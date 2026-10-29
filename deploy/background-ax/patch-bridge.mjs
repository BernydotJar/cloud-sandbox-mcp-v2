export function patchBackgroundBridge(source) {
 if(source.includes("import {backgroundBrowserRequest}"))throw Error('BACKGROUND_ALREADY_PATCHED');
 const marker="      // A native screenshot can activate Edge/Chrome just like a click:";
 const fallback="      const args = verifyTarget(input,allowedOrigins,dynamicTabs,";
 const anchor=source.includes(marker)?marker:fallback;
 if(source.split(anchor).length!==2)throw Error('BACKGROUND_BRIDGE_ANCHOR_UNKNOWN');
 const branch=`      if(req.url.startsWith('/v1/background/')) {
        if(busy)throw new Error('COMPUTER_BUSY');
        busy=true;
        try {
          const data=await backgroundBrowserRequest(req.url.slice('/v1/background/'.length),input,{
            validate:(target,mutate)=>verifyTarget(target,allowedOrigins,dynamicTabs,mutate),
            inspect:(...args)=>nativeHandler('inspect',...args),sessionStore,audit:auditHandler
          });
          reply(res,200,{ok:true,data});return;
        }finally{busy=false;}
      }
`;
 const routes="'/v2/browser/screenshot','/v2/browser/action','/v2/browser/open'].includes(req.url)";
 if(source.split(routes).length!==2)throw Error('BACKGROUND_ROUTE_ANCHOR_UNKNOWN');
 return "import {backgroundBrowserRequest} from './background-browser.mjs';\n"+source.replace(anchor,branch+anchor).replace(routes,"'/v2/browser/screenshot','/v2/browser/action','/v2/browser/open',\n          '/v1/background/status','/v1/background/windows','/v1/background/snapshot','/v1/background/action'].includes(req.url)");
}

export function patchBackgroundTabs(source) {
 if(source.includes("import {BackgroundBrowserTabs}"))throw Error('BACKGROUND_TABS_ALREADY_PATCHED');
 const anchor='  const server = http.createServer(async (req, res) => {';
 if(source.split(anchor).length!==2)throw Error('BACKGROUND_TABS_FACTORY_ANCHOR');
 const init=`  const backgroundTabs=new BackgroundBrowserTabs((route,input)=>backgroundBrowserRequest(route,input,{
    validate:(target,mutate)=>verifyTarget(target,allowedOrigins,dynamicTabs,mutate),
    inspect:(...args)=>nativeHandler('inspect',...args),sessionStore,audit:auditHandler
  }));
`;
 const route="      if (req.url.startsWith('/v2/browser/')) {";
 if(source.split(route).length!==2)throw Error('BACKGROUND_TABS_ROUTE_ANCHOR');
 const branch=`      if(['/v2/browser/inspect','/v2/browser/action'].includes(req.url)&&backgroundTabs.has(input.tab_ref)) {
        if(busy)throw new Error('COMPUTER_BUSY');
        busy=true;
        try {
          const data=req.url.endsWith('/action')?await backgroundTabs.perform(input):await backgroundTabs.inspect(input);
          reply(res,200,{ok:true,data});return;
        }finally{busy=false;}
      }
`;
 const reply='        reply(res,200,{ok:true,data:result}); return;';
 if(!source.includes(reply))throw Error('BACKGROUND_TABS_REPLY_ANCHOR');
 return "import {BackgroundBrowserTabs} from './background-browser-tabs.mjs';\n"+source.replace(anchor,init+anchor).replace(route,branch+route).replace(reply,'        if(result?.provider===\'native\')result=await backgroundTabs.augment(result);\n'+reply);
}
