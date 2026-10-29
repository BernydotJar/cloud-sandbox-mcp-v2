const once=(source,anchor,replacement)=>{if(source.split(anchor).length!==2)throw Error('DOM_PATCH_ANCHOR_CHANGED');return source.replace(anchor,replacement);};
export function patchDOMBridge(source){
 if(source.includes('// LCH_EXTENSION_DOM_V1'))throw Error('DOM_ALREADY_PATCHED');
 source=once(source,'trustedSessionNoticeHandler = showTrustedSessionNotice})','trustedSessionNoticeHandler = showTrustedSessionNotice, extensionDOMBroker = null})');
 source=once(source,'  const server = http.createServer(async (req, res) => {',`  const domBroker=extensionDOMBroker||new DOMBroker();
  const domTabs=new DOMBrowserTabs({broker:domBroker,sessionStore,allowedOrigins,dynamicTabs,audit:auditHandler});
  void domBroker.start().catch(()=>{domBroker.failure='DOM_BROKER_START_FAILED';});
  const server = http.createServer(async (req, res) => {`);
 const anchor="      if (req.url.startsWith('/v2/browser/')) {";
 source=once(source,anchor,`      if(req.url==='/v2/browser/status'&&domBroker.enabled){
        reply(res,200,{ok:true,data:{...(runtime?runtime.status():{}),enabled:true,extension_dom:domTabs.status()}});return;
      }
      if(req.url==='/v2/browser/tabs'&&input.browser==='edge'&&domBroker.enabled){
        validateDiscoveryRequest(input);
        const data=await domTabs.discover(input);reply(res,200,{ok:true,data});return;
      }
      if(req.url==='/v2/browser/reload'||(['/v2/browser/inspect','/v2/browser/action'].includes(req.url)&&domTabs.has(input.tab_ref))){
        if(!domTabs.has(input.tab_ref))throw Error('DOM_TAB_STALE');
        if(busy)throw Error('COMPUTER_BUSY');busy=true;
        try{
          const data=req.url.endsWith('/reload')?await domTabs.reload(input):req.url.endsWith('/action')?await domTabs.perform(input):await domTabs.inspect(input);
          reply(res,200,{ok:true,data});return;
        }finally{busy=false;}
      }
`+anchor);
 source=once(source,"'/v2/browser/screenshot','/v2/browser/action','/v2/browser/open'","'/v2/browser/screenshot','/v2/browser/action','/v2/browser/open','/v2/browser/reload'");
 source=once(source,"backend:'macos-automation',","backend:'macos-automation',extension_dom:domTabs.status(),");
 const original="allowedErrors.has(error?.message) ? error.message : 'NATIVE_UNAVAILABLE'";
 const patched="(allowedErrors.has(error?.message) || /^(?:SAME_MAC_|BACKGROUND_)[A-Z_]{3,80}$/.test(error?.message||'')) ? error.message : 'NATIVE_UNAVAILABLE'";
 if(source.includes(patched))source=once(source,patched,"(allowedErrors.has(error?.message) || /^(?:SAME_MAC_|BACKGROUND_|DOM_)[A-Z_]{3,80}$/.test(error?.message||'')) ? error.message : 'NATIVE_UNAVAILABLE'");
 else source=once(source,original,"(allowedErrors.has(error?.message) || /^DOM_[A-Z_]{3,45}$/.test(error?.message||'')) ? error.message : 'NATIVE_UNAVAILABLE'");
 const closeAnchor="  server.once('close', () => { if (runtime) void runtime.close().catch(() => {}); });";
 source=once(source,closeAnchor,closeAnchor+"\n  server.once('close',()=>{void domBroker.close().catch(()=>{});});");
 return "// LCH_EXTENSION_DOM_V1\nimport {DOMBroker} from './browser-dom/broker.mjs';\nimport {DOMBrowserTabs} from './browser-dom/tabs.mjs';\n"+source;
}
