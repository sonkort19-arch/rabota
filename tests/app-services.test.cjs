"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createSharedServices,normalizePhone,phoneForDisplay,friendlyError}=require("../app-services.js");

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
  await assert.rejects(x.service.authRequest("token","POST",{},false),/invalid_grant/);
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
  assert.match(html,/src="\/app-services\.js\?v=20261114-stage9"/);
  assert.ok(html.indexOf('src="/app-services.js?v=20261114-stage9"')<
    html.indexOf("const sharedServices=window.__rdCreateSharedServices"));
  assert.match(html,/async function ensureSession\(\)/);
  assert.match(html,/localStorage\.removeItem\(AUTH_KEY\)/);
  assert.match(html,/getSession:\(\)=>session/);
  for(const name of ["authRequest","dbRequest","normalizePhone","phoneForDisplay","friendlyError"])
    assert.match(html,new RegExp("sharedServices\\."+name+"\\("));
  for(const rpc of ["rabota_record_order_payment","rabota_salary_payout_v2",
    "rabota_cash_distribute","rabota_cash_confirm","rabota_finance_void"])
    assert.ok(html.includes("rpc/"+rpc),"Missing server-side RPC: "+rpc);
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});
