"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {webcrypto}=require("node:crypto");
const {createSharedServices,createWriteIntents,normalizePhone,phoneForDisplay,friendlyError,sameAuthSession,authTokenSubject,
  withRequestDeadline}=require("../app-services.js");

function fixture({initialToken="old-token",refreshTo=null,status=200,data=[{id:"x"}],jsonThrows=false}={}){
  let session={access_token:initialToken,refresh_token:"refresh",expires_at:5000};
  const calls=[];let ensures=0;
  const service=createSharedServices({
    url:"https://example.supabase.co",key:"public-test-key",
    getSession:()=>session,
    ensureSession:async()=>{ensures++;if(refreshTo)session.access_token=refreshTo;},
    fetch:async(url,options)=>{
      calls.push({url,options});
      return {ok:status>=200&&status<300,status,
        json:async()=>{if(jsonThrows)throw Error("invalid JSON");return data;}};
    }
  });
  return {service,calls,getEnsures:()=>ensures,clearSession:()=>{session=null;}};
}
test("anonymous auth request uses publishable key without Authorization",async()=>{
  const x=fixture({data:{access_token:"ok"}});
  assert.deepEqual(await x.service.authRequest("token?grant_type=password","POST",{email:"a@b.test",password:"test"},false),{access_token:"ok"});
  const call=x.calls[0];
  assert.equal(call.url,"https://example.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(call.options.method,"POST");
  assert.equal(call.options.headers.apikey,"public-test-key");
  assert.equal(call.options.headers.Authorization,undefined);
  assert.equal(call.options.body,JSON.stringify({email:"a@b.test",password:"test"}));
  assert.equal(x.getEnsures(),0);
});
test("authenticated auth request uses the current access token",async()=>{
  const x=fixture({initialToken:"current",data:{}});
  await x.service.authRequest("logout","POST",{},true);
  assert.equal(x.calls[0].options.headers.Authorization,"Bearer current");
});
test("auth server errors keep localized original error handling",async()=>{
  const x=fixture({status:401,data:{error:"invalid_grant"}});
  await assert.rejects(x.service.authRequest("token","POST",{},false),{message:"invalid_grant",status:401});
});
test("auth non-JSON error falls back to Ошибка авторизации",async()=>{
  const x=fixture({status:401,jsonThrows:true});
  await assert.rejects(x.service.authRequest("token","POST",{},false),/Ошибка авторизации/);
});
test("DB GET refreshes session first and uses current token",async()=>{
  const x=fixture({refreshTo:"new-token"});
  assert.deepEqual(await x.service.dbRequest("rabota_orders?select=id&limit=1","GET"),[{id:"x"}]);
  assert.equal(x.getEnsures(),1);
  assert.equal(x.calls[0].url,"https://example.supabase.co/rest/v1/rabota_orders?select=id&limit=1");
  assert.equal(x.calls[0].options.headers.Authorization,"Bearer new-token");
  assert.equal(x.calls[0].options.headers.Accept,"application/json");
  assert.equal(x.calls[0].options.headers.Prefer,undefined);
  assert.equal(x.calls[0].options.headers["Content-Type"],undefined);
  assert.equal(x.calls[0].options.body,undefined);
});
test("RPC POST preserves payload and return=representation",async()=>{
  const x=fixture();
  await x.service.dbRequest("rpc/rabota_record_order_payment","POST",{p_order_id:"test-id"});
  assert.equal(x.calls[0].options.headers.Prefer,"return=representation");
  assert.equal(x.calls[0].options.headers["Content-Type"],"application/json");
  assert.equal(x.calls[0].options.body,'{"p_order_id":"test-id"}');
});
test("DELETE requests without payload keep the original method and headers",async()=>{
  const x=fixture();
  await x.service.dbRequest("rabota_orders?id=eq.test","DELETE");
  assert.equal(x.calls[0].options.method,"DELETE");
  assert.equal(x.calls[0].options.headers.Prefer,"return=representation");
  assert.equal(x.calls[0].options.headers["Content-Type"],undefined);
});
test("database error exposes SQLSTATE 23505 to booking conflict guard",async()=>{
  const x=fixture({status:409,data:{message:"duplicate key",code:"23505"}});
  await assert.rejects(x.service.dbRequest("rabota_orders","POST",{}),error=>{
    assert.equal(error.code,"23505");
    assert.equal(error.message,"duplicate key");
    assert.match(friendlyError(error),/у выбранного мастера уже есть заказ/);
    return true;
  });
});
test("non-JSON database error preserves fallback and null error code",async()=>{
  const x=fixture({status:503,jsonThrows:true});
  await assert.rejects(x.service.dbRequest("rabota_orders","GET"),error=>{
    assert.equal(error.message,"Ошибка базы данных (503)");
    assert.equal(error.code,null);
    return true;
  });
});
test("if session refresh fails, no REST request is sent",async()=>{
  let called=false;
  const x=createSharedServices({
    url:"https://example.supabase.co",key:"test",getSession:()=>({access_token:"old"}),
    ensureSession:async()=>{throw Error("Требуется вход в аккаунт.")},
    fetch:async()=>{called=true;throw Error("unexpected")}
  });
  await assert.rejects(x.dbRequest("rabota_orders","GET"),/Требуется вход/);
  assert.equal(called,false);
});
test("recognizes token rotation only within the same Supabase session",()=>{
  const token=(sub,session_id,version)=>({
    access_token:"header."+Buffer.from(JSON.stringify({sub,session_id,version})).toString("base64url")+".signature"
  });
  assert.equal(sameAuthSession(token("owner","a",1),token("owner","a",2)),true);
  assert.equal(sameAuthSession(token("owner","a",1),token("owner","b",1)),false);
  assert.equal(sameAuthSession(token("owner","a",1),token("manager","a",1)),false);
  assert.equal(sameAuthSession({access_token:"broken"},null),false);
});
test("only a UUID claim can be used as a membership lookup hint",()=>{
  const token=sub=>({access_token:"header."+Buffer.from(JSON.stringify({sub})).toString("base64url")+".signature"});
  const subject="b74a4e75-1efa-4d3b-8dfd-f880d48308d4";
  assert.equal(authTokenSubject(token(subject)),subject);
  assert.equal(authTokenSubject(token("bad-query&user_id=any")),null);
  assert.equal(authTokenSubject({access_token:"opaque"}),null);
  assert.equal(authTokenSubject(null),null);
});
test("unattended GET stops at its deadline and permits a retry",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const requests=[];
  const service=createSharedServices({
    url:"https://example.supabase.co",key:"test",getSession:()=>({access_token:"token"}),
    ensureSession:async()=>{},fetch:async(_url,options)=>{
      requests.push(options);
      if(requests.length===1)return new Promise(()=>{});
      return {ok:true,json:async()=>[]};
    }
  });
  const failure=assert.rejects(service.dbRequest("rabota_orders","GET"),{code:"REQUEST_TIMEOUT"});
  await Promise.resolve();
  t.mock.timers.tick(12000);
  await failure;
  assert.equal(requests[0].signal.aborted,true);
  const controller=new AbortController();
  assert.deepEqual(await service.dbRequest("rabota_orders","GET",undefined,{signal:controller.signal}),[]);
  assert.equal(requests[1].signal,controller.signal);
  assert.deepEqual(await service.dbRequest("rpc/mutation","POST",{}),[]);
  assert.equal(requests[2].signal,undefined);
});
test("deadline cancels other requests when one parallel check fails early",async()=>{
  let siblingSignal;
  await assert.rejects(withRequestDeadline(async signal=>{
    siblingSignal=signal;
    await Promise.all([Promise.reject(Error("Unauthorized")),new Promise(()=>{})]);
  },10000,"Timeout"),/Unauthorized/);
  assert.equal(siblingSignal.aborted,true);
});
test("a REST mutation waiting on auth cannot use the next account's session",async()=>{
  let scope=1,called=false;
  const service=createSharedServices({
    url:"https://example.supabase.co",key:"test",getSession:()=>({access_token:"new"}),
    getScope:()=>scope,ensureSession:async()=>{scope++;},
    fetch:async()=>{called=true;throw Error("unexpected");}
  });
  await assert.rejects(service.dbRequest("rpc/rabota_finance_record","POST",{}),/Сеанс изменился/);
  assert.equal(called,false);
});
test("discard an old account's response after sign-out",async()=>{
  let scope=1;
  const service=createSharedServices({
    url:"https://example.supabase.co",key:"test",getSession:()=>({access_token:"old"}),
    getScope:()=>scope,ensureSession:async()=>{},
    fetch:async()=>({ok:true,json:async()=>{scope++;return [{id:"previous account"}];}})
  });
  await assert.rejects(service.dbRequest("rabota_finance_operations","GET"),/Сеанс изменился/);
});
test("phone display and normalization match existing owner form semantics",()=>{
  assert.equal(phoneForDisplay("  +7 (900) 111-22-33  "),"+7 (900) 111-22-33");
  assert.equal(normalizePhone("8 (900) 111-22-33"),"79001112233");
  assert.equal(normalizePhone("9001112233"),"79001112233");
  assert.equal(normalizePhone("+7 900 111 22 33"),"79001112233");
  assert.equal(normalizePhone("123"),"");
  assert.equal(normalizePhone("1234567890123456"),"");
  assert.equal(normalizePhone(null),"");
});
test("new shared service requires explicit dependencies",()=>{
  assert.throws(()=>createSharedServices({}),/Неверные зависимости/);
  assert.throws(()=>createSharedServices({url:"http://unsafe",key:"x",
    getSession:()=>null,ensureSession:async()=>{},fetch:async()=>{}}),/Неверные зависимости/);
});
test("main screen delegates requests and errors but owns session lifecycle",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const sharedScript=html.match(/src="\/app-services\.js\?v=[^"]+"/);
  assert.ok(sharedScript);
  assert.ok(sharedScript.index<
    html.indexOf("const sharedServices=window.__rdCreateSharedServices"));
  assert.match(html,/async function ensureSession\(\)/);
  assert.match(html,/localStorage\.removeItem\(AUTH_KEY\)/);
  assert.match(html,/getSession:\(\)=>session/);
  for(const name of ["authRequest","dbRequest","normalizePhone","phoneForDisplay","friendlyError"])
    assert.match(html,new RegExp("sharedServices\\."+name+"\\("));
  const callers={
    "index.html":["rabota_master_action","rabota_payroll_payout_v3","rabota_cashbook_record_v1"],
    "order-model.js":["rabota_record_order_payment","rabota_payroll_refund_v3"],
    "expenses.js":["rabota_record_expense_v1","rabota_finance_void"]
  };
  for(const [file,rpcs] of Object.entries(callers)){
    const source=fs.readFileSync(path.join(__dirname,"..",file),"utf8");
    for(const rpc of rpcs)assert.ok(source.includes('dbRequest("rpc/'+rpc+'"'),"Missing shared request: "+rpc);
    assert.doesNotMatch(source,/dbRequest\("rpc\/rabota_(?:cash_distribute|cash_submit(?:_amount)?|cash_confirm(?:_amount)?|salary_payout_v2)"/);
  }
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});

test("an unresolved write reuses its UUID across reload without storing business data", async()=>{
  const stored=new Map();
  const storage={
    getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)
  };
  const options={crypto:webcrypto,getStorage:()=>storage};
  const first=createWriteIntents("expense",options);
  const payload={amount:125.5,note:"Fixture expense note"};
  const original=await first.get("fixture-owner",payload);
  const reloaded=createWriteIntents("expense",options);
  const retry=await reloaded.get("fixture-owner",payload);
  assert.equal(retry.requestId,original.requestId);
  assert.equal(retry.reused,true);
  assert.equal(JSON.stringify([...stored]).includes(payload.note),false);
  await assert.rejects(
    reloaded.get("fixture-owner",{...payload,amount:125},{expectedKey:original.key}),
    /Проверьте предыдущую операцию/
  );
  assert.notEqual((await reloaded.get("another-owner",payload)).requestId,original.requestId);
  await reloaded.finish(retry);
  assert.notEqual((await first.get("fixture-owner",payload)).requestId,original.requestId);
});

test("each new write gets its own stored UUID and only explicit retries can find pending writes", async()=>{
  const storage=()=>{
    const saved=new Map();
    return {getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
  };
  const firstStorage=storage(),otherStorage=storage();
  const actor="fixture-owner",payload={kind:"expense",amount:40,note:"Материалы"};
  const create=getStorage=>createWriteIntents("cashbook",{getStorage,crypto:webcrypto});
  const first=create(()=>firstStorage),other=create(()=>otherStorage);
  const [one,two]=await Promise.all([first.begin(actor,payload),other.begin(actor,payload)]);
  const third=await first.begin(actor,payload);
  assert.equal(new Set([one.requestId,two.requestId,third.requestId]).size,3);
  const reloaded=create(()=>firstStorage);
  assert.deepEqual((await reloaded.find(actor,payload)).map(x=>x.requestId),[one.requestId,third.requestId]);
  assert.deepEqual(await reloaded.find("different-account",payload),[]);
  await reloaded.finish(one);
  assert.deepEqual((await reloaded.find(actor,payload)).map(x=>x.requestId),[third.requestId]);
  assert.deepEqual((await other.find(actor,payload)).map(x=>x.requestId),[two.requestId]);
});

test("a new write fails closed if the key cannot be saved or verified after saving", async()=>{
  for(const setItem of [()=>{throw new DOMException("Quota exceeded","QuotaExceededError")},()=>{}]){
    const pending=createWriteIntents("expense",{getStorage:()=>({getItem:()=>null,setItem}),crypto:webcrypto});
    for(const method of ["get","begin"])
      await assert.rejects(pending[method]("fixture-owner",{amount:40}),{
        code:"WRITE_INTENT_STORAGE",message:/Запись не отправлена/
      });
  }
});
