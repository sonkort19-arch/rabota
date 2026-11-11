/* Synthetic browser regression for manual WhatsApp order sharing.
 * Uses synthetic data and blocks all real writes. Run with Playwright + Chromium.
 */
"use strict";
const {chromium,devices}=require("playwright");
const {readFileSync,existsSync}=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const today=new Date().toISOString().slice(0,10);
const orders=Array.from({length:9},(_,i)=>({
 id:"fake-"+i,name:"Тестовый клиент "+i,address:"Тестовая улица "+i,
 phone:"79990000000",master:"Рауль",assigned_user_id:"master",
 radiator_type:"Алюминиевые",radiators:5,floor_loops:0,
 appointment_date:today,appointment_time:"10:00:00",
 status:i%3===0?"Выполнен":"Записан",price:10000,
 paid:i%3===0,created_at:today+"T07:00:00Z",completed_at:today+"T08:00:00Z"
}));
const members=[
 {user_id:"owner",role:"owner",active:true,email:"owner@test.invalid"},
 {user_id:"master",role:"master",active:true,master_name:"Рауль",email:"master@test.invalid"}
];
async function setup(browser,device){
 const context=await browser.newContext(device||{});
 const page=await context.newPage(),writes=[],errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 await context.addInitScript(()=>{
  localStorage.setItem("rabota-auth-session-v1",JSON.stringify({
   access_token:"synthetic",refresh_token:"synthetic",expires_at:4102444800
  }));
 });
 await context.route("**/*",async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.hostname==="crm.test"){
   const local=path.resolve(root,"."+ (u.pathname==="/" ? "/index.html" : u.pathname));
   if(!local.startsWith(root+path.sep)||!existsSync(local))
    return route.fulfill({status:404,body:"missing"});
   const type=local.endsWith(".css")?"text/css":local.endsWith(".js")?"text/javascript":local.endsWith(".html")?"text/html":"application/json";
   return route.fulfill({contentType:type,body:readFileSync(local)});
  }
  if(req.method()!=="GET"){writes.push(req.url());return route.abort();}
  let value=[];
  if(u.pathname==="/auth/v1/user")value={id:"owner",email:"owner@test.invalid"};
  if(u.pathname.endsWith("/rabota_members"))value=u.searchParams.has("user_id")?[members[0]]:u.searchParams.get("role")==="eq.master"?[members[1]]:members;
  if(u.pathname.endsWith("/rabota_orders"))value=orders;
  if(u.pathname.endsWith("/rabota_finance_operations"))value=[];
  if(u.pathname.endsWith("/rabota_ai_chats"))value=[];
  if(u.pathname.endsWith("/rabota_ai_messages"))value=[];
  return route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
 });
 await page.goto("https://crm.test/");
 await page.locator("#appScreen").waitFor({state:"visible"});
 const mobileOrders=page.locator('.rd-mobilebar [data-page="orders"]');
 if(await mobileOrders.isVisible())await mobileOrders.click();
 else await page.locator('.rd-shell [data-page="orders"]').click();
 await page.locator("#rdOrdersFilterToggle").waitFor({state:"visible"});
 return {page,context,writes,errors};
}

const tomorrow=(()=>{const t=new Date(Date.now()+86400000);const p=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(t);return ["year","month","day"].map(k=>p.find(x=>x.type===k).value).join("-")})();
orders.forEach((o,i)=>{o.appointment_date="2026-01-01";o.master="Рауль";o.status="Записан";o.paid=false;o.name="Тестовый клиент "+i;});
orders[0].appointment_date=tomorrow;
orders[0].appointment_time="15:00:00";
orders[1].appointment_date=tomorrow;
orders[1].appointment_time="10:00:00";
orders[2].appointment_date=tomorrow;orders[2].master="Олег";
orders[3].appointment_date=tomorrow;orders[3].status="Отменён";
orders[4].appointment_date=tomorrow;orders[4].status="Выполнен";
async function check(browser,label,device){
 const {page,context,writes,errors}=await setup(browser,device);
 try{
  await page.evaluate(()=>{
   window.__whatsappUrls=[];
   window.open=url=>{window.__whatsappUrls.push(url);return {opener:null};};
  });
  const prompts=[],alerts=[];
  page.on("dialog",dialog=>{
   if(dialog.type()==="prompt"){
    prompts.push(dialog.message());
    dialog.accept("+7 918 123 45 67");
   }else {alerts.push(dialog.message());dialog.dismiss();}
  });
  const tomorrowButton=page.locator("#rdShareRaulTomorrow");
  const numberButton=page.locator("#rdRaulWhatsAppSettings");
  assert.equal(await tomorrowButton.isVisible(),true,label+": schedule button visible");
  assert.equal(await numberButton.isVisible(),true,label+": recipient button visible");
  await tomorrowButton.click();
  assert.equal(prompts.length,1,label+": asks Raul number once");
  const first=await page.evaluate(()=>window.__whatsappUrls[0]||"");
  assert.ok(first.startsWith("https://wa.me/79181234567?text="),label+": opens Raul's saved WhatsApp number");
  const text1=decodeURIComponent(new URL(first).searchParams.get("text")||"");
  assert.match(text1,/Заказов: 2/,label+": only two upcoming Raul jobs");
  assert.ok(text1.indexOf("Тестовый клиент 1")<text1.indexOf("Тестовый клиент 0"),label+": ordered by time");
  assert.doesNotMatch(text1,/Тестовый клиент [234]/,label+": excludes other master, cancelled and completed");
  await tomorrowButton.click();
  assert.equal(prompts.length,1,label+": second share reuses saved number");
  // Orders screen card actions remain owner/manager-only.
  await page.locator('[data-tab="all"]').click();
  const row=page.locator("#orders > .rd-list-row").filter({hasText:"Тестовый клиент 0"}).first();
  await row.click();
  const shareOne=page.locator(".rd-order-content .rd-share-raul-wa");
  await shareOne.click();
  const last=await page.evaluate(()=>window.__whatsappUrls.at(-1)||"");
  const jobText=new URL(last).searchParams.get("text")||"";
  assert.match(jobText,/Актуальный заказ для Рауля/,label+": individual draft title");
  assert.match(jobText,/Тестовая улица 0/,label+": individual draft includes address");
  assert.match(jobText,/Время: 15:00 МСК/,label+": individual draft includes Moscow time");
  assert.equal(await page.evaluate(()=>localStorage.getItem("rd-raul-whatsapp-phone-v1")),"79181234567");
  assert.deepEqual(writes,[],label+": no orders modified");
  assert.deepEqual(errors,[],label+": no page errors");
  console.log("PASS",label,"drafts opened",await page.evaluate(()=>window.__whatsappUrls.length));
 }finally{await context.close();}
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",args:["--no-sandbox"]});
 try{
  for(const width of [375,390,768])
   await check(browser,"viewport-"+width,{viewport:{width,height:820}});
  await check(browser,"iPhone 13",devices["iPhone 13"]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
