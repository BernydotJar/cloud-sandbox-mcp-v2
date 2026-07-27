import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ExecutionRecord, WorkspaceRecord } from '../domain.js';
import { AppError } from '../utils/errors.js';
import { assertWorkspaceId } from '../utils/path.js';

export class WorkspaceStore {
  constructor(
    private readonly dataDir: string,
    private readonly hostDataDir: string
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.workspacesDir(), { recursive: true });
  }

  workspacesDir(): string {
    return path.join(this.dataDir, 'workspaces');
  }

  hostWorkspacesDir(): string {
    return path.join(this.hostDataDir, 'workspaces');
  }

  workspaceDir(id: string): string {
    return path.join(this.workspacesDir(), assertWorkspaceId(id));
  }

  hostWorkspaceDir(id: string): string {
    return path.join(this.hostWorkspacesDir(), assertWorkspaceId(id));
  }

  repoDir(id: string): string {
    return path.join(this.workspaceDir(id), 'repo');
  }

  hostRepoDir(id: string): string {
    return path.join(this.hostWorkspaceDir(id), 'repo');
  }

  homeDir(id: string): string {
    return path.join(this.workspaceDir(id), 'home');
  }

  hostHomeDir(id: string): string {
    return path.join(this.hostWorkspaceDir(id), 'home');
  }

  dockerDir(id: string): string {
    return path.join(this.workspaceDir(id), 'docker');
  }

  hostDockerDir(id: string): string {
    return path.join(this.hostWorkspaceDir(id), 'docker');
  }

  private metadataPath(id: string): string {
    return path.join(this.workspaceDir(id), 'workspace.json');
  }

  private historyPath(id: string): string {
    return path.join(this.workspaceDir(id), 'executions.jsonl');
  }

  async prepare(id: string): Promise<void> {
    await fs.mkdir(this.repoDir(id), { recursive: true });
    await fs.mkdir(this.homeDir(id), { recursive: true });
    await fs.mkdir(this.dockerDir(id), { recursive: true });
  }

  async save(record: WorkspaceRecord): Promise<void> {
    await fs.mkdir(this.workspaceDir(record.id), { recursive: true });
    const target = this.metadataPath(record.id);
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, target);
  }

  async get(id: string): Promise<WorkspaceRecord> {
    try {
      return JSON.parse(await fs.readFile(this.metadataPath(id), 'utf8')) as WorkspaceRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError(`Workspace ${id} was not found.`, 'WORKSPACE_NOT_FOUND', 404);
      }
      throw error;
    }
  }

  async list(): Promise<WorkspaceRecord[]> {
    await this.initialize();
    const entries = await fs.readdir(this.workspacesDir(), { withFileTypes: true });
    const records: WorkspaceRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        records.push(await this.get(entry.name));
      } catch {
        // Ignore incomplete directories; workspace_create will record actionable errors.
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async appendExecution(record: ExecutionRecord): Promise<void> {
    await fs.appendFile(this.historyPath(record.workspaceId), `${JSON.stringify(record)}\n`, 'utf8');
  }

  async history(id: string, limit: number): Promise<ExecutionRecord[]> {
    await this.get(id);
    try {
      const text = await fs.readFile(this.historyPath(id), 'utf8');
      return text.trim().split('\n').filter(Boolean).slice(-limit).map(line => JSON.parse(line) as ExecutionRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.workspaceDir(id), { recursive: true, force: true });
  }
}
