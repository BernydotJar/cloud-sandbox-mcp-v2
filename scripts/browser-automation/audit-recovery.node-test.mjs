import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AuditLedger} from '../../mac-host/browser-runtime/audit-ledger.mjs';
import {analyzeLedgerRows,scanAuditDirectory} from './audit-recovery.mjs';

test('read-only crash recovery identifies unknown and orphaned actions',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sandbox-ledger-audit-'));
 const ledger=new AuditLedger(dir);
 try{
   await ledger.append({event:'intent',request_id:'click-000001',outcome:'prepared'});
   await ledger.append({event:'result',request_id:'click-000001',outcome:'uncertain'});
   await ledger.append({event:'intent',request_id:'click-000002',outcome:'prepared'});
   await ledger.append({event:'intent',request_id:'click-000003',outcome:'prepared'});
   await ledger.append({event:'result',request_id:'click-000003',outcome:'dispatched'});
   await ledger.close();
   const report=await scanAuditDirectory(dir);
   assert.equal(report.audit_files,1);
   assert.equal(report.uncertain_dispatches,1);
   assert.equal(report.orphaned_intents,1);
   assert.equal(report.dispatched_without_business_readback,1);
   assert.equal(report.requires_independent_review,2);
   assert.equal(report.auto_retry_allowed,false);
   assert(!JSON.stringify(report).includes('click-000001'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('tampered append-only audit rows cannot be treated as valid evidence',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sandbox-ledger-tamper-'));
 const ledger=new AuditLedger(dir);
 try{
   await ledger.append({event:'intent',request_id:'safe-request',outcome:'prepared'});
   await ledger.close();
   const file=(await fs.readdir(dir))[0];
   const rows=(await fs.readFile(path.join(dir,file),'utf8')).trim().split('\n').map(JSON.parse);
   rows[0].outcome='dispatched';
   assert.throws(()=>analyzeLedgerRows(rows),/AUDIT_CHAIN_INVALID/);
   await fs.writeFile(path.join(dir,file),JSON.stringify(rows[0])+'\n');
   const report=await scanAuditDirectory(dir);
   assert.equal(report.corrupt_files,1);
   assert.equal(report.verdict,'AUDIT_INTEGRITY_UNVERIFIED');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
