/* Mobile navigation viewport anchoring browser regression.
 * Uses synthetic data and blocks all real writes. Run with Playwright Chromium or WebKit.
 */
"use strict";
const {chromium,webkit,devices}=require("playwright");
const {readFileSync,existsSync}=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow"}).format(new Date());
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
 await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
 await page.locator("#owFilterToggle").waitFor({state:"visible"});
 return {page,context,writes,errors};
}

async function goSection(page,section){
 if(section==="calendar"){
  await page.locator('#rdMobileNav [data-page="orders"]').click();
  await page.locator('#owViewSwitch [data-ow-mode="calendar"]').click();
  return;
 }
 const direct=page.locator('#rdMobileNav [data-page="'+section+'"]');
 if(await direct.count())await direct.click();
 else{
  await page.locator("#rdMobileMoreBtn").click();
  await page.locator('#rdMobileMoreSheet [data-page="'+section+'"]').click();
 }
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
  assert.deepEqual(await tabs.evaluateAll(items=>items.map(item=>item.dataset.page||(item.id==="rdMobileMoreBtn"?"more":"unknown"))),
    ["orders","expenses","finance","reports","more"],label+": unified owner destinations");
  const tabGeometry=await tabs.evaluateAll(items=>items.map(i=>{const r=i.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width};}));
  assert.ok(tabGeometry.every(r=>Math.abs(r.top-tabGeometry[0].top)<1&&Math.abs(r.bottom-tabGeometry[0].bottom)<1),label+": five buttons share one row");
  assert.ok(tabGeometry.every((r,i)=>r.width>=44&&(i===0||r.left>=tabGeometry[i-1].right)),label+": tabs are separate, tappable, non-overlapping");
  const metrics=await page.evaluate(()=>({scrollHeight:document.documentElement.scrollHeight,innerHeight:innerHeight}));
  assert.ok(metrics.scrollHeight>metrics.innerHeight+700,label+": has long scrollable orders list");
  for(const fraction of [0,.15,.5,1,.25,1,0]){
   await page.evaluate(v=>window.scrollTo({top:(document.documentElement.scrollHeight-innerHeight)*v,behavior:"instant"}),fraction);
   await page.waitForTimeout(70);
   await assertDocked(page,label+" scroll "+fraction);
  }
  for(const section of ["calendar","orders","leads","orders","home","orders"]){
   await goSection(page,section);
   await assertDocked(page,label+" switch "+section);
  }
  // On non-search screens the header must not occupy any space.
  await goSection(page,"home");
  const head=await page.evaluate(()=>{
    const app=document.getElementById("appScreen");
    const top=app.querySelector(":scope > .rd-top");
    const toggle=document.getElementById("rdProfileToggle");
    const title=document.querySelector("#rdHome .rd-view-title");
    const rect=top.getBoundingClientRect();
    const avatar=toggle.getBoundingClientRect();
    return {headerHeight:rect.height,background:getComputedStyle(top).backgroundColor,
      visibleSearch:getComputedStyle(document.getElementById("rdTopSearch")).display!=="none",
      syncDisplayed:getComputedStyle(document.getElementById("syncStatus")).display!=="none",
      avatarWidth:avatar.width,avatarHeight:avatar.height,titleTop:title.getBoundingClientRect().top};
  });
  assert.ok(head.headerHeight<=1,label+": no empty header height "+JSON.stringify(head));
  assert.equal(head.background,"rgba(0, 0, 0, 0)",label+": header is transparent");
  assert.equal(head.visibleSearch,false,label+": no unused global search");
  assert.equal(head.syncDisplayed,false,label+": routine sync label does not waste space");
  assert.ok(head.avatarWidth>=40&&head.avatarHeight>=40,label+": floating avatar stays tappable");
  // On standalone iPhones top safe area can be nonzero; no artificial toolbar should be added.
  const expectedTopLimit=await page.evaluate(()=>{
    const avatarTop=document.getElementById("rdProfileToggle").getBoundingClientRect().top;
    return avatarTop+52;
  });
  assert.ok(head.titleTop<expectedTopLimit,label+": content begins beside avatar without spacer "+JSON.stringify(head));
  await page.locator("#rdProfileToggle").click();
  assert.equal(await page.locator("#appScreen > section#rdProfileMenu").isVisible(),true,label+": floating profile opens");
  await page.locator("#rdProfileToggle").click();
  await page.locator('#rdMobileNav [data-page="orders"]').click();
  assert.equal(await page.locator("#owSearchToggle").isVisible(),true,label+": orders still have search");
  assert.equal(await page.locator("#rdTopSearch").isVisible(),false,label+": no duplicate orders search");
  await goSection(page,"settings");
  await page.locator("#rdMobileMoreBtn").click();
  assert.equal(await page.locator("#rdMobileMoreSheet").isVisible(),true,label+": more menu opens");
  await assertDocked(page,label+" menu");
  const menuState=await page.evaluate(()=>{const sheet=document.getElementById("rdMobileMoreSheet"),nav=document.getElementById("rdMobileNav");const box=sheet.getBoundingClientRect(),dock=nav.getBoundingClientRect();return {parent:sheet.parentElement.tagName,bottom:box.bottom,navTop:dock.top,scroll:sheet.scrollHeight,client:sheet.clientHeight,active:[...nav.querySelectorAll('[aria-current="page"]')].length,available:[...sheet.querySelectorAll("[data-page]")].map(b=>b.dataset.page)};});
  assert.equal(menuState.parent,"BODY",label+": secondary sheet is outside scrolling screen");
  assert.ok(menuState.bottom<=menuState.navTop-1,label+": menu never overlaps dock");
  assert.equal(menuState.active,1,label+": exactly one primary selection");
  for(const name of ["home","leads","clients","growth","settings","ai"])assert.ok(menuState.available.includes(name),label+": menu includes "+name);
  await page.locator("#rdMobileMoreSheet .rd-more-close").click();
  assert.equal(await page.locator("#rdMobileMoreBtn").getAttribute("aria-expanded"),"false",label+": more menu closes");
  await assertDocked(page,label+" menu closes");
  assert.equal(await page.locator("#rdShareRaulTomorrow").isVisible(),true,label+": existing WhatsApp schedule tool remains accessible");
  assert.equal(await page.locator("#rdRaulWhatsAppSettings").isVisible(),true,label+": existing recipient settings remain accessible");
  await page.locator('#rdMobileNav [data-page="orders"]').click();
  const initial=await page.evaluate(()=>window.innerHeight);
  const size=page.viewportSize();
  if(size){
   await page.setViewportSize({width:size.width,height:Math.max(400,size.height-130)});
   await assertDocked(page,label+" shorter viewport");
   await page.setViewportSize(size);
   await assertDocked(page,label+" restored viewport");
  }
  await page.locator("#owSearchToggle").click();
  await page.locator("#owSearchInput").focus();
  await assertDocked(page,label+" search focused");
  await page.locator("#owSearchInput").blur();
  await page.locator("#owSearchClose").click();

  // Every owner destination must avoid the old empty top strip.
  for(const section of ["home","calendar","clients","finance","reports","settings"]){
    await goSection(page,section);
    const info=await page.evaluate(()=>{
      const app=document.getElementById("appScreen");
      const header=app.querySelector(":scope > .rd-top");
      const unified=app.classList.contains("rd-unified-orders");
      const avatar=document.getElementById(unified?"rdProfileTrigger":"rdProfileToggle");
      return {
        unified,
        noSearchClass:app.classList.contains("rd-no-global-search"),
        height:header.getBoundingClientRect().height,
        background:getComputedStyle(header).backgroundColor,
        searchVisible:getComputedStyle(document.getElementById("rdTopSearch")).display!=="none",
        syncVisible:getComputedStyle(document.getElementById("syncStatus")).display!=="none",
        avatarWidth:avatar.getBoundingClientRect().width,
        avatarHeight:avatar.getBoundingClientRect().height,
        appTopPadding:parseFloat(getComputedStyle(app).paddingTop)
      };
    });
    assert.equal(info.noSearchClass,true,label+": "+section+" activates compact header mode");
    assert.ok(info.height<=1,label+": "+section+" empty toolbar must be zero-height: "+JSON.stringify(info));
    if(!info.unified)assert.equal(info.background,"rgba(0, 0, 0, 0)",label+": "+section+" transparent header");
    assert.equal(info.searchVisible,false,label+": "+section+" does not display unrelated search");
    assert.equal(info.syncVisible,false,label+": "+section+" does not display routine sync status");
    assert.ok(info.avatarWidth>=40 && info.avatarHeight>=40,label+": "+section+" profile remains usable");
    assert.ok(info.appTopPadding<110,label+": "+section+" top content uses available space");
    if(info.unified){
      assert.equal(await page.locator("#appTitle").innerText(),"Заказы",label+": useful unified heading");
      assert.equal(await page.locator("#calendarPanel").isVisible(),true,label+": calendar remains accessible within Orders");
    }
    await assertDocked(page,label+" "+section+" without empty top");
  }
  await goSection(page,"leads");
  assert.equal(await page.locator("#rdTopSearch").isVisible(),true,label+": leads search remains");
  await page.locator('#rdMobileNav [data-page="orders"]').click();
  await page.locator("#owSearchToggle").click();
  assert.equal(await page.locator("#owSearchInput").isVisible(),true,label+": orders search remains");
  await page.locator("#owSearchClose").click();
  await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
  assert.ok(await page.locator("#orders .owner-day-heading").count()>0,label+": orders grouped by appointment day");
  await page.locator("#owFilterToggle").click();
  assert.equal(await page.locator("#owFilterStatus option").count(),6,label+": all statuses and unpaid filter remain available");
  await page.locator("#owFilterStatus").selectOption("Записан");
  await page.locator("#owFilterApply").click();
  const filtered=page.locator("#orders .rd-list-row:visible");
  assert.equal(await filtered.count(),orders.filter(order=>order.status==="Записан").length,label+": status filter preserves the actual result set");
  assert.deepEqual(await filtered.evaluateAll(rows=>[...new Set(rows.map(row=>row.dataset.status))]),["Записан"],label+": filtered cards have the requested status");
  await page.locator("#owFilterSummary button").click();
  assert.equal(await page.locator("#orders .rd-list-row:visible").count(),orders.length,label+": clearing filters restores all orders");
  assert.ok(await page.locator("#orders .rd-list-row").count()>0,label+": actual owner order rows are preserved");


  await page.evaluate(()=>document.getElementById("appScreen").hidden=true);
  await page.waitForFunction(()=>document.getElementById("rdMobileNav").hidden);
  assert.equal(await page.locator("#rdMobileNav").isVisible(),false,label+": nav hidden when app screen hidden");
  await page.evaluate(()=>document.getElementById("appScreen").hidden=false);
  await page.waitForFunction(()=>!document.getElementById("rdMobileNav").hidden);
  await assertDocked(page,label+" restored app");
  // The owner modules use the existing dock and menu in the same document.
  await page.evaluate(()=>{window.fixtureMobileNavigation=document.getElementById("rdMobileNav")});
  await page.locator('#rdMobileNav [data-page="expenses"]').click();
  await page.locator("#exMain").waitFor();
  await assertDocked(page,label+" expenses dock");
  await goSection(page,"growth");
  await page.locator("#gwMain").waitFor();
  await assertDocked(page,label+" development dock");
  await page.locator("#rdMobileMoreBtn").click();
  assert.ok(await page.locator("#rdMobileMoreSheet").isVisible(),label+": development menu opens");
  await page.locator("#rdMobileMoreVeil").click({position:{x:10,y:10}});
  await page.locator('#rdMobileNav [data-page="orders"]').click();
  assert.ok(await page.evaluate(()=>window.fixtureMobileNavigation===document.getElementById("rdMobileNav")),
    label+": the original dock stays mounted");
  await assertDocked(page,label+" after visiting expenses and development");
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
  for(const width of [320,375,390,430,768]){
   await runOne(browser,kind+" viewport "+width,{viewport:{width,height:820}});
  }
  await runOne(browser,kind+" iPhone 13 emulation",devices["iPhone 13"]);
  await runOne(browser,kind+" Pixel 7 emulation",devices["Pixel 7"]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
