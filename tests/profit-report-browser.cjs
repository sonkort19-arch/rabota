"use strict";
const {chromium,webkit}=require("playwright");
const path=require("node:path");
const {mkdir,readFile}=require("node:fs/promises");
const {fixture,assertHeaderLayout}=require("./module-navigation-browser.cjs");
const root=path.join(__dirname,"..");
const assert=require("node:assert/strict");
const reportJs=path.join(__dirname,"..","profit-report.js");
const reportCss=path.join(__dirname,"..","profit-report.css");
// Keep Chromium + WebKit coverage by default; allow one installed engine locally.
async function launch(browserType){
  const type=process.env.TEST_BROWSER==="chromium"?chromium:
    process.env.TEST_BROWSER==="webkit"?webkit:browserType;
  return type.launch({headless:true,
    executablePath:process.env.TEST_BROWSER_PATH||
      (type===chromium?process.env.CHROMIUM_PATH:undefined),
    args:type===chromium?["--no-sandbox"]:[]});
}
const origin="https://crm.test";
const monthStart="2026-05-31T21:30:00Z"; // 1 June in Moscow, 31 May in UTC.
const frozen=new Date("2026-06-25T07:00:00Z");
const raul="fixture-master";
const other="another-fixture-master";
const number=text=>Number(text.replace(/[^\d,−-]/g,"").replace(",",".").replace("−","-"));
const rounded=text=>text.trim().replace(/\s+/g," ");
const view=(panel,name)=>panel.and(panel.page().locator('[data-view="'+name+'"]'));
const report=page=>page.locator("#rdReports .pr-detail");
const headerBack=page=>page.locator("#rdScreenBack");
const chart=panel=>panel.locator(".pr-chart-point");
const rows=panel=>panel.locator(".pr-order-row");
const row=(panel,id)=>rows(panel).and(panel.page().locator('[data-order-id="'+id+'"]'));
const metric=(panel,key)=>panel.locator('.pr-metric[data-metric="'+key+'"] strong');
const net=panel=>panel.locator('.pr-net-card [data-metric="net"], .pr-net-card[data-metric="net"]');
const waitView=(panel,name)=>view(panel,name).waitFor();
const tab=(panel,name)=>panel.locator(".pr-tabs").getByRole("button",{name,exact:true});
const financeDetail=panel=>panel.locator(".pr-order-detail:visible");

async function capture(page,filename){
  const directory=process.env.PROFIT_REPORT_SCREENSHOTS;
  if(!directory)return;
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:path.join(directory,filename+".png")});
}

async function applyFilters(panel,{period,basis,status,from,to}={}){
  await panel.locator(".pr-filter-button").click();
  await waitView(panel,"filters");
  if(period)await panel.locator('input[type="radio"][value="'+period+'"]').check();
  if(basis)await panel.locator('input[type="radio"][value="'+basis+'"]').check();
  if(status!==undefined)await panel.getByLabel("Статус заказов",{exact:true}).selectOption(status);
  if(from)await panel.getByLabel("Начало периода",{exact:true}).fill(from);
  if(to)await panel.getByLabel("Конец периода",{exact:true}).fill(to);
  await panel.getByRole("button",{name:"Применить",exact:true}).click();
}

function sampleOrder(id,number,name,amount,closed,options={}){
  const paid=options.paid!==false,travel=options.travel||0,master=options.master||raul;
  return {id,order_number:number,name,price:amount,
    status:closed?"Выполнен":"Записан",paid,travel_amount:travel,
    payment_amount:paid?Math.round((amount+travel)*100)/100:null,
    payment_method:paid?"card":null,paid_at:paid?closed:null,
    assigned_user_id:master,master:master===raul?"Рауль":"Другой мастер",
    completed_at:closed,created_at:closed??"2026-06-23T09:00:00Z",
    updated_at:closed??"2026-06-23T09:00:00Z",appointment_date:"2026-06-29",appointment_time:"12:00:00",
    phone:"+7900000010"+number%10,client_source:"avito"};
}
const a={...sampleOrder("eligible-road",10101,"Анна Тестова",10000.25,"2026-06-04T10:00:00Z",{travel:1000}),
  phone:"+7 (900) 000-10-01"};
const b=sampleOrder("refunded-road",10102,"Борис Возврат",7000,"2026-06-13T10:00:00Z",{travel:500});
const c=sampleOrder("another-master",10103,"Вера Оплата",5000,"2026-06-17T10:00:00Z",{master:other});
const d=sampleOrder("unverified-payment",10104,"Глеб Сверка",9000,"2026-06-24T10:00:00Z");
const e=sampleOrder("booking",10105,"Дарья Запись",2000,null,{paid:false});
const previousOrder=sampleOrder("outside-selection",90123,"Заказ прошлого месяца",1000,"2026-05-21T10:00:00Z",{paid:false});
const sampleOrders=[a,b,c,d,e,previousOrder];
const expense=(id,amount,fields={})=>({id,kind:"expense",amount,payment_method:"card",
  created_at:monthStart,voided_at:null,note:"Тестовый расход",...fields});
const ops=[
  expense("direct-1",125.25,{order_id:a.id}),
  expense("direct-1",125.25,{order_id:a.id}),
  expense("linked-legacy",7.75,{note:"[Расходники] Прокладки · Заказ №10101"}),
  expense("direct-2",80.01,{order_id:c.id}),
  expense("general",1200),
  expense("general",1200),
  expense("past",9000,{created_at:"2026-05-31T20:59:00Z"}),
  expense("external-order",8000,{order_id:"outside-selection"}),
  expense("external-reference",7000,{note:"[Расходники] Материалы · Заказ №90123"}),
  expense("missing-order",223.45,{order_id:"unavailable-order"}),
  expense("missing-reference",76.55,{note:"[Расходники] Материалы · Заказ №90124"}),
  expense("voided",350,{voided_at:monthStart}),
  expense("payout",5000,{kind:"raul_payout"})
];
const bookingLedger=[a,b,c].map(order=>({order_id:order.id,amount:order.payment_amount,
  master_id:order.assigned_user_id,payment_method:"card",travel_amount:order.travel_amount,
  paid_at:order.paid_at,occurred_at:order.completed_at}));
const snapshot={state:"active",version:3,accounting_version:1,master_id:raul,activated_at:monthStart,
  accounting_receipts:bookingLedger,accounting_payouts:[],payouts:[],holds:[],
  accounting_refunds:[{order_id:b.id,amount:b.payment_amount,travel_amount:500,refunded_at:b.completed_at}],
  orders:[{order_id:a.id,paid_amount:10000.25,earned_amount:6500.13,company_share:3500.12,
    rule_version:3,earned_at:a.completed_at}],
  travel_events:[a,b].map(order=>({id:"travel-"+order.id,order_id:order.id,
    delta:order.travel_amount,order_number:order.order_number,occurred_at:order.completed_at})),
  earned:8000.13,paid:0,due:8000.13,balance:8000.13,overpaid:0,travel_earned:1500};
const generalCash={id:"book-general",kind:"expense",amount:800,created_at:"2026-06-06T10:00:00Z",
  from_account:"cash",to_account:null,note:"Общие расходы из кассы"};
const cashbook=[generalCash,generalCash,
  {...generalCash,id:"transfer",kind:"transfer",amount:1400,to_account:"card"},
  {...generalCash,id:"income",kind:"income",amount:9000,from_account:null,to_account:"cash"},
  {...generalCash,id:"old-expense",created_at:"2026-05-31T20:59:00Z",amount:500}
];

async function appFixture(browser,width,role){
  const f=await fixture(browser,root,width,role,{
    height:844,standalone:true,safeArea:{top:47,right:0,bottom:34,left:0}
  });
  const {page}=f;
  await page.clock.setFixedTime(frozen);
  const reportRequests=[];
  let releaseCashbook=()=>{};
  const holdCashbook=role==="owner"&&width===390?new Promise(resolve=>{releaseCashbook=resolve;}):null;
  const mock=async(resource,data,hold)=>{
    const pathname="/rest/v1/"+resource;
    await page.route(url=>url.hostname.endsWith(".supabase.co")&&url.pathname===pathname,async route=>{
      assert.equal(route.request().method(),"GET","The profit report is read-only");
      assert.equal(route.request().headers().authorization,"Bearer fixture-access");
      reportRequests.push(resource);
      if(hold)await hold;
      return route.fulfill({json:data});
    });
  };
  if(role==="owner"){
    await mock("rabota_orders",sampleOrders);
    await mock("rabota_finance_operations",ops);
    await mock("rpc/rabota_payroll_snapshot_v3",snapshot);
    await mock("rabota_cashbook_entries",cashbook,holdCashbook);
  }
  await page.goto(origin+"/?view=reports");
  await page.locator("#appScreen").waitFor();
  return {...f,report:report(page),reportRequests,releaseCashbook,close:async()=>{
    releaseCashbook();
    await f.close();
  }};
}

async function assertNoHorizontalOverflow(page,panel){
  const size=await panel.evaluate(node=>{
    const viewport=window.innerWidth;
    const overflow=[...node.querySelectorAll("button,input,select,strong")]
      .map(element=>({name:element.textContent?.trim(),box:element.getBoundingClientRect()}))
      .filter(item=>item.box.width&&(item.box.left<-.5||item.box.right>viewport+.5)).map(item=>item.name);
    return {body:document.documentElement.scrollWidth,viewport,overflow};
  });
  assert.ok(size.body<=size.viewport+1,JSON.stringify(size));
  assert.deepEqual(size.overflow,[],JSON.stringify(size));
}

async function assertOverview(page,panel,width){
  await waitView(panel,"overview");
  await metric(panel,"count").waitFor();
  await page.waitForFunction(()=>document.querySelector('.pr-metric[data-metric="count"] strong')?.textContent==="4");
  assert.equal(number(await metric(panel,"count").innerText()),4);
  assert.match(rounded(await panel.locator(".pr-paid-count").innerText()),/2\s*оплачен/i);
  const values=await Promise.all(["revenue","salary","profit"].map(key=>metric(panel,key).innerText()));
  assert.deepEqual(values.map(number),[16000.25,8000.13,7787.11],
    "Order totals follow recorded receipts, return, travel accrual and linked expenses");
  assert.match(rounded(await panel.locator(".pr-average").innerText()),/8\s*000,13/);
  await panel.locator(".pr-net-card").getByText(/5[\s\u00a0\u202f]*487,11/).waitFor();
  assert.match(rounded(await net(panel).innerText()),/5\s*487,11/);
  assert.equal(await rows(panel).filter({visible:true}).count(),0,"The initial view does not expose the full list");
  const layout=await panel.locator(".pr-metric:visible").evaluateAll(nodes=>nodes.map(node=>{
    const {x,y,width,height}=node.getBoundingClientRect();
    return {x,y,width,height};
  }));
  assert.equal(layout.length,4);
  assert.equal(layout[0].y,layout[1].y,"The first pair of metrics shares a row");
  assert.equal(layout[2].y,layout[3].y,"The second pair of metrics shares a row");
  assert.ok(layout[2].y>layout[0].y&&layout[1].x>layout[0].x,width+"px layout has two columns and two rows");
  assert.ok(layout.every(card=>card.height>=58),"Metrics have room for the amount and its explanation");
  const appearance=await net(panel).evaluate(button=>{
    const label=button.querySelector(".pr-net-copy > span"),value=button.querySelector("strong"),note=button.querySelector("small");
    const line=button.closest(".pr-overview").querySelector(".pr-chart-line");
    return {positions:[label,value,note].map(node=>node.getBoundingClientRect().top),
      valueFont:parseFloat(getComputedStyle(value).fontSize),lineFill:getComputedStyle(line).fill};
  });
  assert.ok(appearance.positions[0]<appearance.positions[1]&&appearance.positions[1]<appearance.positions[2],
    "Clean profit renders as a label, a separate amount and a separate explanation");
  assert.ok(appearance.valueFont>=18,"The clean profit amount is visibly prominent");
  assert.equal(appearance.lineFill,"none","The line path never fills the chart with a dark polygon");
  await assertNoHorizontalOverflow(page,panel);
}

async function exerciseOwnerReport(page,panel,requests,engine){
  const initialPath=new URL(page.url()).pathname+new URL(page.url()).search;
  const selected=panel.locator(".pr-chart-selected:visible");
  const points=chart(panel).filter({visible:true});
  const originalChart=await selected.innerText();
  const plotted=await points.count();
  assert.ok(plotted>=3,"Profit can be read for several days or weeks");
  assert.match(originalChart,/На сверке/,
    "A chart period with only an unresolved receipt is not graphed as confirmed zero profit");
  let changed=false;
  for(let i=0;i<plotted&&!changed;i++){
    await points.nth(i).tap();
    changed=(await selected.innerText())!==originalChart;
  }
  assert.equal(changed,true,"Tapping another point discloses that period's value");
  await points.last().focus();
  await points.last().press("Enter");
  assert.ok(rounded(await selected.innerText()).length>0,"A chart selection works from the keyboard too");

  await panel.locator(".pr-net-card").click();
  await waitView(panel,"net");
  const netText=rounded(await panel.innerText());
  for(const [pattern,message] of [[/7\s*787,11/,"order profit"],[/2\s*000/,"general expenses"],
    [/Расходы без сопоставленного заказа\s*[-−]300\s*₽/,"unmatched expenses"],[/5\s*487,11/,"net profit"]])
    assert.match(netText,pattern,"Clean profit breakdown must show "+message);
  assert.match(netText,/Общие расходы/i);
  await assertNoHorizontalOverflow(page,panel);
  await capture(page,engine+"-390-net");
  await headerBack(page).click();
  await waitView(panel,"overview");

  await panel.locator(".pr-review-link").click();
  await waitView(panel,"review");
  const review=panel.locator(".pr-reconcile:visible");
  assert.match(rounded(await review.innerText()),/Глеб Сверка/);
  assert.match(rounded(await review.innerText()),/оплат|платёж/i);
  assert.doesNotMatch(await review.innerText(),/Анна Тестова|Вера Оплата|Борис Возврат/);
  await capture(page,engine+"-390-review");
  await headerBack(page).click();
  await waitView(panel,"overview");

  await tab(panel,"Заказы").click();
  await waitView(panel,"orders");
  assert.deepEqual(await rows(panel).evaluateAll(items=>items.filter(x=>x.getClientRects().length).map(x=>x.dataset.orderId)),
    [d.id,c.id,b.id,a.id],"Default date sort matches newest closed orders");
  assert.match(await row(panel,b.id).innerText(),/Возврат/);
  assert.match(await row(panel,d.id).innerText(),/На сверке/i);
  assert.doesNotMatch(await row(panel,d.id).innerText(),/0\s*₽/);
  await assertNoHorizontalOverflow(page,panel);
  await capture(page,engine+"-390-orders");
  const orderSort=panel.getByLabel("Сортировка заказов",{exact:true});
  const ordering=await orderSort.locator("option").evaluateAll(options=>options.map(o=>({name:o.textContent,value:o.value})));
  const byProfit=ordering.find(option=>/прибыл/i.test(option.name));
  assert.ok(byProfit,"The visitor can sort by profit");
  await orderSort.selectOption(byProfit.value);
  const settled=await rows(panel).evaluateAll(items=>items.filter(x=>x.getClientRects().length&&!/на сверке/i.test(x.textContent))
    .map(x=>x.dataset.orderId));
  assert.ok([[c.id,a.id,b.id],[b.id,a.id,c.id]].some(order=>order.join()===settled.join()),
    "Sorting profit uses real numeric values, including the refunded loss");

  const search=panel.getByLabel("Поиск по заказам",{exact:true});
  await search.fill("#10101");
  assert.equal(await rows(panel).count(),1);
  await row(panel,a.id).click();
  await waitView(panel,"order");
  const detail=rounded(await financeDetail(panel).innerText());
  assert.match(detail,/Анна Тестова/);
  for(const figure of [/11\s*000,25/,/6\s*500,13/,/1\s*000/,/133/,/3\s*367,12/])assert.match(detail,figure);
  assert.match(detail,/дорог/i);
  assert.equal(await headerBack(page).getAttribute("aria-label"),"Назад к заказам");
  await assertNoHorizontalOverflow(page,panel);
  await capture(page,engine+"-390-detail");
  await headerBack(page).click();
  await waitView(panel,"orders");
  assert.equal(await search.inputValue(),"#10101","Return preserves the search");
  assert.equal(await orderSort.inputValue(),byProfit.value,"Return preserves the sort");
  assert.equal(await rows(panel).count(),1);

  const downloadEvent=page.waitForEvent("download");
  await panel.locator(".pr-export:visible").click();
  const download=await downloadEvent;
  assert.match(download.suggestedFilename(),/^rabota-profit-orders-.*\.csv$/);
  const exported=(await readFile(await download.path(),"utf8")).trim().split(/\r?\n/);
  assert.equal(exported.length,2,"CSV contains the header and the filtered order");
  assert.match(exported[1],/10101.*Анна Тестова.*11000\.25/);
  assert.doesNotMatch(exported[1],/Вера Оплата|Борис Возврат|Глеб Сверка/);
  await search.fill("вера оплата");
  assert.equal(await rows(panel).count(),1);
  assert.equal(await row(panel,c.id).count(),1,"Customer-name search is case-insensitive");
  await search.fill("79000000102");
  assert.equal(await rows(panel).count(),1);
  assert.equal(await row(panel,b.id).count(),1,"Search matches the order's phone number");
  await search.fill("8 (900) 000-01-02");
  assert.equal(await row(panel,b.id).count(),1,"Pasting a formatted Russian number also finds a stored canonical number");
  await search.fill("79000001001");
  assert.equal(await row(panel,a.id).count(),1,"Search finds a stored legacy phone with spaces and punctuation");
  await search.fill("");

  await applyFilters(panel,{period:"custom",from:"2026-06-04",to:"2026-06-04"});
  await waitView(panel,"orders");
  assert.equal(await rows(panel).count(),1,"A custom closing day narrows the order list");
  assert.equal(await row(panel,a.id).count(),1);
  await tab(panel,"Обзор").click();
  await waitView(panel,"overview");
  assert.equal(number(await metric(panel,"count").innerText()),1);
  assert.match(await panel.locator(".pr-paid-count").innerText(),/1\s*оплачен/i);
  await applyFilters(panel,{period:"month",status:"paid"});
  await waitView(panel,"overview");
  assert.equal(number(await metric(panel,"count").innerText()),2,
    "The paid filter includes only orders with confirmed payment after refunds");
  assert.match(await panel.locator(".pr-paid-count").innerText(),/2\s*оплачен/i);
  assert.match(rounded(await net(panel).innerText()),/5\s*487,11.*По всем заказам за период/i,
    "The company-wide net figure and its scope are preserved under an order status filter");
  await panel.locator(".pr-net-card").click();
  await waitView(panel,"net");
  const cleanProfit=panel.locator(".pr-company-detail:visible");
  assert.match(await cleanProfit.innerText(),/По всем заказам за период/i);
  assert.doesNotMatch(await cleanProfit.innerText(),/·\s*Оплачены/i,
    "Company-wide net profit must never be labeled with an order-only status filter");
  await headerBack(page).click();
  await waitView(panel,"overview");
  await panel.locator(".pr-review-link").click();
  await waitView(panel,"review");
  const paidReview=panel.locator(".pr-reconcile:visible");
  assert.match(await paidReview.innerText(),/Глеб Сверка/,
    "The paid filter must not hide other orders requiring reconciliation");
  await paidReview.locator('.pr-review-row[data-order-id="'+d.id+'"]').click();
  await waitView(panel,"order");
  assert.match(await financeDetail(panel).innerText(),/Глеб Сверка/,
    "An order excluded by the status filter can still be opened from period reconciliation");
  await headerBack(page).click();
  await waitView(panel,"review");
  await headerBack(page).click();
  await waitView(panel,"overview");
  await applyFilters(panel,{status:""});
  await applyFilters(panel,{period:"all"});
  await waitView(panel,"overview");
  assert.equal(number(await metric(panel,"count").innerText()),6,"All-time keeps booked and returned orders in the general count");
  assert.match(await panel.locator(".pr-paid-count").innerText(),/2\s*оплачен/i);
  assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,initialPath,"Report subviews stay in the existing SPA section");
  assert.ok(requests.filter(x=>x==="rabota_cashbook_entries").length<=1,"Changing views and filters shares one cashbook read");
  await headerBack(page).click();
  await page.locator(".pr-menu .pr-report-link").filter({hasText:"Прибыль по заказам"}).waitFor();
}

async function checkHostReportRecovery(browserType){
  const browser=await launch(browserType);
  try{
    const f=await appFixture(browser,390,"owner");
    const {page,report:panel}=f;
    try{
      await page.locator(".pr-menu .pr-report-link").filter({hasText:"Прибыль по заказам"}).click();
      f.releaseCashbook();
      await assertOverview(page,panel,390);
      const bookReads=f.reportRequests.filter(x=>x==="rabota_cashbook_entries").length;
      const financeReads=f.reportRequests.filter(x=>x==="rabota_finance_operations").length;
      await page.evaluate(()=>window.dispatchEvent(new Event("offline")));
      const stale=await page.evaluate(()=>({finance:window.__rdFinanceStatus().stale,
        book:window.__rdMoneyUi.cashbookSnapshot().stale}));
      assert.deepEqual(stale,{finance:true,book:true},"Disconnect makes both report inputs stale");
      await panel.locator(".pr-data-error:visible .pr-retry").click();
      await page.waitForFunction(()=>!window.__rdFinanceStatus().stale&&!window.__rdMoneyUi.cashbookSnapshot().stale);
      assert.equal(f.reportRequests.filter(x=>x==="rabota_cashbook_entries").length,bookReads+1,
        "Report retry independently refreshes the stale cashbook once");
      assert.equal(f.reportRequests.filter(x=>x==="rabota_finance_operations").length,financeReads+1,
        "Report retry refreshes the profit snapshot once");

      await headerBack(page).click();
      await page.locator("#rdReports .rd-salary-entry").click();
      const salary=page.locator("#rdSalaryReport");
      await salary.locator(".fp-balance-hero").waitFor();
      await page.evaluate(()=>window.__rdResetOwnerModules());
      assert.equal(await salary.isVisible(),false,"Account reset closes the neighboring salary report");
      assert.equal(await salary.locator(":scope > *").count(),0,"Account reset removes old salary DOM");
      assert.equal(await page.locator("#rdReports .pr-menu").isVisible(),true);
      assert.deepEqual(f.writes,[]);
    }finally{await f.close();}
  }finally{await browser.close();}
}

async function checkReportRefreshAndDates(browserType){
  const browser=await launch(browserType);
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,
      hasTouch:true,serviceWorkers:"block"});
    await context.route("**/*",route=>route.abort());
    const page=await context.newPage();
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.clock.setFixedTime(frozen);
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><section id="rdReports"></section>');
    await page.addStyleTag({path:reportCss});
    await page.addScriptTag({path:reportJs});
    await page.evaluate(()=>{
      const now="2026-06-04T10:00:00Z";
      const orders=[{id:"first",orderNumber:1,status:"Выполнен",name:"Тестовый клиент",
        assignedUserId:"synthetic-master",paid:true,price:100,paymentAmount:100,completedAt:now,
        createdAt:now,address:"Тестовая улица"}];
      const payroll={state:"active",orders:[],accounting:{receipts:[{orderId:"first",amount:100,
        masterId:"synthetic-master"}]}};
      let revision=1;
      const api=window.__rdCreateProfitReport(document.getElementById("rdReports"),{
        startOpen:true,getOrders:()=>orders,getFinanceStatus:()=>({ready:true,revision}),getPayroll:()=>payroll
      });
      window.refreshProfitFixture=()=>{revision++;api.render();};
      window.refundProfitFixture=()=>{
        payroll.accounting.refunds=[{orderId:"first",amount:100}];
        window.refreshProfitFixture();
      };
    });
    const panel=report(page);
    const chartSummary=panel.locator(".pr-chart-selected");
    assert.match(await chartSummary.innerText(),/100\s*₽/,
      "The chart starts with the most recent bucket that contains orders, rather than a later empty bucket");
    const selected=chart(panel).and(page.locator('[aria-pressed="true"]'));
    await selected.focus();
    const selectedLabel=await selected.getAttribute("aria-label");
    await page.evaluate(()=>window.refreshProfitFixture());
    assert.equal(await selected.getAttribute("aria-label"),selectedLabel);
    assert.equal(await selected.evaluate(el=>el===document.activeElement),true,
      "A fresh accepted finance snapshot keeps the selected chart point keyboard-focused");
    await chart(panel).last().tap();
    assert.match(await chartSummary.innerText(),/Нет заказов/i);
    assert.doesNotMatch(await chartSummary.innerText(),/₽/,"A bucket without orders must not look like a calculated zero");

    await applyFilters(panel,{status:"paid"});
    await tab(panel,"Заказы").click();
    await row(panel,"first").click();
    const details=panel.locator(".pr-order-meta");
    await details.locator("summary").click();
    await details.locator("summary").focus();
    await page.evaluate(()=>window.refreshProfitFixture());
    assert.notEqual(await details.getAttribute("open"),null,"A refresh keeps order information expanded");
    assert.equal(await details.locator("summary").evaluate(el=>el===document.activeElement),true);
    await page.evaluate(()=>window.refundProfitFixture());
    assert.match(await financeDetail(panel).innerText(),/Возврат/,
      "The selected order remains visible while its refund removes it from the paid list");
    await panel.locator(".pr-back").click();
    await waitView(panel,"orders");
    assert.equal(await row(panel,"first").count(),0);
    await panel.locator(".pr-filter-button").click();
    await panel.locator('input[type="radio"][value="custom"]').check();
    await panel.getByLabel("Начало периода",{exact:true}).fill("10000-01-01");
    await panel.getByLabel("Конец периода",{exact:true}).fill("10000-02-01");
    await panel.getByRole("button",{name:"Применить",exact:true}).click();
    assert.equal(await panel.getAttribute("data-view"),"filters","Unsupported years never commit a broken period");
    assert.deepEqual(errors,[]);
    await context.close();
  }finally{await browser.close();}
}

async function ownerDashboard(browserType,engine){
  const browser=await launch(browserType);
  try{
    for(const width of [320,375,390,430]){
      const f=await appFixture(browser,width,"owner");
      const {page,report:panel}=f;
      try{
        const initialHeader=await assertHeaderLayout(page,"reports");
        await page.locator(".pr-menu .pr-report-link").filter({hasText:"Прибыль по заказам"}).click();
        await assertHeaderLayout(page,"reports",initialHeader,{title:"Прибыль по заказам",back:"Назад к отчётам"});
        if(width===390){
          await page.waitForFunction(()=>/7\s*787,11/.test(document.querySelector('.pr-metric[data-metric="profit"] strong')?.textContent));
          assert.doesNotMatch(await panel.locator(".pr-net-card").innerText(),/[\d.,]\s*₽/,
            "A pending cashbook never presents a manufactured clean-profit figure");
          f.releaseCashbook();
        }
        await assertOverview(page,panel,width);
        await capture(page,engine+"-"+width+"-overview");
        if(width===390)await exerciseOwnerReport(page,panel,f.reportRequests,engine);
        assert.deepEqual(f.writes,[]);
        assert.deepEqual(f.documents,["/?view=reports"]);
      }finally{await f.close();}
    }
    const f=await appFixture(browser,390,"manager");
    try{
      await f.page.locator("#ordersArea").waitFor();
      assert.equal(await f.page.locator("#rdReports").getByRole("button",{name:/Прибыль по заказам/}).count(),0);
      assert.equal(await f.page.locator(".pr-net-card:visible").count(),0);
      assert.deepEqual(f.writes,[]);
      for(const resource of ["operations","rabota_cashbook_entries"])assert.ok(!f.requests.includes(resource));
    }finally{await f.close();}
    console.log("PASS",engine,"iPhone 320/375/390/430, owner finance, responsive shell, order filters, chart, details, CSV and manager access");
  }finally{await browser.close();}
}
async function checkRaulPortal(browserType,name,shouldHaveProfit){
  const browser=await launch(browserType);
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:"dark",serviceWorkers:"block"});
    await context.route("**/*",route=>route.abort());
    const page=await context.newPage();
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.setContent('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="rd"><main id="appScreen"><h1 id="appTitle">Мои заказы</h1><section id="ordersArea"><nav class="tabs"><button class="tab" data-tab="calendar"></button><button class="tab" data-tab="all"></button></nav><div id="orders"></div><span id="orderCount"></span></section><section id="financePanel" hidden></section><button id="masterFinanceBack"></button></main></body></html>');
    await page.addStyleTag({path:path.join(__dirname,"..","light-theme.css")});
    await page.addStyleTag({path:path.join(__dirname,"..","money-workspace.css")});
    await page.addStyleTag({path:reportCss});
    await page.addScriptTag({path:path.join(__dirname,"..","finance-model.js")});
    await page.addScriptTag({path:reportJs});
    await page.evaluate(masterName=>{
      // The real index owns this state; the isolated portal must supply it too.
      window.currentTab="calendar";
      window.__rdViewportScroll={position:()=>scrollY,restore:y=>scrollTo(0,y)};
      window.__rdSetActiveNavItem=(nav,active)=>{
        for(const button of nav.querySelectorAll("button")){
          button.classList.toggle("is-active",button===active);
          button.setAttribute("aria-current",button===active?"page":"false");
        }
      };
      const now=new Date().toISOString();
      const orders=[
        {id:"raul",assignedUserId:"raul-uid",referenceCode:"№00012",name:"Мой клиент",
          master:"Рауль",status:"Выполнен",paid:true,price:10000,paymentAmount:10000,createdAt:now,completedAt:now},
        {id:"foreign",assignedUserId:"another-uid",referenceCode:"№99999",name:"Чужой клиент",
          master:"Олег",status:"Выполнен",paid:true,price:100000,paymentAmount:100000,createdAt:now,completedAt:now}
      ];
      window.__rdOrderReference={normalize:x=>String(x||"")};
      window.__rdMoneyUi={
        snapshot:()=>({role:"master",masterName,masterId:"raul-uid",active:masterName==="Рауль",ready:true}),
        masterReportOrders:()=>masterName==="Рауль"?orders.filter(o=>o.assignedUserId==="raul-uid"):[]
      };
    },name);
    await page.addScriptTag({path:path.join(__dirname,"..","money-workspace.js")});
    await page.evaluate(()=>window.__rdMoneyAccess());
    await page.locator('[data-mw-page="reports"]').click();
    const entry=page.locator('.mw-entry').filter({hasText:"Прибыль по заказам"});
    if(!shouldHaveProfit){
      assert.equal(await entry.count(),0,"A different master cannot see Raul's profit report");
      assert.deepEqual(errors,[],"Isolated master portal has no JavaScript errors");
      await context.close();return;
    }
    assert.equal(await entry.count(),1);
    await entry.click();
    const panel=page.locator("#mwMasterReports .pr-detail");
    await waitView(panel,"overview");
    assert.equal(number(await metric(panel,"count").innerText()),1);
    assert.equal(await panel.locator(".pr-net-card:visible").count(),0,"A master never sees company net profit");
    await tab(panel,"Заказы").click();
    const orderText=await row(panel,"raul").innerText();
    assert.match(orderText,/№00012/);
    assert.doesNotMatch(await panel.innerText(),/№99999|Чужой клиент|100 000/);
    await assertNoHorizontalOverflow(page,panel);
    await page.locator('#mwMasterReports .pr-back').click();
    if(await panel.isVisible())await page.locator('#mwMasterReports .pr-back').click();
    assert.equal(await entry.isVisible(),true,"Back returns to Raul's Reports menu");
    assert.deepEqual(errors,[],"Isolated master portal has no JavaScript errors");
    await context.close();
  }finally{await browser.close()}
}
async function checkOwnerPayroll(browserType,iphone){
  const browser=await launch(browserType);
  try{
    const context=await browser.newContext({
      viewport:iphone?{width:390,height:844}:{width:1200,height:800},
      isMobile:iphone,hasTouch:iphone,colorScheme:iphone?"dark":"light",serviceWorkers:"block"
    });
    await context.route("**/*",route=>route.abort());
    const page=await context.newPage();
    await page.setContent('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="rd"><main id="appScreen"><section id="rdReports"><div id="rdSalaryReport"></div></section></main></body></html>');
    await page.addStyleTag({path:path.join(__dirname,"..","light-theme.css")});
    await page.addStyleTag({path:path.join(__dirname,"..","polished-v2.css")});
    await page.addStyleTag({path:path.join(__dirname,"..","finance-payroll.css")});
    await page.addStyleTag({path:reportCss});
    await page.addScriptTag({path:path.join(__dirname,"..","finance-payroll.js")});
    await page.evaluate(()=>{
      const model={active:true,ready:true,actorId:"owner",employeeId:"raul",earned:12000,paid:5000,due:7000,
        accruals:[],payouts:[]};
      window.__rdMoneyUi={payroll:()=>model};
      window.salaryBrowserFixture=window.__rdPayrollReport.mount(
        document.getElementById("rdSalaryReport"),
        {onBack:()=>{window.returnedToReports=true}}
      );
    });
    assert.equal(await page.locator("#rdSalaryReport .fp-person-summary-item").count(),2);
    const layout=await page.evaluate(()=>({
      pageWidth:document.documentElement.scrollWidth,
      viewport:window.innerWidth,
      background:getComputedStyle(document.querySelector("#rdSalaryReport .fp-v3-balance")).backgroundColor
    }));
    assert.notEqual(layout.background,"rgb(27, 37, 52)","Salary must match CRM light style");
    if(iphone)assert.ok(layout.pageWidth<=layout.viewport+1,
      "Owner salary report must not overflow iPhone: "+JSON.stringify(layout));
    assert.equal(await page.locator("#rdSalaryReport .fp-balance-hero").count(),1);
    assert.match(await page.locator("#rdSalaryReport .fp-balance-hero").innerText(),/7[\s\u00a0\u202f]*000/);
    await page.getByRole("button",{name:"Выплаты",exact:true}).click();
    assert.equal(await page.getByRole("heading",{name:"История выплат"}).count(),1);
    const heading=page.locator("#rdSalaryReport .fp-report-head");
    const back=heading.getByRole("button",{name:"Назад к отчётам"});
    assert.equal(await heading.getByRole("heading",{name:"Зарплата",exact:true}).count(),1);
    assert.ok((await back.boundingBox()).height>=44,"Salary Back has a full touch target");
    await back.click();
    assert.equal(await page.evaluate(()=>window.returnedToReports),true);
    await context.close();
  }finally{await browser.close()}
}
async function checkContentWrapping(browserType){
  const browser=await launch(browserType);
  const customer="Сверхдлинноеназваниекомпании".repeat(4).slice(0,100);
  const address="https://example.invalid/"+"длинныйидентификаторадреса".repeat(6);
  const expenseNote="сверхдлинноеназваниерасхода".repeat(5);
  try{
    for(const [width,height,safeArea] of [[320,844,{top:47,right:0,bottom:34,left:0}],
      [844,390,{top:0,right:47,bottom:21,left:47}]]){
      const f=await fixture(browser,root,width,"owner",{height,safeArea,standalone:true});
      const {page}=f;
      try{
        await page.clock.setFixedTime(frozen);
        for(const [resource,json] of [["rabota_orders",[{...a,name:customer,address}]],
          ["rpc/rabota_payroll_snapshot_v3",snapshot],
          ["rabota_finance_operations",ops.concat(expense("long-expense",9999999.99,{order_id:a.id,note:expenseNote}))],
          ["rabota_cashbook_entries",Array.from({length:150},(_,index)=>({
            ...generalCash,id:"large-"+index,amount:9999999.99
          }))]]){
          await page.route(url=>url.hostname.endsWith(".supabase.co")&&url.pathname==="/rest/v1/"+resource,
            route=>route.fulfill({json}));
        }
        await page.goto(origin+"/?view=reports");
        await page.locator(".pr-menu .pr-report-link").filter({hasText:"Прибыль по заказам"}).click();
        const panel=report(page);
        await waitView(panel,"overview");
        const netAmount=panel.locator(".pr-net-copy strong").filter({hasText:/₽/});
        await netAmount.waitFor();
        assert.equal(await netAmount.evaluate(node=>{
          const text=node.firstChild;
          const lastGroup=/\d{1,3}(?:,\d{1,2})?\s*₽$/u.exec(text?.nodeValue??"");
          if(!lastGroup)return false;
          const range=document.createRange();
          range.setStart(text,lastGroup.index);range.setEnd(text,text.length);
          return new Set([...range.getClientRects()].map(rect=>rect.top)).size===1;
        }),true,width+"px decimals and currency stay on one line");
        await assertNoHorizontalOverflow(page,panel);
        await tab(panel,"Заказы").click();
        await row(panel,a.id).click();
        await waitView(panel,"order");
        const heading=financeDetail(panel).getByRole("heading",{name:customer,exact:true});
        await heading.waitFor();
        assert.equal(await heading.evaluate(node=>{
          const card=node.closest(".pr-detail-card").getBoundingClientRect();
          const range=document.createRange();range.selectNodeContents(node);
          return [...range.getClientRects()].every(rect=>rect.left>=card.left&&rect.right<=card.right);
        }),true,width+"px order name stays inside its card");
        const expenseAmount=panel.locator(".pr-detail-line").filter({hasText:expenseNote}).locator("dd");
        assert.equal(number(await expenseAmount.innerText()),9999999.99);
        assert.equal(await expenseAmount.evaluate(node=>{
          const range=document.createRange();range.selectNodeContents(node);
          return new Set([...range.getClientRects()].map(rect=>rect.top)).size===1;
        }),true,width+"px long expense label leaves room for its amount");
        const details=panel.locator(".pr-order-meta summary");
        assert.ok((await details.boundingBox()).height>=44,"Order details have a full touch target");
        await details.focus();
        await details.press("Enter");
        assert.equal(await panel.locator(".pr-order-meta[open]").count(),1);
        assert.equal(await page.locator("#appScreen").evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,
          width+"px detail view does not add horizontal scrolling");
        if(height<width){
          await headerBack(page).click();
          await panel.locator(".pr-filter-button").click();
          await waitView(panel,"filters");
          const apply=panel.getByRole("button",{name:"Применить",exact:true});
          assert.equal(await apply.evaluate(node=>{
            const action=node.getBoundingClientRect();
            const scroll=document.getElementById("appScreen").getBoundingClientRect();
            return action.top>=scroll.top&&action.bottom<=scroll.bottom&&
              node.contains(document.elementFromPoint(action.x+action.width/2,action.y+action.height/2));
          }),true,"Apply is reachable above the dock without scrolling in landscape");
          await apply.click();
          await waitView(panel,"orders");
        }
      }finally{await f.close()}
    }
  }finally{await browser.close()}
}
async function checkDenseChart(browserType){
  const browser=await launch(browserType);
  try{
    const context=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true,serviceWorkers:"block"});
    await context.route("**/*",route=>route.abort());
    const page=await context.newPage();
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><section id="rdReports"></section>');
    await page.addStyleTag({path:reportCss});
    await page.addScriptTag({path:reportJs});
    await page.evaluate(()=>{
      const orders=Array.from({length:12},(_,index)=>{
        const stamp="2026-"+String(index+1).padStart(2,"0")+"-01T08:00:00Z";
        return {id:"month-"+index,name:"Тестовый заказ",completedAt:stamp,createdAt:stamp,
          price:1000,paid:true,paymentAmount:1000,status:"Выполнен",assignedUserId:"fixture-master"};
      });
      window.__rdCreateProfitReport(document.getElementById("rdReports"),{
        startOpen:true,getOrders:()=>orders,getPayroll:()=>({state:"active",orders:[],accounting:{
          receipts:orders.map(order=>({orderId:order.id,amount:1000,masterId:"fixture-master"}))
        }})
      });
    });
    const panel=report(page);
    await applyFilters(panel,{period:"all"});
    const points=chart(panel);
    assert.equal(await points.count(),12);
    const hits=await points.evaluateAll(buttons=>buttons.map(button=>{
      button.scrollIntoView({block:"center"});
      const {x,y,width,height}=button.getBoundingClientRect();
      const hit=document.elementFromPoint(x+width/2,y+height/2)?.closest(".pr-chart-point");
      return buttons.indexOf(hit);
    }));
    assert.deepEqual(hits,Array.from({length:12},(_,index)=>index),
      "At 320px neighboring monthly markers must not intercept taps at each other's center");
    await points.first().tap();
    assert.equal(await points.first().getAttribute("aria-pressed"),"true");
    await points.nth(1).tap();
    assert.equal(await points.nth(1).getAttribute("aria-pressed"),"true");
    await context.close();
  }finally{await browser.close()}
}
async function checkVersionedReport(browserType){
  const browser=await launch(browserType);
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,
      hasTouch:true,serviceWorkers:"block"});
    await context.route("**/*",route=>route.abort());
    const page=await context.newPage();
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><section id="rdReports"></section>');
    await page.addStyleTag({path:reportCss});
    await page.addScriptTag({path:path.join(__dirname,"..","order-model.js")});
    await page.addScriptTag({path:path.join(__dirname,"..","finance-model.js")});
    await page.addScriptTag({path:reportJs});
    await page.evaluate(()=>{
      const stamp=new Date().toISOString();
      const defaults={status:"Выполнен",master:"Рауль",assignedUserId:"raul",paid:true,
        price:10000,paymentAmount:10000,completedAt:stamp,createdAt:stamp};
      const orders=[
        {...defaults,id:"earned",referenceCode:"№00001",name:"Полная оплата",price:16000,paymentAmount:null},
        {...defaults,id:"partial",referenceCode:"№00002",name:"Частичная оплата",paymentAmount:5000},
        {...defaults,id:"refunded",referenceCode:"№00003",name:"Возврат",status:"Отменён"},
        {...defaults,id:"payroll-hold",referenceCode:"№00004",name:"Проверка начисления"},
        {...defaults,id:"cash-hold",name:"Проверка передачи",price:20000,paymentAmount:null}
      ];
      const payroll={state:"active",version:3,masterId:"raul",earned:21000,paid:5000,due:16000,
        accounting:{receipts:[["earned",16000],["refunded",10000],["payroll-hold",10000],["cash-hold",20000]]
          .map(([orderId,amount])=>({orderId,amount,masterId:"raul"}))},
        orders:[
          {orderId:"earned",actualPaid:16000,earned:9500,companyShare:6500,ruleVersion:"v3-50pct-plus-1500"},
          {orderId:"cash-hold",actualPaid:20000,earned:11500,companyShare:8500,ruleVersion:"legacy_verified"}
        ],
        refunds:[{orderId:"refunded",amount:10000,occurredAt:stamp}],
        holds:[
          {orderId:"payroll-hold",orderNumber:"4",payrollOnHold:true,cashOnHold:false,reason:"Находится подтверждение выплаты"},
          {orderId:"cash-hold",orderNumber:"315",payrollOnHold:false,cashOnHold:true,paymentAmount:20000,
            reason:"Не подтверждён остаток у мастера"}
        ]};
      window.__rdCreateProfitReport(document.getElementById("rdReports"),{
        startOpen:true,getOrders:()=>orders,getRaulMasterId:()=>"raul",getPayroll:()=>payroll,
        getFinanceStatus:()=>({ready:true,revision:1})
      });
    });
    const panel=report(page);
    await waitView(panel,"overview");
    assert.equal(number(await metric(panel,"count").innerText()),5);
    assert.match(await panel.locator(".pr-paid-count").innerText(),/3\s*оплачен/i);
    const amounts=await Promise.all(["revenue","salary","profit"].map(key=>metric(panel,key).innerText()));
    assert.deepEqual(amounts.map(number),[46000,21000,15000]);
    await tab(panel,"Заказы").click();
    const byOrder=(id)=>row(panel,id);
    assert.match(await byOrder("earned").innerText(),/6[\s\u00a0\u202f]*500/);
    assert.match(await byOrder("partial").innerText(),/На сверке/i);
    assert.match(await byOrder("refunded").innerText(),/Возврат/);
    assert.match(await byOrder("cash-hold").innerText(),/№00315/);
    const back=panel.locator(".pr-back");
    for(const [id,reasons] of [
      ["earned",[/16\s*000/,/9\s*500/,/6\s*500/]],
      ["payroll-hold",[/10\s*000/,/Находится подтверждение выплаты/,/на сверке/i]],
      ["cash-hold",[/20\s*000/,/11\s*500/,/8\s*500/,/Не подтверждён остаток у мастера/]],
      ["refunded",[/Возврат/,/10\s*000/]]
    ]){
      await byOrder(id).click();
      await waitView(panel,"order");
      const details=rounded(await financeDetail(panel).innerText());
      for(const reason of reasons)assert.match(details,reason,id);
      await back.click();
      await waitView(panel,"orders");
    }
    await applyFilters(panel,{status:"paid"});
    assert.equal(await byOrder("refunded").count(),0,"A refunded order is excluded from paid orders");
    await context.close();
  }finally{await browser.close()}
}
(async()=>{
  const engines=process.env.TEST_BROWSER==="chromium"?[[chromium,"chromium"]]:
    process.env.TEST_BROWSER==="webkit"?[[webkit,"webkit"]]:[[chromium,"chromium"],[webkit,"webkit"]];
  for(const [engine,name] of engines){
    await ownerDashboard(engine,name);
    await checkHostReportRecovery(engine);
    await checkReportRefreshAndDates(engine);
    await checkDenseChart(engine);
    await checkContentWrapping(engine);
    await checkRaulPortal(engine,"Рауль",true);
    await checkRaulPortal(engine,"Олег",false);
    await checkVersionedReport(engine);
  }
  await checkOwnerPayroll(chromium,false);
  await checkOwnerPayroll(webkit,true);
  process.stdout.write("Reports browser checks passed: orders, owner salary, Raul permissions, versioned holds, refunds and profit\n");
})().catch(err=>{console.error(err);process.exitCode=1});
