import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { WorkspaceService } from '../services/workspace-service.js';
import { errorMessage } from '../utils/errors.js';

function jsonResult(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    isError
  };
}

async function safely(action: () => Promise<unknown>) {
  try {
    return jsonResult(await action());
  } catch (error) {
    return jsonResult({ error: errorMessage(error) }, true);
  }
}

export function createMcpServer(service: WorkspaceService): McpServer {
  const server = new McpServer({ name: 'cloud-sandbox-mcp', version: '0.2.0' });

  server.registerTool('workspace_create', {
    title: 'Create isolated engineering workspace',
    description: 'Clone an allowed HTTPS Git repository into persistent storage and start a VM-like Linux workstation with root, nested Docker, Python, uv, Node, browser tooling, and persistent home/Docker state.',
    inputSchema: {
      repository_url: z.string().url(),
      branch: z.string().min(1).max(255).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async ({ repository_url, branch }) => await safely(() => service.create({ repositoryUrl: repository_url, ...(branch ? { branch } : {}) })));

  server.registerTool('workspace_list', {
    title: 'List engineering workspaces',
    description: 'List persistent workspaces and current container state.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => await safely(() => service.list()));

  server.registerTool('workspace_status', {
    title: 'Inspect workspace status',
    description: 'Return container state, Git branch/status, and current HEAD for a workspace.',
    inputSchema: { workspace_id: z.uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ workspace_id }) => await safely(() => service.status(workspace_id)));

  server.registerTool('workspace_exec', {
    title: 'Execute command in sandbox',
    description: 'Run a shell command as root inside the isolated workstation. Package installation, nested Docker, services, browsers, and infrastructure CLIs are allowed; git push remains a dedicated audited tool.',
    inputSchema: {
      workspace_id: z.uuid(),
      command: z.string().min(1).max(20_000),
      timeout_seconds: z.number().int().positive().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async ({ workspace_id, command, timeout_seconds }) => await safely(() => service.exec(workspace_id, command, timeout_seconds)));

  server.registerTool('file_read', {
    title: 'Read workspace file',
    description: 'Read a UTF-8 file under the workspace repository. Direct .git access and path traversal are blocked.',
    inputSchema: { workspace_id: z.uuid(), path: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ workspace_id, path }) => await safely(() => service.readFile(workspace_id, path)));

  server.registerTool('file_write', {
    title: 'Write workspace file',
    description: 'Create or replace a UTF-8 file. expected_sha256 provides optimistic concurrency protection.',
    inputSchema: {
      workspace_id: z.uuid(),
      path: z.string().min(1),
      content: z.string(),
      expected_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ workspace_id, path, content, expected_sha256 }) => await safely(() => service.writeFile(workspace_id, path, content, expected_sha256)));

  server.registerTool('file_apply_patch', {
    title: 'Apply unified diff',
    description: 'Apply a unified Git patch to the workspace repository using git apply.',
    inputSchema: { workspace_id: z.uuid(), patch: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, async ({ workspace_id, patch }) => await safely(() => service.applyPatch(workspace_id, patch)));

  server.registerTool('git_diff', {
    title: 'Read Git diff',
    description: 'Return the unstaged or staged binary-safe Git diff.',
    inputSchema: { workspace_id: z.uuid(), staged: z.boolean().default(false) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ workspace_id, staged }) => await safely(() => service.diff(workspace_id, staged)));

  server.registerTool('git_commit', {
    title: 'Commit workspace changes',
    description: 'Stage all workspace changes and create a local commit with the configured bot identity. This does not push.',
    inputSchema: { workspace_id: z.uuid(), message: z.string().min(1).max(500) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ workspace_id, message }) => await safely(() => service.commit(workspace_id, message)));

  server.registerTool('git_push', {
    title: 'Push workspace branch',
    description: 'Push HEAD using an injected GitHub token. Disabled by default and never exposes the token to the workspace container.',
    inputSchema: {
      workspace_id: z.uuid(),
      remote: z.string().min(1).default('origin'),
      branch: z.string().min(1).max(255).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async ({ workspace_id, remote, branch }) => await safely(() => service.push(workspace_id, remote, branch)));

  server.registerTool('project_verify', {
    title: 'Run project verification',
    description: 'Detect Node.js or Python project tooling and run available lint, typecheck, test, and build checks. Dependency installation is opt-in.',
    inputSchema: {
      workspace_id: z.uuid(),
      install_dependencies: z.boolean().default(false),
      checks: z.array(z.string().min(1)).max(10).optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async ({ workspace_id, install_dependencies, checks }) => await safely(() => service.verify(workspace_id, install_dependencies, checks)));

  server.registerTool('workspace_history', {
    title: 'Read execution history',
    description: 'Read recent command and patch execution records for a workspace.',
    inputSchema: { workspace_id: z.uuid(), limit: z.number().int().min(1).max(100).default(20) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ workspace_id, limit }) => await safely(() => service.history(workspace_id, limit)));


  server.registerTool('workspace_recreate_runtime', {
    title: 'Recreate workstation runtime',
    description: 'Replace the workspace container with the current workstation image while preserving the repository, home directory, caches, credentials, and nested Docker data.',
    inputSchema: { workspace_id: z.uuid() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ workspace_id }) => await safely(() => service.recreateRuntime(workspace_id)));

  server.registerTool('workspace_destroy', {
    title: 'Destroy engineering workspace',
    description: 'Remove the workspace container and persistent checkout. Disabled by default.',
    inputSchema: { workspace_id: z.uuid() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, async ({ workspace_id }) => await safely(() => service.destroy(workspace_id)));

  return server;
}
