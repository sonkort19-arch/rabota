'use strict';
// WebKit + synthetic data only: every browser request is fulfilled/aborted locally.
const {webkit,devices}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve('.');
async function setup(browser,role,width){
 const context=await browser.newContext({...devices['iPhone 13'],viewport:{width,height:844}});
 const writes=[],errors=[];
 await context.addInitScript(()=>localStorage.setItem('rabota-auth-session-v1',JSON.stringify({
 access_token:'synthetic',refresh_token:'synthetic',expires_at:4102444800})));
 const day=new Date().toISOString().slice(0,10);
 const orders=[{id:'test-order',name:'Тестовый клиент',phone:'79990000001',master:'Рауль',status:'Записан',paid:false,
 appointment_date:day,appointment_time:'10:00:00',price:20000,assigned_user_id:'master',created_at:day+'T00:00:00Z',updated_at:day+'T00:00:00Z'}];
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.hostname==='crm.test'){
   const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
  }
  if(r.method()!=='GET'){writes.push(u.pathname);return route.abort();}
  let value=[];
  if(u.pathname==='/auth/v1/user')value={id:role==='master'?'master':role,email:role+'@test.invalid'};
  else if(u.pathname.endsWith('/rabota_members'))value=u.searchParams.has('user_id')?
   [{user_id:role,role,active:true,master_name:role==='master'?'Рауль':''}]:
   [{user_id:'master',role:'master',active:true,master_name:'Рауль'}];
  else if(u.pathname.endsWith('/rabota_orders'))value=orders;
  else if(!u.pathname.startsWith('/rest/v1/'))return route.abort();
  return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 return {context,page,writes,errors};
}
(async()=>{
 const browser=await webkit.launch();let checks=0;
 try{
  for(const role of ['owner','manager','master'])for(const width of [320,375,390,430]){
   const f=await setup(browser,role,width),p=f.page;
   try{
    await p.goto('https://crm.test/');await p.locator('#appScreen').waitFor({state:'visible'});
    if(role!=='master'){
     await p.locator('.rd-mobilebar [data-page="orders"]').click();
    }
    await p.locator('#newOrderBtn').click();await p.locator('#orderOverlay').waitFor({state:'visible'});
    await p.locator('#clientName').fill('Синтетический клиент');
    await p.locator('#clientName').focus();
    // Model iOS keyboard visual viewport without claiming a hardware Safari test.
    await p.evaluate(()=>{
     Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>320});
     Object.defineProperty(window.visualViewport,'offsetTop',{configurable:true,get:()=>40});
     window.visualViewport.dispatchEvent(new Event('resize'));
    });
    const overlay=await p.locator('#orderOverlay').boundingBox();
    const save=await p.locator('.order-submit-bar .save').boundingBox();
    assert.ok(overlay.height<=321,'overlay must fit keyboard visual viewport');
    assert.ok(save.y>=40&&save.y+save.height<=361,'save must be above keyboard');
    const scroll=p.locator('#orderFormScroll');
    assert.ok(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight),'form body must scroll');
    assert.ok(await p.locator('#clientName').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16),'no input auto zoom');
    await p.locator('#closeOrderBtn').click();
    assert.equal(await p.locator('#orderOverlay').isVisible(),false);
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
    assert.deepEqual(f.writes,[],'no real or mocked mutations expected');assert.deepEqual(f.errors,[]);
    checks++;
   }finally{await f.context.close()}
  }
  console.log(JSON.stringify({engine:'WebKit',checks,roles:['owner','manager','master'],widths:[320,375,390,430],network:'all intercepted',hardwareSafari:false}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
