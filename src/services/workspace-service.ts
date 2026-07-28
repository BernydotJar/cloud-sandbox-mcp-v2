import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { CommandResult, ExecutionRecord, WorkspaceRecord } from '../domain.js';
import { runCommand } from '../runtime/command.js';
import { DockerRuntime } from '../runtime/docker.js';
import { gitAuthEnvironment } from '../runtime/git-auth.js';
import { assertCommandAllowed } from '../runtime/policy.js';
import { WorkspaceStore } from '../store/workspace-store.js';
import { AppError, errorMessage } from '../utils/errors.js';
import { relativePathForContainer, resolveSafeRelativePath } from '../utils/path.js';

interface CreateWorkspaceInput {
  repositoryUrl: string;
  branch?: string;
}

export class WorkspaceService {
  constructor(
    private readonly cfg: AppConfig,
    private readonly store: WorkspaceStore,
    private readonly docker: DockerRuntime
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  private validateRepositoryUrl(repositoryUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(repositoryUrl);
    } catch {
      throw new AppError('repository_url must be a valid HTTPS URL.', 'INVALID_REPOSITORY_URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new AppError('Only HTTPS repository URLs are allowed.', 'UNSUPPORTED_REPOSITORY_PROTOCOL');
    }
    if (!this.cfg.allowedGitHosts.has(parsed.hostname)) {
      throw new AppError(`Git host ${parsed.hostname} is not allowed.`, 'GIT_HOST_NOT_ALLOWED');
    }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed;
  }

  async create(input: CreateWorkspaceInput): Promise<Record<string, unknown>> {
    await this.docker.ensureAvailable();
    if (!(await this.docker.imageExists(this.cfg.SANDBOX_IMAGE))) {
      throw new AppError(
        `Sandbox image ${this.cfg.SANDBOX_IMAGE} is missing. Build docker/sandbox.Dockerfile first.`,
        'SANDBOX_IMAGE_MISSING',
        503
      );
    }

    const repositoryUrl = this.validateRepositoryUrl(input.repositoryUrl).toString();
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: WorkspaceRecord = {
      id,
      repositoryUrl,
      ...(input.branch ? { requestedBranch: input.branch } : {}),
      containerName: `cloud-sandbox-${id}`,
      image: this.cfg.SANDBOX_IMAGE,
      state: 'creating',
      createdAt: now,
      updatedAt: now
    };
    await this.store.prepare(id);
    await this.store.save(record);

    try {
      const repoDir = this.store.repoDir(id);
      await fs.rm(repoDir, { recursive: true, force: true });
      const cloneArgs = ['clone', '--no-tags'];
      if (input.branch) cloneArgs.push('--branch', input.branch, '--single-branch');
      cloneArgs.push(repositoryUrl, repoDir);
      const clone = await runCommand('git', cloneArgs, {
        timeoutMs: this.cfg.COMMAND_MAX_TIMEOUT_SECONDS * 1_000,
        maxOutputBytes: this.cfg.MAX_OUTPUT_BYTES,
        env: gitAuthEnvironment(this.cfg.GITHUB_TOKEN)
      });
      if (clone.exitCode !== 0) throw new AppError(`git clone failed: ${clone.stderr}`, 'GIT_CLONE_FAILED');

      const branch = await this.hostGit(id, ['branch', '--show-current']);
      if (!this.cfg.workstationMode) {
        await this.docker.fixOwnership(this.store.hostRepoDir(id), record.image);
        await this.docker.fixOwnership(this.store.hostHomeDir(id), record.image);
      }
      await this.docker.createContainer({
        name: record.containerName,
        image: record.image,
        hostRepoPath: this.store.hostRepoDir(id),
        hostHomePath: this.store.hostHomeDir(id),
        hostDockerPath: this.store.hostDockerDir(id),
        workspaceId: id
      });

      const ready: WorkspaceRecord = {
        ...record,
        resolvedBranch: branch.stdout.trim(),
        state: 'ready',
        updatedAt: new Date().toISOString()
      };
      await this.store.save(ready);
      return await this.status(id);
    } catch (error) {
      const failed: WorkspaceRecord = {
        ...record,
        state: 'error',
        lastError: errorMessage(error),
        updatedAt: new Date().toISOString()
      };
      await this.store.save(failed);
      await this.docker.remove(record.containerName).catch(() => undefined);
      throw error;
    }
  }

  async list(): Promise<Record<string, unknown>[]> {
    const records = await this.store.list();
    return await Promise.all(records.map(async record => {
      const container = await this.docker.inspect(record.containerName);
      return {
        id: record.id,
        repository_url: record.repositoryUrl,
        branch: record.resolvedBranch ?? record.requestedBranch ?? null,
        state: record.state,
        container_status: container.status,
        created_at: record.createdAt,
        updated_at: record.updatedAt
      };
    }));
  }

  async status(id: string): Promise<Record<string, unknown>> {
    const workspace = await this.store.get(id);
    const container = await this.docker.inspect(workspace.containerName);
    if (!(await exists(path.join(this.store.repoDir(id), '.git')))) {
      return { workspace, container, git: { available: false } };
    }
    const gitStatus = container.running
      ? await this.containerGit(workspace, ['status', '--short', '--branch'])
      : await this.hostGit(id, ['status', '--short', '--branch']);
    const head = container.running
      ? await this.containerGit(workspace, ['log', '-1', '--pretty=format:%H%n%h %s%n%an%n%aI'])
      : await this.hostGit(id, ['log', '-1', '--pretty=format:%H%n%h %s%n%an%n%aI']);
    return {
      workspace,
      container,
      git: {
        available: true,
        status: gitStatus.stdout,
        head: head.stdout
      }
    };
  }

  async exec(id: string, command: string, timeoutSeconds?: number): Promise<CommandResult> {
    assertCommandAllowed(command, this.cfg.workstationMode);
    const workspace = await this.ensureRunning(id);
    const timeout = Math.min(
      timeoutSeconds ?? this.cfg.COMMAND_TIMEOUT_SECONDS,
      this.cfg.COMMAND_MAX_TIMEOUT_SECONDS
    ) * 1_000;
    const startedAt = new Date().toISOString();
    const result = await this.docker.exec(workspace.containerName, command, timeout);
    await this.recordExecution(id, 'workspace_exec', command, startedAt, result);
    return result;
  }

  async readFile(id: string, requestedPath: string): Promise<Record<string, unknown>> {
    await this.store.get(id);
    const absolutePath = resolveSafeRelativePath(this.store.repoDir(id), requestedPath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw new AppError('Requested path is not a regular file.', 'NOT_A_FILE');
    if (stat.size > this.cfg.MAX_FILE_BYTES) {
      throw new AppError(`File exceeds MAX_FILE_BYTES (${this.cfg.MAX_FILE_BYTES}).`, 'FILE_TOO_LARGE');
    }
    const content = await fs.readFile(absolutePath, 'utf8');
    return {
      path: requestedPath,
      bytes: stat.size,
      sha256: createHash('sha256').update(content).digest('hex'),
      content
    };
  }

  async writeFile(
    id: string,
    requestedPath: string,
    content: string,
    expectedSha256?: string
  ): Promise<Record<string, unknown>> {
    if (Buffer.byteLength(content, 'utf8') > this.cfg.MAX_FILE_BYTES) {
      throw new AppError(`Content exceeds MAX_FILE_BYTES (${this.cfg.MAX_FILE_BYTES}).`, 'FILE_TOO_LARGE');
    }
    const workspace = await this.ensureRunning(id);
    const absolutePath = resolveSafeRelativePath(this.store.repoDir(id), requestedPath);
    if (expectedSha256) {
      const existing = await fs.readFile(absolutePath, 'utf8').catch(() => undefined);
      const actual = existing === undefined ? null : createHash('sha256').update(existing).digest('hex');
      if (actual !== expectedSha256) {
        throw new AppError(`File changed concurrently. Expected ${expectedSha256}, found ${actual}.`, 'SHA_MISMATCH', 409);
      }
    }

    const relativePath = relativePathForContainer(requestedPath);
    const script = [
      "const fs=require('fs');",
      "const path=require('path');",
      "const target=path.resolve('/workspace',process.argv[1]);",
      "if(!target.startsWith('/workspace/')) process.exit(41);",
      "fs.mkdirSync(path.dirname(target),{recursive:true});",
      "const chunks=[];process.stdin.on('data',c=>chunks.push(c));",
      "process.stdin.on('end',()=>fs.writeFileSync(target,Buffer.concat(chunks)));"
    ].join('');
    const result = await this.docker.execWithInput(
      workspace.containerName,
      'node',
      ['-e', script, relativePath],
      content,
      30_000
    );
    if (result.exitCode !== 0) throw new AppError(`File write failed: ${result.stderr}`, 'FILE_WRITE_FAILED');
    const sha256 = createHash('sha256').update(content).digest('hex');
    return { path: requestedPath, bytes: Buffer.byteLength(content), sha256 };
  }

  async applyPatch(id: string, patch: string): Promise<CommandResult> {
    if (Buffer.byteLength(patch, 'utf8') > this.cfg.MAX_FILE_BYTES * 2) {
      throw new AppError('Patch is too large.', 'PATCH_TOO_LARGE');
    }
    const workspace = await this.ensureRunning(id);
    const startedAt = new Date().toISOString();
    const result = await this.docker.execWithInput(
      workspace.containerName,
      'git',
      ['apply', '--whitespace=nowarn', '-'],
      patch,
      60_000
    );
    await this.recordExecution(id, 'file_apply_patch', 'git apply -', startedAt, result);
    return result;
  }

  async diff(id: string, staged = false): Promise<CommandResult> {
    const workspace = await this.ensureRunning(id);
    return await this.containerGit(workspace, ['diff', ...(staged ? ['--cached'] : []), '--no-ext-diff', '--binary']);
  }

  async commit(id: string, message: string): Promise<CommandResult> {
    if (!message.trim()) throw new AppError('Commit message cannot be empty.', 'EMPTY_COMMIT_MESSAGE');
    const workspace = await this.ensureRunning(id);
    const add = await this.containerGit(workspace, ['add', '--all']);
    if (add.exitCode !== 0) return add;
    return await this.containerGit(workspace, [
      '-c', `user.name=${this.cfg.GIT_AUTHOR_NAME}`,
      '-c', `user.email=${this.cfg.GIT_AUTHOR_EMAIL}`,
      'commit', '-m', message
    ]);
  }

  async push(id: string, remote = 'origin', branch?: string): Promise<CommandResult> {
    if (!this.cfg.ENABLE_GIT_PUSH) {
      throw new AppError('git_push is disabled. Set ENABLE_GIT_PUSH=true after configuring a short-lived token.', 'GIT_PUSH_DISABLED', 403);
    }
    if (!this.cfg.GITHUB_TOKEN) {
      throw new AppError('GITHUB_TOKEN is required for git_push.', 'GITHUB_TOKEN_MISSING', 503);
    }
    const workspace = await this.store.get(id);
    const targetBranch = branch ?? workspace.resolvedBranch ?? workspace.requestedBranch;
    if (!targetBranch) throw new AppError('Unable to determine branch to push.', 'BRANCH_UNKNOWN');
    const startedAt = new Date().toISOString();
    const result = await this.hostGit(id, ['push', remote, `HEAD:${targetBranch}`], gitAuthEnvironment(this.cfg.GITHUB_TOKEN));
    await this.recordExecution(id, 'git_push', `git push ${remote} HEAD:${targetBranch}`, startedAt, result);
    return result;
  }

  async verify(id: string, install: boolean, requestedChecks?: string[]): Promise<Record<string, unknown>> {
    await this.ensureRunning(id);
    const repoDir = this.store.repoDir(id);
    const checks: Array<{ name: string; command: string }> = [];
    let installCommand: string | undefined;

    const packageJsonPath = path.join(repoDir, 'package.json');
    if (await exists(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { scripts?: Record<string, string> };
      const manager = await detectNodePackageManager(repoDir);
      installCommand = manager.install;
      const defaults = ['lint', 'typecheck', 'test', 'build'];
      for (const name of requestedChecks ?? defaults) {
        if (packageJson.scripts?.[name]) checks.push({ name, command: `${manager.run} ${name}` });
      }
    } else if (await exists(path.join(repoDir, 'pyproject.toml')) || await exists(path.join(repoDir, 'requirements.txt'))) {
      installCommand = await exists(path.join(repoDir, 'requirements.txt'))
        ? 'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt'
        : 'python3 -m venv .venv && .venv/bin/pip install -e .';
      checks.push({ name: 'pytest', command: '.venv/bin/python -m pytest' });
    } else {
      throw new AppError('No supported Node.js or Python project manifest was found.', 'PROJECT_TYPE_UNKNOWN');
    }

    const results: Array<Record<string, unknown>> = [];
    if (install && installCommand) {
      const result = await this.exec(id, installCommand, this.cfg.COMMAND_MAX_TIMEOUT_SECONDS);
      results.push({ name: 'install', command: installCommand, ...result });
      if (result.exitCode !== 0) return { success: false, results };
    }

    for (const check of checks) {
      const result = await this.exec(id, check.command, this.cfg.COMMAND_MAX_TIMEOUT_SECONDS);
      results.push({ ...check, ...result });
      if (result.exitCode !== 0) return { success: false, results };
    }
    return { success: true, results };
  }

  async history(id: string, limit: number): Promise<ExecutionRecord[]> {
    return await this.store.history(id, limit);
  }

  async recreateRuntime(id: string): Promise<Record<string, unknown>> {
    if (!this.cfg.ENABLE_RUNTIME_RECREATE) {
      throw new AppError('Runtime recreation is disabled.', 'RUNTIME_RECREATE_DISABLED', 403);
    }
    const workspace = await this.store.get(id);
    await this.store.prepare(id);
    await this.docker.remove(workspace.containerName);
    await this.docker.createContainer({
      name: workspace.containerName,
      image: this.cfg.SANDBOX_IMAGE,
      hostRepoPath: this.store.hostRepoDir(id),
      hostHomePath: this.store.hostHomeDir(id),
      hostDockerPath: this.store.hostDockerDir(id),
      workspaceId: id
    });
    const updated: WorkspaceRecord = {
      ...workspace,
      image: this.cfg.SANDBOX_IMAGE,
      state: 'ready',
      updatedAt: new Date().toISOString(),
      lastError: undefined
    };
    await this.store.save(updated);
    return await this.status(id);
  }

  async destroy(id: string): Promise<Record<string, unknown>> {
    if (!this.cfg.ENABLE_WORKSPACE_DESTROY) {
      throw new AppError('workspace_destroy is disabled.', 'WORKSPACE_DESTROY_DISABLED', 403);
    }
    const workspace = await this.store.get(id);
    await this.docker.remove(workspace.containerName);
    await this.store.remove(id);
    return { destroyed: true, workspace_id: id };
  }

  private async ensureRunning(id: string): Promise<WorkspaceRecord> {
    const workspace = await this.store.get(id);
    const state = await this.docker.inspect(workspace.containerName);
    if (state.status === 'missing') throw new AppError('Workspace container is missing.', 'CONTAINER_MISSING', 409);
    if (!state.running) await this.docker.start(workspace.containerName);
    return workspace;
  }

  private async containerGit(workspace: WorkspaceRecord, args: string[]): Promise<CommandResult> {
    return await this.docker.execArgv(
      workspace.containerName,
      'git',
      args,
      this.cfg.COMMAND_MAX_TIMEOUT_SECONDS * 1_000
    );
  }

  private async hostGit(id: string, args: string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> {
    await this.store.get(id).catch(error => {
      if (args[0] === 'branch' && (error as AppError).code === 'WORKSPACE_NOT_FOUND') return undefined;
      throw error;
    });
    return await runCommand(
      'git',
      ['-c', `safe.directory=${this.store.repoDir(id)}`, ...args],
      {
        cwd: this.store.repoDir(id),
        timeoutMs: this.cfg.COMMAND_MAX_TIMEOUT_SECONDS * 1_000,
        maxOutputBytes: this.cfg.MAX_OUTPUT_BYTES,
        env
      }
    );
  }

  private async recordExecution(
    workspaceId: string,
    tool: string,
    command: string,
    startedAt: string,
    result: CommandResult
  ): Promise<void> {
    await this.store.appendExecution({
      id: randomUUID(),
      workspaceId,
      tool,
      command,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr
    });
  }
}

async function exists(target: string): Promise<boolean> {
  return await fs.access(target).then(() => true).catch(() => false);
}

async function detectNodePackageManager(repoDir: string): Promise<{ install: string; run: string }> {
  if (await exists(path.join(repoDir, 'pnpm-lock.yaml'))) return { install: 'pnpm install --frozen-lockfile', run: 'pnpm run' };
  if (await exists(path.join(repoDir, 'yarn.lock'))) return { install: 'yarn install --frozen-lockfile', run: 'yarn run' };
  if (await exists(path.join(repoDir, 'package-lock.json'))) return { install: 'npm ci', run: 'npm run' };
  return { install: 'npm install', run: 'npm run' };
}
