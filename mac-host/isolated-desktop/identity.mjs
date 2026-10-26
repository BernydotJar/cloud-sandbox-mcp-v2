import crypto from 'node:crypto';
export function platformUuidFromIoreg(text){
  const match=String(text).match(/"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"/);
  if(!match)throw Error('HOST_MACHINE_ID_UNAVAILABLE');
  return match[1].toUpperCase();
}
export function machineDigest(uuid){
  if(!/^[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(uuid))
    throw Error('INVALID_MAC_MACHINE_ID');
  return crypto.createHash('sha256')
    .update('sandbox-v3-mac-worker-identity:v1:'+uuid).digest('hex');
}
export function assertDistinctMachines(operator,worker){
  if(!/^[a-f0-9]{64}$/.test(operator)||!/^[a-f0-9]{64}$/.test(worker))
    throw Error('MACHINE_ID_UNVERIFIED');
  if(crypto.timingSafeEqual(Buffer.from(operator,'hex'),Buffer.from(worker,'hex')))
    throw Error('WORKER_IS_OPERATOR_MAC');
  return true;
}
export function capacityStatus({arm64,virtualization,availableGiB,ramGiB}){
  if(!arm64||!virtualization)return {vmEligible:false,reason:'APPLE_SILICON_HYPERVISOR_REQUIRED'};
  if(!Number.isFinite(availableGiB)||availableGiB<80)
    return {vmEligible:false,reason:'LOCAL_VM_STORAGE_BELOW_80_GIB'};
  if(!Number.isFinite(ramGiB)||ramGiB<16)
    return {vmEligible:false,reason:'LOCAL_VM_MEMORY_BELOW_16_GIB'};
  return {vmEligible:true,reason:'RESOURCE_PREFLIGHT_ONLY_NOT_PROVISIONED'};
}
