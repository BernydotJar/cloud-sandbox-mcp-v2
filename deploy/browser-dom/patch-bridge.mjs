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
        let domData=null,domError=null,nativeData=null;
        try{domData=await domTabs.discover(input);}catch(error){domError=/^DOM_[A-Z_]+$/.test(error?.message||'')?error.message:'DOM_DISCOVERY_UNAVAILABLE';}
        // A matching approved Teams tab never depends on native discovery.
        if(input.title&&domData?.tabs.length){reply(res,200,{ok:true,data:domData});return;}
        try{
          const state=await nativeHandler('state',input.browser);
          nativeData=nativeDiscoveryFallback(input.browser,state,input,dynamicTabs,allowedOrigins,'NATIVE_FIRST');
        }catch{
          if(typeof backgroundTabs!=='undefined')try{nativeData=await backgroundTabs.discover(input);}catch{/* Preserve independent DOM availability. */}
        }
        if(!nativeData){
          if(domData?.tabs.length){reply(res,200,{ok:true,data:{...domData,native_discovery_available:false}});return;}
          throw Error(domError||'NATIVE_DISCOVERY_UNAVAILABLE');
        }
        // Never expose a native Teams alternative from another profile when
        // the approved DOM profile is disconnected or does not match.
        nativeData.tabs=(nativeData.tabs||[]).filter(tab=>{try{return new URL(tab.url).origin!=='https://teams.cloud.microsoft';}catch{return false;}});
        if(typeof backgroundTabs!=='undefined'&&nativeData.provider==='native')nativeData=await backgroundTabs.augment(nativeData);
        const domRows=domData?.tabs||[],nativeRows=nativeData.tabs;
        let data;
        if(domRows.length&&nativeRows.length)data={browser:'edge',provider:'mixed',semantic_available:false,inspection_mode:'mixed',extension_dom:domTabs.status(),tabs:[...domRows.map(tab=>({...tab,provider:'extension_dom',semantic_available:true})),...nativeRows.map(tab=>({...tab,provider:nativeData.provider,semantic_available:false}))],next_step:'Select the actual per-tab provider. Teams DOM refs use browser_inspect/action. Other origins retain their existing native targets; they are not DOM.'};
        else if(domRows.length)data=domData;
        else data={...nativeData,extension_dom:{...domTabs.status(),...(domError?{error:domError}:{})},next_step:nativeData.next_step+'; Teams requires the approved connected DOM profile, never a different native Teams profile.'};
        reply(res,200,{ok:true,data});return;
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
