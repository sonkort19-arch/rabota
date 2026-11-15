"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createFinanceModel}=require("../finance-model.js");

function fixture(request){
  const calls=[],snapshots=[];
  let generation=0;
  const model=createFinanceModel({
    dbRequest:async(path,method)=>{calls.push([path,method]);return request(path);},
    getRole:()=>"master",getMasterName:()=>"Рауль",getUserId:()=>"raul-test",
    nextGeneration:()=>++generation,isCurrentGeneration:id=>id===generation,
    onSnapshot:value=>snapshots.push(value)
  });
  return {model,calls,snapshots};
}
test("cash collections load across a 1000-row page boundary without missing records",async()=>{
  const rows=Array.from({length:1001},(_,i)=>({order_id:"synthetic-"+i,company_amount:i}));
  const {model,calls,snapshots}=fixture(async path=>{
    if(path.startsWith("rabota_finance_operations"))return [];
    if(path.startsWith("rabota_cash_collections")){
      const offset=Number(/offset=(\d+)/.exec(path)?.[1]);
      return rows.slice(offset,offset+1000);
    }
    throw Error("unexpected "+path);
  });
  await model.loadFinance();
  assert.equal(snapshots.length,1);
  assert.equal(snapshots[0].collections.length,1001);
  assert.equal(snapshots[0].collections.at(-1).order_id,"synthetic-1000");
  assert.deepEqual(calls.filter(([path])=>path.startsWith("rabota_cash_collections"))
    .map(([path])=>Number(/offset=(\d+)/.exec(path)[1])),[0,1000]);
  assert.ok(calls.every(([,method])=>method==="GET"));
});
test("failed second cash page never publishes incomplete finance snapshot",async()=>{
  const {model,snapshots}=fixture(async path=>{
    if(path.startsWith("rabota_finance_operations"))return [];
    if(path.includes("offset=0"))return Array.from({length:1000},(_,i)=>({order_id:"synthetic-"+i}));
    throw Error("second page unavailable");
  });
  await assert.rejects(model.loadFinance(),/second page unavailable/);
  assert.equal(snapshots.length,0);
});
test("collection deduplication uses order_id across separate pages",async()=>{
  const rows=Array.from({length:1000},(_,i)=>({order_id:"synthetic-"+i,company_amount:1}));
  const {model,snapshots}=fixture(async path=>{
    if(path.startsWith("rabota_finance_operations"))return [];
    if(path.includes("offset=0"))return rows;
    return [{order_id:"synthetic-0",company_amount:5},{order_id:"synthetic-1000",company_amount:9}];
  });
  await model.loadFinance();
  assert.equal(snapshots[0].collections.length,1001);
  assert.equal(snapshots[0].collections.find(x=>x.order_id==="synthetic-0").company_amount,5);
});
