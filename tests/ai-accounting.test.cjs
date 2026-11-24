"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const handler=require("../api/ai-chat.js");

const orders=[
 {id:"direct",name:"Тестовый клиент",phone:"79000000001",address:"Закрытый адрес",price:10000,
  status:"Выполнен",paid:true,master:"Рауль",assigned_user_id:"raul",payment_received_by:"company"},
 {id:"held",price:10000,status:"Выполнен",paid:true,master:"Рауль",assigned_user_id:"raul",payment_received_by:"master"},
 {id:"confirmed",price:12000,status:"Выполнен",paid:true,master:"Рауль",assigned_user_id:"raul",payment_received_by:"master"},
 {id:"advance",price:4000,status:"Записан",paid:true,payment_received_by:"company",master:"__proto__"},
 {id:"cancelled",price:33000,status:"Отменён",paid:true,payment_received_by:"company"}
];
const operations=[
 {id:"expense",kind:"expense",amount:"600"},
 {id:"payout",kind:"raul_payout",master_user_id:"raul",amount:"2000"},
 {id:"order-payout",kind:"timur_payout",master_user_id:"raul",order_id:"direct",amount:"1500"},
 {id:"voided",kind:"expense",amount:"999",voided_at:"2026-10-01T10:00:00Z"}
];
const receipt={order_id:"confirmed",company_amount:4500,confirmed_amount:2000,submitted_amount:3200};
const master={user_id:"raul",role:"master",active:true,master_name:"Рауль"};

function fixture(t,{authorized=true}={}){
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
  if(table==="rabota_members")return Response.json([master]);
  if(table==="rabota_orders")return Response.json(orders);
  if(table==="rabota_finance_operations")return Response.json([...operations,operations[0]]);
  if(table==="rabota_cash_collections")return Response.json([receipt,receipt]);
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

test("AI accounting reuses canonical cash and payroll numbers without double counting",async t=>{
 const f=fixture(t);
 await f.run();
 assert.equal(f.response.code,200);
 assert.equal(f.response.headers["Cache-Control"],"no-store");
 const openai=f.calls.find(call=>call.url.hostname==="api.openai.com");
 const request=JSON.parse(openai.options.body);
 const prompt=request.input[0].content;
 const summary=JSON.parse(prompt.slice(prompt.indexOf("{")));
 assert.equal(summary.accounting_rub.direct_receipts,14000,"master-held cash has no company receipt");
 assert.equal(summary.accounting_rub.confirmed_company_deposits,2000);
 assert.equal(summary.accounting_rub.unconfirmed_company_deposits,2500);
 assert.equal(summary.accounting_rub.recorded_cash_in,16000);
 assert.equal(summary.accounting_rub.payouts_recorded,2000,"order-linked payout is not a separate cash movement");
 assert.equal(summary.accounting_rub.expenses_recorded,600);
 assert.equal(summary.accounting_rub.recorded_cash_balance,13400);
 assert.equal(summary.accounting_rub.raul_accrued,16000);
 assert.equal(summary.accounting_rub.raul_due,14000);
 assert.equal(summary.accounting_rub.timur_due,3000);
 assert.equal(summary.accounting_rub.advances_on_incomplete_orders,4000);
 assert.equal(summary.accounting_rub.free_cash_balance,-7600);
 assert.deepEqual(summary.order_examples,[]);
 assert.doesNotMatch(prompt,/79000000001|Закрытый адрес|Тестовый клиент/);
 assert.equal(summary.by_master.__proto__.orders,1);
 assert.equal(Object.prototype.orders,undefined);
 assert.equal(request.store,false);
});

test("only a verified owner reaches the accounting tables or provider",async t=>{
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
