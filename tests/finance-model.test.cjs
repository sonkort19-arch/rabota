"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createFinanceModel,createFinanceReader,financeSplit,calculateAccruals,calculateCompanyCash,
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
test("a half-cent share follows PostgreSQL rounding instead of binary floating point",()=>{
  assert.deepEqual(financeSplit(4096.11),{gross:4096.11,raul:2048.06,timur:1500,company:548.05});
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
test("partial handoffs separate outstanding, pending and confirmed cash from payroll",()=>{
  const collection={order_id:"1",master_user_id:"raul",company_amount:3500,
    submitted_amount:"1500.75",confirmed_amount:"1000.50"};
  const values=calculateAccruals({orders:[r("1",10000)],operations:[],
    collections:[collection],masterId:"raul"});
  assert.equal(values.masterHeld,1999.25);
  assert.equal(values.waitingOwner,500.25);
  assert.equal(values.raulAccrued,5000);
  const cash=calculateCompanyCash({orders:[r("1",10000)],collections:[collection],
    payments:[],raulDue:0,timurDue:0});
  assert.equal(cash.confirmedDeposits,1000.50);
  assert.equal(cash.cashBalance,1000.50);
  assert.deepEqual(cash.awaiting,[collection]);
});
test("cash history preserves dates of confirmed instalments and counts each legacy receipt once",async()=>{
  const first="2026-11-20T11:00:00Z",second="2026-11-21T11:00:00Z";
  const legacy={order_id:"old",company_amount:3500,confirmed_at:first};
  const managed={order_id:"new",company_amount:2000,submitted_amount:2000,
    confirmed_amount:2000,confirmed_at:second,last_confirmed_at:second};
  const event={id:"entry-a",order_id:"new",amount:800,created_at:first};
  const {model,snapshots}=setup({request:async path=>{
    if(path.startsWith("rabota_cash_collections"))return [legacy,legacy,managed];
    if(path.startsWith("rabota_cash_transfer_events"))return [
      {id:"entry-b",order_id:"new",amount:1200,created_at:second},event,event];
    return [];
  }});
  await model.loadFinance();
  assert.deepEqual(snapshots[0].deposits.map(x=>[x.amount,x.confirmed_at]),
    [[3500,first],[1200,second],[800,first]]);
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
  const second=model.loadFinance();
  assert.equal(operationsRead,1,"the new ledger request waits for the older HTTP request");
  unblock();
  await Promise.all([first,second]);
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
test("Expenses shares the in-flight ledger request with Finance",async()=>{
  let releaseLedger;
  const ledger=new Promise(resolve=>{releaseLedger=resolve;});
  const {model,calls,snapshots}=setup({request:async path=>
    path.startsWith("rabota_finance_operations")?ledger:[]
  });
  const finance=model.loadFinance({fresh:false});
  const expenses=model.readOperations();
  assert.equal(model.readOperations(),expenses);
  const row={id:"expense-a",kind:"expense",amount:450};
  releaseLedger([row]);
  assert.deepEqual(await expenses,[row]);
  await finance;
  assert.deepEqual(snapshots[0].operations,[row]);
  assert.equal(calls.filter(([path])=>path.startsWith("rabota_finance_operations")).length,1);
});
test("resetting account operations isolates an outstanding ledger read",async()=>{
  let releasePrevious;
  const previous=new Promise(resolve=>{releasePrevious=resolve;});
  let callCount=0;
  const {model}=setup({request:async()=>++callCount===1?previous:[{id:"new-account"}]});
  const previousRead=model.readOperations();
  const previousRejected=assert.rejects(previousRead,/Аккаунт изменился/);
  model.resetOperations();
  assert.deepEqual(await model.readOperations(),[{id:"new-account"}]);
  releasePrevious([{id:"previous-account"}]);
  await previousRejected;
  assert.equal(callCount,2);
});
test("finance readers share one request and skip unchanged cache revisions",async()=>{
  let resolve;
  let calls=0,now=100;
  const reader=createFinanceReader({
    load:()=>{calls++;return new Promise(done=>resolve=done);},
    equal:(left,right)=>left.amount===right.amount,
    now:()=>now
  });
  const initial=reader.refresh();
  assert.equal(reader.refresh(),initial);
  await Promise.resolve();
  assert.equal(calls,1);
  resolve({amount:250});
  await initial;
  const ready=reader.state();
  assert.equal(ready.revision,1);
  assert.equal(ready.ready,true);
  assert.equal(ready.updatedAt,100);
  now=120;
  await reader.refresh({maxAge:30});
  assert.equal(calls,1);
  now=140;
  const background=reader.refresh({maxAge:30});
  assert.equal(reader.state().refreshing,true);
  assert.equal(reader.state().stale,false);
  assert.strictEqual(reader.state().value,ready.value);
  await Promise.resolve();
  resolve({amount:250});
  await background;
  assert.equal(reader.state().revision,1);
  assert.equal(reader.state().updatedAt,140);
  assert.strictEqual(reader.state().value,ready.value);
});
test("confirmed writes invalidate the old response and queue one fresh attempt",async()=>{
  const responses=[];
  const reader=createFinanceReader({load:({fresh})=>new Promise(resolve=>responses.push({fresh,resolve}))});
  const first=reader.refresh();
  await Promise.resolve();
  responses[0].resolve({amount:120});
  await first;

  const background=reader.refresh();
  await Promise.resolve();
  reader.invalidate();
  reader.invalidate();
  assert.equal(reader.refresh(),background);
  assert.equal(responses.length,2);
  responses[1].resolve({amount:160});
  await Promise.resolve();
  assert.equal(responses.length,3);
  assert.equal(responses[2].fresh,true);
  assert.equal(reader.state().value.amount,120);
  assert.equal(reader.state().stale,true);
  responses[2].resolve({amount:175});
  await background;
  assert.equal(reader.state().value.amount,175);
  assert.equal(reader.state().stale,false);
});
test("transient read failures retain clearly stale data, authorization errors erase it",async()=>{
  let result={amount:100},failure=null;
  const reader=createFinanceReader({load:async()=>{
    if(failure)throw failure;
    return result;
  }});
  await reader.refresh();
  failure=Error("timeout");
  await reader.refresh();
  assert.equal(reader.state().ready,true);
  assert.equal(reader.state().stale,true);
  assert.equal(reader.state().error,"");
  assert.equal(reader.state().refreshError,"timeout");
  assert.equal(reader.state().value.amount,100);

  failure=null;result={amount:150};
  await reader.refresh();
  assert.equal(reader.state().ready,true);
  assert.equal(reader.state().stale,false);
  assert.equal(reader.state().value.amount,150);
  failure=Object.assign(Error("denied"),{status:403});
  await reader.refresh();
  assert.equal(reader.state().ready,false);
  assert.equal(reader.state().error,"denied");
  assert.equal(reader.state().value,null);
});
test("resetting financial readers discards a previous account response",async()=>{
  let release,calls=0;
  const reader=createFinanceReader({load:()=>++calls===1?
    new Promise(resolve=>release=resolve):Promise.resolve({owner:"current"})});
  const previous=reader.refresh();
  await Promise.resolve();
  reader.reset();
  assert.equal(reader.state().value,null);
  await reader.refresh();
  release({owner:"former"});
  await previous;
  assert.equal(reader.state().value.owner,"current");
});
test("index retains existing RPC payment paths behind the shared finance model",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  assert.match(html,/src="\/finance-model\.js\?v=[A-Za-z0-9_-]+"/);
  assert.match(html,/financeModel\.calculateAccruals/);
  assert.match(html,/financeModel\.calculateCompanyCash/);
  assert.match(html,/financeModel\.loadFinance\(\{fresh,operations,isCurrent\}\)/);
  for(const rpc of ["rabota_record_order_payment","rabota_salary_payout_v2",
    "rabota_cash_distribute","rabota_cash_confirm","rabota_finance_void"])
    assert.ok(html.includes("rpc/"+rpc),"Missing RPC: "+rpc);
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});
