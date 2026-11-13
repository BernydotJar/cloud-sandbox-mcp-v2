import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpec,verifyParity} from './upgrade-controller-on-mac.mjs';
const image='sha256:'+'b'.repeat(64);
const original={Name:'/cloud-sandbox-mcp',Image:'sha256:'+'a'.repeat(64),Config:{
 Image:'old',Env:['SECRET=fixture-value'],Cmd:['node','dist/index.js'],Labels:{'com.docker.compose.service':'mcp','com.docker.compose.image':'old'}},
 HostConfig:{AutoRemove:false,NetworkMode:'same-network',Binds:['/physical/ssd:/data'],PortBindings:{'3000/tcp':[{HostIp:'',HostPort:'3000'}]},RestartPolicy:{Name:'unless-stopped'}},
 Mounts:[{Type:'bind',Source:'/physical/ssd',Destination:'/data',RW:true}],
 NetworkSettings:{Networks:{'same-network':{IPAMConfig:null,Links:null,Aliases:['mcp']}}}};
test('image upgrade retains secret values, SSD mounts, ports, restart policy and network aliases',()=>{
 const before=structuredClone(original),spec=createSpec(original,image);
 assert.deepEqual(spec.Env,original.Config.Env);assert.deepEqual(spec.HostConfig,original.HostConfig);
 assert.deepEqual(spec.NetworkingConfig.EndpointsConfig['same-network'].Aliases,['mcp']);
 assert.equal(spec.Image,image);assert.deepEqual(original,before);
 const current={...structuredClone(original),Image:image,Config:{...spec}};
 delete current.Config.HostConfig;delete current.Config.NetworkingConfig;
 assert.doesNotThrow(()=>verifyParity(original,current,image));
 current.HostConfig.Binds=['/wrong:/data'];
 assert.throws(()=>verifyParity(original,current,image),/PARITY_FAILED/);
});
test('upgrade refuses unknown containers, static address configuration and auto-removal',()=>{
 for(const changed of [
  {...original,Name:'/other'},
  {...original,HostConfig:{...original.HostConfig,AutoRemove:true}},
  {...original,NetworkSettings:{Networks:{n:{IPAMConfig:{IPv4Address:'1.2.3.4'}}}}}
 ])assert.throws(()=>createSpec(changed,image));
});
