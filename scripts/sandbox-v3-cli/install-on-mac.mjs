#!/usr/bin/env node
/**
 * Explicit guarded migration of the operator Mac's sandbox CLI.
 * Moves the existing command to a recoverable backup IN ITS ORIGINAL
 * directory, never runs it, and links sandbox to the new V3-only entry.
 * Does not modify Docker, the controller, browser sessions or tunnels.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import {fileURLToPath} from 'node:url';

const releaseDir=path.dirname(fileURLToPath(import.meta.url));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const say=(k,v)=>console.log('[Sandbox V3 CLI Install] '+k+'='+String(v));
const safePath=p=>String(p).replaceAll(os.homedir(),'~');
const releaseName='sandbox-v3';

export function locations(home){
  const userHome=path.resolve(home);
  const bin=path.join(userHome,'.local','bin');
  const install=path.join(userHome,'.local','share',releaseName);
  return {home:userHome,bin,entry:path.join(bin,'sandbox'),
    install,cli:path.join(install,'cli.mjs'),
    record:path.join(install,'install-record.json')};
}
// Inspect with lstat without dereferencing symlinks.
export function entryInfo(filename){
  let info;
  try{info=fs.lstatSync(filename);}catch(error){
    if(error.code==='ENOENT')return {kind:'ABSENT'};
    throw error;
  }
  if(info.isSymbolicLink())return {kind:'SYMLINK',
    target:fs.readlinkSync(filename)};
  if(!info.isFile())throw Error('SANDBOX_ENTRY_UNSUPPORTED_TYPE');
  if(info.size>1_000_000)throw Error('SANDBOX_ENTRY_OVERSIZE');
  const bytes=fs.readFileSync(filename);
  if(bytes.subarray(0,4096).includes(0))
    throw Error('SANDBOX_ENTRY_BINARY_REFUSED');
  const value=bytes.toString('utf8');
  if(value.includes('\uFFFD'))throw Error('SANDBOX_ENTRY_NON_UTF8');
  if(!value.startsWith('#!'))throw Error('SANDBOX_ENTRY_UNKNOWN_SCRIPT');
  return {kind:'SCRIPT',sha256:sha(bytes)};
}
export function verifyRelease(folder){
  const manifest=path.join(folder,'manifest.json');
  const manifestDigest=path.join(folder,'manifest.sha256');
  const stat=fs.lstatSync(manifest);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>40_000)
    throw Error('RELEASE_MANIFEST_UNTRUSTED');
  const bytes=fs.readFileSync(manifest);
  if(sha(bytes)!==fs.readFileSync(manifestDigest,'utf8').trim())
    throw Error('RELEASE_MANIFEST_HASH_MISMATCH');
  const data=JSON.parse(bytes.toString('utf8'));
  if(data.schema!=='sandbox-v3.primary-cli.v1'||data.primary_plugin!=='Sandbox_V3')
    throw Error('RELEASE_IDENTITY_UNEXPECTED');
  if(!data.files_sha256||!data.files_sha256['cli.mjs']||
     !data.files_sha256['art.mjs']||
     !data.files_sha256['cloudflare.mjs']||
     !data.files_sha256['health.mjs']||
     !data.files_sha256['install-on-mac.mjs'])
    throw Error('RELEASE_FILES_MISSING');
  for(const [name,hash] of Object.entries(data.files_sha256)){
    if(!/^[a-zA-Z0-9._-]{2,80}$/.test(name)||
       typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))
      throw Error('RELEASE_FILE_RECORD_INVALID');
    const file=path.join(folder,name);
    const fileStat=fs.lstatSync(file);
    if(!fileStat.isFile()||fileStat.isSymbolicLink()||fileStat.size>1_000_000||
       sha(fs.readFileSync(file))!==hash)
      throw Error('RELEASE_FILE_DRIFT:'+name);
  }
  return data;
}
function ownedFolder(folder,userId){
  if(!fs.existsSync(folder))return;
  const st=fs.lstatSync(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==userId)
    throw Error('UNSAFE_USER_FOLDER:'+path.basename(folder));
}
function atomic(file,contents,mode=0o600){
  const tmp=path.join(path.dirname(file),'.sandbox-v3-'+crypto.randomUUID());
  try{
    fs.writeFileSync(tmp,contents,{flag:'wx',mode});
    fs.renameSync(tmp,file);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
export function activateCli({home,release=releaseDir,userId=process.getuid()}){
  const meta=verifyRelease(release);
  const dest=locations(home);
  for(const directory of [dest.home,path.join(dest.home,'.local'),dest.bin,
    path.join(dest.home,'.local','share'),dest.install])
    ownedFolder(directory,userId);
  for(const directory of [dest.bin,dest.install])
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const current=entryInfo(dest.entry);
  const source=fs.readFileSync(path.join(release,'cli.mjs'));
  const artwork=fs.readFileSync(path.join(release,'art.mjs'));
  const cloudflare=fs.readFileSync(path.join(release,'cloudflare.mjs'));
  const health=fs.readFileSync(path.join(release,'health.mjs'));
  const artFile=path.join(dest.install,'art.mjs');
  const cloudflareFile=path.join(dest.install,'cloudflare.mjs');
  const healthFile=path.join(dest.install,'health.mjs');
  if(fs.existsSync(dest.record)){
    const recStat=fs.lstatSync(dest.record);
    if(!recStat.isFile()||recStat.isSymbolicLink()||recStat.uid!==userId)
      throw Error('EXISTING_INSTALL_RECORD_UNTRUSTED');
    const record=JSON.parse(fs.readFileSync(dest.record,'utf8'));
    if(record.primary!=='Sandbox_V3'||record.name!=='sandbox')
      throw Error('ALREADY_INSTALLED_UNKNOWN_RECORD');
    const link=entryInfo(dest.entry);
    if(link.kind==='SYMLINK'&&
       path.resolve(dest.bin,link.target)===dest.cli&&
       fs.existsSync(dest.cli)&&
       sha(fs.readFileSync(dest.cli))===meta.files_sha256['cli.mjs']&&
       fs.existsSync(artFile)&&sha(fs.readFileSync(artFile))===
         meta.files_sha256['art.mjs']&&
       fs.existsSync(cloudflareFile)&&sha(fs.readFileSync(cloudflareFile))===
         meta.files_sha256['cloudflare.mjs']&&
       fs.existsSync(healthFile)&&sha(fs.readFileSync(healthFile))===
         meta.files_sha256['health.mjs'])
      return {status:'ALREADY_ACTIVE',backup:record.backup};
    throw Error('EXISTING_V3_INSTALL_DRIFT_REFUSED');
  }
  if(fs.existsSync(dest.cli)&&
     sha(fs.readFileSync(dest.cli))!==meta.files_sha256['cli.mjs'])
    throw Error('EXISTING_V3_CLI_UNRECOGNIZED');
  const existingV3Cli=fs.existsSync(dest.cli);
  if(fs.existsSync(artFile)&&sha(fs.readFileSync(artFile))!==
     meta.files_sha256['art.mjs'])
    throw Error('EXISTING_V3_ART_UNRECOGNIZED');
  if(!fs.existsSync(artFile))
    fs.writeFileSync(artFile,artwork,{flag:'wx',mode:0o600});
  if(fs.existsSync(cloudflareFile)&&
     sha(fs.readFileSync(cloudflareFile))!==meta.files_sha256['cloudflare.mjs'])
    throw Error('EXISTING_V3_CLOUDFLARE_MODULE_UNRECOGNIZED');
  if(!fs.existsSync(cloudflareFile))
    fs.writeFileSync(cloudflareFile,cloudflare,{flag:'wx',mode:0o600});
  if(fs.existsSync(healthFile)&&
     sha(fs.readFileSync(healthFile))!==meta.files_sha256['health.mjs'])
    throw Error('EXISTING_V3_HEALTH_MODULE_UNRECOGNIZED');
  if(!fs.existsSync(healthFile))
    fs.writeFileSync(healthFile,health,{flag:'wx',mode:0o600});
  const backup=current.kind==='ABSENT'?null:
    path.join(dest.bin,'sandbox.pre-v3-'+Date.now()+'-'+crypto.randomUUID());
  const relativeTarget=path.relative(dest.bin,dest.cli);
  // All release content is verified before the first filesystem mutation.
  if(!existingV3Cli)fs.writeFileSync(dest.cli,source,{flag:'wx',mode:0o700});
  let moved=false;let linked=false;
  try{
    if(backup){fs.renameSync(dest.entry,backup);moved=true;}
    fs.symlinkSync(relativeTarget,dest.entry);linked=true;
    if(path.resolve(dest.bin,fs.readlinkSync(dest.entry))!==dest.cli)
      throw Error('SANDBOX_LINK_VERIFY_FAILED');
    const record={schema:'sandbox-v3.cli-install.v1',name:'sandbox',
      primary:'Sandbox_V3',source_commit:meta.source_git_sha,
      legacy:'PRESERVED_NOT_INVOKED',backup,cli_sha256:sha(source),
      art_sha256:sha(artwork),cloudflare_sha256:sha(cloudflare),
      health_sha256:sha(health),
      installed_utc:new Date().toISOString()};
    atomic(dest.record,JSON.stringify(record,null,2)+'\n');
    return {status:'ACTIVATED',backup};
  }catch(error){
    if(linked&&fs.existsSync(dest.entry))fs.unlinkSync(dest.entry);
    if(moved&&backup&&!fs.existsSync(dest.entry))fs.renameSync(backup,dest.entry);
    if(!existingV3Cli&&!fs.existsSync(dest.record)&&fs.existsSync(dest.cli)&&
       sha(fs.readFileSync(dest.cli))===sha(source))
      fs.unlinkSync(dest.cli);
    throw error;
  }
}
export function upgradeCli({home,release=releaseDir,userId=process.getuid()}){
  const meta=verifyRelease(release);
  const dest=locations(home);
  for(const dir of [dest.home,path.join(dest.home,'.local'),
    dest.bin,path.join(dest.home,'.local','share'),dest.install])
    ownedFolder(dir,userId);
  const recordStat=fs.lstatSync(dest.record);
  if(!recordStat.isFile()||recordStat.isSymbolicLink()||
     recordStat.uid!==userId||(recordStat.mode&0o077)!==0)
    throw Error('INSTALLED_V3_RECORD_UNTRUSTED');
  const record=JSON.parse(fs.readFileSync(dest.record,'utf8'));
  if(record.schema!=='sandbox-v3.cli-install.v1'||
     record.primary!=='Sandbox_V3'||record.name!=='sandbox'||
     !/^[a-f0-9]{64}$/.test(record.cli_sha256))
    throw Error('INSTALLED_V3_RECORD_INVALID');
  const link=entryInfo(dest.entry);
  if(link.kind!=='SYMLINK'||path.resolve(dest.bin,link.target)!==dest.cli)
    throw Error('CURRENT_SANDBOX_ENTRY_NOT_V3');
  const stat=fs.lstatSync(dest.cli);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==userId)
    throw Error('INSTALLED_V3_CLI_UNTRUSTED');
  const previous=fs.readFileSync(dest.cli);
  const previousHash=sha(previous);
  if(previousHash!==record.cli_sha256)
    throw Error('INSTALLED_V3_CLI_HASH_DRIFT');
  const newCode=fs.readFileSync(path.join(release,'cli.mjs'));
  const artwork=fs.readFileSync(path.join(release,'art.mjs'));
  const artFile=path.join(dest.install,'art.mjs');
  const cloudflare=fs.readFileSync(path.join(release,'cloudflare.mjs'));
  const cloudflareFile=path.join(dest.install,'cloudflare.mjs');
  const health=fs.readFileSync(path.join(release,'health.mjs'));
  const healthFile=path.join(dest.install,'health.mjs');
  if(fs.existsSync(artFile)){
    const artStat=fs.lstatSync(artFile);
    if(!artStat.isFile()||artStat.isSymbolicLink()||
       artStat.uid!==userId)
      throw Error('INSTALLED_V3_ART_UNTRUSTED');
    if(record.art_sha256&&sha(fs.readFileSync(artFile))!==record.art_sha256)
      throw Error('INSTALLED_V3_ART_HASH_DRIFT');
    if(!record.art_sha256&&
       sha(fs.readFileSync(artFile))!==meta.files_sha256['art.mjs'])
      throw Error('UNRECOGNIZED_INSTALLED_ART');
  }
  if(fs.existsSync(cloudflareFile)){
    const installed=fs.lstatSync(cloudflareFile);
    if(!installed.isFile()||installed.isSymbolicLink()||
       installed.uid!==userId)
      throw Error('INSTALLED_CLOUDFLARE_MODULE_UNTRUSTED');
    const currentCloudflare=sha(fs.readFileSync(cloudflareFile));
    if(record.cloudflare_sha256 &&
       currentCloudflare!==record.cloudflare_sha256)
      throw Error('INSTALLED_CLOUDFLARE_MODULE_HASH_DRIFT');
    if(!record.cloudflare_sha256&&
       currentCloudflare!==meta.files_sha256['cloudflare.mjs'])
      throw Error('UNRECOGNIZED_INSTALLED_CLOUDFLARE_MODULE');
  }
  if(fs.existsSync(healthFile)){
    const currentHealthStat=fs.lstatSync(healthFile);
    if(!currentHealthStat.isFile()||currentHealthStat.isSymbolicLink()||
       currentHealthStat.uid!==userId)
      throw Error('INSTALLED_HEALTH_MODULE_UNTRUSTED');
    const currentHealthHash=sha(fs.readFileSync(healthFile));
    if(record.health_sha256&&currentHealthHash!==record.health_sha256)
      throw Error('INSTALLED_HEALTH_MODULE_HASH_DRIFT');
    if(!record.health_sha256&&
       currentHealthHash!==meta.files_sha256['health.mjs'])
      throw Error('UNRECOGNIZED_INSTALLED_HEALTH_MODULE');
  }
  if(previousHash===meta.files_sha256['cli.mjs']&&
     fs.existsSync(artFile)&&
     sha(fs.readFileSync(artFile))===meta.files_sha256['art.mjs']&&
     fs.existsSync(cloudflareFile)&&
     sha(fs.readFileSync(cloudflareFile))===meta.files_sha256['cloudflare.mjs']&&
     fs.existsSync(healthFile)&&
     sha(fs.readFileSync(healthFile))===meta.files_sha256['health.mjs'])
    return {status:'ALREADY_CURRENT',backup:record.backup};
  const backups=path.join(dest.install,'backups');
  ownedFolder(backups,userId);
  if(!fs.existsSync(backups))fs.mkdirSync(backups,{mode:0o700});
  const previousBackup=path.join(backups,
    'cli-before-upgrade-'+Date.now()+'-'+crypto.randomUUID()+'.mjs');
  fs.writeFileSync(previousBackup,previous,{flag:'wx',mode:0o700});
  const hadArt=fs.existsSync(artFile);
  const previousArt=hadArt?fs.readFileSync(artFile):null;
  const hadCloudflare=fs.existsSync(cloudflareFile);
  const previousCloudflare=hadCloudflare?fs.readFileSync(cloudflareFile):null;
  const hadHealth=fs.existsSync(healthFile);
  const previousHealth=hadHealth?fs.readFileSync(healthFile):null;
  try{
    atomic(artFile,artwork,0o600);
    atomic(cloudflareFile,cloudflare,0o600);
    atomic(healthFile,health,0o600);
    atomic(dest.cli,newCode,0o700);
    const updated={...record,
      source_commit:meta.source_git_sha,
      cli_sha256:meta.files_sha256['cli.mjs'],
      art_sha256:meta.files_sha256['art.mjs'],
      cloudflare_sha256:meta.files_sha256['cloudflare.mjs'],
      health_sha256:meta.files_sha256['health.mjs'],
      previous_cli_backup:previousBackup,
      previous_cli_sha256:previousHash,
      upgrade_utc:new Date().toISOString()};
    if(sha(fs.readFileSync(dest.cli))!==meta.files_sha256['cli.mjs']||
       sha(fs.readFileSync(artFile))!==meta.files_sha256['art.mjs']||
       sha(fs.readFileSync(cloudflareFile))!==meta.files_sha256['cloudflare.mjs']||
       sha(fs.readFileSync(healthFile))!==meta.files_sha256['health.mjs'])
      throw Error('UPGRADE_POSTVERIFY_FAILED');
    atomic(dest.record,JSON.stringify(updated,null,2)+'\n');
    return {status:'UPGRADED',backup:record.backup,
      previousV3Backup:previousBackup};
  }catch(error){
    atomic(dest.cli,previous,0o700);
    if(hadArt)atomic(artFile,previousArt,0o600);
    else if(fs.existsSync(artFile))fs.unlinkSync(artFile);
    if(hadCloudflare)atomic(cloudflareFile,previousCloudflare,0o600);
    else if(fs.existsSync(cloudflareFile))fs.unlinkSync(cloudflareFile);
    if(hadHealth)atomic(healthFile,previousHealth,0o600);
    else if(fs.existsSync(healthFile))fs.unlinkSync(healthFile);
    throw error;
  }
}
export function rollbackCli({home,userId=process.getuid()}){
  const dest=locations(home);
  ownedFolder(dest.bin,userId);
  ownedFolder(dest.install,userId);
  const stat=fs.lstatSync(dest.record);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==userId)
    throw Error('INSTALL_RECORD_UNTRUSTED');
  const record=JSON.parse(fs.readFileSync(dest.record,'utf8'));
  if(record.schema!=='sandbox-v3.cli-install.v1'||
     record.primary!=='Sandbox_V3')throw Error('INSTALL_RECORD_INVALID');
  const link=entryInfo(dest.entry);
  if(link.kind!=='SYMLINK'||path.resolve(dest.bin,link.target)!==dest.cli)
    throw Error('CURRENT_CLI_NOT_OUR_SYMLINK');
  if(record.backup){
    const backup=path.resolve(record.backup);
    if(path.dirname(backup)!==dest.bin||!path.basename(backup).startsWith('sandbox.pre-v3-')||
       !fs.existsSync(backup))throw Error('LEGACY_BACKUP_UNTRUSTED');
    fs.unlinkSync(dest.entry);
    fs.renameSync(backup,dest.entry);
  }else fs.unlinkSync(dest.entry);
  fs.renameSync(dest.record,dest.record+'.rolled-back-'+Date.now());
  return {status:'LEGACY_ENTRY_RESTORED'};
}
function inspect(){
  const release=verifyRelease(releaseDir);
  const dest=locations(os.homedir());
  say('SOURCE','VERIFIED');
  say('SOURCE_COMMIT',release.source_git_sha);
  say('DESIRED_ENTRY',safePath(dest.entry));
  const current=entryInfo(dest.entry);
  say('CURRENT_ENTRY',current.kind);
  if(current.kind==='SYMLINK'){
    const intended=path.resolve(dest.bin,current.target)===dest.cli;
    say('POINTS_TO_SANDBOX_V3',intended?'YES':'NO');
  }
  say('ACTIVE_CONFIG',fs.existsSync(dest.record)?'PRESENT':'NOT_INSTALLED');
  say('MAC_REQUIRED_TO_ACTIVATE','YES');
  say('LEGACY_START_ALL_EXECUTED','NO');
  say('DOCKER_CHANGED','NO');
}
function main(){
  const mode=process.argv[2];
  if(process.argv.length!==3||
     !['--inspect','--activate','--upgrade','--rollback'].includes(mode))
    throw Error('USE_INSPECT_ACTIVATE_UPGRADE_OR_ROLLBACK');
  if(mode==='--inspect'){inspect();return;}
  if(process.platform!=='darwin')throw Error('OPERATOR_MAC_REQUIRED');
  const result=mode==='--activate'?activateCli({home:os.homedir()}):
    mode==='--upgrade'?upgradeCli({home:os.homedir()}):
      rollbackCli({home:os.homedir()});
  say('RESULT',result.status);
  if(result.backup)say('LEGACY_BACKUP',safePath(result.backup));
  if(result.previousV3Backup)say('PREVIOUS_V3_BACKUP',safePath(result.previousV3Backup));
  say('NEXT','sandbox art cats; sandbox');
  say('V2_CONNECTOR_REMOVED','NO_NOT_UNINSTALLED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}
  catch(error){
    say('STOP',String(error?.message||'UNKNOWN').slice(0,200));
    process.exitCode=2;
  }
}
