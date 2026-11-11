/* Mobile navigation viewport anchoring browser regression.
 * Uses synthetic data and blocks all real writes. Run with Playwright Chromium or WebKit.
 */
"use strict";
const {chromium,webkit,devices}=require("playwright");
const {readFileSync,existsSync}=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const today=new Date().toISOString().slice(0,10);
const orders=Array.from({length:86},(_,i)=>({
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

async function assertDocked(page,label){
 const state=await page.locator("#rdMobileNav").evaluate(nav=>{
  const rect=nav.getBoundingClientRect();
  return {
   parent:nav.parentElement?.tagName,
   position:getComputedStyle(nav).position,
   visible:!!(rect.width&&rect.height)&&getComputedStyle(nav).display!=="none",
   bottom:rect.bottom,
   viewport:window.innerHeight,
   scrollY:window.scrollY,
   scrollHeight:document.documentElement.scrollHeight,
   height:rect.height
  };
 });
 assert.equal(state.parent,"BODY",label+": dock is direct child of body");
 assert.equal(state.position,"fixed",label+": fixed position");
 assert.equal(state.visible,true,label+": dock remains visible");
 assert.ok(Math.abs(state.bottom-state.viewport)<=3,label+": dock touches bottom; "+JSON.stringify(state));
}
async function runOne(browser,label,device){
 const {page,context,writes,errors}=await setup(browser,device);
 try{
  await assertDocked(page,label+" initial");
  const tabs=page.locator("#rdMobileNav .rd-nav-btn");
  assert.equal(await tabs.count(),5,label+": five navigation actions");
  const metrics=await page.evaluate(()=>({scrollHeight:document.documentElement.scrollHeight,innerHeight:innerHeight}));
  assert.ok(metrics.scrollHeight>metrics.innerHeight+700,label+": has long scrollable orders list");
  for(const fraction of [0,.15,.5,1,.25,1,0]){
   await page.evaluate(v=>window.scrollTo({top:(document.documentElement.scrollHeight-innerHeight)*v,behavior:"instant"}),fraction);
   await page.waitForTimeout(70);
   await assertDocked(page,label+" scroll "+fraction);
  }
  for(const section of ["calendar","orders","leads","orders","home","orders"]){
   await page.locator('#rdMobileNav [data-page="'+section+'"]').click();
   await assertDocked(page,label+" switch "+section);
  }
  await page.locator("#rdMobileMoreBtn").click();
  assert.equal(await page.locator("#rdMobileMoreSheet").isVisible(),true,label+": more menu opens");
  await assertDocked(page,label+" menu");
  await page.locator("#rdMobileMoreBtn").click();
  await assertDocked(page,label+" menu closes");
  const initial=await page.evaluate(()=>window.innerHeight);
  const size=page.viewportSize();
  if(size){
   await page.setViewportSize({width:size.width,height:Math.max(400,size.height-130)});
   await assertDocked(page,label+" shorter viewport");
   await page.setViewportSize(size);
   await assertDocked(page,label+" restored viewport");
  }
  await page.locator("#rdTopSearch").focus();
  await assertDocked(page,label+" search focused");
  await page.locator("#rdTopSearch").blur();
  await page.evaluate(()=>document.getElementById("appScreen").hidden=true);
  await page.waitForFunction(()=>document.getElementById("rdMobileNav").hidden);
  assert.equal(await page.locator("#rdMobileNav").isVisible(),false,label+": nav hidden when app screen hidden");
  await page.evaluate(()=>document.getElementById("appScreen").hidden=false);
  await page.waitForFunction(()=>!document.getElementById("rdMobileNav").hidden);
  await assertDocked(page,label+" restored app");
  assert.deepEqual(writes,[],label+": no database writes");
  assert.deepEqual(errors,[],label+": no page errors");
  console.log("PASS",label,"initial viewport",initial);
 }finally{await context.close();}
}
(async()=>{
 const kind=process.env.TEST_BROWSER||"chromium";
 const browserType=kind==="webkit"?webkit:chromium;
 const browser=await browserType.launch({
  executablePath:process.env.TEST_BROWSER_PATH||undefined,
  args:kind==="chromium"?["--no-sandbox"]:[]
 });
 try{
  for(const width of [320,390,430,768]){
   await runOne(browser,kind+" viewport "+width,{viewport:{width,height:820}});
  }
  await runOne(browser,kind+" iPhone 13 emulation",devices["iPhone 13"]);
  await runOne(browser,kind+" Pixel 7 emulation",devices["Pixel 7"]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
