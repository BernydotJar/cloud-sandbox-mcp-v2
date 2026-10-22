import { registerDesktopTools } from './desktop-tools.js';
import { registerBrowserRuntimeTools } from './browser-runtime-tools.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { WorkspaceService } from '../services/workspace-service.js';
import { ComputerUseService } from '../services/computer-use-service.js';
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

export function createMcpServer(service: WorkspaceService, computer?: ComputerUseService): McpServer {
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

  if (computer) {
    registerBrowserRuntimeTools(server, computer);
    registerDesktopTools(server, computer);
    const browserSchema = z.enum(['chrome', 'edge']);
    const targetSchema = {
      browser: browserSchema,
      window_index: z.number().int().min(1),
      tab_index: z.number().int().min(1),
      expected_url: z.string().url().max(2048),
      expected_title: z.string().min(1).max(300).optional()
    };

    server.registerTool('computer_use_session_begin', {
      title: 'Authorize a temporary Mac task session',
      description: 'Request ONE local macOS approval for a time-limited, action-budgeted delegated Chrome/Edge session. Subsequent clicks and typing with session_id require no further local approvals until expiration, revocation or exhaustion. This can operate on sensitive pages; obtain clear user task instructions before requesting.',
      inputSchema: {
        scope: z.enum(['chrome','edge','both','desktop']),
        duration_minutes: z.number().int().min(1).max(30).default(20),
        max_actions: z.number().int().min(1).max(200).default(120),
        purpose: z.string().min(10).max(300)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    }, async (input) => await safely(() => computer.beginSession(input)));

    server.registerTool('computer_use_session_status', {
      title: 'Check delegated Computer Use session',
      description: 'Read the current macOS session scope, expiry and remaining action budget. Does not return the session token.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async () => await safely(() => computer.sessionStatus()));

    server.registerTool('computer_use_session_end', {
      title: 'Stop delegated Mac control',
      description: 'Revoke the current delegated Computer Use session immediately. Use at task completion, cancellation or whenever user requests stop. The local operator can also restart the host bridge to revoke.',
      inputSchema: { session_id: z.string().regex(/^[a-f0-9]{48}$/).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ session_id }) => await safely(() => computer.endSession(session_id)));

    const macTarget = {
      bundle_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*(?:\\.[A-Za-z0-9][A-Za-z0-9-]*)+$/),
      pid:z.number().int().positive(),
      window_index:z.number().int().min(1).max(128),
      expected_title:z.string().min(1).max(300)
    };
    server.registerTool('mac_apps', {
      description:'List ONLY the macOS desktop applications explicitly allowlisted by the operator.',
      inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },()=>safely(()=>computer.desktop({operation:'apps'})));
    server.registerTool('mac_windows', {
      description:'Discover windows for an explicitly allowlisted macOS application, returning fresh PID, index and exact title.',
      inputSchema:{bundle_id:macTarget.bundle_id},
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },input=>safely(()=>computer.desktop({operation:'windows',...input})));
    server.registerTool('mac_accessibility_tree', {
      description:'Bounded accessibility structure for a freshly selected native window; no form values or keystrokes returned.',
      inputSchema:macTarget,
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },input=>safely(()=>computer.desktop({operation:'tree',...input})));
    server.registerTool('mac_screenshot', {
      description:'Capture an allowlisted macOS window. Foreground windows may contain sensitive data; requires Screen Recording.',
      inputSchema:macTarget,
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async input=>{
      try {
        const image=await computer.desktop({operation:'screenshot',...input}) as {mime_type?:string;base64?:string};
        if(image.mime_type!=='image/png'||typeof image.base64!=='string'||image.base64.length>12000000)
          return jsonResult({error:'INVALID_MAC_SCREENSHOT'},true);
        return {content:[{type:'image' as const,mimeType:'image/png',data:image.base64}]};
      }catch(error){return jsonResult({error:errorMessage(error)},true);}
    });
    server.registerTool('mac_action', {
      description:'Perform ONE native macOS UI event in an allowlisted window, requiring a separate mac/all delegated session, fresh window identity, and unique request_id. No arbitrary scripts. Never retry uncertain events; inspect state.',
      inputSchema:{...macTarget,session_id:z.string().regex(/^[a-f0-9]{48}$/),
        request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/),
        reason:z.string().min(10).max(300),
        action:z.enum(['click','type_text','press_key','scroll']),
        element_path:z.string().max(30).optional(),
        expected_role:z.string().max(100).optional(),
        expected_name:z.string().max(200).optional(),
        text:z.string().max(2000).optional(),
        key:z.enum(['tab','escape','enter','space','backspace','up','down','left','right','pageup','pagedown']).optional(),
        direction:z.enum(['up','down']).optional(),
        steps:z.number().int().min(1).max(8).optional()
      },annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
    },input=>safely(()=>computer.desktop({operation:'action',...input})));
    server.registerTool('mac_focus', {
      description:'Focus an allowlisted native Mac window after explicit mac/all session authorization.',
      inputSchema:{...macTarget,session_id:z.string().regex(/^[a-f0-9]{48}$/),request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/),reason:z.string().min(10).max(300)},
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}
    },input=>safely(()=>computer.desktop({operation:'focus',...input})));
    server.registerTool('mac_launch', {
      description:'Launch only an operator-allowlisted macOS app under explicit mac/all session authorization.',
      inputSchema:{bundle_id:macTarget.bundle_id,session_id:z.string().regex(/^[a-f0-9]{48}$/),request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/),reason:z.string().min(10).max(300)},
      annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}
    },input=>safely(()=>computer.desktop({operation:'launch',...input})));
    server.registerTool('computer_use_status', {
      title: 'Computer Use connectivity',
      description: 'Inspect availability of the native macOS Computer Use bridge inside Cloud Sandbox MCP V2. Never discloses credentials.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async () => await safely(() => computer.status()));

    server.registerTool('computer_use_state', {
      title: 'Discover Chrome and Edge sessions',
      description: 'Discover currently open native Mac Chrome/Edge windows and tabs with safe URLs (query strings and fragments removed). Browser and tab indices are dynamic.',
      inputSchema: { browser: browserSchema.optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ browser }) => await safely(() => computer.state(browser)));

    server.registerTool('computer_use_focus', {
      title: 'Focus a Mac browser tab',
      description: 'Focus a Chrome/Edge tab selected by fresh state discovery and verify its expected URL before acting. Does not submit a form.',
      inputSchema: targetSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (target) => await safely(() => computer.focus(target)));

    server.registerTool('computer_use_screenshot', {
      title: 'Inspect Mac browser window screenshot',
      description: 'Request a screenshot of a selected authenticated Mac browser window via the native macOS bridge. Requires macOS Screen Recording permission; never stores screenshots in execution logs.',
      inputSchema: targetSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (target) => {
      try {
        const screenshot = await computer.screenshot(target);
        return { content: [{ type: 'image' as const, ...screenshot }] };
      } catch (error) {
        return jsonResult({ error: errorMessage(error) }, true);
      }
    });

    server.registerTool('computer_use_action', {
      title: 'Perform an approved Mac UI action',
      description: 'Click, type or press a key in an authenticated Chrome/Edge tab. Pass session_id from an approved computer_use_session_begin grant on EVERY action for uninterrupted delegated execution. Without session_id, Mac approval is required per action. Rechecks URL and tab identity immediately before acting. Never executes arbitrary JS, scripts or shell commands.',
      inputSchema: {
        ...targetSchema,
        action: z.enum(['click', 'type_text', 'press_key']),
        x: z.number().int().min(0).max(32768).optional(),
        y: z.number().int().min(0).max(32768).optional(),
        text: z.string().max(2000).optional(),
        key: z.enum(['tab', 'escape', 'enter', 'space', 'backspace', 'up', 'down', 'left', 'right']).optional(),
        reason: z.string().min(10).max(300),
        session_id: z.string().regex(/^[a-f0-9]{48}$/).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    }, async (input) => await safely(() => computer.action(input)));
  }

  return server;
}
