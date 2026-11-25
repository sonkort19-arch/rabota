/* Focused browser regression for the inline Orders filters.
 * Uses synthetic data and blocks all real writes. Run with Playwright + Chromium.
 */
"use strict";
const {chromium,devices}=require("playwright");
const {mockAccountingSnapshot}=require("./fixtures/legacy-payroll.cjs");
const {readFileSync,existsSync}=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow"}).format(new Date());
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
 await mockAccountingSnapshot(context);
 await page.goto("https://crm.test/");
 await page.locator("#appScreen").waitFor({state:"visible"});
 const mobileOrders=page.locator('.rd-mobilebar [data-page="orders"]');
 if(await mobileOrders.isVisible())await mobileOrders.click();
 else await page.locator('.rd-shell [data-page="orders"]').click();
 await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
 await page.locator("#owFilterToggle").waitFor({state:"visible"});
 return {page,context,writes,errors};
}
async function mobile(browser,name,device){
 const {page,context,writes,errors}=await setup(browser,device);
 try{
  const toggle=page.locator("#ordersArea #owTools #owFilterToggle"),
    count=page.locator("#orderCount"),panel=page.locator("#ordersArea #owTools #owFilters");
  const status=page.locator("#owFilterStatus");
  const visibleRows=page.locator("#orders .rd-list-row:visible");
  const first=await count.innerText();
  assert.equal(await visibleRows.count(),9,name+": all synthetic orders initially visible");
  const firstCard=visibleRows.first();
  const before=await firstCard.boundingBox();
  await toggle.click();
  assert.equal(await panel.isVisible(),true,name+": filters expand inside Orders");
  assert.equal(await toggle.getAttribute("aria-expanded"),"true",name+": expanded state is announced");
  const after=await firstCard.boundingBox(),panelBox=await panel.boundingBox();
  assert.ok(panelBox.y+panelBox.height<=after.y,name+": filter panel leaves cards unobscured");
  await status.selectOption("Выполнен");
  assert.equal(await count.innerText(),first,name+": filter is still a draft");
  assert.equal(await visibleRows.count(),9,name+": drafting a filter does not alter cards");
  await page.locator("#owFilterCancel").click();
  assert.equal(await panel.isVisible(),false,name+": closed");
  assert.equal(await toggle.evaluate(e=>e===document.activeElement),true,name+": toggle regains keyboard focus");
  assert.ok(Math.abs((await firstCard.boundingBox()).y-before.y)<2,name+": closing restores list position");
  assert.equal(await count.innerText(),first,name+": cancel leaves applied results unchanged");
  await toggle.click();
  assert.equal(await status.inputValue(),"",name+": reopening after cancel restores applied status");
  await status.press("Escape");
  assert.equal(await panel.isVisible(),false,name+": Escape closes the filters");
  assert.equal(await toggle.getAttribute("aria-expanded"),"false",name+": collapsed state is announced");
  await toggle.click();
  await status.selectOption("Выполнен");
  await page.locator("#owFilterApply").click();
  const filtered=await count.innerText();
  assert.notEqual(filtered,first,name+": Apply filters the list");
  assert.equal(await visibleRows.count(),3,name+": Apply shows exactly the completed orders");
  assert.deepEqual(await visibleRows.evaluateAll(rows=>[...new Set(rows.map(row=>row.dataset.status))]),
    ["Выполнен"],name+": every shown card matches the applied status");
  assert.match(await toggle.getAttribute("aria-label"),/активно:\s*1/,name+": accessible active filter count");
  assert.equal(await toggle.evaluate(e=>e.classList.contains("has-filters")),true,name+": active filter indicator");
  assert.match(await page.locator("#owFilterSummary").innerText(),/Выполнен/,name+": applied status is visible above the list");
  await toggle.click();
  await page.locator("#owFilterReset").click();
  assert.equal(await count.innerText(),filtered,name+": Reset remains draft");
  await page.locator("#owFilterCancel").click();
  assert.equal(await count.innerText(),filtered,name+": cancelled Reset preserves applied results");
  await toggle.click();
  assert.equal(await status.inputValue(),"Выполнен",name+": reopening after Reset/Cancel restores the applied filter");
  await page.locator("#owFilterReset").click();
  await page.locator("#owFilterApply").click();
  assert.equal(await count.innerText(),first,name+": Reset/Apply restores all orders");
  assert.equal(await visibleRows.count(),9,name+": Reset/Apply restores all cards");
  assert.equal(await toggle.getAttribute("aria-label"),"Фильтры заказов",name+": no active filters");
  assert.equal(await page.locator("#owFilterSummary").isVisible(),false,name+": cleared summary disappears");
  assert.deepEqual(writes,[],name+": no production mutations");
  assert.deepEqual(errors,[],name+": no page errors");
  console.log("PASS",name,"initial",first,"filtered",filtered);
 }finally{await context.close();}
}
async function desktop(browser){
 await mobile(browser,"desktop inline filters",{viewport:{width:1024,height:820}});
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
