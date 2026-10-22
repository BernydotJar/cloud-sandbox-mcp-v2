import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod/v4';
import type {ComputerUseService} from '../services/computer-use-service.js';
const bundle=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/);
const target={bundle_id:bundle,pid:z.number().int().positive(),window_index:z.number().int().min(1).max(128),
  expected_title:z.string().min(1).max(300)};
const grant={session_id:z.string().regex(/^[a-f0-9]{48}$/),
  request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/),
  reason:z.string().min(10).max(300)};
const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const write={readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true};
function text(data:unknown,isError=false){return {content:[{type:'text' as const,text:JSON.stringify(data)}],isError};}
async function safe(action:()=>Promise<unknown>){
  try{return text(await action());}
  catch(e){const m=e instanceof Error?e.message:'';
    return text({error:m.startsWith('Computer bridge: ')?m.slice(17):'MAC_DESKTOP_UNAVAILABLE',
      automatic_retry:false},true);}
}
export function registerDesktopTools(server:McpServer,computer:ComputerUseService):void {
  server.registerTool('mac_windows',{
    description:'List windows of an operator-allowlisted Mac app by bundle ID; no full-desktop enumeration.',
    inputSchema:{bundle_id:bundle},annotations:read
  },input=>safe(()=>computer.desktop('windows',input)));
  server.registerTool('mac_inspect',{
    description:'Read bounded macOS Accessibility roles and names for one exact PID/window/title. No field values.',
    inputSchema:target,annotations:read
  },input=>safe(()=>computer.desktop('inspect',input)));
  server.registerTool('mac_focus',{
    description:'Focus an exact Mac window using a desktop-scoped delegated session.',
    inputSchema:{...target,session_id:grant.session_id},annotations:write
  },input=>safe(()=>computer.desktop('focus',input)));
  server.registerTool('mac_open',{
    description:'Open an operator-allowlisted installed macOS app by bundle ID only. Desktop session and unique request ID required.',
    inputSchema:{bundle_id:bundle,...grant},annotations:write
  },input=>safe(()=>computer.desktop('open',input)));
  server.registerTool('mac_action',{
    description:'One exact macOS Accessibility action after fresh inspection, desktop-scoped approval, and content-free audit. Uncertain actions MUST NOT be retried.',
    inputSchema:{...target,...grant,action:z.enum(['click','type_text','press_key','scroll']),
      element_path:z.string().regex(/^0(?:\.(?:0|[1-9]\d?)){1,5}$/).optional(),
      expected_role:z.string().min(1).max(100).optional(),
      expected_name:z.string().min(1).max(200).optional(),
      text:z.string().min(1).max(2000).optional(),
      key:z.enum(['tab','escape','enter','space','backspace','up','down','left','right','pageup','pagedown']).optional(),
      direction:z.enum(['up','down']).optional(),
      steps:z.number().int().min(1).max(8).optional()},
    annotations:write
  },input=>safe(()=>computer.desktop('action',input)));
}
