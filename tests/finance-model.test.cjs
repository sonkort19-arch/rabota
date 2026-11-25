"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createFinanceModel,createFinanceReader,payrollSplitV3,fullyPaidAmount,
  readPayrollSnapshot,normalizePayrollSnapshot,calculateRecordedCashFlow,
  money,sumBy,roundMoney}=require("../finance-model.js");

function setup({role="owner",userId="current-user",request=async()=>[],afterSnapshot}={}){
  let generation=0;
  const calls=[],snapshots=[];
  const model=createFinanceModel({
    dbRequest:async(path,method,payload)=>{
      calls.push([path,method,payload]);
      return request(path,method,payload);
    },
    getRole:()=>role,getUserId:()=>userId,
    nextGeneration:()=>++generation,isCurrentGeneration:value=>value===generation,
    onSnapshot:s=>{snapshots.push(s);afterSnapshot?.(s);}
  });
  return {model,calls,snapshots,invalidate:()=>++generation};
}

test("canonical payroll pays Raul 50% plus 1500 rubles with PostgreSQL cent rounding",()=>{
  for(const [paid,raul,company] of [[10000,6500,3500],[16000,9500,6500],[20000,11500,8500],[4096.11,3548.06,548.05]]){
    assert.deepEqual(payrollSplitV3(paid),{gross:paid,raul,company});
  }
  assert.equal(payrollSplitV3(null),null);
  assert.equal(payrollSplitV3(0),null);
  assert.equal(roundMoney(10000.235),10000.24);
  assert.equal(sumBy([],x=>x.amount),0);
  assert.match(money(2000.50),/^2\s000,5 ₽$/);
});
test("unpaid, partial, missing or unfinished payments do not qualify as full",()=>{
  const order={status:"Выполнен",paid:true,price:10000,paymentAmount:10000};
  assert.equal(fullyPaidAmount(order),10000);
  for(const change of [{paymentAmount:9999.99},{paymentAmount:10000.01},{paymentAmount:null},
    {paymentAmount:""},{status:"В работе"},{paid:false},{paid:"false"},{paymentAmount:0,price:0}])
    assert.equal(fullyPaidAmount({...order,...change}),null,JSON.stringify(change));
});
test("v3 payroll uses the server snapshot, with explicit compatibility and fail-closed errors",async()=>{
  const active={
    version:3,state:"active",master_id:"raul",activated_at:"2026-11-24T20:00:00Z",
    earned:"6500.00",paid:"2000.00",due:"4500.00",
    orders:[{order_id:"order-a",paid_amount:"10000",earned_amount:"6500",company_share:"3500",rule_version:3}],
    payouts:[{id:"payout-a",amount:"2000",payment_method:"card",kind:"raul_payout"}],
    refunds:[{order_id:"refunded-a",amount:"12000",refunded_at:"2026-11-25T20:00:00Z",
      earned_reversed:"7500",earned_at:"2026-11-25T10:00:00Z"}]
  };
  const snapshot=await readPayrollSnapshot(async (endpoint,method)=>{
    assert.equal(endpoint,"rpc/rabota_payroll_snapshot_v3");
    assert.equal(method,"GET");
    return active;
  });
  assert.equal(snapshot.earned,6500);
  assert.deepEqual(snapshot.orders,[{orderId:"order-a",actualPaid:10000,earned:6500,companyShare:3500,earnedAt:null,ruleVersion:3}]);
  assert.deepEqual(snapshot.payouts,[{id:"payout-a",orderId:null,amount:2000,occurredAt:null,method:"card",note:"",kind:"raul_payout"}]);
  assert.deepEqual(snapshot.refunds,[{orderId:"refunded-a",amount:12000,occurredAt:"2026-11-25T20:00:00Z",
    earnedReversed:7500,earnedAt:"2026-11-25T10:00:00Z"}]);
  assert.deepEqual(await readPayrollSnapshot(async()=>({version:3,state:"inactive"})),{version:3,state:"inactive"});
  assert.equal(await readPayrollSnapshot(async()=>{throw Object.assign(Error("missing"),{code:"PGRST202"});}),null);
  assert.equal(await readPayrollSnapshot(async()=>{
    throw Object.assign(Error("function public.rabota_payroll_snapshot_v3() does not exist"),{code:"42883"});
  }),null);
  await assert.rejects(readPayrollSnapshot(async()=>{
    throw Object.assign(Error("function private.some_dependency() does not exist"),{code:"42883"});
  }),/some_dependency/);
  await assert.rejects(readPayrollSnapshot(async()=>{throw Object.assign(Error("denied"),{code:"42501"});}),/denied/);
  await assert.rejects(readPayrollSnapshot(async()=>[]),/Неизвестный формат/);
  await assert.rejects(readPayrollSnapshot(async()=>({...active,earned:null})),/неверную сумму/);
  await assert.rejects(readPayrollSnapshot(async()=>({...active,due:4000})),/неверную сумму/);
  await assert.rejects(readPayrollSnapshot(async()=>({...active,refunds:[{...active.refunds[0],order_id:"order-a"}]})),/запись возврата/);
  await assert.rejects(readPayrollSnapshot(async()=>({...active,orders:[active.orders[0],active.orders[0]]})),/начисление по заказу/);
});
test("payroll reconciliation preserves original payout amounts separately from the payable balance",async()=>{
  const payout={id:"payout-a",amount:"3000",recorded_amount:"5000",held_amount:"2000",kind:"legacy"};
  const hold={order_id:"order-held",order_number:101,payroll_on_hold:true,cash_on_hold:false,
    reason:"Проверить повторную запись",earned_amount:"2000",credited_amount:"2000",linked_recorded_amount:"2000",payment_amount:null};
  const cashHold={...hold,order_id:"order-active",order_number:102,payroll_on_hold:false,cash_on_hold:true,
    reason:"Уточнить местонахождение наличных",earned_amount:null,credited_amount:null,linked_recorded_amount:null,payment_amount:"8000"};
  const active={version:3,state:"active",master_id:"raul",activated_at:"2026-11-24T20:00:00Z",
    earned:"5500",paid:"3000",due:"2500",orders:[{order_id:"order-active",paid_amount:"8000",
      earned_amount:"5500",company_share:"2500"}],payouts:[payout],holds:[hold,cashHold]};
  const snapshot=await readPayrollSnapshot(async()=>active);
  assert.equal(snapshot.due,2500);
  assert.equal(snapshot.payouts[0].held,2000);
  assert.equal(snapshot.payouts[0].recorded,5000);
  assert.deepEqual(snapshot.holds[0],{orderId:"order-held",orderNumber:101,payrollOnHold:true,cashOnHold:false,
    reason:hold.reason,earned:2000,credited:2000,linkedRecorded:2000,paymentAmount:null});
  assert.equal(snapshot.holds[1].paymentAmount,8000);
  await assert.rejects(readPayrollSnapshot(async()=>({...active,holds:[hold,hold]})),/запись на сверке/);
  await assert.rejects(readPayrollSnapshot(async()=>({...active,holds:[{...hold,order_id:"order-active"}]})),/запись на сверке/);
  await assert.rejects(readPayrollSnapshot(async()=>({...active,payouts:[{...payout,held_amount:2001}]})),/выплаты на сверке/);
});
const receipt=(orderId,amount,{masterId="raul",method="cash",paidAt=null,occurredAt="2026-11-25T11:00:00Z"}={})=>({
  order_id:orderId,master_id:masterId,amount,payment_method:method,paid_at:paidAt,occurred_at:occurredAt
});
const activeAccounting={
  version:3,state:"active",master_id:"raul",activated_at:"2026-11-24T20:00:00Z",
  accounting_version:1,earned:9000,paid:2000,due:7000,
  orders:[
    {order_id:"current",paid_amount:10000,earned_amount:6500,company_share:3500,rule_version:3},
    {order_id:"legacy",paid_amount:5000,earned_amount:2500,company_share:1500,rule_version:"legacy_verified"}
  ],
  payouts:[{id:"old-allocated",amount:1700},{id:"new-payout",amount:300}],
  holds:[{order_id:"held",order_number:41,payroll_on_hold:true,cash_on_hold:true,reason:"Проверить архив",
    earned_amount:5500,credited_amount:600,linked_recorded_amount:3000,payment_amount:8000}],
  refunds:[{order_id:"refunded",amount:18000,refunded_at:"2026-11-25T20:00:00Z"}],
  accounting_receipts:[receipt("current",10000),receipt("held",8000),receipt("legacy",5000,{method:null}),
    receipt("other",12000,{masterId:"other-master",method:"card"}),receipt("refunded",18000,{method:"card"})],
  accounting_payouts:[{id:"old-allocated",amount:1700},{id:"held-actual",order_id:"held",amount:600},
    {id:"new-payout",amount:300,payment_method:"card"}]
};

test("accounting counts full receipts once regardless of receiver, holds or historical payment metadata",()=>{
  const payroll=normalizePayrollSnapshot(activeAccounting);
  assert.equal(payroll.accountingVersion,1);
  const flow=calculateRecordedCashFlow({payroll,operations:[
    {id:"real-expense",kind:"expense",amount:200},
    {id:"real-expense",kind:"expense",amount:200},
    {id:"voided-expense",kind:"expense",amount:900,voided_at:"2026-11-25T20:00:00Z"},
    {id:"held-actual",kind:"timur_payout",amount:3000,order_id:"held"},
    {id:"old-duplicate",kind:"raul_payout",amount:3500,order_id:"held"}
  ],manualEntries:[
    {id:"manual-income",kind:"income",amount:1000,to_account:"cash"},
    {id:"manual-expense",kind:"expense",amount:300,from_account:"account"},
    {id:"internal-transfer",kind:"transfer",amount:777,from_account:"cash",to_account:"account"}
  ]});
  assert.equal(flow.receiptTotal,53000);
  assert.equal(flow.refundTotal,18000);
  assert.equal(flow.netReceiptTotal,35000);
  assert.deepEqual(flow.receiptByMethod,{cash:18000,card:30000,unknown:5000});
  assert.deepEqual(flow.netReceiptByMethod,{cash:18000,card:12000,unknown:5000});
  assert.equal(flow.refunds[0].method,"card");
  assert.equal(flow.receipts.find(row=>row.orderId==="legacy").paidAt,null);
  assert.equal(flow.receipts.find(row=>row.orderId==="legacy").occurredAt,"2026-11-25T11:00:00Z");
  assert.equal(flow.payoutTotal,2600,"includes verified held payment and excludes a disputed duplicate");
  assert.equal(flow.expenseTotal,200);
  assert.deepEqual(flow.expenses.map(row=>[row.id,row.amount,row.voidedAt]),[
    ["real-expense",200,null],["voided-expense",900,"2026-11-25T20:00:00Z"]
  ]);
  assert.deepEqual(flow.manualEntries.map(row=>row.kind),["income","expense","transfer"]);
  assert.equal(flow.manualIncome,1000);
  assert.equal(flow.manualExpense,300);
  assert.equal(flow.recordedNet,32900);
  assert.deepEqual(flow.orderShares,[
    {orderId:"current",companyShare:3500,payrollCost:6500},
    {orderId:"held",companyShare:null,payrollCost:null},
    {orderId:"legacy",companyShare:1500,payrollCost:3500},
    {orderId:"other",companyShare:12000,payrollCost:0}
  ]);
  assert.equal(flow.unverifiedMarginCount,1);
  assert.equal(flow.companyShare,17000);
  assert.equal(flow.companyProfit,16500,"payroll and transfers are not deducted again from profit");
});

test("only a validated owner accounting snapshot can produce accounting totals",()=>{
  const legacy={...activeAccounting};
  for(const key of ["accounting_version","accounting_receipts","accounting_payouts"])delete legacy[key];
  assert.equal(calculateRecordedCashFlow({payroll:normalizePayrollSnapshot(legacy)}),null);
  const own={...activeAccounting,accounting_receipts:activeAccounting.accounting_receipts.filter(row=>row.master_id==="raul")};
  delete own.accounting_payouts;
  const master=normalizePayrollSnapshot(own);
  assert.equal(master.accounting.payouts,null);
  assert.equal(master.accounting.receipts.length,4);
  assert.equal(calculateRecordedCashFlow({payroll:master}),null);
  const other=normalizePayrollSnapshot({version:3,state:"not_applicable",accounting_version:1,
    accounting_receipts:[receipt("order-other",4000,{masterId:"other-master"})]});
  assert.equal(other.accounting.receipts[0].masterId,"other-master");
  assert.equal(other.accounting.payouts,null);
  assert.deepEqual(normalizePayrollSnapshot({version:3,state:"not_applicable",accounting_version:1}),
    {version:3,state:"not_applicable",accountingVersion:1});
});

test("reject incomplete, duplicate or inconsistent accounting facts",()=>{
  const [first]=activeAccounting.accounting_receipts;
  assert.throws(()=>normalizePayrollSnapshot({...activeAccounting,accounting_version:2}),/Неизвестная версия/);
  assert.throws(()=>normalizePayrollSnapshot({...activeAccounting,accounting_version:undefined}),/без версии/);
  assert.throws(()=>normalizePayrollSnapshot({...activeAccounting,accounting_receipts:null}),/неполный журнал/);
  assert.throws(()=>normalizePayrollSnapshot({...activeAccounting,accounting_receipts:[first,first]}),/запись поступления/);
  assert.throws(()=>normalizePayrollSnapshot({...activeAccounting,accounting_receipts:[{order_id:"incomplete",amount:1000}]}),/запись поступления/);
  assert.throws(()=>normalizePayrollSnapshot({...activeAccounting,
    accounting_receipts:activeAccounting.accounting_receipts.filter(row=>row.order_id!=="refunded")}),/возврат без соответствующего поступления/);
  assert.throws(()=>normalizePayrollSnapshot({...activeAccounting,
    accounting_receipts:activeAccounting.accounting_receipts.map(row=>row.order_id==="legacy"?{...row,amount:4000}:row)}),
    /начисление без соответствующего поступления/);
  assert.throws(()=>normalizePayrollSnapshot({...activeAccounting,
    accounting_payouts:[activeAccounting.accounting_payouts[0],activeAccounting.accounting_payouts[0]]}),/запись учтённой выплаты/);
});

test("owner finance reads one operations endpoint and deduplicates records",async()=>{
  const {model,snapshots,calls}=setup({request:async path=>{
    assert.match(path,/^rabota_finance_operations\?/);
    return [{id:"a",amount:100},{id:"a",amount:200},{id:"b",amount:300}];
  }});
  await model.loadFinance();
  assert.equal(snapshots.length,1);
  assert.deepEqual(snapshots[0].operations.map(x=>x.amount),[200,300]);
  assert.equal(calls.length,1);
});
test("master finance does not query owner ledger or the members list",async()=>{
  const privateSnapshot={version:3,state:"not_applicable",accounting_version:1,accounting_receipts:[]};
  const {model,snapshots,calls}=setup({role:"master",request:async endpoint=>{
    assert.equal(endpoint,"rpc/rabota_payroll_snapshot_v3");
    return privateSnapshot;
  }});
  await model.loadFinance();
  assert.deepEqual(snapshots,[{operations:[]}]);
  assert.equal(calls.length,0);
  const payroll=await model.readPayrollSnapshot();
  assert.equal(payroll.accounting.payouts,null);
  assert.equal(calls.length,1);
});
test("unauthorized role makes no finance request",async()=>{
  const {model,calls,snapshots}=setup({role:"manager"});
  await model.loadFinance();
  assert.equal(calls.length,0);assert.equal(snapshots.length,0);
});
test("server request failure never publishes partial finance state",async()=>{
  const {model,snapshots}=setup({request:async path=>{
    throw Error("Network error");
  }});
  await assert.rejects(model.loadFinance(),/Network error/);
  assert.equal(snapshots.length,0);
});
test("invalid finance response fails closed",async()=>{
  const {model,snapshots}=setup({request:async path=>{
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
  const {model,snapshots}=setup({request:async path=>{
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
  const {model,snapshots,invalidate}=setup({request:async path=>{
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
  const {model,snapshots}=setup({request:async path=>{
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
test("index uses authoritative finance operations and versioned payment writes",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  assert.match(html,/src="\/finance-model\.js\?v=[A-Za-z0-9_-]+"/);
  assert.match(html,/financeModel\.calculateRecordedCashFlow/);
  assert.match(html,/financeModel\.readPayrollSnapshot/);
  assert.match(html,/financeModel\.loadFinance\(\{fresh,operations,isCurrent\}\)/);
  assert.ok(html.includes("rpc/rabota_payroll_payout_v3"));
  assert.doesNotMatch(html,/rpc\/rabota_cash_(?:distribute|submit|confirm)/);
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});
