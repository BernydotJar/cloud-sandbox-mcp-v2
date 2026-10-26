#!/usr/bin/env node
/**
 * Read-only crash recovery: validates the browser-v2 append-only hash chain,
 * and identifies orphaned intents/uncertain dispatches which require application
 * readback BEFORE a new request ID may be used. No URLs, session IDs, raw
 * request IDs or page content are emitted.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import process from 'node:process';

const DIGEST = payload=>crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
export function analyzeLedgerRows(rows){
  const pending=new Map();
  let previous='0'.repeat(64),sequence=0,uncertain=0,dispatched=0,otherResults=0;
  for(const row of rows){
    if(!row || typeof row!=='object' || Array.isArray(row))throw Error('INVALID_LEDGER_ENTRY');
    const {hash,...entry}=row;
    if(row.seq!==sequence+1 || row.previous!==previous ||
      typeof hash!=='string' || hash!==DIGEST(entry))
      throw Error('AUDIT_CHAIN_INVALID');
    previous=hash;sequence=row.seq;
    if(entry.event==='intent' && entry.outcome==='prepared' &&
       typeof entry.request_id==='string')pending.set(entry.request_id,false);
    if(entry.event==='result' && typeof entry.request_id==='string') {
      pending.delete(entry.request_id);
      if(entry.outcome==='uncertain')uncertain++;
      else if(entry.outcome==='dispatched')dispatched++;
      else otherResults++;
    }
  }
  return {audit_chain:'PASS',entries:sequence,orphaned_intents:pending.size,
    uncertain_dispatches:uncertain,dispatched_without_business_readback:dispatched,
    other_results:otherResults,requires_independent_review:pending.size+uncertain,
    auto_retry_allowed:false};
}
export async function scanAuditDirectory(directory){
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('UNSAFE_AUDIT_DIRECTORY');
  const names=(await fs.readdir(directory)).filter(n=>/^browser-v2-[0-9a-f-]{36}\.jsonl$/.test(n)).sort();
  if(names.length>1000)throw Error('AUDIT_FILE_COUNT_LIMIT');
  const summary={utc:new Date().toISOString(),audit_files:names.length,
    entries:0,orphaned_intents:0,uncertain_dispatches:0,
    dispatched_without_business_readback:0,corrupt_files:0,
    auto_retry_allowed:false,read_only:true};
  for(const name of names){
    const filename=path.join(directory,name);
    try{
      const info=await fs.lstat(filename);
      if(!info.isFile()||info.isSymbolicLink()||info.size>12000000)
        throw Error('UNSAFE_AUDIT_FILE');
      const content=await fs.readFile(filename,'utf8');
      const rows=content.trim().split('\n').filter(Boolean).map(JSON.parse);
      const result=analyzeLedgerRows(rows);
      for(const key of ['entries','orphaned_intents','uncertain_dispatches',
        'dispatched_without_business_readback'])summary[key]+=result[key];
    }catch{summary.corrupt_files++;}
  }
  summary.requires_independent_review=summary.orphaned_intents+
    summary.uncertain_dispatches+summary.corrupt_files;
  summary.verdict=summary.corrupt_files?'AUDIT_INTEGRITY_UNVERIFIED':
    summary.requires_independent_review?'RELOAD_READBACK_REQUIRED':'NO_UNRESOLVED_DISPATCH';
  return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const directory=process.argv[2]||path.join(os.homedir(),'Library','Application Support',
    'LCH','CloudSandboxComputerUse','audit-v2');
  try{
    const report=await scanAuditDirectory(directory);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(report.corrupt_files)process.exitCode=2;
  }catch(e){
    process.stderr.write('AUDIT_RECOVERY_FAILED:'+String(e?.code||e?.message||'UNKNOWN')+'\n');
    process.exitCode=2;
  }
}
