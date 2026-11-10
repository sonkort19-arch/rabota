/* Browser regression for the calendar's date field on narrow phones.
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
 const mobileCalendar=page.locator('.rd-mobilebar [data-page="calendar"]');
 if(await mobileCalendar.isVisible())await mobileCalendar.click();
 else await page.locator('.rd-shell [data-page="calendar"]').click();
 await page.locator("#rdCalendarDate").waitFor({state:"attached"});
 return {page,context,writes,errors};
}

async function checkCalendar(browser,label,device,width){
 const {page,context,writes,errors}=await setup(browser,device);
 try{
  const date=page.locator("#rdCalendarDate");
  const field=page.locator("#rdCalendarNavigation .rd-cal-date-field");
  const prev=page.locator("#rdCalendarNavigation .rd-cal-step").first();
  const next=page.locator("#rdCalendarNavigation .rd-cal-step").last();
  const todayButton=page.locator("#rdCalendarNavigation .rd-cal-today");
  const filterButton=page.locator("#rdCalendarNavigation .rd-cal-filter-toggle");
  const rect=await field.boundingBox(),inputRect=await date.boundingBox();
  assert.ok(rect && inputRect,label+": date input exists");
  assert.ok(rect.width>=180,label+": visible date field should be at least 180px, got "+rect.width);
  assert.ok(inputRect.width>=180,label+": native date hit area should be at least 180px, got "+inputRect.width);
  const before=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert.ok(before<=2,label+": no horizontal overflow before selecting date: "+before);
  const prevRect=await prev.boundingBox(),nextRect=await next.boundingBox();
  console.log("RECT",label,JSON.stringify({prevRect,rect,nextRect,nav:await page.locator("#rdCalendarNavigation").evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),grid:getComputedStyle(e).gridTemplateColumns})),field:await field.evaluate(e=>({gridColumn:getComputedStyle(e).gridColumn,gridRow:getComputedStyle(e).gridRow}))}));
  assert.ok(prevRect.right<=rect.x+2,label+": left arrow does not overlap date");
  assert.ok(rect.x+rect.width<=nextRect.x+2,label+": right arrow does not overlap date");
  if(width<=520){
   const todayRect=await todayButton.boundingBox(),filterRect=await filterButton.boundingBox();
   assert.ok(todayRect.y>=rect.y+rect.height-2,label+": Today is on second row");
   assert.ok(filterRect.y>=rect.y+rect.height-2,label+": Filters is on second row");
  }
  await date.fill("2026-11-19");
  assert.equal(await date.inputValue(),"2026-11-19",label+": calendar date remains interactive");
  await prev.click();
  assert.notEqual(await date.inputValue(),"2026-11-19",label+": previous-date control works");
  await next.click();
  assert.equal(await date.inputValue(),"2026-11-19",label+": next-date control restores date");
  const after=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert.ok(after<=2,label+": no horizontal overflow after navigation: "+after);
  assert.deepEqual(writes,[],label+": no database writes");
  assert.deepEqual(errors,[],label+": no page errors");
  console.log("PASS",label,"date width",Math.round(rect.width));
 }finally{await context.close();}
}
(async()=>{
 const browser=await chromium.launch({
  executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",
  args:["--no-sandbox"]
 });
 try{
  for(const width of [320,360,375,390,412,440,480,520,600,768,790,820,1024])
   await checkCalendar(browser,"viewport-"+width,{viewport:{width,height:800}},width);
  await checkCalendar(browser,"iPhone 13",devices["iPhone 13"],390);
  await checkCalendar(browser,"Pixel 7",devices["Pixel 7"],412);
 }finally{await browser.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
