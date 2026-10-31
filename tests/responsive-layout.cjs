/* Browser layout regression on synthetic data only. Requires Playwright and Chromium.
 * Run: node tests/responsive-layout.cjs
 * Optional: CHROMIUM_PATH=/path/to/chromium. No live API requests are allowed.
 */
const {chromium,devices}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const today=new Date().toISOString().slice(0,10);
const long='ОченьДлинноеИмяКлиентаБезПробелов'.repeat(4);
const orders=Array.from({length:9},(_,i)=>({id:'order-'+i,name:i? 'Тестовый клиент '+i:long,phone:'79990000001',address:long,radiator_type:'Биметаллические',radiators:12,floor_loops:3,master:'Рауль',assigned_user_id:'master',appointment_date:today,appointment_time:(10+i%8)+':00:00',status:i%3?'Записан':'Выполнен',paid:i%3===0,price:12000,details:long,created_at:today+'T10:00:00Z',completed_at:today+'T12:00:00Z'}));
const members=[{user_id:'owner',role:'owner',active:true,email:'owner@test.invalid'},{user_id:'master',role:'master',active:true,master_name:'Рауль',email:long+'@test.invalid'},{user_id:'pending',role:'master',active:false,email:long+'@test.invalid'}];
async function setup(browser,device,role='owner'){
 const context=await browser.newContext(device||{});const writes=[],errors=[];
 await context.addInitScript(()=>localStorage.setItem('rabota-auth-session-v1',JSON.stringify({access_token:'synthetic',refresh_token:'synthetic',expires_at:4102444800})));
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());
  if(u.hostname==='crm.test'){
   const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
   if(!file.startsWith(root+'/')||!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
   const type=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/json';
   return route.fulfill({contentType:type,body:fs.readFileSync(file)});
  }
  if(r.method()!=='GET'){writes.push(u.pathname);return route.abort()}
  let value=[];
  if(u.pathname==='/auth/v1/user')value={id:role,email:role+'@test.invalid'};
  if(u.pathname.endsWith('/rabota_members'))value=u.searchParams.has('user_id')?[{user_id:role,role,active:true,master_name:role==='master'?'Рауль':null}]:u.searchParams.get('role')==='eq.master'?[members[1]]:members;
  if(u.pathname.endsWith('/rabota_orders'))value=orders;
  if(u.pathname.endsWith('/rabota_finance_operations'))value=[{id:'op',kind:'expense',amount:123,created_at:today+'T10:00:00Z',note:long}];
  if(u.pathname.endsWith('/rabota_ai_chats'))value=[{id:'chat',title:long,updated_at:today}];
  if(u.pathname.endsWith('/rabota_ai_messages'))value=[{id:'m',role:'assistant',content:long,created_at:today}];
  return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 return {context,page,writes,errors};
}
async function scan(page,label){
 return page.evaluate(label=>{
  const viewport=document.documentElement.clientWidth;
  const issues=[];
  for(const e of document.querySelectorAll('button,input,select,textarea,a,strong,h1,h2,h3,.rd-panel,.team-item,.fp-person-row')){
   const r=e.getBoundingClientRect();if(!r.width||!r.height||getComputedStyle(e).visibility==='hidden')continue;
   let intentional=false;for(let p=e.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){const s=getComputedStyle(p);if(['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth+2){intentional=true;break}}
   if(!intentional&&(r.left< -2||r.right>viewport+2))issues.push({id:e.id,cls:e.className,tag:e.tagName,left:Math.round(r.left),right:Math.round(r.right)});
  }
  return {label,width:innerWidth,overflow:document.documentElement.scrollWidth-viewport,issues:issues.slice(0,16)};
 },label);
}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const {page,context,writes,errors}=await setup(browser);
 await page.goto('https://crm.test/');await page.locator('.rd-shell').waitFor();
 const results=[];
 const screenshots=process.env.RABOTA_SCREENSHOT_DIR;
 if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
 for(const width of [320,360,375,390,412,600,768,790,800,820,900,1024,1130,1180,1280,1440]){
  await page.setViewportSize({width,height:800});
  for(const section of ['home','orders','calendar','clients','finance','leads']){
   await page.evaluate(s=>document.querySelector('.rd-shell [data-page="'+s+'"]').click(),section);
   if(section==='finance')await page.locator('.fp-tabs').waitFor();
   results.push(await scan(page,section));
   if(section==='clients'){
    await page.locator('.rd-client button').first().click();results.push(await scan(page,'client-history'));
    await page.getByRole('button',{name:'‹ Все клиенты',exact:true}).click();
   }
   if(section==='calendar'){
    if(width<=1180)assert.ok((await page.locator('#rdCalendarDate').boundingBox()).width>=180,'native date text fits');
    for(const mode of ['day','list','week']){
     await page.locator('.rd-calendar-mode[data-mode="'+mode+'"]').click();results.push(await scan(page,'calendar-'+mode));
    }
   }
   if(screenshots&&[320,800,1440].includes(width))await page.screenshot({path:path.join(screenshots,section+'-'+width+'.png')});
   if(section==='orders'){
    await page.locator('.rd-list-toggle').first().click();results.push(await scan(page,'order-details'));
    await page.locator('#newOrderBtn').click();results.push(await scan(page,'order-form'));
    await page.locator('#orderOverlay .close').click();
    // The existing app hides this panel. Inspect its layout without changing source visibility.
    await page.evaluate(()=>{const p=document.querySelector('#teamPanel');p.hidden=false;p.style.setProperty('display','block','important')});results.push(await scan(page,'team'));
    await page.evaluate(()=>document.querySelector('#teamPanel').style.removeProperty('display'));
   }
   if(section==='finance'){
    for(const tab of ['Касса компании','Операции','Зарплата']){await page.getByRole('button',{name:tab,exact:true}).click();results.push(await scan(page,'finance-'+tab))}
    await page.locator('.fp-person-button').first().click();results.push(await scan(page,'salary-detail'));
    await page.locator('.fp-subtab').nth(1).click();results.push(await scan(page,'salary-payments'));
    await page.locator('.fp-balance-payout').click();results.push(await scan(page,'payout-dialog'));
    await page.locator('.fp-close').click();
    await page.locator('.fp-link').click();
   }
  }
 }
 // Short landscape/keyboard viewport: both dialogs must remain scrollable.
 await page.setViewportSize({width:568,height:320});
 await page.locator('.rd-mobilebar [data-page="orders"]').click();await page.locator('#newOrderBtn').click();
 await page.locator('#orderOverlay .sheet').evaluate(e=>e.scrollTop=e.scrollHeight);
 const save=await page.locator('.order-submit-bar .save').boundingBox();
 assert.ok(save&&save.y>=0&&save.y+save.height<=320,'save reachable in short viewport');
 results.push(await scan(page,'landscape order-form'));
 await page.locator('#orderOverlay .close').click();
 await page.goto('https://crm.test/ai.html');await page.locator('#layout').waitFor({state:'visible'});
 for(const width of [320,375,390,600,760,768,800,1024,1440]){
  await page.setViewportSize({width,height:600});await page.waitForTimeout(250);
  await page.locator('#newChat').evaluate(e=>e.click());results.push(await scan(page,'ai-empty'));
  await page.evaluate(()=>document.querySelector('.chat-open').click());await page.locator('.bubble').waitFor();results.push(await scan(page,'ai-chat'));
  if(width<=760){await page.locator('#menu').click();await page.waitForTimeout(250);results.push(await scan(page,'ai-menu'));await page.locator('#scrim').click({position:{x:width-5,y:100}});await page.waitForTimeout(250)}
 }
 await page.setViewportSize({width:320,height:360});await page.waitForTimeout(250);
 await page.evaluate(()=>setPendingDraft({action:'create',name:'Тестовый клиент',date:'2026-11-01',time:'10:00',master:'Рауль',phone:'79990000001',address:'Тестовый адрес '.repeat(30)}));
 await page.locator('.composer-wrap').evaluate(e=>e.scrollTop=e.scrollHeight);
 const composer=await page.locator('#composer').boundingBox();
 assert.ok(composer&&composer.y>=0&&composer.y+composer.height<=360,'composer reachable with proposal');
 results.push(await scan(page,'ai-proposal short viewport'));
 if(screenshots)await page.screenshot({path:path.join(screenshots,'ai-proposal-320.png')});
 // Test phone input sizes, menu hit targets and form scrolling in mobile Chromium.
 for(const profile of ['iPhone 13','Pixel 7']){
  for(const role of ['owner','manager','master']){
   const mobile=await setup(browser,devices[profile],role),p=mobile.page;
   await p.goto('https://crm.test/');await p.locator('#appScreen').waitFor({state:'visible'});
   if(role==='master'){
    await p.locator('.master-schedule-toggle').first().click();results.push(await scan(p,profile+' master schedule'));
    await p.locator('#viewFinanceBtn').evaluate(e=>e.click());results.push(await scan(p,profile+' master finance'));
   }else{
    await p.locator('.rd-mobilebar [data-page="more"]').click();results.push(await scan(p,profile+' '+role+' menu'));
    await p.locator('.rd-more-sheet [data-page="clients"]').click();
    assert.equal(await p.locator('.rd-more-sheet').isVisible(),false);
    await p.locator('.rd-mobilebar [data-page="orders"]').click();await p.locator('#newOrderBtn').click();
    await p.locator('#orderOverlay .sheet').evaluate(e=>e.scrollTop=e.scrollHeight);
    assert.equal(await p.locator('.order-submit-bar .save').isVisible(),true);
    results.push(await scan(p,profile+' '+role+' form'));
    assert.ok(await p.locator('#orderForm input[type="text"]').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
    await p.locator('#orderOverlay .close').click();
   }
   results.push(await scan(p,profile+' '+role));
   assert.deepEqual(mobile.writes,[]);assert.deepEqual(mobile.errors,[]);
   await mobile.context.close();
  }
 }
 const failures=results.filter(x=>x.overflow>2||x.issues.length);
 console.log(JSON.stringify({checks:results.length,failures,writes,errors},null,2));
 assert.deepEqual(failures,[],'layout overflow');assert.deepEqual(writes,[],'unexpected mutation attempt');assert.deepEqual(errors,[],'browser errors');
 await context.close();
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
