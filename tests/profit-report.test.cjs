"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {reportRow,summary,filterRows,bounds,moscowDay,csvFor}=require("../profit-report.js");
function order(fields={}){
  return {id:"a",orderNumber:12,referenceCode:"№00012",createdAt:"2026-11-12T12:00:00Z",
    completedAt:"2026-11-13T15:00:00Z",date:"2026-11-13",name:"Клиент",
    master:"Рауль",status:"Выполнен",price:10000,paid:true,paymentAmount:10000,...fields};
}
const receipt=(orderId,amount,masterId="raul")=>({orderId,amount,masterId});
const payrollFor=(receipts,orders=[],extra={})=>({
  state:"active",masterId:"raul",orders,accounting:{version:1,receipts},...extra
});
const defaultPayroll=payrollFor([receipt("a",10000)],[
  {orderId:"a",earned:6500,actualPaid:10000,companyShare:3500}
]);
test("paid and completed Raul order uses current payout rules",()=>{
  const row=reportRow(order(),{payroll:defaultPayroll});
  assert.equal(row.reportReceived,10000);
  assert.equal(row.reportSalary,6500);
  assert.equal(row.reportProfit,3500);
  assert.equal(row.reportCalculated,true);
});
test("pending or unpaid order is never presented as earned profit",()=>{
  for(const fields of [{paid:false},{status:"В работе"},{status:"Записан"},{status:"Отменён"}]){
    const row=reportRow(order(fields));
    assert.equal(row.reportProfit,null);
    assert.equal(row.reportSalary,null);
  }
});
test("v3 report reads the verified per-order allocation, not legacy or cash payout totals",()=>{
  const payroll=payrollFor([receipt("new",16000),receipt("historical",10000)],[
    {orderId:"new",earned:9500,actualPaid:16000,companyShare:6500,ruleVersion:3},
    {orderId:"historical",earned:5000,actualPaid:10000,companyShare:3500,ruleVersion:1}
  ],{paid:19500});
  const rows=filterRows([
    order({id:"new",price:16000,paymentAmount:16000}),order({id:"historical"}),
    order({id:"partial",price:10000,paymentAmount:5000}),order({id:"unknown",paymentAmount:null})
  ],{payroll});
  const byId=new Map(rows.map(row=>[row.id,row]));
  assert.equal(byId.get("new").reportSalary,9500);
  assert.equal(byId.get("new").reportProfit,6500);
  assert.equal(byId.get("historical").reportSalary,6500,"historical total wage cost includes archived Timur allocation");
  assert.equal(byId.get("historical").reportProfit,3500);
  assert.equal(byId.get("partial").reportProfit,null);
  assert.equal(byId.get("unknown").reportProfit,null);
  const total=summary(rows);
  assert.equal(total.salary,16000);
  assert.equal(total.profit,10000);
  assert.equal(total.uncalculated,2);
});
test("confirmed refund clears profit and net received while preserving the order and its audit label",()=>{
  const payroll={version:3,state:"active",orders:[],refunds:[{orderId:"a",amount:10000}]};
  const item=order({status:"Отменён"});
  const row=reportRow(item,{payroll});
  assert.equal(row.reportReceived,0);
  assert.equal(row.reportProfit,null);
  assert.equal(row.paid,true,"keep the original payment marker on the order");
  assert.equal(row.reportRefundedAmount,10000);
  assert.equal(filterRows([item],{payroll,status:"paid"}).length,0);
  assert.equal(filterRows([item],{payroll,status:"unpaid"}).length,0);
  assert.match(csvFor([row]),/Подтверждён возврат/);
});
test("payroll holds leave customer receipts visible and exclude earnings and margin",()=>{
  const payroll={...payrollFor([receipt("cash-only",16000),receipt("review",10000)]),orders:[
    {orderId:"cash-only",earned:9500,actualPaid:16000,companyShare:6500}
  ],holds:[
    {orderId:"cash-only",payrollOnHold:false,cashOnHold:true,paymentAmount:16000,
      reason:"Проверяется остаток у мастера"},
    {orderId:"review",orderNumber:"313",payrollOnHold:true,cashOnHold:true,paymentAmount:10000,
      earned:6500,credited:1000,linkedRecorded:6600,reason:"Не подтверждена выплата"},
    {orderId:"unknown",payrollOnHold:true,cashOnHold:false,paymentAmount:null,
      reason:"Не подтверждена сумма оплаты"}
  ]};
  const records=[
    order({id:"cash-only",price:16000,paymentAmount:null}),
    order({id:"review",orderNumber:null,referenceCode:"",paymentAmount:null}),
    order({id:"unknown",price:20000,paymentAmount:null})
  ];
  const rows=filterRows(records,{payroll});
  const cash=rows.find(row=>row.id==="cash-only");
  assert.equal(cash.reportCashOnHold,true);
  assert.equal(cash.reportReceived,16000);
  assert.equal(cash.reportPaymentVerified,true);
  assert.equal(cash.reportPaymentMissing,false);
  assert.equal(cash.reportProfit,6500,"a cash-only hold does not change confirmed company share");
  const held=rows.find(row=>row.id==="review");
  assert.equal(held.referenceCode,"№00313");
  assert.equal(held.reportReceived,10000,"customer receipt is independent of the custody hold");
  assert.equal(held.reportPayrollOnHold,true);
  assert.equal(held.reportCalculated,false);
  assert.equal(held.reportSalary,null);
  assert.equal(held.reportProfit,null);
  const previousProjection={orderId:"review",earned:6500,actualPaid:10000,companyShare:3500};
  const overlapping=reportRow(records[1],{payroll:{...payroll,orders:[...payroll.orders,previousProjection]}});
  assert.equal(overlapping.reportProfit,null,"the payroll hold prevails over an overlapping earlier projection");
  const unknown=rows.find(row=>row.id==="unknown");
  assert.equal(unknown.reportPaymentUnverified,true);
  assert.equal(unknown.reportReceived,0,"an unverified receipt must not add a price estimate to totals");
  assert.equal(summary(rows).received,26000);
  assert.equal(summary(rows).salary,9500);
  assert.equal(summary(rows).profit,6500);
  assert.match(csvFor([held]),/"На сверке";"";".*Не подтверждена выплата"/);
  assert.doesNotMatch(csvFor([held]),/6600|6500/,"draft earnings and linked ledger amounts stay outside the profit export");
  assert.equal(filterRows(records,{payroll,search:"№00313"})[0]?.id,"review");
});
test("verified order payment supersedes a missing raw amount in v3",()=>{
  const payroll={...payrollFor([receipt("a",10000)]),orders:[
    {orderId:"a",earned:6500,actualPaid:10000,companyShare:3500}
  ]};
  const row=reportRow(order({price:null,paymentAmount:null}),{payroll});
  assert.equal(row.reportReceived,10000);
  assert.equal(row.reportPaymentVerified,true);
  assert.equal(row.reportPaymentMissing,false);
  assert.equal(row.reportProfit,3500);
  assert.match(csvFor([row]),/Сумма подтверждена сверкой/);
});
test("other masters require a verified receipt; partial payments never enter profit",()=>{
  assert.equal(reportRow(order({master:"Алекс"})).reportProfit,null);
  const partial=reportRow(order({paymentAmount:5000}));
  assert.equal(partial.reportProfit,null);
  assert.equal(partial.reportPaymentMismatch,true);
  assert.equal(partial.reportReceived,0);
  assert.equal(reportRow(order({price:null})).reportProfit,null);
});
test("summary includes all payments, but only calculable company shares",()=>{
  const payroll=payrollFor([receipt("a",10000),receipt("b",5000,"alex")],defaultPayroll.orders);
  const rows=filterRows([order(),order({id:"b",master:"Алекс",price:5000,paymentAmount:5000}),
    order({id:"c",status:"Записан",paid:false,price:2000,paymentAmount:null})],{payroll});
  assert.deepEqual(summary(rows),{count:3,price:17000,received:15000,salary:6500,profit:8500,uncalculated:0,missingPayments:0,mismatchedPayments:0});
});
test("totals respect every filtered order, not only the first 100 rendered",()=>{
  const records=Array.from({length:132},(_,i)=>order({id:String(i),price:10000,paymentAmount:10000}));
  const payroll=payrollFor(records.map(row=>receipt(row.id,10000)),
    records.map(row=>({...defaultPayroll.orders[0],orderId:row.id})));
  const orders=filterRows(records,{payroll});
  assert.deepEqual(summary(orders),{
    count:132,price:1320000,received:1320000,
    salary:858000,profit:462000,uncalculated:0,missingPayments:0,mismatchedPayments:0
  });
});
test("dates follow Moscow local time and all orders remain available",()=>{
  assert.equal(moscowDay("2026-11-18T22:30:00Z"),"2026-11-19");
  assert.deepEqual(bounds("previous","2026-11-19"),["2026-10-01","2026-10-31"]);
  const rows=[order(),order({id:"b",createdAt:"2026-10-29T12:00:00Z",completedAt:null,status:"Записан",paid:false})];
  assert.equal(filterRows(rows,{period:"all"}).length,2);
  assert.equal(filterRows(rows,{period:"month",today:"2026-11-19",basis:"created"}).length,1);
  assert.equal(filterRows(rows,{period:"month",today:"2026-11-19",basis:"closed"}).length,1);
  assert.equal(filterRows(rows,{period:"all",search:"#00012"}).length,2);
  assert.equal(filterRows(rows,{period:"month",today:"2026-11-19"}).length,1,
    "Default monthly report must be based on closing date");
});
test("status and custom period filters work without altering records",()=>{
  const rows=[order(),order({id:"b",status:"Записан",paid:false,createdAt:"2026-10-15T12:00:00Z"})];
  assert.equal(filterRows(rows,{period:"all",status:"unpaid"}).length,1);
  assert.equal(filterRows(rows,{period:"custom",from:"2026-10-01",to:"2026-10-31",basis:"created"}).length,1);
});
test("CSV escapes spreadsheet formulas and preserves the order breakdown",()=>{
  const csv=csvFor([reportRow(order({name:"=cmd()"}),{payroll:defaultPayroll})]);
  assert.match(csv,/'=cmd\(\)/);
  assert.match(csv,/3500/);
  assert.match(csv,/№00012/);
});

test("Raul report adapter is assigned-user scoped and guarded by role",()=>{
  const fs=require("node:fs");
  const path=require("node:path");
  const markup=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const match=markup.match(/masterReportOrders\(\)\s*\{([\s\S]*?)\n\s*\},\s*\n\s*masterPayments\(\)/);
  assert.ok(match,"Raul's report adapter must be declared near masterPayments");
  const code=match[1];
  assert.match(code,/currentRole\s*!==\s*"master"/);
  assert.match(code,/currentUser\?\.id/);
  assert.match(code,/toLocaleLowerCase\("ru"\)\s*!==\s*"рауль"/);
  assert.match(code,/\.filter\(o\s*=>\s*o\.assignedUserId\s*===\s*id\)/);
  assert.doesNotMatch(code,/dbRequest\(|rpc\//,"Read-only reporting cannot write to the database");
});

test("unassigned orders and Raul use canonical receipts and server allocations",()=>{
  const other=order({id:"other",assignedUserId:null,master:"Любая подпись"});
  const raul=order({assignedUserId:"raul",master:"Неверная подпись"});
  const payroll=payrollFor([...defaultPayroll.accounting.receipts,receipt("other",10000,null)],defaultPayroll.orders);
  assert.equal(reportRow(other,{payroll}).reportProfit,10000);
  assert.equal(reportRow(raul,{payroll}).reportProfit,3500);
  assert.equal(reportRow(raul,{payroll:{...payroll,orders:[]}}).reportProfit,null);
});
test("missing amount remains visible as an uncertainty, without writing a fabricated payment",()=>{
  const record=order({paymentAmount:null,paidAt:null,paymentMethod:""});
  const row=reportRow(record,{masterId:"raul-uuid"});
  assert.equal(row.reportReceived,0);
  assert.equal(row.reportPaymentMissing,true);
  assert.equal(row.reportSalary,null,"Without assigned Raul ID do not invent salary");
  const totals=summary([row]);
  assert.equal(totals.missingPayments,1);
  assert.equal(totals.received,0);
  assert.equal(record.paymentAmount,null);
  const csv=csvFor([row]);
  assert.match(csv,/Сумма платежа не указана/);
});
test("previous-month creation with current-month closure belongs to current-month profit",()=>{
  const record=order({
    createdAt:"2026-10-31T20:00:00Z",completedAt:"2026-11-03T12:00:00Z",
    assignedUserId:"raul-uuid"
  });
  assert.equal(filterRows([record],{period:"month",today:"2026-11-19",masterId:"raul-uuid"}).length,1);
  assert.equal(filterRows([record],{period:"month",today:"2026-11-19",basis:"created",masterId:"raul-uuid"}).length,0);
});
test("owner reports navigation retains salary scope outside build()",()=>{
  const fs=require("node:fs"),path=require("node:path");
  const ui=fs.readFileSync(path.join(__dirname,"..","redesign.js"),"utf8");
  assert.match(ui,/calendarOpened=false,profitReport=null,salaryRoot=null,ownerSalaryReport=null/);
  assert.match(ui,/salaryRoot=makeNode\("div","rd-salary-report"\)/);
  assert.doesNotMatch(ui,/const salaryRoot=makeNode/);
  assert.match(ui,/else if\(key==="reports"\)\{profitReport\?\.render\(\);if\(salaryRoot/);
});

test("CSV never labels unpaid orders as having a recorded payment",()=>{
  const row=reportRow(order({status:"Записан",paid:false,paymentAmount:null}));
  const csv=csvFor([row]);
  assert.match(csv,/Не оплачено/);
  assert.doesNotMatch(csv,/Сумма указана/);
});
