"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const cp=require("node:child_process");

const script=path.resolve(__dirname,"..","scripts","verify-supabase-dump-local.sh");
const source=fs.readFileSync(script,"utf8");
function run(dir){
  return cp.spawnSync("bash",[script,dir],{encoding:"utf8",timeout:10000});
}

test("script is syntax-correct, offline-only and has no upload/network operations",()=>{
 const syntax=cp.spawnSync("bash",["-n",script],{encoding:"utf8"});
 assert.equal(syntax.status,0,syntax.stderr);
 assert.doesNotMatch(source,/\b(?:curl|wget|fetch|scp|rsync|git push|supabase db dump|pg_restore|sftp)\b/i);
 assert.match(source,/SHA256SUMS/);
 assert.match(source,/outside the Git repository/);
});

test("a private fake backup is checked, then integrity violations are rejected",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"rabota-free-dump-ci-"));
 try{
  for(const f of ["roles.sql","schema.sql","data.sql"]){
   fs.writeFileSync(path.join(dir,f),"-- fake data, never a real client\nCREATE TABLE test (id int);\n",{mode:0o600});
  }
  const first=run(dir);
  assert.equal(first.status,0,first.stdout+" "+first.stderr);
  assert.match(first.stdout,/created and verified locally/);
  const manifest=fs.readFileSync(path.join(dir,"SHA256SUMS"),"utf8");
  assert.equal(manifest.trim().split("\n").length,3);
  const again=run(dir);
  assert.equal(again.status,0,again.stderr);
  assert.match(again.stdout,/existing SHA256SUMS verified/);
  assert.equal(fs.readFileSync(path.join(dir,"SHA256SUMS"),"utf8"),manifest);
  fs.appendFileSync(path.join(dir,"data.sql"),"INSERT INTO test VALUES (123);\n");
  const damaged=run(dir);
  assert.equal(damaged.status,1,damaged.stdout+" "+damaged.stderr);
  assert.match(damaged.stderr,/checksum mismatch/);
  assert.equal(fs.readFileSync(path.join(dir,"SHA256SUMS"),"utf8"),manifest,
     "corrupt file must not overwrite the approved manifest");
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
});

test("missing, empty or non-directory backup is rejected",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"rabota-free-incomplete-ci-"));
 try{
  const empty=run(dir);
  assert.equal(empty.status,2);
  assert.match(empty.stderr,/missing, empty/);
  assert.equal(run(path.join(dir,"absent")).status,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
