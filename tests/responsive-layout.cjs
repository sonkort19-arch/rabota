/* Browser layout regression on synthetic data only. Requires Playwright Chromium or WebKit.
 * Run: node tests/responsive-layout.cjs
 * Optional: CHROMIUM_PATH=/path/to/chromium. No live API requests are allowed.
 */
const {chromium,webkit,devices}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const long='ОченьДлинноеИмяКлиентаБезПробелов'.repeat(4);
const orders=Array.from({length:9},(_,i)=>({id:'order-'+i,name:i? 'Тестовый клиент '+i:long,phone:'79990000001',address:long,radiator_type:'Биметаллические',radiators:12,floor_loops:3,master:'Рауль',assigned_user_id:'master',appointment_date:today,appointment_time:(10+i%8)+':00:00',status:i%3?'Записан':'Выполнен',paid:i%3===0,price:12000,details:long,created_at:today+'T10:00:00Z',completed_at:today+'T12:00:00Z'}));
const paidOrders=orders.filter(order=>order.paid);
const paidAt=today+'T12:00:00Z';
function payrollSnapshot(role){
 const snapshot={version:3,accounting_version:1,activated_at:paidAt};
 if(role==='manager')return {...snapshot,state:'not_applicable'};
 return {...snapshot,state:'active',master_id:'master',earned:22500,paid:0,due:22500,payouts:[],refunds:[],holds:[],
  orders:paidOrders.map(order=>({order_id:order.id,paid_amount:12000,earned_amount:7500,
   company_share:4500,earned_at:paidAt,rule_version:3})),
  accounting_receipts:paidOrders.map(order=>({order_id:order.id,master_id:'master',
   amount:12000,payment_method:'cash',paid_at:paidAt,occurred_at:paidAt})),
  ...(role==='owner'?{accounting_payouts:[]}:{}),
 };
}
const members=[{user_id:'owner',role:'owner',active:true,email:'owner@test.invalid'},{user_id:'master',role:'master',active:true,master_name:'Рауль',email:long+'@test.invalid'},{user_id:'pending',role:'master',active:false,email:long+'@test.invalid'}];
async function setup(browser,device,role='owner'){
 const context=await browser.newContext({...device,serviceWorkers:"block"});const writes=[],errors=[];
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
  if(u.pathname.endsWith('/rpc/rabota_payroll_snapshot_v3'))value=payrollSnapshot(role);
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
  const workspace=document.getElementById('appScreen');
  const issues=[];
  for(const e of document.querySelectorAll('button,input,select,textarea,a,strong,h1,h2,h3,.rd-panel,.team-item,.fp-person-row')){
   const r=e.getBoundingClientRect();if(!r.width||!r.height||getComputedStyle(e).visibility==='hidden')continue;
   let intentional=false;for(let p=e.parentElement;p&&p!==workspace&&p!==document.body&&p!==document.documentElement;p=p.parentElement){const s=getComputedStyle(p);if(['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth+2){intentional=true;break}}
   if(!intentional&&(r.left< -2||r.right>viewport+2))issues.push({id:e.id,cls:e.className,tag:e.tagName,left:Math.round(r.left),right:Math.round(r.right)});
  }
  return {label,width:innerWidth,overflow:document.documentElement.scrollWidth-viewport,
   workspaceOverflow:workspace?workspace.scrollWidth-workspace.clientWidth:0,issues:issues.slice(0,16)};
 },label);
}
async function verifyProfile(page,role){
 const header=page.locator('#rdScreenHeader');
 const profile=header.locator('#rdProfile');
 const trigger=header.locator('#rdProfileTrigger');
 const bell=header.locator('#pushBellBtn');
 const menu=page.locator('#rdProfileMenu');
 await trigger.waitFor();
 assert.equal(await profile.count(),1,'one profile in the shared header');
 assert.equal(await header.getByRole('heading',{name:'Заказы',exact:true}).count(),1,'section title is in the shared header');
 assert.equal(await bell.isVisible(),true,role+' can reach notifications from the shared header');
 const workspace=page.locator('#appScreen');
 assert.equal(await workspace.getAttribute('aria-label'),'CRM «Работа»');
 assert.equal(await header.evaluate(node=>node.parentElement===document.getElementById('appScreen').parentElement
  &&getComputedStyle(node).position==='fixed'),true,'header is fixed outside the scrolling workspace');
 const headerBox=await header.boundingBox(),appBox=await workspace.boundingBox();
 assert.ok(Math.abs(headerBox.height-56)<=1,'header has a 56px control row');
 assert.ok(Math.abs(appBox.y-headerBox.y-headerBox.height)<=1,'workspace begins at the header bottom');
 assert.match(await workspace.evaluate(node=>getComputedStyle(node).overflowY),/^(auto|scroll)$/);
 for(const control of [trigger,bell]){
  const target=await control.boundingBox();
  assert.ok(target.width>=43.5&&target.height>=43.5&&target.y>=headerBox.y&&target.y+target.height<=appBox.y+1,
   'header control is tappable without covering the workspace');
 }
 const toolbar=page.locator('#owTools .ow-toolbar');
 await toolbar.waitFor();
 const tools=await toolbar.evaluate(node=>({width:node.getBoundingClientRect().width,
  available:node.parentElement.getBoundingClientRect().width,
  controls:[...node.querySelectorAll('button')].filter(button=>button.getClientRects().length).map(button=>{
   const box=button.getBoundingClientRect(),y=box.top+box.height/2;
   return [box.left+3,box.right-3].every(x=>button.contains(document.elementFromPoint(x,y)));
  })}));
 assert.ok(Math.abs(tools.width-tools.available)<=1,'toolbar uses the available content width');
 assert.ok(tools.controls.length>=4&&tools.controls.every(Boolean),'all visible order controls have independent hit targets');
 await trigger.click();
 await menu.waitFor();
 assert.deepEqual(await workspace.boundingBox(),appBox,'opening profile keeps the workspace in place');
 assert.equal(await menu.locator('#logoutBtn').isVisible(),true,'sign-out is inside the profile');
 await page.keyboard.press('Escape');
 assert.equal(await menu.isVisible(),false,'Escape closes the profile');
 assert.equal(await trigger.evaluate(node=>node===document.activeElement),true,'Escape restores profile focus');
 await bell.click();
 const notices=page.locator('#pushPopover');
 await notices.waitFor();
 assert.deepEqual(await workspace.boundingBox(),appBox,'opening notifications keeps the workspace in place');
 await page.keyboard.press('Escape');
 assert.equal(await notices.isVisible(),false,'Escape closes notifications');
 assert.equal(await bell.evaluate(node=>node===document.activeElement),true,'Escape restores bell focus');
}
async function verifyWorkspaceScroll(page,label){
 const positions=await page.evaluate(()=>{
  const app=document.getElementById('appScreen');
  const header=document.getElementById('rdScreenHeader');
  const initialScroll=app.scrollTop;
  const initialHeader=header.getBoundingClientRect().top;
  app.scrollTop=0;
  app.scrollTop=Math.min(120,app.scrollHeight-app.clientHeight);
  const result={scroll:app.scrollTop,header:header.getBoundingClientRect().top,
   initialHeader,documentScroll:window.scrollY};
  app.scrollTop=initialScroll;
  return result;
 });
 assert.ok(positions.scroll>0,label+' scrollable workspace');
 assert.equal(positions.header,positions.initialHeader,label+' header stays anchored');
 assert.equal(positions.documentScroll,0,label+' document remains stationary');
}
(async()=>{const kind=process.env.TEST_BROWSER||'chromium';
 const browser=await (kind==='webkit'?webkit:chromium).launch({
  executablePath:process.env.TEST_BROWSER_PATH||(kind==='chromium'?(process.env.CHROMIUM_PATH||'/usr/bin/chromium'):undefined),
  args:kind==='chromium'?['--no-sandbox']:[]
 });try{
 const {page,context,writes,errors}=await setup(browser);
 await page.goto('https://crm.test/');await page.locator('.rd-shell').waitFor();
 const results=[];
 const screenshots=process.env.RABOTA_SCREENSHOT_DIR;
 if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
 for(const width of [320,360,375,390,412,600,768,790,800,820,900,1024,1130,1180,1280,1440]){
  await page.setViewportSize({width,height:800});
  for(const section of ['home','orders','calendar','clients','finance','reports','settings','leads']){
   await page.locator('.rd-shell [data-page="'+(section==='calendar'?'orders':section)+'"]').evaluate(e=>e.click());
   if(section==='finance')await page.locator('.mw-money-stats').waitFor();
   results.push(await scan(page,section));
   if(section==='clients'){
    await page.locator('.rd-client button').first().click();results.push(await scan(page,'client-history'));
    const back=page.locator('#rdScreenHeader').getByRole('button',{name:'Назад к клиентам',exact:true});
    await back.click();
    assert.equal(await page.locator('#rdScreenHeader #appTitle').textContent(),'Клиенты');
   }
   if(section==='calendar'){
    await page.locator('#owViewSwitch [data-ow-mode="calendar"]').click();
    const date=page.locator('#masterCalendarDateText');
    assert.ok(await date.evaluate(e=>e.clientWidth>0&&e.scrollWidth<=e.clientWidth+1),'native date text fits');
    results.push(await scan(page,'calendar-day'));
    await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
    results.push(await scan(page,'calendar-to-all-orders'));
   }
   if(screenshots&&[320,800,1440].includes(width))await page.screenshot({path:path.join(screenshots,section+'-'+width+'.png')});
   if(section==='orders'){
    await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
    if(width===1440){
     await page.setViewportSize({width,height:600});
     await verifyWorkspaceScroll(page,'desktop owner');
     await page.setViewportSize({width,height:800});
    }
    if(width<=790){
     const toggle=page.locator('#owFilterToggle');
     const count=page.locator('#orderCount');
     const initialCount=await count.innerText();
     await toggle.scrollIntoViewIfNeeded();
     await toggle.click();
     const panel=page.locator('#ordersArea #owTools #owFilters');
     assert.equal(await panel.isVisible(),true,'mobile filters expand within Orders');
     results.push(await scan(page,'orders-filters-expanded'));
     await page.locator('#owFilterStatus').selectOption('Выполнен');
     assert.equal(await count.innerText(),initialCount,'draft filters do not apply before confirmation');
     await page.locator('#owFilterCancel').click();
     assert.equal(await panel.isVisible(),false,'close collapses the filter panel');
     await toggle.click();
     assert.equal(await page.locator('#owFilterStatus').inputValue(),'','reopening restores saved selection');
     await page.locator('#owFilterStatus').selectOption('Выполнен');
     await page.locator('#owFilterApply').click();
     assert.notEqual(await count.innerText(),initialCount,'Apply filters visible orders');
     assert.match(await toggle.getAttribute("aria-label"),/активно: 1/,'active filter count is announced');
     await toggle.click();
     await page.locator('#owFilterReset').click();
     assert.notEqual(await count.innerText(),initialCount,'Reset stays draft until Apply');
     await page.locator('#owFilterApply').click();
     assert.equal(await count.innerText(),initialCount,'reset and apply restores the full list');
     results.push(await scan(page,'orders-filters-collapsed'));
    }
    await page.locator('.rd-list-toggle').first().click();results.push(await scan(page,'order-details'));
    await page.locator('.rd-order-close').click(); // Modal must be closed before testing another action.
    await page.locator('#newOrderBtn').click();results.push(await scan(page,'order-form'));
    await page.locator('#orderOverlay .close').click();
   }
   if(section==='finance'){
    await page.locator('.mw-owner-create').click();
    results.push(await scan(page,'finance-menu'));
    await page.getByRole('button',{name:/создать расход/i}).click();
    results.push(await scan(page,'finance-expense-dialog'));
    await page.locator('.mw-modal').getByRole('button',{name:'Отмена'}).click();
   }
   if(section==='reports'){
    await page.locator('#rdReports .rd-salary-entry').click();
    assert.equal(await page.locator('#rdScreenHeader #appTitle').textContent(),'Зарплата');
    assert.equal(await page.locator('#rdSalaryReport').getByRole('heading',{name:'Зарплата',exact:true}).count(),0,'report title appears once');
    await page.locator('.fp-balance-value').waitFor();results.push(await scan(page,'salary-detail'));
    await page.locator('.fp-subtab').nth(1).click();results.push(await scan(page,'salary-payments'));
    await page.locator('.fp-balance-payout').click();results.push(await scan(page,'payout-dialog'));
    await page.locator('.fp-close').click();
    await page.locator('#rdScreenHeader #rdScreenBack').click();
    assert.equal(await page.locator('#rdReports .rd-salary-entry').evaluate(node=>node===document.activeElement),true,'report back restores focus');
   }
   if(section==='settings'){
    await page.locator('#teamMembers .team-item').first().waitFor();
    results.push(await scan(page,'team'));
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
   await verifyProfile(p,role);
   if(role==='master'){
    await p.locator('.master-schedule-toggle').first().click();results.push(await scan(p,profile+' master schedule'));
    await p.locator('.master-order-sheet .mw-order-modal-close').click();
    await p.locator('#mwMasterNav [data-mw-page="payments"]').click();
    await p.locator('#mwMasterPayments .mw-payment-breakdown').waitFor();
    results.push(await scan(p,profile+' master finance'));
   }else{
    await p.locator('#rdMobileMoreBtn').click();results.push(await scan(p,profile+' '+role+' menu'));
    await p.locator('#rdMobileMoreSheet [data-page="'+(role==='owner'?'clients':'home')+'"]').click();
    assert.equal(await p.locator('.rd-more-sheet').isVisible(),false);
    if(role==='manager')await p.locator('#rdMobileNav [data-page="clients"]').click();
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
 const desktopMaster=await setup(browser,{viewport:{width:1280,height:600}},'master');
 try{
  await desktopMaster.page.goto('https://crm.test/');
  await desktopMaster.page.locator('#owViewSwitch [data-ow-mode="all"]').click();
  await verifyWorkspaceScroll(desktopMaster.page,'desktop master');
  assert.deepEqual(desktopMaster.writes,[]);assert.deepEqual(desktopMaster.errors,[]);
 }finally{await desktopMaster.context.close();}
 const failures=results.filter(x=>x.overflow>2||x.workspaceOverflow>2||x.issues.length);
 console.log(JSON.stringify({checks:results.length,failures,writes,errors},null,2));
 assert.deepEqual(failures,[],'layout overflow');assert.deepEqual(writes,[],'unexpected mutation attempt');assert.deepEqual(errors,[],'browser errors');
 await context.close();
}finally{await browser.close()}})().catch(e=>{console.error(e.stack);process.exitCode=1});
