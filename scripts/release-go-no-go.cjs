#!/usr/bin/env node
"use strict";
/*
 * Evidence ledger, NOT a deployment system.
 * Reads only a local JSON file. Never contacts Supabase/Vercel/GitHub,
 * never merges branches, and never changes data.
 */
const fs=require("node:fs");
const path=require("node:path");
const configPath=path.join(__dirname,"..","qa","release-go-no-go.json");
const raw=JSON.parse(fs.readFileSync(configPath,"utf8"));
const command=process.argv[2]||"--status";

function evaluate(x){
  if(!x || !Array.isArray(x.gates)||!x.gates.length)throw Error("Missing release gates");
  const ids=x.gates.map(g=>g.id);
  if(new Set(ids).size!==ids.length)throw Error("Duplicate gate IDs");
  for(const g of x.gates){
    if(typeof g.id!=="string"||!g.id||typeof g.verified!=="boolean")
      throw Error("Invalid gate entry");
    if(g.verified && (!g.evidence || !/^https:\/\/[^ ]+/.test(g.evidence)))
      throw Error("Verified gate requires clickable evidence: "+g.id);
  }
  const blocked=x.gates.filter(g=>!g.verified);
  const passed=x.gates.filter(g=>g.verified);
  // An affirmative manifest alone is NEVER authority to deploy.
  const approved=x.gates.find(g=>g.id==="explicit_production_approval");
  const ready=blocked.length===0 && approved?.verified===true && x.decision==="GO";
  return {ready,passed:passed.length,total:x.gates.length,blocked};
}
const result=evaluate(raw);
if(command==="--status"){
  process.stdout.write(
    "Release decision: "+(result.ready?"GO (human-reviewed manifest only)":"NO_GO")+
    "\nConfirmed gates: "+result.passed+"/"+result.total+
    "\nRemaining: "+result.blocked.length+"\n"+
    result.blocked.map(g=>"BLOCKED "+g.id+": "+g.title).join("\n")+"\n"
  );
  process.exitCode=0;
}else if(command==="--require-go"){
  if(!result.ready){
    process.stderr.write("NO_GO: release is blocked; production actions are forbidden.\n");
    process.exitCode=3;
  }else{
    process.stdout.write("All gates marked verified. Explicit human review and deploy approval still required.\n");
  }
}else{
  process.stderr.write("Use --status or --require-go\n");
  process.exitCode=2;
}
module.exports={evaluate};
