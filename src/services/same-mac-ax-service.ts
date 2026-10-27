export type SameMacAXTarget = {bundle_id:string;window_title:string};
export type SameMacAXAction = SameMacAXTarget & {
  action:'set_value'|'press';
  node_ref:string;
  expected_revision:string;
  request_id:string;
  value?:string;
  reason:string;
};

export class SameMacAXService {
  constructor(private readonly config:{
    enabled:boolean;
    url:string;
    token:string;
    machineDigest:string;
  }){}
  async status(){
    if(!this.config.enabled)return {ready:false,enabled:false,
      reason:'SAME_MAC_BACKGROUND_AX_NOT_INSTALLED'};
    try{
      const state=await this.request('/v1/status',{}) as {
        provider:string;mac_machine_digest:string;
        same_machine_verified:boolean;gui_session:boolean;
        ax_permission:boolean;ready:boolean;
        no_global_keystrokes:boolean;no_pointer_events:boolean;
        no_activate_calls:boolean;not_isolated_session:boolean;
      };
      if(state.provider!=='same_mac_background_ax'||
        state.mac_machine_digest!==this.config.machineDigest||
        state.same_machine_verified!==true||
        state.no_global_keystrokes!==true||
        state.no_pointer_events!==true||
        state.no_activate_calls!==true||
        state.not_isolated_session!==true)
        return {ready:false,enabled:true,reason:'SAME_MAC_AX_HOST_MISMATCH'};
      return {ready:state.ready===true&&state.gui_session===true&&
        state.ax_permission===true,enabled:true,
        provider:'same_mac_background_ax',
        mac_machine_digest:state.mac_machine_digest,
        gui_session:state.gui_session,ax_permission:state.ax_permission,
        no_global_input:true,app_capability:'semantic_ax_only'};
    }catch{
      return {ready:false,enabled:true,reason:'SAME_MAC_AX_HOST_UNAVAILABLE'};
    }
  }
  async snapshot(target:SameMacAXTarget){
    await this.assertReady();
    return this.request('/v1/snapshot',target);
  }
  async action(input:SameMacAXAction){
    await this.assertReady();
    if(!/^[a-f0-9]{64}$/.test(input.node_ref)||
       !/^[a-f0-9]{64}$/.test(input.request_id)||
       !/^[a-f0-9]{64}$/.test(input.expected_revision)||
       typeof input.reason!=='string'||input.reason.length<10||
       input.reason.length>300)
      throw Error('SAME_MAC_AX_ACTION_INVALID');
    return this.request('/v1/action',input);
  }
  private async assertReady(){
    const state=await this.status();
    if(!state.ready)throw Error(state.reason??'SAME_MAC_AX_NOT_READY');
  }
  private async request(route:string,input:unknown):Promise<unknown>{
    const target=new URL(this.config.url);
    if(target.protocol!=='http:'||
      !['host.docker.internal','localhost','127.0.0.1'].includes(target.hostname)||
      target.port!=='9779'||target.pathname!=='/'||
      target.search||target.hash||target.username||target.password||
      this.config.token.length<32||
      !/^[a-f0-9]{64}$/.test(this.config.machineDigest))
      throw Error('SAME_MAC_AX_CONFIG_INVALID');
    const response=await fetch(new URL(route,target),{
      method:'POST',headers:{
        authorization:'Bearer '+this.config.token,
        'content-type':'application/json'
      },
      body:JSON.stringify(input),
      redirect:'error',
      signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)throw Error('SAME_MAC_AX_HTTP_'+response.status);
    const result=await response.json() as {ok:boolean;data:unknown};
    if(result.ok!==true)throw Error('SAME_MAC_AX_RESPONSE_INVALID');
    return result.data;
  }
}
