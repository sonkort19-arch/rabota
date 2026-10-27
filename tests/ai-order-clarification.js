/* Synthetic regression tests for the Rabota AI handler.
 * Usage: node tests/ai-order-clarification.js
 * No production API calls, real database writes, or API credits.
 */
"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

process.env.SUPABASE_URL = "https://fixture.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "fixture-public-key";
process.env.OPENAI_API_KEY = "fixture-openai-key";
const handler = require("../api/ai-chat.js");

const fixtureOrders = [{
  id:"fixture-order",name:"Тестовый Иван",phone:"79990000001",
  appointment_date:"2026-11-04",appointment_time:"10:00:00",master:"Рауль",
  assigned_user_id:"fixture-master",status:"Записан",price:10000,paid:false,
  created_at:"2026-10-26T09:00:00Z",completed_at:null,updated_at:"2026-10-26T09:00:00Z"
}];
const response = (status,body) => ({ok:status>=200&&status<300,status,json:async()=>body});
const base = {action:"create",client_name:"Тестовая Мария",date:"2026-11-04",
  time:"11:00",phone:"79990000011",master:"Рауль"};

async function exercise(options={}) {
  const calls = [];
  let openaiPayload;
  const oldFetch=global.fetch, oldKey=process.env.OPENAI_API_KEY;
  if(options.noKey)delete process.env.OPENAI_API_KEY;
  global.fetch=async(url,request={})=>{
    const raw=String(url).slice(String(url).indexOf("/",8));
    const path=raw.split("?")[0],method=request.method||"GET";
    calls.push({path,method});
    if(path==="/auth/v1/user")return response(options.invalidJwt?401:200,{id:"fixture-owner"});
    if(path==="/rest/v1/rabota_members"&&raw.includes("role=eq.owner"))
      return response(200,options.notOwner?[]:[{user_id:"fixture-owner"}]);
    if(path==="/rest/v1/rabota_orders")return response(200,fixtureOrders);
    if(path==="/rest/v1/rabota_members")return response(200,[{
      user_id:"fixture-master",role:"master",active:true,master_name:"Рауль"
    }]);
    if(path==="/rest/v1/rabota_finance_operations"||path==="/rest/v1/rabota_cash_collections")
      return response(200,[]);
    if(path==="/v1/responses") {
      openaiPayload=JSON.parse(request.body);
      if(options.openaiStatus)return response(options.openaiStatus,{error:{message:"mock error"}});
      if(options.modelText!==undefined)return response(200,{output:[{
        type:"message",role:"assistant",content:[{type:"output_text",text:options.modelText}]
      }]});
      return response(200,{output:[{
        type:"function_call",name:"prepare_order_action",
        arguments: options.badArguments || JSON.stringify(options.candidate||base)
      }]});
    }
    throw new Error("Unexpected network request: "+path);
  };
  const req={
    method:options.method||"POST",
    headers: options.noAuth?{}:{authorization:"Bearer fixture-jwt"},
    body: options.body===undefined?{messages:[{role:"user",content:"Тест"}]}:options.body
  };
  const res={
    code:200,
    setHeader(){return this},
    status(code){this.code=code;return this},
    json(payload){this.payload=payload;return this}
  };
  try{
    await handler(req,res);
    assert.ok(calls.every(x=>x.method==="GET"||x.path==="/v1/responses"),
      "No database mutations allowed in synthetic handler tests");
    return {status:res.code,body:res.payload,calls,openaiPayload};
  } finally {
    global.fetch=oldFetch;
    if(oldKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=oldKey;
  }
}
test("rejects non-POST and no Authorization without network calls",async()=>{
  const get=await exercise({method:"GET",noAuth:true});
  assert.equal(get.status,405);assert.equal(get.calls.length,0);
  const none=await exercise({noAuth:true});
  assert.equal(none.status,401);assert.equal(none.calls.length,0);
});
test("rejects expired JWT and non-owner",async()=>{
  assert.equal((await exercise({invalidJwt:true})).status,401);
  assert.equal((await exercise({notOwner:true})).status,403);
});
test("rejects missing API key and invalid message shape",async()=>{
  assert.equal((await exercise({noKey:true})).status,503);
  assert.equal((await exercise({body:{messages:[]}})).status,400);
  assert.equal((await exercise({body:{messages:[{role:"system",content:"x"}]}})).status,400);
  assert.equal((await exercise({body:{messages:[{role:"user",content:"x".repeat(12001)}]}})).status,400);
});
const clarifications=[
  ["missing name",{...base,client_name:""},"Как зовут клиента, для которого нужно оформить или перенести заявку?"],
  ["missing date",{...base,date:""},"На какую точную дату записать клиента? Укажите день, месяц и год."],
  ["impossible date",{...base,date:"2026-11-31"},"На какую точную дату записать клиента? Укажите день, месяц и год."],
  ["invalid time",{...base,time:"28:99"},"На какое точное время записать клиента по Москве?"],
  ["missing phone",{...base,phone:null},"Укажите номер телефона клиента для новой заявки."],
  ["invalid phone",{...base,phone:"123"},"Уточните номер телефона клиента: нужно 10–11 цифр."],
  ["letters in phone",{...base,phone:"7999000001a"},"Уточните номер телефона клиента: нужно 10–11 цифр."],
  ["missing master",{...base,master:null},"Какого мастера назначить на эту заявку?"]
];
for(const [name,candidate,expected] of clarifications) {
  test(name+": ask one question, no proposal",async()=>{
    const result=await exercise({candidate});
    assert.equal(result.status,200);
    assert.equal(result.body.reply,expected);
    assert.equal(result.body.proposal,undefined);
  });
}
test("valid new order returns preview, never writes",async()=>{
  const result=await exercise({candidate:base});
  assert.equal(result.status,200);
  assert.equal(result.body.proposal.action,"create");
  assert.equal(result.body.proposal.phone,base.phone);
});
test("valid move preserves optional master",async()=>{
  const candidate={action:"move",client_name:"Тестовый Иван",date:"2026-11-05",time:"12:00"};
  const result=await exercise({candidate});
  assert.equal(result.status,200);
  assert.equal(result.body.proposal.action,"move");
  assert.equal(result.body.proposal.master,null);
});
test("ordinary reply uses read-only snapshot and store:false",async()=>{
  const result=await exercise({modelText:"Тестовый ответ"});
  assert.equal(result.status,200);
  assert.equal(result.body.reply,"Тестовый ответ");
  assert.equal(result.openaiPayload.store,false);
  assert.ok(!JSON.stringify(result.openaiPayload).includes("79990000001"),
    "Existing client phone must not leak to OpenAI in the snapshot");
});
test("handles damaged model arguments",async()=>{
  assert.equal((await exercise({badArguments:"{broken"})).status,502);
});
test("handles OpenAI rate limit and invalid API credential",async()=>{
  assert.equal((await exercise({openaiStatus:429})).status,429);
  assert.equal((await exercise({openaiStatus:401})).status,503);
});
