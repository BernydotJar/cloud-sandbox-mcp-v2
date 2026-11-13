export type BackgroundMacTarget = {
  bundle_id: string;
  window_title: string;
};
export type BackgroundMacAction = BackgroundMacTarget & {
  action:'press'|'set_value';
  node_ref:string;
  expected_revision:string;
  request_id:string;
  reason:string;
  value?:string;
};
type WorkerStatus = {
  worker_machine:string;
  operator_machine_distinct:boolean;
  gui_session:boolean;
  ax_permission:boolean;
  ready:boolean;
  background_mode:string;
};
export class BackgroundMacService {
  constructor(private readonly cfg: {
    enabled:boolean;
    url:string;
    token:string;
    operatorMachineDigest:string;
  }) {}
  async status(){
    if(!this.cfg.enabled)return {connected:false,ready:false,
      reason:'BACKGROUND_MAC_WORKER_NOT_CONFIGURED'};
    try{
      const response=await this.request('/v1/status',{});
      const state=response as WorkerStatus;
      if(!/^[a-f0-9]{64}$/.test(state.worker_machine)||
         state.worker_machine===this.cfg.operatorMachineDigest||
         state.operator_machine_distinct!==true||
         state.background_mode!=='separate_macos_machine')
        return {connected:false,ready:false,
          reason:'BACKGROUND_MAC_WORKER_NOT_ISOLATED'};
      return {connected:true,ready:state.ready===true &&
        state.gui_session===true && state.ax_permission===true,
        provider:'isolated_mac_ax',
        gui_session:state.gui_session,ax_permission:state.ax_permission,
        worker_machine:state.worker_machine};
    }catch{
      return {connected:false,ready:false,reason:'BACKGROUND_MAC_WORKER_UNAVAILABLE'};
    }
  }
  async snapshot(target:BackgroundMacTarget){
    await this.requireReady();
    return this.request('/v1/snapshot',target);
  }
  async screenshot(){
    await this.requireReady();
    const result=await this.request('/v1/screenshot',{}) as {
      mime_type?:string;base64?:string;provider?:string
    };
    if(result.provider!=='isolated_macos_screenshot'||
       result.mime_type!=='image/png'||
       typeof result.base64!=='string'||
       result.base64.length<12||result.base64.length>12_000_000||
       !/^[A-Za-z0-9+/=]+$/.test(result.base64))
      throw Error('BACKGROUND_MAC_INVALID_SCREENSHOT');
    return {mimeType:'image/png' as const,data:result.base64};
  }
  async action(input:BackgroundMacAction){
    await this.requireReady();
    if(!/^[a-f0-9]{64}$/.test(input.request_id)||
       !/^[a-f0-9]{64}$/.test(input.node_ref)||
       !/^[a-f0-9]{64}$/.test(input.expected_revision)||
       typeof input.reason!=='string'||input.reason.length<10 ||
       input.reason.length>300)
      throw Error('BACKGROUND_MAC_ACTION_INVALID');
    return this.request('/v1/action',input);
  }
  private async requireReady(){
    const checked=await this.status();
    if(!checked.ready)throw Error(checked.reason||
      'BACKGROUND_MAC_DESKTOP_ISOLATION_REQUIRED');
  }
  private async request(endpoint:string,body:unknown){
    const url=new URL(this.cfg.url);
    if(url.protocol!=='http:'||
       !['host.docker.internal','127.0.0.1','localhost'].includes(url.hostname)||
       url.port!=='9777'||url.pathname!=='/'||
       url.username||url.password||url.search||url.hash ||
       this.cfg.token.length<32||
       !/^[a-f0-9]{64}$/.test(this.cfg.operatorMachineDigest))
      throw Error('BACKGROUND_MAC_WORKER_CONFIG_INVALID');
    const response=await fetch(new URL(endpoint,url),{
      method:'POST',headers:{
        authorization:'Bearer '+this.cfg.token,
        'content-type':'application/json'
      },
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)throw Error('BACKGROUND_MAC_WORKER_RESPONSE_'+response.status);
    const payload=await response.json() as {ok:boolean;data:unknown};
    if(payload.ok!==true)throw Error('BACKGROUND_MAC_WORKER_INVALID_RESPONSE');
    return payload.data;
  }
}
