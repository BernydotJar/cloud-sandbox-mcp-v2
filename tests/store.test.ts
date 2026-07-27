import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../src/store/workspace-store.js';
import type { WorkspaceRecord } from '../src/domain.js';

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('WorkspaceStore', () => {
  it('persists metadata and execution history', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-store-'));
    temporaryDirs.push(dir);
    const store = new WorkspaceStore(dir, dir);
    const id = '11111111-1111-4111-8111-111111111111';
    const record: WorkspaceRecord = {
      id,
      repositoryUrl: 'https://github.com/example/repo.git',
      containerName: `cloud-sandbox-${id}`,
      image: 'test:latest',
      state: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await store.prepare(id);
    await store.save(record);
    expect((await store.get(id)).repositoryUrl).toBe(record.repositoryUrl);

    await store.appendExecution({
      id: 'exec-1', workspaceId: id, tool: 'workspace_exec', command: 'npm test',
      startedAt: record.createdAt, finishedAt: record.updatedAt,
      exitCode: 0, timedOut: false, stdout: 'ok', stderr: ''
    });
    expect(await store.history(id, 10)).toHaveLength(1);
  });
});
