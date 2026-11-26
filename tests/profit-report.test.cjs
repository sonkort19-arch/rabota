"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {reportRow,summary,financialSummary,filterRows,selectReportRows,bounds,moscowDay,csvFor,
  reconciliationReasons,profitTrend,companySummary,sortReportRows,orderProfit}=require("../profit-report.js");
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
test("profit and CSV use the full recorded refunds for other and unassigned masters",()=>{
  const other=order({id:"other",assignedUserId:"other-master",master:"Олег"});
  const unassigned=order({id:"unassigned",assignedUserId:null,master:""});
  const payroll=payrollFor([receipt(other.id,10000,"other-master"),receipt(unassigned.id,10000,null)]);
  payroll.refunds=[];
  payroll.accounting.refunds=[{orderId:other.id,amount:10000},{orderId:unassigned.id,amount:10000}];
  const rows=filterRows([other,unassigned],{payroll,status:"Отменён"});
  assert.equal(rows.length,2,"The confirmed refund prevails over the earlier order status.");
  assert.equal(other.status,"Выполнен","The read-only report does not mutate orders.");
  assert.ok(rows.every(row=>row.reportReceived===0&&row.reportProfit===null&&row.reportRefundedAmount===10000));
  assert.equal(summary(rows).uncalculated,0);
  assert.equal(filterRows([other,unassigned],{payroll,status:"paid"}).length,0);
  assert.equal((csvFor(rows).match(/Подтверждён возврат/g)||[]).length,2);
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
test("the report distinguishes a missing receipt from a disagreement with a confirmed payment",()=>{
  const raw=order({id:"recorded",assignedUserId:"oleg",travelAmount:1000,paymentAmount:11000});
  const receiptEntry={...receipt("recorded",11500,"oleg"),travelAmount:1000};
  const pending=reportRow(raw);
  assert.deepEqual(reconciliationReasons(pending),["Оплата отсутствует в учёте"]);
  assert.match(csvFor([pending]),/Оплата отсутствует в учёте/);
  assert.doesNotMatch(csvFor([pending]),/Сумма указана|Оплата подтверждена/);

  const recorded=reportRow(raw,{payroll:payrollFor([receiptEntry])});
  assert.equal(recorded.reportReceived,11500);
  assert.equal(recorded.reportProfit,10500);
  assert.deepEqual(reconciliationReasons(recorded),["Сумма в карточке отличается от учтённой оплаты"]);
  assert.match(csvFor([recorded]),/Сумма в карточке отличается от учтённой оплаты/);

  const legacy=reportRow({...raw,paid:false,paymentAmount:null},{payroll:payrollFor([receiptEntry])});
  assert.equal(legacy.reportReceived,11500);
  assert.deepEqual(reconciliationReasons(legacy),["Оплата отличается от стоимости заказа"]);
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
  assert.match(csv,/Учтённая оплата/);
  assert.match(csv,/3500/);
  assert.match(csv,/№00012/);
});
test("CSV exports negative company share as a numeric field while escaping signed or formula-shaped text",()=>{
  const payroll=payrollFor([receipt("a",1000)],[
    {orderId:"a",earned:2000,actualPaid:1000,companyShare:-1000}
  ]);
  const entry=order({price:1000,paymentAmount:1000,name:"=2+2",master:"-1000"});
  const csv=csvFor([reportRow(entry,{payroll})]);
  const row=csv.split("\r\n")[1];
  assert.match(row,/;"'=2\+2";"'-1000";/);
  assert.match(row,/;1000;1000;2000;-1000;/);
});

test("profit report records the full customer payment while reporting travel receipts and accrual separately",()=>{
  const payroll=payrollFor([{...receipt("a",11000),travelAmount:1000}], [
    {orderId:"a",earned:6500,actualPaid:10000,companyShare:3500}
  ]);
  payroll.travelHistory=[{orderId:"a",delta:1200},{orderId:"a",delta:-200}];
  const record=order({price:10000,travelAmount:1000,paymentAmount:11000});
  const [row]=filterRows([record],{payroll});
  assert.equal(row.reportPrice,10000);
  assert.equal(row.reportTotalPrice,11000);
  assert.equal(row.reportReceived,11000);
  assert.equal(row.reportSalary,6500);
  assert.equal(row.reportProfit,3500);
  assert.equal(row.reportPaymentMismatch,false);
  assert.equal(row.reportTravelEarned,1000);
  assert.equal(row.reportTravelUncovered,0);
  const csv=csvFor([row]);
  assert.match(csv,/Поступило за дорогу/);
  assert.match(csv,/;10000;11000;6500;3500;.*;1000;11000;1000;0;1000;0;7500;0;3500$/);

  payroll.orders=[];
  payroll.accounting.refunds=[{orderId:"a",amount:11000,travelAmount:1000}];
  const refunded=summary([reportRow(record,{payroll})]);
  assert.equal(refunded.received,0);
  assert.equal(refunded.travelReceived,1000);
  assert.equal(refunded.travelRefunded,1000);
  assert.equal(refunded.travelUncovered,1000);
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
  const reportsNav=ui.match(/else if\(key==="reports"\)\{([\s\S]*?)\n \}/)?.[1];
  assert.match(reportsNav,/updateOwnerReportHeader\(\);\s*profitReport\?\.render\(\);/);
  assert.match(reportsNav,/if\(salaryRoot&&!salaryRoot\.hidden\)ownerSalaryReport\?\.render\(\)/);
  assert.match(ui,/__rdSetScreenHeader\?\.\(profitReport\.title\(\),profitReport\.back,profitReport\.backLabel\(\)\)/);
});

test("CSV never labels unpaid orders as having a recorded payment",()=>{
  const row=reportRow(order({status:"Записан",paid:false,paymentAmount:null}));
  const csv=csvFor([row]);
  assert.match(csv,/Не оплачено/);
  assert.doesNotMatch(csv,/Сумма указана/);
});

test("company profit deducts direct order costs once and only common ledger expenses within the Moscow period",()=>{
  const orders=[order(),order({id:"out-of-range",orderNumber:40,completedAt:"2026-10-16T10:00:00Z"})];
  const operations=[
    {id:"direct-id",kind:"expense",order_id:"a",amount:"250.55",created_at:"2026-10-20T10:00:00Z"},
    {id:"direct-note",kind:"expense",note:"[Материалы] Кран · Заказ №12",amount:"49.45",created_at:"2026-11-13T10:00:00Z"},
    {id:"outside-order",kind:"expense",order_id:"out-of-range",amount:700,created_at:"2026-11-10T10:00:00Z"},
    {id:"orphan-link",kind:"expense",note:"[Материалы] Кран · Заказ №230",amount:950,created_at:"2026-11-13T10:00:00Z"},
    {id:"common",kind:"expense",amount:1000,created_at:"2026-11-01T10:00:00Z"},
    {id:"common",kind:"expense",amount:"100.10",occurredAt:"2026-11-30T20:59:59Z"},
    {id:"next-month",kind:"expense",amount:400,created_at:"2026-11-30T21:00:00Z"},
    {id:"void",kind:"expense",amount:800,created_at:"2026-11-12T10:00:00Z",voided_at:"2026-11-30T23:00:00Z"}
  ];
  const cashbookEntries=[
    {id:"cashbook",kind:"expense",amount:730,created_at:"2026-11-11T10:00:00Z"},
    {id:"cashbook",kind:"expense",amount:"25.65",created_at:"2026-11-21T10:00:00Z"},
    {id:"income",kind:"income",amount:900,created_at:"2026-11-11T10:00:00Z"},
    {id:"transfer",kind:"transfer",amount:350,created_at:"2026-11-11T10:00:00Z"},
    {id:"next-cash",kind:"expense",amount:300,occurredAt:"2026-11-30T21:00:00Z"}
  ];
  const filters={period:"month",today:"2026-11-30",basis:"closed"};
  const rows=filterRows(orders,{...filters,payroll:defaultPayroll,operations});
  assert.equal(rows[0].reportExpenses,300);
  assert.deepEqual(rows[0].reportExpenseItems,[
    {label:"Расход по заказу",amount:250.55},{label:"Кран",amount:49.45}
  ]);
  assert.deepEqual(companySummary(rows,{...filters,operations,cashbookEntries}),{
    orderProfit:3200,crmExpenses:100.10,cashbookExpenses:25.65,commonExpenses:125.75,unallocatedExpenses:0,netProfit:3074.25
  });
  assert.deepEqual(companySummary(rows,{...filters,orders,operations,cashbookEntries}),{
    orderProfit:3200,crmExpenses:100.10,cashbookExpenses:25.65,commonExpenses:125.75,unallocatedExpenses:950,netProfit:2124.25
  });
  assert.equal(companySummary(rows,{...filters,operations,cashbookEntries:null}),null);
});

test("company profit agrees with the cashbook all-time result for the same confirmed scope",()=>{
  const {calculateRecordedCashFlow}=require("../finance-model.js");
  const payroll={...defaultPayroll,holds:[],refunds:[],accounting:{...defaultPayroll.accounting,
    payouts:[{id:"salary-paid",amount:6000,method:"cash"}]}};
  const orders=[order({orderNumber:null}),order({id:"duplicate-one",orderNumber:42,paid:false}),
    order({id:"duplicate-two",orderNumber:42,paid:false})];
  payroll.holds.push({orderId:"a",orderNumber:12,cashOnHold:true});
  const operations=[{id:"direct",kind:"expense",order_id:"a",amount:450},
    {id:"hold-number",kind:"expense",note:"[Материалы] · Заказ №12",amount:50},
    {id:"orphan",kind:"expense",order_id:"missing",note:"[Материалы] Кран · Заказ №12",amount:300},
    {id:"orphan",kind:"expense",order_id:"missing",note:"[Материалы] Кран · Заказ №12",amount:130.25},
    {id:"ambiguous",kind:"expense",note:"[Материалы] Кран · Заказ №42",amount:19.75},
    {id:"void-orphan",kind:"expense",order_id:"missing",amount:50,voided_at:"2026-11-17"},
    {id:"general",kind:"expense",amount:200}];
  const cashbookEntries=[{id:"owner-expense",kind:"expense",amount:25.50},{id:"owner-income",kind:"income",amount:300}];
  const rows=filterRows(orders,{payroll,operations});
  assert.equal(rows.find(row=>row.id==="a").reportExpenses,500,"the order number on the hold resolves a persistent expense link");
  assert.ok(rows.filter(row=>row.id!=="a").every(row=>row.reportExpenses===0));
  const company=companySummary(rows,{orders,payroll,operations,cashbookEntries});
  const ledger=calculateRecordedCashFlow({payroll,operations,manualEntries:cashbookEntries});
  assert.equal(company.commonExpenses,225.50);
  assert.equal(company.unallocatedExpenses,150);
  assert.equal(company.netProfit,2624.50);
  assert.equal(company.netProfit,ledger.companyProfit);
});

test("profit chart separates missing calculations from true zero and groups Moscow dates into bounded points",()=>{
  const dated=(id,day,fields={})=>order({id,completedAt:day?day+"T02:00:00Z":null,...fields});
  const paid=dated("a","2026-11-03");
  const loss=dated("loss","2026-11-10",{paid:false});
  const unknown=dated("review","2026-11-17");
  const unpaid=dated("unpaid","2026-11-17",{paid:false});
  const refund=dated("refund","2026-11-25",{completedAt:"2026-11-24T21:00:00Z"});
  const undated=dated("undated",null,{paid:false});
  const payroll=payrollFor([receipt("a",10000),receipt("refund",10000)],defaultPayroll.orders,
    {refunds:[{orderId:"refund",amount:10000}]});
  const rows=filterRows([paid,loss,unknown,unpaid,refund,undated],{payroll,
    operations:[{id:"loss-cost",order_id:"loss",kind:"expense",amount:500.25}]});
  const graph=profitTrend(rows,{period:"month",today:"2026-11-29"});
  assert.equal(graph.granularity,"week");
  assert.equal(graph.undated,1);
  assert.deepEqual(graph.points.map(({from,to,profit,orders,unverified})=>[from,to,profit,orders,unverified]),[
    ["2026-11-01","2026-11-01",0,0,0],
    ["2026-11-02","2026-11-08",3500,1,0],
    ["2026-11-09","2026-11-15",-500.25,1,0],
    ["2026-11-16","2026-11-22",null,2,1],
    ["2026-11-23","2026-11-29",0,1,0]
  ]);
  const decades=profitTrend(filterRows([dated("old","1990-01-01"),dated("new","2026-11-29")]));
  assert.equal(decades.granularity,"year");
  assert.ok(decades.points.length<=12);
  assert.equal(decades.points.at(-1).to,"2026-11-29");
});

test("paid count uses confirmed receipts and reconciliation does not withhold a cash-only confirmed profit",()=>{
  const held="Архивная операция на сверке";
  const payroll=payrollFor([receipt("a",10000),receipt("refund",10000)],defaultPayroll.orders,{
    holds:[{orderId:"a",cashOnHold:true,reason:held}],refunds:[{orderId:"refund",amount:10000}]
  });
  const rows=filterRows([order(),order({id:"unverified",paymentAmount:null}),order({id:"refund"}),
    order({id:"unpaid",paid:false,paymentAmount:null})],{payroll});
  const stats=financialSummary(rows);
  assert.deepEqual([stats.count,stats.paid,stats.average,stats.unverified],[4,1,10000,1]);
  assert.deepEqual(reconciliationReasons(rows.find(row=>row.id==="a")),[held]);
  assert.equal(orderProfit(rows.find(row=>row.id==="a")),3500);
  const unverified=rows.find(row=>row.id==="unverified");
  assert.ok(reconciliationReasons(unverified).includes("Оплата отсутствует в учёте"));
  assert.equal(orderProfit(unverified),null);
  assert.match(csvFor([unverified]).split("\r\n")[1],/;"";0;""$/);
  assert.deepEqual(selectReportRows(rows,{status:"paid"}).map(row=>row.id),["a"]);
  assert.deepEqual(selectReportRows(rows,{status:"unpaid"}).map(row=>row.id),["unpaid"]);
  const receiptOnly=filterRows([order({id:"a",paid:false})],{payroll,status:"paid"});
  assert.equal(receiptOnly.length,1,"a recorded receipt takes precedence over the order flag");
});

test("order search and sorting reuse projected rows and put unknown values last",()=>{
  const records=[order({id:"new",name:"Анна",phone:"+7 (900) 123-45-67",completedAt:"2026-11-19T12:00:00Z"}),
    order({id:"loss",name:"Зоя",phone:"79112345678",completedAt:"2026-11-15T12:00:00Z"}),
    order({id:"review",name:"Михаил",completedAt:null})];
  const payroll=payrollFor([receipt("new",10000,"oleg"),receipt("loss",10000,"oleg")]);
  const rows=filterRows(records,{payroll,operations:[{id:"direct",order_id:"loss",kind:"expense",amount:11000}]});
  assert.deepEqual(selectReportRows(rows,{search:"79001234567"}).map(row=>row.id),["new"]);
  assert.deepEqual(selectReportRows(rows,{search:"8 900 123 45 67"}).map(row=>row.id),["new"]);
  assert.deepEqual(selectReportRows(rows,{search:"(900) 123"}).map(row=>row.id),["new"]);
  assert.deepEqual(selectReportRows(rows,{search:"+7 (911) 234‑56‑78"}).map(row=>row.id),["loss"]);
  assert.deepEqual(sortReportRows(rows,"profit","asc").map(row=>row.id),["loss","new","review"]);
  assert.deepEqual(sortReportRows(rows,"date","desc").map(row=>row.id),["new","loss","review"]);
  assert.deepEqual(sortReportRows(rows,"client","asc").map(row=>row.id),["new","loss","review"]);
  assert.match(csvFor([rows.find(row=>row.id==="loss")]).split("\r\n")[1],/;11000;-1000$/);
});
