import { registerBrowserRuntimeTools } from './browser-runtime-tools.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { WorkspaceService } from '../services/workspace-service.js';
import { ComputerUseService } from '../services/computer-use-service.js';
import { BackgroundMacService } from '../services/background-mac-service.js';
import { SameMacAXService } from '../services/same-mac-ax-service.js';
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

export function createMcpServer(service: WorkspaceService,
  computer?: ComputerUseService, backgroundMac?: BackgroundMacService,
  sameMacAX?: SameMacAXService): McpServer {
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
    const browserSchema = z.enum(['chrome', 'edge']);
    const targetSchema = {
      browser: browserSchema,
      window_index: z.number().int().min(1),
      tab_index: z.number().int().min(1),
      expected_url: z.string().url().max(2048),
      expected_title: z.string().min(1).max(300),
      background_required: z.boolean().default(true)
    };

    server.registerTool('computer_use_session_begin', {
      title: 'Authorize a temporary Mac task session',
      description: 'Request a scoped Mac Chrome/Edge delegated session. Default mode requires one local approval and enforces max_actions. If the Mac operator explicitly enabled the trusted Edu notice, qualifying single-browser requests receive up to 30 minutes and unlimited actions without modal approval; max_actions is ignored in that mode, and a closable 20-second notice is shown. The configured HTTPS allowlist, expiry, revocation and audit still apply. Obtain clear user task instructions first.',
      inputSchema: {
        scope: z.enum(['chrome','edge','both']),
        duration_minutes: z.number().int().min(1).max(30).default(20),
        max_actions: z.number().int().min(1).max(200).default(120),
        purpose: z.string().min(10).max(300)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    }, async (input) => await safely(() => computer.beginSession(input)));

    server.registerTool('computer_use_session_status', {
      title: 'Check delegated Computer Use session',
      description: 'Read the delegated session scope and expiry. Trusted operator sessions also enforce a finite per-session action budget (1..200), while avoiding per-action approval prompts. Does not expose the session token.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async () => await safely(() => computer.sessionStatus()));

    server.registerTool('computer_use_session_end', {
      title: 'Stop delegated Mac control',
      description: 'Revoke the current delegated Computer Use session immediately. Use at task completion, cancellation or whenever user requests stop. The local operator can also restart the host bridge to revoke.',
      inputSchema: { session_id: z.string().regex(/^[a-f0-9]{48}$/).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({ session_id }) => await safely(() => computer.endSession(session_id)));

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
      description: 'FOREGROUND ONLY: focus activates a shared Mac Chrome/Edge window. Defaults background_required=true and fails closed. Set background_required=false ONLY for an explicitly approved foreground task. Requires exact URL, title and fresh tab identity.',
      inputSchema: targetSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (target) => await safely(() => computer.focus(target)));

    server.registerTool('computer_use_screenshot', {
      title: 'Inspect Mac browser window screenshot',
      description: 'FOREGROUND POSSIBLE: native screenshot may activate the Mac browser window. Defaults background_required=true and rejects native capture. For expressly approved foreground use background_required=false, exact tab identity and optional include_ax. This is not isolated/background CUA or CDP.',
      inputSchema: {...targetSchema, include_ax:z.boolean().optional()},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async ({include_ax,...target}) => {
      try {
        const screenshot = await computer.screenshot(target,{include_ax});
        // Image is kept unchanged for old clients. Text metadata gives Mac
        // point geometry and a short-lived opaque image-pixel click reference.
        const {geometry,ax_snapshot,...image}=screenshot;
        return { content: [
          { type:'image' as const,...image },
          ...(geometry ? [{
            type:'text' as const,
            text:JSON.stringify({geometry})
          }] : []),
          ...(ax_snapshot ? [{
            type:'text' as const,
            text:JSON.stringify({ax_snapshot})
          }] : [])
        ] };
      } catch (error) {
        return jsonResult({ error: errorMessage(error) }, true);
      }
    });

    server.registerTool('computer_use_action', {
      title: 'Perform an approved Mac UI action',
      description: 'FOREGROUND ONLY: the native macOS event may activate a window or send global keystrokes. Defaults background_required=true and fails closed. background_required=false is allowed only for explicitly approved foreground UI work, exact tab identity, task grant and allowlist. AX refs require separately deployed helper; native is NOT an offscreen executor, CDP or Playwright. performed=true is not persisted readback.',
      inputSchema: {
        ...targetSchema,
        action: z.enum(['click', 'type_text', 'press_key','ax_press','ax_set_value']),
        x: z.number().int().min(-32768).max(32768).optional(),
        y: z.number().int().min(-32768).max(32768).optional(),
        coordinate_space: z.enum(['screen_points','screenshot_pixels']).optional(),
        screenshot_ref: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        ax_node_ref: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        ax_revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        text: z.string().max(2000).optional(),
        key: z.enum(['tab', 'escape', 'enter', 'space', 'backspace', 'up', 'down', 'left', 'right']).optional(),
        reason: z.string().min(10).max(300),
        session_id: z.string().regex(/^[a-f0-9]{48}$/).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    }, async (input) => await safely(() => computer.action(input)));
  }

  if(backgroundMac){
    server.registerTool('mac_background_cua_status',{
      title:'Isolated macOS Desktop CUA worker status',
      description:'Check the independently identified macOS worker, GUI session and AX readiness. Does not control the operator desktop. Ready=false means the P0 is not yet operational.',
      inputSchema:{},
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async()=>await safely(()=>backgroundMac.status()));
    server.registerTool('mac_background_cua_snapshot',{
      title:'Inspect an isolated macOS application AX tree',
      description:'Read a named application window on the independent macOS GUI worker, not the operator Mac. Requires worker identity, GUI session and Accessibility readiness.',
      inputSchema:{
        bundle_id:z.string().min(8).max(120).regex(/^[a-zA-Z0-9.-]+$/),
        window_title:z.string().min(1).max(120)
      },
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async(input)=>await safely(()=>backgroundMac.snapshot(input)));
    server.registerTool('mac_background_cua_screenshot',{
      title:'Capture screen of isolated macOS worker',
      description:'Screen recording of the separate macOS GUI worker only. This never captures the operator desktop, does not focus windows, and fails closed if guest recording permission is unavailable.',
      inputSchema:{},
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async()=>{
      try {
        const image=await backgroundMac.screenshot();
        return {content:[{type:'image' as const,...image}]};
      }catch(error){return jsonResult({error:errorMessage(error)},true);}
    });
    server.registerTool('mac_background_cua_action',{
      title:'Execute a targeted AX action on isolated Mac worker',
      description:'Perform AXPress or AXSetValue using a fresh opaque node reference on the verified separate macOS machine. No global host keyboard or mouse. Request IDs are durable and replay-blocked; dispatch is not proof of persisted business state.',
      inputSchema:{
        bundle_id:z.string().min(8).max(120).regex(/^[a-zA-Z0-9.-]+$/),
        window_title:z.string().min(1).max(120),
        action:z.enum(['press','set_value']),
        node_ref:z.string().regex(/^[a-f0-9]{64}$/),
        expected_revision:z.string().regex(/^[a-f0-9]{64}$/),
        request_id:z.string().regex(/^[a-f0-9]{64}$/),
        reason:z.string().min(10).max(300),
        value:z.string().min(1).max(2000).optional()
      },
      annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
    },async(input)=>await safely(()=>backgroundMac.action(input)));
  }

  if(sameMacAX){
    server.registerTool('mac_same_background_status',{
      title:'Same Mac background native Accessibility status',
      description:'Inspect native AX availability on the current operator Mac. No VM, new Mac, browser debugging, activation, pointer motion, or keystrokes.',
      inputSchema:{},
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async()=>await safely(()=>sameMacAX.status()));
    server.registerTool('mac_same_background_snapshot',{
      title:'Inspect background Mac app AX tree without focusing it',
      description:'Find one running non-frontmost Mac application window by bundle ID and exact title. Returns fresh opaque AX control references and safe values; never activates the app.',
      inputSchema:{
        bundle_id:z.string().min(8).max(120).regex(/^[a-zA-Z0-9.-]+$/),
        window_title:z.string().min(1).max(120)
      },
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async(input)=>await safely(()=>sameMacAX.snapshot(input)));
    server.registerTool('mac_same_background_action',{
      title:'Act on verified AX element of background app on current Mac',
      description:'Use an opaque node_ref from a fresh snapshot and one-time request ID. No global keyboard/mouse. AXPress only for locally certified apps; stop and report unsupported if app requires focus. Dispatch alone does not verify persistence.',
      inputSchema:{
        bundle_id:z.string().min(8).max(120).regex(/^[a-zA-Z0-9.-]+$/),
        window_title:z.string().min(1).max(120),
        action:z.enum(['set_value','press']),
        node_ref:z.string().regex(/^[a-f0-9]{64}$/),
        expected_revision:z.string().regex(/^[a-f0-9]{64}$/),
        request_id:z.string().regex(/^[a-f0-9]{64}$/),
        reason:z.string().min(10).max(300),
        value:z.string().min(1).max(2000).optional()
      },
      annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
    },async(input)=>await safely(()=>sameMacAX.action(input)));
  }
  return server;
}
