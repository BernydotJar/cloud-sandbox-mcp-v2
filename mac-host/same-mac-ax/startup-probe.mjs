import {setTimeout as sleep} from 'node:timers/promises';

const transientCodes=new Set(['ECONNREFUSED','ETIMEDOUT','ECONNRESET',
  'UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','fetch failed']);
const address='http://127.0.0.1:9779/v1/status';

export function isTransientStartupFailure(error){
  const code=String(error?.cause?.code||error?.cause?.errors?.[0]?.code||
    error?.message||'UNKNOWN');
  return transientCodes.has(code);
}
/**
 * Health check for a launchd-bootstrapped service. Registering a
 * job does not guarantee that Node has reached listen(). Retry only
 * transient transport failures, never authorization or response errors.
 */
export async function waitForLocalAXStatus(token,{
  attempts=30,intervalMs=400,timeoutMs=1700,fetchImpl=fetch
}={}){
  if(typeof token!=='string'||token.length<32||
     !Number.isInteger(attempts)||attempts<1||attempts>60||
     !Number.isInteger(intervalMs)||intervalMs<0||intervalMs>2000)
    throw Error('SAME_MAC_STATUS_PROBE_INVALID');
  for(let n=0;n<attempts;n++){
    try{
      const response=await fetchImpl(address,{
        method:'POST',headers:{
          authorization:'Bearer '+token,'content-type':'application/json'
        },body:'{}',signal:AbortSignal.timeout(timeoutMs),redirect:'error'
      });
      if(!response.ok)throw Error('SAME_MAC_STATUS_HTTP_'+response.status);
      const data=await response.json();
      if(data?.ok!==true||data?.data?.provider!=='same_mac_background_ax'||
         data?.data?.same_machine_verified!==true)
        throw Error('SAME_MAC_STATUS_PROVIDER_MISMATCH');
      return data.data;
    }catch(error){
      if(!isTransientStartupFailure(error))throw error;
      if(n<attempts-1&&intervalMs>0)await sleep(intervalMs);
    }
  }
  throw Error('SAME_MAC_SERVICE_NOT_RESPONDING_USE_DOCTOR');
}
