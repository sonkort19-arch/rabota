"use strict";
const assert=require("node:assert/strict");
const {existsSync}=require("node:fs");
const path=require("node:path");
const {chromium,webkit,devices}=require("playwright");

const root=path.resolve(__dirname,"..");
const origin="https://crm.test";
const authKey="rabota-auth-session-v1";
const stamp=Number(new Date("2026-11-20T10:00:00Z"));
const row=(id,role,content,offset)=>({id,role,content,created_at:new Date(stamp+offset).toISOString()});
function deferred(){
 let resolve;
 const promise=new Promise(done=>{resolve=done});
 return {promise,resolve};
}
async function fixture(browser,width,role="owner"){
 const context=await browser.newContext({
  ...devices["iPhone 13"],viewport:{width,height:760},screen:{width,height:760},serviceWorkers:"block"
 });
 const gates=new Map(), reads=[],writes=[],sentToAI=[],unexpected=[],errors=[];
 const chats=[{id:"chat-a",title:"Чат A"},{id:"chat-b",title:"Чат B"}];
 const messages={
  "chat-a":[row("a1","user","Старый чат A",1)],
  "chat-b":[row("b1","user","Начало чата B",1),row("b2","assistant","Ответ в чате B",2)]
 };
 const state={next:3,holdAI:null,proposal:null};
 const orderWrites=[];
 await context.addInitScript(key=>{
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({
   access_token:"synthetic-chat-owner",refresh_token:"synthetic",expires_at:4102444800
  }));
 },authKey);
 await context.route("**/*",async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method();
  const table=url.pathname.split("/").pop();
  if(url.origin===origin){
   if(url.pathname==="/api/ai-chat"&&method==="POST"){
    sentToAI.push(request.postDataJSON());
    await state.holdAI?.promise;
    return route.fulfill({json:{reply:"Синтетический ответ ИИ",proposal:state.proposal}});
   }
   if(url.pathname==="/fixture"&&method==="GET")return route.fulfill({contentType:"text/html",body:"<!doctype html>"});
   const file=path.resolve(root,"."+url.pathname);
   if(method==="GET"&&file.startsWith(root+path.sep)&&existsSync(file))return route.fulfill({path:file});
   return route.fulfill({status:404,body:""});
  }
  if(!url.hostname.endsWith(".supabase.co"))return route.abort();
  assert.equal(request.headers().authorization,"Bearer synthetic-chat-owner");
  if(table==="user")return route.fulfill({json:{id:"fixture-owner"}});
  if(table==="rabota_members")return route.fulfill({json:[{role,active:true}]});
  if(role!=="owner"){
   unexpected.push("Denied role requested "+table);
   return route.abort();
  }
  if(table==="rabota_ai_prepare_order_v3"&&method==="POST"){
   const params=request.postDataJSON();
   orderWrites.push({table,params});
   return route.fulfill({json:{draft_id:"travel-preview",action:params.p_action,name:params.p_client_name,
     date:params.p_date,time:params.p_time,master:params.p_master,phone:params.p_phone,
     price:params.p_price,travel_amount:params.p_travel_amount}});
  }
  if(table==="rabota_ai_confirm_order_v2"&&method==="POST"){
   orderWrites.push({table,params:request.postDataJSON()});
   return route.fulfill({json:{ok:true,order_id:"confirmed-travel-order"}});
  }
  if(table==="rabota_orders"&&method==="GET"&&url.searchParams.get("id")==="eq.confirmed-travel-order"){
   assert.ok(url.searchParams.get("select").split(",").includes("travel_amount"));
   const p=state.proposal;
   return route.fulfill({json:[{name:p.client_name,master:p.master,appointment_date:p.date,
     appointment_time:p.time+":00",travel_amount:p.travel_amount}]});
  }
  if(table==="rabota_ai_chats"){
   if(method==="GET")return route.fulfill({json:chats});
   if(method==="PATCH"){
    const id=url.searchParams.get("id").slice(3);
    return route.fulfill({json:[chats.find(chat=>chat.id===id)]});
   }
  }
  if(table==="rabota_ai_messages"){
   if(method==="GET"){
    const id=url.searchParams.get("chat_id").slice(3);
    reads.push({id,sort:url.searchParams.get("order")});
    await gates.get(id)?.promise;
    return route.fulfill({json:[...messages[id]].reverse()});
   }
   if(method==="POST"){
    const posted=request.postDataJSON();
    writes.push(posted);
    const saved=row("msg-"+state.next,posted.role,posted.content,state.next++);
    messages[posted.chat_id].push(saved);
    return route.fulfill({json:[saved]});
   }
  }
  unexpected.push(method+" "+table);
  return route.abort();
 });
 const page=await context.newPage();
 page.on("pageerror",error=>errors.push(error.message));
 page.setDefaultTimeout(10000);
 await page.goto(origin+"/ai.html");
 async function close(){
  for(const gate of gates.values())gate.resolve();
  state.holdAI?.resolve();
  await context.close();
  assert.deepEqual(unexpected,[]);
  assert.deepEqual(errors,[]);
 }
 return {context,page,gates,reads,writes,sentToAI,state,orderWrites,close};
}
async function openChat(page,title){
 await page.locator("#menu").click();
 await page.locator("#history").getByRole("button",{name:title,exact:true}).click();
}
async function owner(browser,width){
 const f=await fixture(browser,width);
 const {page,gates,writes,reads,sentToAI,state}=f;
 try{
  await page.locator("#layout").waitFor();
  const slow=deferred();
  gates.set("chat-a",slow);
  await openChat(page,"Чат A");
  await page.getByText("Загружаем сообщения…").waitFor();
  assert.equal(await page.locator("#send").isDisabled(),true);
  await openChat(page,"Чат B");
  await page.getByText("Начало чата B").waitFor();
  slow.resolve();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator("#conversationTitle").textContent(),"Чат B");
  assert.doesNotMatch(await page.locator("#messageList").textContent(),/Старый чат A/);

  await page.locator("#input").fill("Проверка контекста");
  await page.locator("#send").click();
  await page.getByText("Синтетический ответ ИИ",{exact:true}).waitFor();
  assert.equal(sentToAI.length,1);
  assert.deepEqual(sentToAI[0].messages.map(message=>message.content),
   ["Начало чата B","Ответ в чате B","Проверка контекста"]);
  assert.ok(reads.every(read=>read.sort==="created_at.desc,id.desc"));
  assert.equal(reads.filter(read=>read.id==="chat-b").length,2,"one open and one refresh for sending");
  assert.deepEqual(writes.map(write=>[write.chat_id,write.role]),[["chat-b","user"],["chat-b","assistant"]]);

  // Another tab changes the signed-in account while an AI response is pending.
  const otherPage=await f.context.newPage();
  await otherPage.goto(origin+"/fixture");
  state.holdAI=deferred();
  const inFlight=page.waitForRequest(request=>new URL(request.url()).pathname==="/api/ai-chat"&&request.method()==="POST");
  await page.locator("#input").fill("Запрос до смены сеанса");
  await page.locator("#send").click();
  await page.getByText("Запрос до смены сеанса",{exact:true}).waitFor();
  await inFlight;
  await otherPage.evaluate(key=>localStorage.removeItem(key),authKey);
  await page.locator("#gate").getByText(/Сеанс изменился/).waitFor();
  state.holdAI.resolve();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator("#layout").isHidden(),true);
  assert.equal(await page.locator("#messageList").textContent(),"");
  assert.equal(writes.filter(write=>write.role==="assistant").length,1,"old response cannot write to a cleared session");
  // The fixture closes both tabs with their context. Closing just the second
  // page here can wait indefinitely in WebKit after the intercepted response.
 }finally{await f.close();}
}
async function denied(browser,width,role){
 const f=await fixture(browser,width,role);
 try{
  await f.page.locator("#gate").getByText("ИИ-чат доступен только владельцу приложения.").waitFor();
  assert.equal(await f.page.locator("#layout").isHidden(),true);
  assert.deepEqual(f.writes,[]);
 }finally{await f.close();}
}
async function travelPreview(browser,width){
 const f=await fixture(browser,width);
 const {page,state,orderWrites}=f;
 try{
  state.proposal={action:"create",client_name:"Тестовая запись",master:"Рауль",phone:"79000000000",
   date:"2026-12-18",time:"17:30",price:10000,travel_amount:1000};
  await page.locator("#layout").waitFor();
  await openChat(page,"Чат A");
  await page.getByText("Старый чат A").waitFor();
  await page.locator("#input").fill("Новый заказ, промывка 10000 ₽, дорога 1000 ₽");
  await page.locator("#send").click();
  await page.locator("#proposalCard").waitFor();
  const lines=await page.locator("#proposalDetails").textContent();
  assert.match(lines,/Стоимость промывки — 10\s000 ₽\nДорога — 1\s000 ₽\nИтого клиенту — 11\s000 ₽/);
  assert.equal(orderWrites.length,1);
  assert.equal(orderWrites[0].params.p_price,10000);
  assert.equal(orderWrites[0].params.p_travel_amount,1000);
  await page.locator("#confirmOrder").click();
  await page.getByText(/Заявка создана: Тестовая запись/).waitFor();
  assert.equal(orderWrites.length,2);
  assert.equal(orderWrites[1].params.p_draft_id,"travel-preview");
 }finally{await f.close();}
}
(async()=>{
 const name=process.env.TEST_BROWSER||"chromium";
 const engine=name==="webkit"?webkit:chromium;
 const browser=await engine.launch({
  executablePath:process.env.TEST_BROWSER_PATH||undefined,
  args:name==="chromium"?["--no-sandbox"]:[]
 });
 try{
  for(const width of [320,375,390,430]){
   await owner(browser,width);
   for(const role of ["manager","master"])await denied(browser,width,role);
   await travelPreview(browser,width);
   console.log("PASS",name,width,"AI chat transitions, responses, access roles and travel confirmation");
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
