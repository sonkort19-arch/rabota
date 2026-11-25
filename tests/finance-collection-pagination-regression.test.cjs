"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createFinanceModel,calculateRecordedCashFlow}=require("../finance-model.js");

function fixture(request){
  const calls=[],snapshots=[];
  let generation=0;
  const model=createFinanceModel({
    dbRequest:async(path,method)=>{calls.push([path,method]);return request(path);},
    getRole:()=>"owner",getUserId:()=>"owner-test",
    nextGeneration:()=>++generation,isCurrentGeneration:id=>id===generation,
    onSnapshot:value=>snapshots.push(value)
  });
  return {model,calls,snapshots};
}

test("the scalar accounting RPC returns all full receipts beyond the PostgREST table page size",async()=>{
  const rows=Array.from({length:1001},(_,i)=>({
    order_id:"synthetic-"+i,master_id:null,amount:i+1,payment_method:"card"
  }));
  const {model,calls}=fixture(async path=>{
    assert.equal(path,"rpc/rabota_payroll_snapshot_v3");
    return {version:3,state:"active",master_id:"raul",activated_at:"2026-11-25T00:00:00Z",
      earned:0,paid:0,due:0,orders:[],payouts:[],accounting_version:1,
      accounting_receipts:rows,accounting_payouts:[]};
  });
  const payroll=await model.readPayrollSnapshot();
  assert.equal(payroll.accounting.receipts.length,1001);
  assert.equal(payroll.accounting.receipts.at(-1).orderId,"synthetic-1000");
  assert.equal(calculateRecordedCashFlow({payroll}).receiptTotal,501501);
  assert.deepEqual(calls,[["rpc/rabota_payroll_snapshot_v3","GET"]]);
});

test("failed second ledger page never publishes incomplete financial operations",async()=>{
  const {model,snapshots}=fixture(async path=>{
    assert.match(path,/^rabota_finance_operations\?/);
    if(path.includes("offset=0"))return Array.from({length:1000},(_,i)=>({id:"synthetic-"+i}));
    throw Error("second page unavailable");
  });
  await assert.rejects(model.loadFinance(),/second page unavailable/);
  assert.equal(snapshots.length,0);
});

test("ledger deduplication uses operation identity across separate pages",async()=>{
  const rows=Array.from({length:1000},(_,i)=>({id:"synthetic-"+i,kind:"expense",amount:1}));
  const {model,snapshots,calls}=fixture(async path=>{
    assert.match(path,/^rabota_finance_operations\?/);
    if(path.includes("offset=0"))return rows;
    return [{id:"synthetic-0",kind:"expense",amount:5},{id:"synthetic-1000",kind:"expense",amount:9}];
  });
  await model.loadFinance();
  assert.equal(snapshots[0].operations.length,1001);
  assert.equal(snapshots[0].operations.find(x=>x.id==="synthetic-0").amount,5);
  assert.deepEqual(calls.map(([path])=>Number(/offset=(\d+)/.exec(path)[1])),[0,1000]);
  assert.ok(calls.every(([,method])=>method==="GET"));
});
