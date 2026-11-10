/* Focused browser regression for the Orders mobile filter sheet.
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
async function mobile(browser,name,device){
 const {page,context,writes,errors}=await setup(browser,device);
 try{
  const toggle=page.locator("#rdOrdersFilterToggle"),
    count=page.locator("#orderCount"),dialog=page.locator("#rdOrdersFilterDialog");
  const first=await count.innerText();
  const before=await page.locator("#orders").boundingBox();
  await toggle.click();
  assert.equal(await dialog.evaluate(e=>e.open),true,name+": dialog opens");
  const after=await page.locator("#orders").boundingBox();
  assert.ok(Math.abs(before.y-after.y)<2,name+": list is not shifted");
  await page.locator("#rdStatusFilter").selectOption("Выполнен");
  assert.equal(await count.innerText(),first,name+": filter is still a draft");
  await page.locator(".rd-orders-filter-close").click();
  assert.equal(await dialog.evaluate(e=>e.open),false,name+": closed");
  assert.equal(await page.locator("#rdStatusFilter").inputValue(),"",name+": cancel restores status");
  await toggle.click();
  await page.locator("#rdStatusFilter").selectOption("Выполнен");
  await page.locator(".rd-orders-filter-apply").click();
  const filtered=await count.innerText();
  assert.notEqual(filtered,first,name+": Apply filters the list");
  assert.match(await toggle.innerText(),/Фильтры \(1\)/,name+": active filter badge");
  await toggle.click();
  await dialog.getByRole("button",{name:"Сбросить"}).click();
  assert.equal(await count.innerText(),filtered,name+": Reset remains draft");
  await page.locator(".rd-orders-filter-close").click();
  assert.equal(await page.locator("#rdStatusFilter").inputValue(),"Выполнен",name+": Reset cancel preserves applied filter");
  await toggle.click();
  await dialog.getByRole("button",{name:"Сбросить"}).click();
  await page.locator(".rd-orders-filter-apply").click();
  assert.equal(await count.innerText(),first,name+": Reset/Apply restores all orders");
  assert.equal(await toggle.innerText(),"Фильтры",name+": no active filters");
  assert.deepEqual(writes,[],name+": no production mutations");
  assert.deepEqual(errors,[],name+": no page errors");
  console.log("PASS",name,"initial",first,"filtered",filtered);
 }finally{await context.close();}
}
async function desktop(browser){
 const {page,context,writes,errors}=await setup(browser,{viewport:{width:1024,height:820}});
 try{
  const toggle=page.locator("#rdOrdersFilterToggle");
  await toggle.click();
  assert.equal(await page.locator("#rdOrdersFilterDialog").evaluate(e=>e.open),false);
  assert.equal(await page.locator("#rdOrderToolbar").evaluate(e=>e.classList.contains("is-open")),true);
  await toggle.click();
  assert.equal(await page.locator("#rdOrderToolbar").evaluate(e=>e.classList.contains("is-open")),false);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log("PASS desktop inline filters retained");
 }finally{await context.close();}
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",args:["--no-sandbox"]});
 try{
  for(const width of [320,375,390,768,790])
   await mobile(browser,"mobile-"+width,{viewport:{width,height:800}});
  await mobile(browser,"iPhone 13 emulation",devices["iPhone 13"]);
  await mobile(browser,"Pixel 7 emulation",devices["Pixel 7"]);
  await desktop(browser);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
