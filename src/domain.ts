export type WorkspaceState = 'creating' | 'ready' | 'error' | 'stopped';

export interface WorkspaceRecord {
  id: string;
  repositoryUrl: string;
  requestedBranch?: string;
  resolvedBranch?: string;
  containerName: string;
  image: string;
  state: WorkspaceState;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface ExecutionRecord {
  id: string;
  workspaceId: string;
  tool: string;
  command?: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface CommandResult {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}
