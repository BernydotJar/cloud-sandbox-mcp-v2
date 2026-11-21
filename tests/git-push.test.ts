import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { WorkspaceRecord } from '../src/domain.js';
import { DockerRuntime } from '../src/runtime/docker.js';
import { WorkspaceService } from '../src/services/workspace-service.js';
import { WorkspaceStore } from '../src/store/workspace-store.js';

const execFileAsync = promisify(execFile);
const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return result.stdout;
}

function testConfig(dir: string): AppConfig {
  return {
    PORT: 3000,
    BIND_HOST: '127.0.0.1',
    MCP_DATA_DIR: dir,
    HOST_DATA_DIR: dir,
    MCP_PATH_SECRET: 'test-secret-at-least-16-characters',
    SANDBOX_IMAGE: 'test:latest',
    SANDBOX_MODE: 'workstation',
    SANDBOX_NETWORK: 'bridge',
    SANDBOX_MEMORY: '1g',
    SANDBOX_CPUS: '1',
    SANDBOX_PIDS_LIMIT: 128,
    INNER_DOCKER_STORAGE_DRIVER: 'vfs',
    COMMAND_TIMEOUT_SECONDS: 30,
    COMMAND_MAX_TIMEOUT_SECONDS: 30,
    MAX_OUTPUT_BYTES: 100_000,
    MAX_FILE_BYTES: 100_000,
    ALLOWED_GIT_HOSTS: 'github.com',
    ALLOWED_HOSTS: 'localhost,127.0.0.1',
    ENABLE_GIT_PUSH: true,
    ENABLE_WORKSPACE_DESTROY: false,
    ENABLE_RUNTIME_RECREATE: true,
    GIT_AUTHOR_NAME: 'Test Agent',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GITHUB_TOKEN: 'injected-test-token',
    dataDir: dir,
    hostDataDir: dir,
    workstationMode: true,
    allowedGitHosts: new Set(['github.com']),
    allowedHosts: ['localhost', '127.0.0.1'],
    mcpPath: '/mcp/test-secret-at-least-16-characters'
  };
}

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-git-push-'));
  temporaryDirs.push(dir);
  const store = new WorkspaceStore(dir, dir);
  const id = '11111111-1111-4111-8111-111111111111';
  await store.prepare(id);
  const repoDir = store.repoDir(id);
  const remoteDir = path.join(dir, 'remote.git');
  await git(dir, 'init', '--bare', remoteDir);
  await git(repoDir, 'init', '--initial-branch', 'main');
  await git(repoDir, 'config', 'user.name', 'Test Agent');
  await git(repoDir, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(repoDir, 'README.md'), 'fixture\n', 'utf8');
  await git(repoDir, 'add', 'README.md');
  await git(repoDir, 'commit', '-m', 'test: fixture');
  await git(repoDir, 'remote', 'add', 'origin', remoteDir);
  const now = new Date().toISOString();
  const record: WorkspaceRecord = {
    id,
    repositoryUrl: 'https://github.com/example/repo.git',
    requestedBranch: 'main',
    resolvedBranch: 'main',
    containerName: `cloud-sandbox-${id}`,
    image: 'test:latest',
    state: 'ready',
    createdAt: now,
    updatedAt: now
  };
  await store.save(record);
  const cfg = testConfig(dir);
  const runtime = new DockerRuntime(cfg);
  const ownership = vi.spyOn(runtime, 'fixOwnership');
  const service = new WorkspaceService(cfg, store, runtime);
  return { store, service, ownership, remoteDir, repoDir };
}

describe('WorkspaceService.push', () => {
  it('pushes a slash-delimited branch without starting a Docker ownership helper', async () => {
    const { store, service, ownership, remoteDir } = await createFixture();

    const result = await service.push(
      '11111111-1111-4111-8111-111111111111',
      'origin',
      'agent/inc-032-dual-social-connection-checkpoint'
    );

    expect(result.exitCode).toBe(0);
    expect(ownership).not.toHaveBeenCalled();
    expect((await git(remoteDir, 'rev-parse', 'refs/heads/agent/inc-032-dual-social-connection-checkpoint')).trim()).toMatch(/^[a-f0-9]{40}$/);
    const history = await store.history('11111111-1111-4111-8111-111111111111', 10);
    expect(history.at(-1)).toMatchObject({
      tool: 'git_push',
      command: 'git push origin HEAD:agent/inc-032-dual-social-connection-checkpoint',
      exitCode: 0
    });
    expect(JSON.stringify(history)).not.toContain('injected-test-token');
  });

  it('returns and records the Git failure instead of masking it with Docker', async () => {
    const { store, service, ownership, repoDir } = await createFixture();
    await git(repoDir, 'remote', 'set-url', 'origin', path.join(repoDir, 'missing.git'));

    const result = await service.push(
      '11111111-1111-4111-8111-111111111111',
      'origin',
      'agent/failing-push'
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/does not appear to be a git repository/i);
    expect(ownership).not.toHaveBeenCalled();
    const history = await store.history('11111111-1111-4111-8111-111111111111', 10);
    expect(history.at(-1)).toMatchObject({ tool: 'git_push', exitCode: result.exitCode });
    expect(JSON.stringify(history)).not.toContain('injected-test-token');
  });
});
