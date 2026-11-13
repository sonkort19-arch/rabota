"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createFinanceModel,financeSplit,calculateAccruals,calculateCompanyCash,
  sumBy,roundMoney,TIMUR_FEE,RAUL_PERCENT}=require("../finance-model.js");

const r=(id,price,{paid=true,status="Выполнен",receivedBy="company"}={})=>({
  id,assignedUserId:"raul",price,paid,status,paymentReceivedBy:receivedBy
});
const payout=(kind,amount,{voided=false,orderId=null}={})=>({
  id:kind+String(amount),kind,amount,master_user_id:"raul",
  voided_at:voided?"2026-11-13T15:00:00Z":null,order_id:orderId
});
function setup({role="owner",masterName="Рауль",userId="raul",request,afterSnapshot}={}){
  let generation=0;const calls=[],snapshots=[];
  const defaultRequest=async path=>{
    if(path.startsWith("rabota_members"))return [{user_id:"raul",role:"master",active:true,master_name:"Рауль"}];
    return [];
  };
  const model=createFinanceModel({
    dbRequest:async(path,method,payload)=>{
      calls.push([path,method,payload]);
      return (request||defaultRequest)(path,method,payload);
    },
    getRole:()=>role,getMasterName:()=>masterName,getUserId:()=>userId,
    nextGeneration:()=>++generation,isCurrentGeneration:value=>value===generation,
    onSnapshot:s=>{snapshots.push(s);afterSnapshot?.(s);}
  });
  return {model,calls,snapshots,invalidate:()=>++generation};
}

test("unchanged payroll split and Russian currency",()=>{
  const x=financeSplit(10000);
  assert.deepEqual(x,{gross:10000,raul:5000,timur:1500,company:3500});
  assert.equal(TIMUR_FEE,1500);
  assert.equal(RAUL_PERCENT,0.5);
  assert.equal(roundMoney(10000.235),10000.24);
  assert.equal(sumBy([],x=>x.amount),0);
});
test("accruals only include Rauls completed paid orders",()=>{
  const x=calculateAccruals({
    orders:[r("1",10000),r("2",12000,{paid:false}),r("3",11000,{status:"Отменён"}),
      {id:"4",assignedUserId:"other",price:8000,status:"Выполнен",paid:true}],
    operations:[],collections:[],masterId:"raul"
  });
  assert.equal(x.eligible.length,1);
  assert.equal(x.raulAccrued,5000);
  assert.equal(x.timurAccrued,1500);
  assert.equal(x.companyEarned,3500);
  assert.equal(x.bookedPending.length,2);
});
test("manual payouts and voids calculate remaining balances exactly",()=>{
  const x=calculateAccruals({
    orders:[r("1",10000),r("2",14000)],
    operations:[payout("raul_payout",3000),payout("raul_payout",5000,{voided:true}),
      payout("timur_payout",1500)],
    collections:[],masterId:"raul"
  });
  assert.equal(x.raulAccrued,12000);
  assert.equal(x.raulPaid,3000);
  assert.equal(x.raulDue,9000);
  assert.equal(x.timurAccrued,3000);
  assert.equal(x.timurPaid,1500);
  assert.equal(x.timurDue,1500);
});
test("unconfirmed collection distinguishes master-held and awaiting owner",()=>{
  const x=calculateAccruals({
    orders:[r("1",10000),r("2",10000)],
    operations:[],masterId:"raul",collections:[
      {order_id:"1",master_user_id:"raul",company_amount:3500},
      {order_id:"2",master_user_id:"raul",company_amount:3500,submitted_at:"now"},
      {order_id:"3",master_user_id:"raul",company_amount:1000,confirmed_at:"now"}
    ]
  });
  assert.equal(x.masterHeld,3500);
  assert.equal(x.waitingOwner,3500);
});
test("company cash excludes unconfirmed master custody and automatic payouts",()=>{
  const cash=calculateCompanyCash({
    orders:[r("1",10000),r("2",16000,{receivedBy:"master"}),r("3",9000,{receivedBy:"master"})],
    collections:[
      {order_id:"2",company_amount:6500,confirmed_at:"2026-11-13"},
      {order_id:"3",company_amount:3000}
    ],
    payments:[payout("raul_payout",2000,{orderId:"2"}),payout("timur_payout",1500),
      payout("expense",500)],raulDue:3000,timurDue:500
  });
  assert.equal(cash.directReceipts,10000);
  assert.equal(cash.confirmedDeposits,6500);
  assert.equal(cash.allPayouts,1500);
  assert.equal(cash.expenses,500);
  assert.equal(cash.cashBalance,14500);
  assert.equal(cash.freeBalance,11000);
});
test("legacy paid order without metadata stays in direct receipts",()=>{
  const x=calculateCompanyCash({
    orders:[{id:"legacy",status:"Выполнен",paid:true,price:10000}],
    collections:[],payments:[],raulDue:0,timurDue:0
  });
  assert.equal(x.directReceipts,10000);
  assert.equal(x.cashBalance,10000);
});
test("owner finance reads active Raul and deduplicates operations and collections",async()=>{
  const {model,snapshots,calls}=setup({request:async path=>{
    if(path.startsWith("rabota_members"))return [
      {user_id:"inactive",role:"master",active:false,master_name:"Рауль"},
      {user_id:"raul",role:"master",active:true,master_name:"Рауль"}];
    if(path.startsWith("rabota_finance_operations"))return [
      {id:"a",amount:100},{id:"a",amount:200},{id:"b",amount:300}];
    if(path.startsWith("rabota_cash_collections"))return [
      {order_id:"1",company_amount:100},{order_id:"1",company_amount:200}];
    throw Error("unexpected "+path);
  }});
  await model.loadFinance();
  assert.equal(snapshots.length,1);
  assert.equal(snapshots[0].masterId,"raul");
  assert.deepEqual(snapshots[0].operations.map(x=>x.amount),[200,300]);
  assert.equal(snapshots[0].collections[0].company_amount,200);
  assert.equal(calls.length,3);
});
test("master finance never requests a members list",async()=>{
  const {model,snapshots,calls}=setup({role:"master",request:async()=>[]});
  await model.loadFinance();
  assert.equal(snapshots[0].masterId,"raul");
  assert.equal(calls.length,2);
  assert.ok(calls.every(([path])=>!path.startsWith("rabota_members")));
});
test("unauthorized role makes no finance request",async()=>{
  const {model,calls,snapshots}=setup({role:"manager"});
  await model.loadFinance();
  assert.equal(calls.length,0);assert.equal(snapshots.length,0);
});
test("server request failure never publishes partial finance state",async()=>{
  const {model,snapshots}=setup({request:async path=>{
    if(path.startsWith("rabota_members"))return [{user_id:"raul",active:true,master_name:"Рауль"}];
    throw Error("Network error");
  }});
  await assert.rejects(model.loadFinance(),/Network error/);
  assert.equal(snapshots.length,0);
});
test("invalid finance response fails closed",async()=>{
  const {model,snapshots}=setup({request:async path=>{
    if(path.startsWith("rabota_members"))return [{user_id:"raul",active:true,master_name:"Рауль"}];
    if(path.startsWith("rabota_finance_operations"))return null;
    return [];
  }});
  await assert.rejects(model.loadFinance(),/Не удалось загрузить финансовые операции/);
  assert.equal(snapshots.length,0);
});
test("older in-flight refresh cannot overwrite newer snapshot",async()=>{
  let unblock;
  const hold=new Promise(resolve=>{unblock=resolve;});
  let operationsRead=0;
  const {model,snapshots}=setup({role:"master",request:async path=>{
    if(path.startsWith("rabota_finance_operations")){
      operationsRead++;
      if(operationsRead===1){await hold;return [{id:"stale"}];}
      return [{id:"fresh"}];
    }
    return [];
  }});
  const first=model.loadFinance();
  await Promise.resolve(); // first request is suspended
  await model.loadFinance();
  unblock();
  await first;
  assert.deepEqual(snapshots.map(x=>x.operations.map(o=>o.id)),[["fresh"]]);
});
test("logout invalidates in-flight responses",async()=>{
  let unblock;
  const hold=new Promise(resolve=>{unblock=resolve;});
  const {model,snapshots,invalidate}=setup({role:"master",request:async path=>{
    if(path.startsWith("rabota_finance_operations")){await hold;return [];}
    return [];
  }});
  const inFlight=model.loadFinance();
  invalidate();unblock();await inFlight;
  assert.equal(snapshots.length,0);
});
test("finance operations fetch over 1000 rows safely",async()=>{
  const rows=Array.from({length:1001},(_,i)=>({id:"op"+i,amount:1}));
  const offsets=[];
  const {model,snapshots}=setup({role:"master",request:async path=>{
    if(path.startsWith("rabota_finance_operations")){
      const offset=Number(/offset=(\d+)/.exec(path)[1]);
      offsets.push(offset);
      return rows.slice(offset,offset+1000);
    }
    return [];
  }});
  await model.loadFinance();
  assert.deepEqual(offsets,[0,1000]);
  assert.equal(snapshots[0].operations.length,1001);
});
test("index uses the new finance module but retains existing RPC payment paths",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  assert.match(html,/src="\/finance-model\.js\?v=20261113-stage5"/);
  assert.match(html,/financeModel\.calculateAccruals/);
  assert.match(html,/financeModel\.calculateCompanyCash/);
  assert.match(html,/return financeModel\.loadFinance\(\)/);
  for(const rpc of ["rabota_record_order_payment","rabota_salary_payout_v2",
    "rabota_cash_distribute","rabota_cash_confirm","rabota_finance_void"])
    assert.ok(html.includes("rpc/"+rpc),"Missing RPC: "+rpc);
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});
