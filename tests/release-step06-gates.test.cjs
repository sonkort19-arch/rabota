"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const manifest=JSON.parse(read("qa/release-go-no-go.json"));
const preflight=read("qa/RELEASE_READONLY_PREFLIGHT.sql");
const runbook=read("qa/RELEASE_RUNBOOK_STAGE6.md");
const gateScript=path.join(root,"scripts","release-go-no-go.cjs");

test("candidate is the audited integration branch, not main or production",()=>{
 assert.equal(manifest.repository,"sonkort19-arch/rabota");
 assert.equal(manifest.current_main_sha_at_audit,"3c3e037b9a97ba74544af2fe337e09175cb603d7");
 assert.equal(manifest.candidate.pr,72);
 assert.equal(manifest.candidate.sha,"499baf79e65614d6eb6877f8c6baba0e8aba6fb2");
 assert.match(manifest.candidate.branch,/^audit\//);
});

test("the release is explicitly blocked until each human gate is evidenced",()=>{
 assert.equal(manifest.decision,"NO_GO");
 assert.equal(manifest.gates.length,12);
 assert.equal(manifest.gates.filter(x=>x.verified).length,2);
 assert.equal(manifest.gates.filter(x=>!x.verified).length,10);
 assert.equal(manifest.gates.find(x=>x.id==="explicit_production_approval").verified,false);
 const ids=new Set(manifest.gates.map(x=>x.id));
 for(const id of ["production_backup_restore","finance_historical_reconciliation",
 "staging_auth_rls","physical_iphone_pwa","vercel_target_verified",
 "migration_approval_and_drift","protected_release_path","final_main_comparison",
 "rollback_and_monitoring","explicit_production_approval"]){
   assert.ok(ids.has(id),id);
   assert.equal(manifest.gates.find(x=>x.id===id).verified,false,id);
 }
});

test("the informational command reports NO_GO without an exception",()=>{
 const p=cp.spawnSync(process.execPath,[gateScript,"--status"],{encoding:"utf8",cwd:root});
 assert.equal(p.status,0,p.stderr);
 assert.match(p.stdout,/Release decision: NO_GO/);
 assert.match(p.stdout,/Confirmed gates: 2\/12/);
 assert.match(p.stdout,/Remaining: 10/);
});

test("strict release gate fails closed with code 3",()=>{
 const p=cp.spawnSync(process.execPath,[gateScript,"--require-go"],{encoding:"utf8",cwd:root});
 assert.equal(p.status,3);
 assert.match(p.stderr,/production actions are forbidden/);
});

test("the preflight SQL is READ ONLY and returns no customer rows",()=>{
 const uncommented=preflight.replace(/--[^\n]*/g,"");
 assert.match(uncommented,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
 assert.match(uncommented,/ROLLBACK;\s*$/);
 assert.doesNotMatch(uncommented,/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|DO|CALL|GRANT|REVOKE|SET|COPY|EXECUTE)\b/i);
 assert.doesNotMatch(uncommented,/\b(?:phone|name|address|details|note|customer)\b/i);
 assert.match(uncommented,/pg_catalog\.md5\(p\.prosrc\)/);
 assert.match(uncommented,/relrowsecurity/);
 assert.match(uncommented,/rabota_paid_order_guard_trigger/);
});

test("runbook defines safe migration order and non-destructive rollback",()=>{
 assert.match(runbook,/008.*009/);
 assert.match(runbook,/NO-GO/);
 assert.match(runbook,/полный PITR/i);
 assert.match(runbook,/на основную/);
 assert.match(runbook,/не применять часть набора/i);
 assert.match(runbook,/grafik/);
 assert.match(runbook,/общей/);
 assert.match(runbook,/реальн/i);
});

test("the evidence ledger stores no secrets or client PII",()=>{
 const data=JSON.stringify(manifest)+preflight;
 assert.doesNotMatch(data,/postgres:\/\/[^ \n]+@|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|VERCEL_TOKEN|Bearer +eyJ/i);
 assert.doesNotMatch(data,/phone_number|customer_name|client_address/i);
});
