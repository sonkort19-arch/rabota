"use strict";
// Autonomous roadmap bookkeeping: offline tests only, no network and no production access.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const ledger=JSON.parse(read("qa/autonomy-progress.json"));
const roadmap=read("qa/AUTONOMOUS_IMPROVEMENT_ROADMAP.md");
const status=read("qa/POST_FINANCE_MIGRATION_STATUS_20261114.md");

test("roadmap is a separate, numbered and persistent ten-phase program",()=>{
 assert.equal(ledger.schema_version,1);
 assert.equal(ledger.project,"CRM Работа / MOBA");
 assert.equal(ledger.total,10);
 assert.equal(ledger.phases.length,10);
 assert.match(ledger.last_verified_main_sha,/^[a-f0-9]{40}$/);
 assert.equal(ledger.plan,"qa/AUTONOMOUS_IMPROVEMENT_ROADMAP.md");
 const numbers=ledger.phases.map(s=>s.number);
 assert.deepEqual(numbers,Array.from({length:10},(_,i)=>i+1));
 for(const phase of ledger.phases){
  assert.equal(typeof phase.title,"string");
  assert.ok(phase.title.length>5);
  assert.ok(["pending","in_progress","blocked","done"].includes(phase.status));
  assert.ok(Array.isArray(phase.evidence));
  assert.ok(Array.isArray(phase.blockers));
  if(phase.status==="done"){
   assert.ok(phase.evidence.length>=1,"completed phase must link to actual evidence");
   assert.ok(phase.evidence.every(e=>typeof e==="string"&&e.trim()));
   assert.equal(phase.blockers.length,0,"completed phase cannot have unresolved blockers");
  }
 }
 const completed=ledger.phases.filter(x=>x.status==="done");
 assert.equal(ledger.completed,completed.length);
 const next=ledger.phases.find(x=>x.status!=="done");
 assert.equal(ledger.next_phase,next?next.number:null);
});
test("roadmap does not mistake deployed finance SQL for uninstalled code",()=>{
 for(const x of ["20261114090014","20261114090049","20261114090119"]){
  assert.ok(ledger.baseline.production_migrations.some(z=>z.includes(x)));
  assert.ok(status.includes(x));
 }
 assert.equal(ledger.safety.production_backup_verified,false);
 assert.equal(ledger.safety.production_restore_verified,false);
 assert.equal(ledger.safety.allow_production_sql_writes,false);
 assert.equal(ledger.safety.allow_real_client_messages,false);
 assert.equal(ledger.safety.allow_finance_writes,false);
});
test("automation contract keeps production data protected and uses verifiable progress",()=>{
 assert.match(roadmap,/одну\*\* самую раннюю/);
 assert.match(roadmap,/Node \+ Chromium\/WebKit/);
 assert.match(roadmap,/GitHub admin/);
 assert.match(roadmap,/10\/10/);
 assert.match(roadmap,/не проводить/);
});
