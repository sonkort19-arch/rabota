"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {reportRow,summary,filterRows,bounds,moscowDay,csvFor}=require("../profit-report.js");
function order(fields={}){
  return {id:"a",orderNumber:12,referenceCode:"№00012",createdAt:"2026-11-12T12:00:00Z",
    completedAt:"2026-11-13T15:00:00Z",date:"2026-11-13",name:"Клиент",
    master:"Рауль",status:"Выполнен",price:10000,paid:true,paymentAmount:10000,...fields};
}
test("paid and completed Raul order uses current payout rules",()=>{
  const row=reportRow(order());
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
test("other master and invalid price cannot generate profit; payment mismatch is flagged",()=>{
  assert.equal(reportRow(order({master:"Алекс"})).reportProfit,null);
  const partial=reportRow(order({paymentAmount:5000}));
  assert.equal(partial.reportProfit,3500);
  assert.equal(partial.reportPaymentMismatch,true);
  assert.equal(partial.reportReceived,5000);
  assert.equal(reportRow(order({price:null})).reportProfit,null);
});
test("summary includes all payments, but only calculable company shares",()=>{
  const rows=[order(),order({id:"b",master:"Алекс",price:5000,paymentAmount:5000}),
    order({id:"c",status:"Записан",paid:false,price:2000,paymentAmount:null})].map(reportRow);
  assert.deepEqual(summary(rows),{count:3,price:17000,received:15000,salary:6500,profit:3500,uncalculated:1,missingPayments:0,mismatchedPayments:0});
});
test("totals respect every filtered order, not only the first 100 rendered",()=>{
  const orders=Array.from({length:132},(_,i)=>reportRow(order({id:String(i),price:10000,paymentAmount:10000})));
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
  const csv=csvFor([reportRow(order({name:"=cmd()"}))]);
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

test("owner and Raul share the authoritative finance split and assigned master ID",()=>{
  const {financeSplit}=require("../finance-model.js");
  for(const price of [0,10000,16000,16500.50,24000]){
    const testOrder=order({assignedUserId:"raul-uuid",price,paymentAmount:price,master:"Неверная подпись"});
    const actual=reportRow(testOrder,{masterId:"raul-uuid"});
    const split=financeSplit(price);
    assert.equal(actual.reportSalary,split.raul+split.timur);
    assert.equal(actual.reportProfit,split.company);
    assert.equal(actual.reportSalary+actual.reportProfit,split.gross);
    assert.equal(reportRow(testOrder,{masterId:"other-uuid"}).reportProfit,null);
    assert.equal(reportRow(testOrder,{masterId:null}).reportProfit,null);
  }
});
test("missing amount remains visible as an uncertainty, without writing a fabricated payment",()=>{
  const record=order({paymentAmount:null,paidAt:null,paymentMethod:""});
  const row=reportRow(record,{masterId:"raul-uuid"});
  assert.equal(row.reportReceived,10000);
  assert.equal(row.reportPaymentMissing,true);
  assert.equal(row.reportSalary,null,"Without assigned Raul ID do not invent salary");
  const totals=summary([row]);
  assert.equal(totals.missingPayments,1);
  assert.equal(totals.received,10000);
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
