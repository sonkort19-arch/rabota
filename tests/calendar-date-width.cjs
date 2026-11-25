/* Browser regression for the calendar's date field on narrow phones.
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
 await page.locator('#owViewSwitch [data-ow-mode="calendar"]').click();
 await page.locator("#calendarPanel").waitFor({state:"visible"});
 return {page,context,writes,errors};
}

async function checkCalendar(browser,label,device,width){
 const {page,context,writes,errors}=await setup(browser,device);
 try{
  const date=page.locator("#calendarDate");
  const field=page.locator("#calendarPanel .master-calendar-date-trigger");
  const prev=page.locator("#prevWeek"),next=page.locator("#nextWeek");
  const todayButton=page.locator("#goToday");
  const rect=await field.boundingBox(),inputRect=await date.boundingBox();
  assert.ok(rect && inputRect,label+": date input exists");
  assert.ok(rect.width>=100&&rect.height>=36,label+": compact date field stays usable: "+JSON.stringify(rect));
  assert.ok(inputRect.width>=rect.width-2&&inputRect.height>=rect.height-2,
    label+": native date hit area covers its visible field");
  const before=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert.ok(before<=2,label+": no horizontal overflow before selecting date: "+before);
  const prevRect=await prev.boundingBox(),nextRect=await next.boundingBox();
  assert.ok(prevRect.x+prevRect.width<=rect.x+2,label+": left arrow does not overlap date");
  assert.ok(rect.x+rect.width<=nextRect.x+2,label+": right arrow does not overlap date");
  const todayRect=await todayButton.boundingBox();
  assert.ok(nextRect.x+nextRect.width<=todayRect.x+2,label+": Today does not overlap the arrows");
  assert.ok(Math.abs(todayRect.y+todayRect.height/2-rect.y-rect.height/2)<=3,
    label+": compact calendar controls share one row");
  // September is a longer Russian month name and catches clipped month/year labels.
  await date.fill("2026-09-19");
  assert.equal(await date.inputValue(),"2026-09-19",label+": calendar date remains interactive");
  const labelMetrics=await page.locator("#masterCalendarDateText").evaluate(element=>({
    text:element.textContent,width:element.clientWidth,scrollWidth:element.scrollWidth
  }));
  assert.match(labelMetrics.text,/Сентябрь\s+2026/i,label+": selected month and year are visible");
  assert.ok(labelMetrics.scrollWidth<=labelMetrics.width+1,label+": complete month label fits: "+JSON.stringify(labelMetrics));
  const geometry=await page.locator("#weekDays").evaluate(strip=>{
    const rect=strip.getBoundingClientRect();
    return {left:rect.left,right:rect.right,width:rect.width,
      cells:[...strip.children].map(cell=>{
        const r=cell.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top};
      })};
  });
  assert.equal(geometry.cells.length,7,label+": one compact week shows seven dates");
  assert.ok(geometry.cells[0].left>=geometry.left-1&&geometry.cells[6].right<=geometry.right+1,
    label+": all seven cells fit inside the calendar");
  for(let i=0;i<7;i++){
    const cell=geometry.cells[i];
    assert.ok(Math.abs(cell.width-geometry.cells[0].width)<=1,label+": date cells have equal widths");
    assert.ok(Math.abs(cell.top-geometry.cells[0].top)<=1,label+": date cells stay on one row");
    if(i)assert.ok(geometry.cells[i-1].right<=cell.left+1,label+": date cells do not overlap");
  }
  assert.equal(await page.locator('#weekDays .day.active').getAttribute("data-date"),"2026-09-19",label+": selected date is highlighted");
  await prev.click();
  assert.equal(await date.inputValue(),"2026-09-12",label+": previous-week control works");
  await next.click();
  assert.equal(await date.inputValue(),"2026-09-19",label+": next-week control restores date");
  await todayButton.click();
  assert.equal(await date.inputValue(),today,label+": Today returns to the Moscow date");
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
