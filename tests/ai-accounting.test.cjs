"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const handler=require("../api/ai-chat.js");

const orders=[
 {id:"direct",name:"Тестовый клиент",phone:"79000000001",address:"Закрытый адрес",price:10000,
  status:"Выполнен",paid:true,master:"Рауль",assigned_user_id:"raul",payment_received_by:"company"},
 {id:"held",price:10000,status:"Выполнен",paid:true,master:"Рауль",assigned_user_id:"raul",payment_received_by:"master"},
 {id:"confirmed",price:12000,status:"Выполнен",paid:true,master:"Другой мастер",assigned_user_id:"other",payment_received_by:"master"},
 {id:"advance",price:4000,status:"Записан",paid:true,payment_received_by:"company",master:"__proto__"},
 {id:"cancelled",price:33000,status:"Отменён",paid:true,payment_received_by:"company"}
];
const operations=[
 {id:"expense",kind:"expense",amount:"600"},
 {id:"payout",kind:"raul_payout",master_user_id:"raul",amount:"2000"},
 {id:"duplicate-order-payout",kind:"timur_payout",master_user_id:"raul",order_id:"held",amount:"1500"},
 {id:"voided",kind:"expense",amount:"999",voided_at:"2026-10-01T10:00:00Z"}
];
const manualEntries=[
 {id:"extra-income",kind:"income",amount:"500",to_account:"cash"},
 {id:"extra-expense",kind:"expense",amount:"200",from_account:"account"},
 {id:"internal",kind:"transfer",amount:"700",from_account:"cash",to_account:"account"}
];
const accountingReceipts=[
 {order_id:"direct",master_id:"raul",amount:10000,payment_method:"cash"},
 {order_id:"held",master_id:"raul",amount:10000,payment_method:null},
 {order_id:"confirmed",master_id:"other",amount:12000,payment_method:"card"}
];
const payrollWithAccounting={
 version:3,state:"active",master_id:"raul",activated_at:"2026-11-24T20:00:00Z",accounting_version:1,
 earned:6500,paid:2000,due:4500,
 orders:[{order_id:"direct",paid_amount:10000,earned_amount:6500,company_share:3500,rule_version:3}],
 payouts:[{id:"private-payout",amount:2000,note:"Внутренняя пометка",kind:"raul_payout"}],
 holds:[{order_id:"held",order_number:112,payroll_on_hold:true,cash_on_hold:true,
   reason:"Приватные сведения сверки",earned_amount:6500,credited_amount:1000,
   linked_recorded_amount:2500,payment_amount:10000}],
 accounting_receipts:accountingReceipts,
 accounting_payouts:[
  {id:"private-payout",amount:2000,note:"Внутренняя пометка",payment_method:"cash"},
  {id:"private-held-payment",amount:1000,order_id:"held",note:"Вторая внутренняя пометка"}
 ]
};

function fixture(t,{authorized=true,payroll=payrollWithAccounting,payrollError=null,orderData=orders}={}){
 const oldKey=process.env.OPENAI_API_KEY;
 process.env.OPENAI_API_KEY="isolated-fixture";
 t.after(()=>{
  if(oldKey===undefined)delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY=oldKey;
 });
 const calls=[];
 t.mock.method(globalThis,"fetch",async (input,options)=>{
  const url=new URL(input);
  const table=url.pathname.split("/").at(-1);
  calls.push({url,table,options});
  if(url.hostname==="api.openai.com")return Response.json({output:[
   {type:"message",role:"assistant",content:[{type:"output_text",text:"Итог проверен"}]}
  ]});
  assert.equal(options.headers.Authorization,"Bearer synthetic-owner-token");
  assert.equal(options.method,undefined);
  const authMembership=table==="rabota_members"&&url.searchParams.has("role");
  if(table==="user")return Response.json({id:"fixture-owner"});
  if(authMembership)return Response.json(authorized?[{user_id:"fixture-owner"}]:[]);
  if(table==="rabota_orders")return Response.json(orderData);
  if(table==="rabota_finance_operations")return Response.json([...operations,operations[0]]);
  if(table==="rabota_cashbook_entries")return Response.json(manualEntries);
  if(table==="rabota_payroll_snapshot_v3"){
   if(payrollError)return Response.json({code:payrollError.code},{status:payrollError.status});
   if(payroll)return Response.json(payroll);
   return Response.json({code:"PGRST202"},{status:404});
  }
  assert.fail("Unexpected fixture request: "+url);
 });
 const response={
  code:null, headers:{}, payload:null,
  setHeader(name,value){this.headers[name]=value;},
  status(code){this.code=code;return this;},
  json(payload){this.payload=payload;return this;}
 };
 const run=options=>handler({
  method:"POST",headers:{authorization:"Bearer synthetic-owner-token"},
  body:{messages:[{role:"user",content:"Итоговая касса и выплаты"}]},...options
 },response);
 return {calls,response,run};
}

function aiContext(fixture){
 const openai=fixture.calls.find(call=>call.url.hostname==="api.openai.com");
 assert.ok(openai);
 const request=JSON.parse(openai.options.body);
 const prompt=request.input[0].content;
 return {request,prompt,summary:JSON.parse(prompt.slice(prompt.indexOf("{")))};
}

test("AI uses full confirmed receipts and separates cash movements from company profit",async t=>{
 const f=fixture(t);
 await f.run();
 assert.equal(f.response.code,200);
 assert.equal(f.response.headers["Cache-Control"],"no-store");
 const {request,prompt,summary}=aiContext(f);
 const accounting=summary.accounting_rub;
 assert.equal(accounting.payroll_rule_version,3);
 assert.equal(accounting.raul_accrued,6500);
 assert.equal(accounting.raul_paid,2000);
 assert.equal(accounting.raul_due,4500);
 assert.equal(accounting.payroll_orders_under_review,1);
 assert.equal(accounting.orders_without_verified_company_share,1);
 assert.equal(accounting.completed_paid_order_receipts,32000);
 assert.equal(accounting.net_order_receipts,32000);
 assert.deepEqual(accounting.net_order_receipts_by_method,{cash:10000,card:12000,unknown:10000});
 assert.equal(accounting.payroll_payouts_recorded,3000,"includes a verified held payout and excludes the disputed duplicate");
 assert.equal(accounting.expenses_recorded,600);
 assert.equal(accounting.manual_income_recorded,500);
 assert.equal(accounting.manual_expense_recorded,200);
 assert.equal(accounting.net_recorded_movements,28700);
 assert.equal(accounting.company_share_before_expenses,15500);
 assert.equal(accounting.company_profit_after_expenses,14700);
 assert.equal(accounting.recorded_cash_balance,undefined);
 assert.equal(accounting.timur_due,undefined);
 assert.equal(summary.all_time.marked_paid_rub,36000,"an advance remains operational information only");
 assert.equal(Object.values(summary.by_master).reduce((total,master)=>total+master.paid_orders,0),
  summary.all_time.marked_paid_orders,"Cancelled orders do not count as paid in either view.");
 assert.match(summary.definitions.accounting,/учтённой прибылью/);
 assert.deepEqual(summary.order_examples,[]);
 assert.doesNotMatch(prompt,/79000000001|Закрытый адрес|Тестовый клиент|private-payout|private-held-payment|Внутренняя пометка|Приватные сведения сверки/);
 assert.equal(summary.by_master.__proto__.orders,1);
 assert.equal(Object.prototype.orders,undefined);
 assert.equal(request.store,false);
 assert.ok(!f.calls.some(call=>["rabota_cash_collections","rabota_cash_transfer_events"].includes(call.table)));
 assert.equal(f.calls.filter(call=>call.table==="rabota_members").length,1);
});

test("AI records a verified refund once even while the raw order has the original status",async t=>{
 const payroll={...payrollWithAccounting,earned:0,paid:0,due:0,orders:[],payouts:[],holds:[],
  accounting_receipts:[accountingReceipts[0],accountingReceipts[2]],accounting_payouts:[],
  refunds:[{order_id:"direct",amount:10000,refunded_at:"2026-11-25T20:00:00Z"}]};
 const f=fixture(t,{payroll});
 await f.run();
 assert.equal(f.response.code,200);
 const {summary}=aiContext(f);
 const accounting=summary.accounting_rub;
 assert.equal(accounting.completed_paid_order_receipts,22000);
 assert.equal(accounting.confirmed_refunds,10000);
 assert.equal(accounting.net_order_receipts,12000);
 assert.deepEqual(accounting.net_order_receipts_by_method,{cash:0,card:12000,unknown:0});
 assert.equal(accounting.net_recorded_movements,11700);
 assert.equal(accounting.company_share_before_expenses,12000);
 assert.equal(accounting.company_profit_after_expenses,11200);
 assert.equal(summary.all_time.marked_paid_rub,26000);
});

test("AI counts a single fully refunded order as zero paid orders globally and for its assigned master",async t=>{
 const payroll={...payrollWithAccounting,earned:0,paid:0,due:0,orders:[],payouts:[],holds:[],refunds:[],
  accounting_receipts:[accountingReceipts[2]],accounting_payouts:[],
  accounting_refunds:[{order_id:"confirmed",amount:12000,refunded_at:"2026-11-26T12:00:00Z"}]};
 const f=fixture(t,{payroll,orderData:[orders[2]]});
 await f.run();
 assert.equal(f.response.code,200);
 const {summary}=aiContext(f);
 assert.equal(summary.all_time.marked_paid_orders,0);
 assert.equal(summary.all_time.marked_paid_rub,0);
 assert.equal(summary.by_master["Другой мастер"].paid_orders,0);
 assert.equal(summary.accounting_rub.net_order_receipts,0);
});

test("AI applies customer refunds of other and unassigned masters to all accounting totals",async t=>{
 const unassigned={id:"unassigned",price:8000,status:"Выполнен",paid:true};
 const refundedAt="2026-11-26T12:00:00Z";
 const payroll={...payrollWithAccounting,refunds:[],
  accounting_receipts:[...accountingReceipts,{order_id:unassigned.id,master_id:null,amount:8000,payment_method:"cash"}],
  accounting_refunds:[{order_id:"confirmed",amount:12000,refunded_at:refundedAt},
    {order_id:unassigned.id,amount:8000,refunded_at:refundedAt}]};
 const f=fixture(t,{payroll,orderData:[...orders,unassigned]});
 await f.run();
 assert.equal(f.response.code,200);
 const {summary}=aiContext(f);
 const accounting=summary.accounting_rub;
 assert.equal(accounting.completed_paid_order_receipts,40000);
 assert.equal(accounting.confirmed_refunds,20000);
 assert.equal(accounting.net_order_receipts,20000);
 assert.deepEqual(accounting.net_order_receipts_by_method,{cash:10000,card:0,unknown:10000});
 assert.equal(accounting.net_recorded_movements,16700);
 assert.equal(accounting.company_share_before_expenses,3500);
 assert.equal(accounting.company_profit_after_expenses,2700);
 assert.equal(summary.all_time.marked_paid_rub,24000);
 assert.equal(summary.by_master["Другой мастер"].paid_orders,0);
 assert.equal(accounting.raul_accrued,6500);
});

test("before accounting activation the AI still sees orders with no invented ledger",async t=>{
 const oldSnapshot={...payrollWithAccounting};
 for(const key of ["accounting_version","accounting_receipts","accounting_payouts"])delete oldSnapshot[key];
 for(const [name,payroll] of [["missing RPC",null],["inactive",{version:3,state:"inactive"}],["older payroll",oldSnapshot]]){
  await t.test(name,async subtest=>{
   const f=fixture(subtest,{payroll});
   await f.run();
   assert.equal(f.response.code,200);
   const {summary}=aiContext(f);
   assert.equal(summary.accounting_rub,null);
   assert.equal(summary.all_time.orders,5);
   assert.ok(!f.calls.some(call=>["rabota_cash_collections","rabota_cash_transfer_events",
    "rabota_finance_operations","rabota_cashbook_entries"].includes(call.table)));
  });
 }
});

test("payroll authorization and malformed data fail closed before any provider call",async t=>{
 for(const options of [
  {payrollError:{code:"42501",status:403}},
  {payroll:{version:3,state:"active",orders:[]}},
  {payroll:{version:3,state:"not_applicable"}},
  {payroll:{...payrollWithAccounting,accounting_payouts:null}},
  {payroll:{...payrollWithAccounting,accounting_receipts:[accountingReceipts[0],accountingReceipts[0]]}},
  {payroll:{...payrollWithAccounting,accounting_refunds:[
    {order_id:"confirmed",amount:11000,refunded_at:"2026-11-26T12:00:00Z"}
  ]}}
 ])await t.test(JSON.stringify(options),async subtest=>{
  const f=fixture(subtest,options);
  await f.run();
  assert.equal(f.response.code,502);
  assert.ok(!f.calls.some(call=>call.url.hostname==="api.openai.com"));
 });
});

test("only a verified owner reaches the accounting data or provider",async t=>{
 const f=fixture(t,{authorized:false});
 await f.run();
 assert.equal(f.response.code,403);
 assert.deepEqual(f.calls.map(call=>call.table),["user","rabota_members"]);
 assert.equal(f.calls[1].url.searchParams.get("role"),"eq.owner");
 assert.equal(f.calls[1].url.searchParams.get("active"),"is.true");
});

test("malformed JSON returns a client error after the access backstop",async t=>{
 const f=fixture(t);
 await f.run({body:"{"});
 assert.equal(f.response.code,400);
 assert.deepEqual(f.calls.map(call=>call.table),["user","rabota_members"]);
});
