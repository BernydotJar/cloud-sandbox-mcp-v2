/**
 * Guarded recent-change reconciliation for a previous completed SSD
 * cold snapshot. Walks metadata ONCE, selects only files changed since
 * the checkpoint, and uses rsync --files-from to transfer selected
 * paths. Never performs a full rsync across the source tree.
 *
 * A bounded scanner DOES still inspect source directory entries.
 * If it takes too long or finds too much, abort and restore Mac
 * originals through the outer transaction. All Mac sources remain.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import console from 'node:console';
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const WID='6544ba3e-e124-4ca5-adc7-62c6dd47ba86';
const ROOT='/Volumes/SSD/Sandbox';
const REPORTS=ROOT+'/reports';
// Under sudo, os.homedir() may be /var/root. Resolve the original
// user's physical source from the signed release's known structure
// instead, and independently verify it against the signed manifest.
const RELEASE_DIR=path.dirname(fileURLToPath(import.meta.url));
const SOURCE=process.platform==='darwin'?
  path.resolve(RELEASE_DIR,'../../../../../'):
  path.join(os.homedir(),'.cloud-sandbox-mcp-data');
const DATA=ROOT+'/persistent/cloud-sandbox-mcp-data';
const CONTROLLER=path.join(path.dirname(SOURCE),
  'Development/Workspaces/cloud-sandbox-mcp-v0.2.0-workstation');
const CODE=ROOT+'/source/cloud-sandbox-workstation';
const MAX_SCAN_MS=300000;
const MAX_ENTRIES=5000000;
const MAX_SELECTED=160000;
const MAX_BYTES=12*1024*1024*1024;
const BACKTRACK_MS=10*60*1000;
const excluded='workspaces/'+WID+'/home/.cache/uv';
const echo=(key,value)=>console.log(
  '[SSD Recent Delta] '+key+'='+String(value));
export const SOURCE_PAIRS=Object.freeze([
  {name:'persistent',source:SOURCE,target:DATA},
  {name:'controller',source:CONTROLLER,target:CODE}
]);
export function deltaCutoffMs(persistentLogMtime,controllerLogMtime,
  backtrackMs=BACKTRACK_MS){
  if(!Number.isFinite(persistentLogMtime)||
    !Number.isFinite(controllerLogMtime)||
    Math.abs(persistentLogMtime-controllerLogMtime)>1200000||
    !Number.isFinite(backtrackMs)||backtrackMs<60000)
    throw Error('DELTA_BASELINE_SYNC_TIMES_UNTRUSTED');
  const cutoff=Math.min(persistentLogMtime,controllerLogMtime)-backtrackMs;
  if(cutoff>Date.now()||cutoff<Date.now()-24*60*60*1000)
    throw Error('DELTA_BASELINE_TOO_OLD_REVIEW_REQUIRED');
  return cutoff;
}
export function isExcluded(relative,pairName){
  return pairName==='persistent'&&
    (relative===excluded||relative.startsWith(excluded+'/'));
}
function safeDir(dir){
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink())
    throw Error('DELTA_ROOT_MUST_BE_PHYSICAL_DIRECTORY');
  return st;
}
function isChanged(st,cutoffMs){
  return st.mtimeMs>=cutoffMs||st.ctimeMs>=cutoffMs||
    st.birthtimeMs>=cutoffMs;
}
export function scanMetadataTree(pair,cutoffMs,{maxScanMs=MAX_SCAN_MS,
  maxEntries=MAX_ENTRIES,maxSelected=MAX_SELECTED,
  maxBytes=MAX_BYTES,clock=Date.now,onProgress=()=>{}}={}){
  const rootStat=safeDir(pair.source);
  safeDir(pair.target);
  if(!Number.isFinite(cutoffMs)||cutoffMs>Date.now()||
    cutoffMs<Date.now()-24*60*60*1000)
    throw Error('DELTA_CUTOFF_OUT_OF_RANGE');
  const start=clock();
  let lastProgress=start;
  let entries=0;
  let bytes=0;
  const changed=new Set();
  const touchedDirs=new Set();
  const stack=[''];
  if(isChanged(rootStat,cutoffMs))touchedDirs.add('');
  while(stack.length){
    const relDir=stack.pop();
    const absDir=relDir?path.join(pair.source,relDir):pair.source;
    const names=fs.readdirSync(absDir,{withFileTypes:true});
    for(const ent of names){
      entries++;
      const currentTime=clock();
      if(currentTime-start>maxScanMs||entries>maxEntries)
        throw Error('DELTA_SCAN_LIMIT_REACHED_NO_UNBOUNDED_RETRY');
      if(currentTime-lastProgress>14000){
        onProgress({name:pair.name,entries,changed:changed.size,
          seconds:Math.floor((currentTime-start)/1000)});
        lastProgress=currentTime;
      }
      const rel=relDir?relDir+'/'+ent.name:ent.name;
      if(isExcluded(rel,pair.name))continue;
      if(ent.name.includes('\uFFFD'))
        throw Error('DELTA_NONUTF8_FILENAME_UNSUPPORTED');
      const full=path.join(pair.source,rel);
      const st=fs.lstatSync(full);
      // Never cross onto another mounted filesystem or follow symlinks.
      if(st.dev!==rootStat.dev)
        throw Error('DELTA_CROSS_DEVICE_ENTRY_UNSUPPORTED');
      const directory=st.isDirectory();
      const file=st.isFile();
      const link=st.isSymbolicLink();
      if(!directory&&!file&&!link){
        if(isChanged(st,cutoffMs))
          throw Error('DELTA_RECENT_SPECIAL_FILE_UNSUPPORTED');
        continue;
      }
      if(directory)stack.push(rel);
      if(isChanged(st,cutoffMs)){
        changed.add(rel);
        if(directory)touchedDirs.add(rel);
        if(file)bytes+=st.size;
        if(changed.size>maxSelected||bytes>maxBytes)
          throw Error('DELTA_CHANGED_SET_TOO_LARGE_BOUNDED_ABORT');
      }
    }
  }
  if(clock()-start>maxScanMs)
    throw Error('DELTA_SCAN_LIMIT_REACHED_NO_UNBOUNDED_RETRY');
  return {
    name:pair.name,entries,bytes,changed:[...changed].sort(),
    touchedDirs:[...touchedDirs].sort(),
    elapsedMs:clock()-start
  };
}
function validInternalTarget(target){
  const stat=safeDir(target);
  return stat.dev;
}
export function scanRecentMetadata(pair,cutoffMs,options={}){
  if(!SOURCE_PAIRS.some(p=>p.name===pair.name&&
    p.source===pair.source&&p.target===pair.target))
    throw Error('DELTA_SOURCE_AND_TARGET_NOT_ALLOWLISTED');
  return scanMetadataTree(pair,cutoffMs,options);
}
export function collectMissingDirectEntries(pair,scan){
  const missing=[];
  const device=validInternalTarget(pair.target);
  for(const rel of scan.touchedDirs){
    const src=rel?path.join(pair.source,rel):pair.source;
    const dest=rel?path.join(pair.target,rel):pair.target;
    if(!fs.existsSync(dest))continue;
    const stat=fs.lstatSync(dest);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.dev!==device)
      throw Error('DELTA_TARGET_PARENT_CHANGED_TYPE');
    const srcNames=new Set(fs.readdirSync(src));
    for(const name of fs.readdirSync(dest)){
      const child=rel?rel+'/'+name:name;
      if(isExcluded(child,pair.name))continue;
      if(!srcNames.has(name))missing.push(child);
    }
  }
  const sorted=[...new Set(missing)]
    .sort((a,b)=>a.length-b.length);
  const keep=[];
  for(const rel of sorted){
    if(keep.some(parent=>rel.startsWith(parent+'/')))continue;
    keep.push(rel);
  }
  if(keep.length>MAX_SELECTED)
    throw Error('DELTA_TOMBSTONES_TOO_MANY_BOUNDED_ABORT');
  return keep;
}
function requirePrivateReports(){
  const st=safeDir(REPORTS);
  if((st.mode&0o077)!==0)
    throw Error('DELTA_REPORTS_DIRECTORY_NOT_PRIVATE');
}
function privateFile(name,bytes){
  requirePrivateReports();
  const file=REPORTS+'/'+name;
  const fd=fs.openSync(file,
    fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,bytes);}
  finally{fs.closeSync(fd);}
  return file;
}
function changedFilesManifest(scan,runId){
  if(!/^[a-f0-9]{12}$/.test(runId))
    throw Error('DELTA_RUNID_NOT_TRUSTED');
  const name='ssd-recent-delta-'+runId+'-'+scan.name+'.list';
  const entries=scan.changed;
  return privateFile(name,Buffer.from(
    entries.map(p=>p+'\0').join(''),'utf8'));
}
function safeQuarantineDestination(dir){
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
    (st.mode&0o077)!==0)
    throw Error('DELTA_QUARANTINE_UNTRUSTED');
}
function quarantineTargetTombstones(pair,missing,runId){
  if(!missing.length)return 0;
  const dir=REPORTS+'/ssd-recent-quarantine-'+runId;
  if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});
  safeQuarantineDestination(dir);
  const side=dir+'/'+pair.name;
  if(!fs.existsSync(side))fs.mkdirSync(side,{mode:0o700});
  safeQuarantineDestination(side);
  for(const rel of missing){
    const original=path.join(pair.target,rel);
    if(!fs.existsSync(original)&&!fs.lstatSync(original,{throwIfNoEntry:false}))
      continue;
    const dest=path.join(side,rel);
    fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
    if(fs.existsSync(dest))
      throw Error('DELTA_QUARANTINE_COLLISION');
    fs.renameSync(original,dest);
  }
  return missing.length;
}
async function selectiveRsync(pair,manifestPath){
  const args=[
    pair.name==='persistent'?'-aH':'-aEH',
    '--from0','--files-from='+manifestPath,
    '--stats','--',pair.source+'/',pair.target+'/'
  ];
  // The isolated helper already runs with root privileges. Start
  // rsync directly so a bounded timeout terminates the actual data
  // transfer process, not an intermediate sudo wrapper.
  echo('DELTA_TRANSFER_START',pair.name);
  const child=spawnSync('/usr/bin/rsync',args,{
    encoding:'utf8',timeout:180000,maxBuffer:3500000,
    stdio:['ignore','pipe','pipe']
  });
  if(child.status!==0||child.error){
    const reason=child.error?.code||'RSYNC_EXIT_'+child.status;
    throw Error('DELTA_SELECTIVE_RSYNC_FAILED:'+pair.name+':'+reason);
  }
  echo('DELTA_TRANSFER_RESULT',pair.name+':PASS');
}
export async function recentDeltaSync({cutoffMs,runId,scanOptions={}}){
  if(process.platform!=='darwin'||process.getuid()!==0)
    throw Error('DELTA_NEEDS_MACOS_ROOT_ACCESS');
  requirePrivateReports();
  let scanned=0;
  let transferred=0;
  let quarantined=0;
  for(const pair of SOURCE_PAIRS){
    const scan=scanRecentMetadata(pair,cutoffMs,{
      ...scanOptions,
      onProgress:p=>echo('DELTA_SCAN_ACTIVE',
        p.name+' FILES_VISITED='+p.entries+
        ' CHANGED='+p.changed+' ELAPSED_SECONDS='+p.seconds)
    });
    scanned+=scan.entries;
    echo('DELTA_SCAN_COMPLETE',pair.name+
      ' ENTRIES='+scan.entries+' SELECTED='+scan.changed.length+
      ' SECONDS='+Math.ceil(scan.elapsedMs/1000));
    const missing=collectMissingDirectEntries(pair,scan);
    echo('DELTA_DELETED_ENTRIES_FOUND',pair.name+':'+missing.length);
    const manifest=changedFilesManifest(scan,runId);
    // Quarantine SSD-only entries instead of deleting them; Mac
    // originals and all old data are retained for verification.
    quarantined+=quarantineTargetTombstones(pair,missing,runId);
    if(scan.changed.length){
      await selectiveRsync(pair,manifest);
      transferred+=scan.changed.length;
    }
  }
  echo('DELTA_TRANSFERRED_PATHS',transferred);
  echo('DELTA_SCANNED_ENTRIES',scanned);
  echo('DELTA_QUARANTINED_ENTRIES',quarantined);
  echo('DELTA_RECONCILIATION','RECENT_CHANGE_METADATA_APPLIED');
  return {scanned,transferred,quarantined};
}

function verifyRootHelperRelease(){
  const folder=path.dirname(fileURLToPath(import.meta.url));
  const raw=fs.readFileSync(folder+'/manifest.json');
  const digest=fs.readFileSync(folder+'/manifest.sha256','utf8').trim();
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  if(hash(raw)!==digest)
    throw Error('DELTA_SIGNED_BUNDLE_MANIFEST_MISMATCH');
  const m=JSON.parse(raw.toString('utf8'));
  if(m.schema!=='sandbox-v3.primary-cli.v1'||
    m.ssd_direct_cutover_bundle!==true||
    m.pinned_volume_uuid!=='A6268296-0330-4A69-9BE3-059BE8E4016A'||
    m.release!=='sandbox-v3-ssd-direct-bind-cutover-v4-20261103'||
    m.data_source!==SOURCE||
    m.files_sha256?.['ssd-recent-delta-on-mac.mjs']!==
      hash(fs.readFileSync(fileURLToPath(import.meta.url))))
    throw Error('DELTA_SIGNED_BUNDLE_IDENTITY_DRIFT');
}
function validateRootVolume(){
  const info=spawnSync('/usr/sbin/diskutil',[
    'info','-plist','/Volumes/SSD'],{
    encoding:'utf8',timeout:15000});
  if(info.status!==0||info.error)
    throw Error('DELTA_ROOT_DISKUTIL_FAILED');
  const plist=spawnSync('/usr/bin/plutil',
    ['-convert','json','-o','-','-'],{
      input:info.stdout,encoding:'utf8',timeout:15000
    });
  if(plist.status!==0||plist.error)
    throw Error('DELTA_ROOT_PLUTIL_FAILED');
  const value=JSON.parse(plist.stdout);
  const apfs=/APFS/i.test(
    String(value.FileSystemPersonality||'')+' '+
    String(value.FilesystemType||''));
  if(String(value.VolumeUUID||'').toUpperCase()!==
      'A6268296-0330-4A69-9BE3-059BE8E4016A'||
    value.Internal!==false||value.MountPoint!=='/Volumes/SSD'||!apfs)
    throw Error('DELTA_ROOT_VOLUME_UUID_OR_APFS_MISMATCH');
}
export async function runRootRecentDelta(cutoffMs,runId){
  if(process.platform!=='darwin'||!Number.isFinite(cutoffMs)||
    !/^[a-f0-9]{12}$/.test(runId))
    throw Error('DELTA_ROOT_DISPATCH_INVALID');
  const helper=fileURLToPath(import.meta.url);
  const args=['-n',process.execPath,helper,
    '--apply',String(Math.floor(cutoffMs)),runId];
  echo('DELTA_ROOT_HELPER','STARTING');
  await new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/sudo',args,{
      stdio:['ignore','pipe','pipe']
    });
    let line='';
    let errorBytes=0;
    child.stdout.on('data',buf=>{
      line+=buf.toString('utf8');
      let next=line.indexOf('\n');
      while(next>=0){
        const row=line.slice(0,next);
        // Only the program's known diagnostic lines are forwarded.
        if(row.startsWith('[SSD Recent Delta] ')&&row.length<350)
          console.log(row);
        line=line.slice(next+1);
        next=line.indexOf('\n');
      }
      if(line.length>1200)line='';
    });
    child.stderr.on('data',buf=>{errorBytes+=buf.length;});
    child.on('error',()=>reject(Error('DELTA_ROOT_SPAWN_FAILED')));
    child.on('close',code=>{
      if(code===0){resolve();return;}
      reject(Error('DELTA_ROOT_HELPER_FAILED_EXIT_'+code+
        '_STDERR_BYTES_'+errorBytes));
    });
  });
  echo('DELTA_ROOT_HELPER','PASS');
}
async function rootMain(){
  if(process.platform!=='darwin'||process.getuid()!==0)
    throw Error('MACOS_ROOT_OPERATOR_REQUIRED');
  if(process.argv.length!==5||process.argv[2]!=='--apply'||
    !/^\d{13}$/.test(process.argv[3])||
    !/^[a-f0-9]{12}$/.test(process.argv[4]))
    throw Error('ONLY_PINNED_DELTA_APPLY_SUPPORTED');
  verifyRootHelperRelease();
  validateRootVolume();
  const cutoff=Number(process.argv[3]);
  const runId=process.argv[4];
  if(!Number.isFinite(cutoff)||cutoff>Date.now()||
    cutoff<Date.now()-24*60*60*1000)
    throw Error('DELTA_ROOT_TIMESTAMP_INVALID');
  await recentDeltaSync({cutoffMs:cutoff,runId});
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===
  fileURLToPath(import.meta.url)){
  rootMain().catch(error=>{
    echo('STOP',String(error.message||'DELTA_FAILED').slice(0,120));
    process.exitCode=2;
  });
}
