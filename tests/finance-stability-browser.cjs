/* Payment, cashbook and payroll regressions against the real CRM with isolated REST fixtures. */
"use strict";
const assert=require("node:assert/strict");
const {existsSync}=require("node:fs");
const path=require("node:path");
const {chromium,webkit,devices}=require("playwright");

const root=path.resolve(__dirname,"..");
const origin="https://finance.test";
const stamp=new Date().toISOString();
const day=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const owner={user_id:"owner-fixture",role:"owner",active:true};
const master={user_id:"master-fixture",role:"master",master_name:"Рауль",active:true};
const rows=[
  {id:"incoming",kind:"income",amount:1000,to_account:"card",created_at:stamp,note:"Прочий доход"},
  {id:"transfer",kind:"transfer",amount:250,from_account:"card",to_account:"cash",created_at:stamp,note:"Снятие с карты"}
];
const ops=[
  {id:"expense-card",kind:"expense",amount:500,payment_method:"card",created_at:stamp,note:"Материалы"},
  {id:"payout-manual",kind:"raul_payout",master_user_id:master.user_id,amount:1500,payment_method:"cash",created_at:stamp,note:"Ручная выплата"},
  {id:"payout-auto",kind:"raul_payout",master_user_id:master.user_id,order_id:"transfer-order",amount:200,payment_method:"cash",created_at:stamp}
];
const orders=[
  {id:"direct-order",name:"Прямой платёж",payment_received_by:"owner"},
  {id:"transfer-order",name:"Распределённый платёж",payment_received_by:"master"}
].map((order,i)=>({
  ...order,order_number:100+i,paid:true,price:10000,payment_amount:10000,payment_method:"cash",
  status:"Выполнен",paid_at:stamp,created_at:stamp,completed_at:stamp,
  appointment_date:day,appointment_time:"12:00",assigned_user_id:master.user_id,master:"Рауль"
}));
function gate(){
  let release;
  const promise=new Promise(resolve=>{release=resolve;});
  return {promise,release};
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(browser,{source=root,latency=0,role="owner"}={}){
  const context=await browser.newContext({...devices["iPhone 13"],timezoneId:"Europe/Moscow",serviceWorkers:"block"});
  const page=await context.newPage();
  page.setDefaultTimeout(7000);
  const member=role==="owner"?owner:master;
  const state={rows:rows.slice(),holds:new Map(),fail:new Set(),denied:new Set()};
  const calls=[],writes=[],errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await context.addInitScript(()=>{
    localStorage.setItem("rabota-auth-session-v1",JSON.stringify({
      access_token:"finance-fixture",refresh_token:"finance-fixture",expires_at:4102444800
    }));
  });
  await context.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin){
      const asset=state.holds.get(url.pathname);
      if(asset)await asset.promise;
      const file=path.resolve(source,"."+(url.pathname==="/"?"/index.html":url.pathname));
      if(file.startsWith(source+path.sep)&&existsSync(file))return route.fulfill({path:file});
      return route.fulfill({status:404,body:"Missing fixture asset"});
    }
    if(!url.hostname.endsWith(".supabase.co"))return route.abort();
    assert.equal(request.headers().authorization,"Bearer finance-fixture");
    const resource=url.pathname.split("/").pop();
    calls.push(resource);
    if(latency)await delay(latency);
    const pending=state.holds.get(resource);
    if(pending)await pending.promise;
    if(state.denied.delete(resource))return route.fulfill({status:403,json:{message:"Тестовый запрет доступа"}});
    if(state.fail.delete(resource))return route.fulfill({status:503,json:{message:"Тестовый сетевой сбой"}});
    if(request.method()!=="GET"){
      const data=request.postDataJSON();
      writes.push({resource,data});
      assert.equal(resource,"rabota_cashbook_record_v1");
      state.rows=[...state.rows,{
        id:"new-entry",kind:data.p_kind,amount:data.p_amount,
        from_account:data.p_from_account,to_account:data.p_to_account,created_at:stamp,note:data.p_note
      }];
      return route.fulfill({json:true});
    }
    let json=[];
    if(resource==="user")json={id:member.user_id};
    if(resource==="rabota_members")json=url.searchParams.has("user_id")?[member]:[owner,master];
    if(resource==="rabota_orders")json=orders;
    if(resource==="rabota_finance_operations")json=ops;
    if(resource==="rabota_cash_collections")json=[{
      order_id:"transfer-order",master_user_id:master.user_id,company_amount:4000,confirmed_at:stamp
    }];
    if(resource==="rabota_cashbook_entries")json=state.rows;
    return route.fulfill({json});
  });
  async function close(){
    for(const value of state.holds.values())value.release();
    await context.close();
    assert.deepEqual(errors,[]);
  }
  return {page,state,calls,writes,close};
}
const dock=(page,name)=>page.locator('#rdMobileNav [data-page="'+name+'"]');
const count=(calls,name)=>calls.filter(resource=>resource===name).length;
async function waitCall(calls,name,expected){
  const until=Date.now()+7000;
  while(count(calls,name)<expected){
    if(Date.now()>=until)throw Error("Fixture did not request "+name+" "+expected+" times");
    await delay(10);
  }
}
async function benchmark(browser,source){
  const f=await fixture(browser,{source,latency:150});
  const values=[],requests=[];
  try{
    await f.page.goto(origin);
    await dock(f.page,"finance").click();
    await f.page.locator(".mw-money-stats").waitFor();
    await f.page.waitForLoadState("networkidle");
    for(let repeat=0;repeat<4;repeat++){
      await dock(f.page,"orders").click();
      const before=count(f.calls,"rabota_cashbook_entries");
      await f.page.evaluate(()=>{
        const button=document.querySelector('#rdMobileNav [data-page="finance"]');
        button.addEventListener("click",()=>{window.financeEnteredAt=performance.now();},{capture:true,once:true});
      });
      await dock(f.page,"finance").click();
      const elapsed=await f.page.waitForFunction(()=>{
        const data=document.querySelector(".mw-money-stats");
        return data?.getClientRects().length ? performance.now()-window.financeEnteredAt : null;
      });
      values.push(Math.round(await elapsed.jsonValue()));
      await f.page.waitForLoadState("networkidle");
      requests.push(count(f.calls,"rabota_cashbook_entries")-before);
    }
    values.sort((a,b)=>a-b);
    return {medianMs:Math.round((values[1]+values[2])/2),samples:values,cashbookGets:requests};
  }finally{await f.close();}
}
async function ownerCashbook(browser){
  const f=await fixture(browser);
  const {page,state,calls,writes}=f;
  const bookName="rabota_cashbook_entries",financeName="rabota_finance_operations";
  const initial=gate();state.holds.set(bookName,initial);
  try{
    await page.goto(origin+"/?view=finance");
    const tabs=page.locator(".fp-tabs"),data=page.locator(".mw-money-stats");
    await tabs.waitFor();
    await waitCall(calls,bookName,1);
    assert.equal(await data.isVisible(),false);
    await dock(page,"orders").click();
    await dock(page,"finance").click();
    await dock(page,"expenses").click();
    await dock(page,"finance").click();
    assert.equal(count(calls,bookName),1,"Rapid entries share a pending cashbook read");
    state.holds.delete(bookName);initial.release();
    await data.waitFor();
    const amounts=()=>data.locator("strong").allTextContents().then(rows=>rows.map(row=>row.replace(/\s/g,"")));
    assert.deepEqual(await amounts(),["12750,00₽","250,00₽","15000,00₽","2000,00₽"],
      "Only direct receipts and confirmed handoffs enter cash; linked payouts are not subtracted twice");
    await page.evaluate(()=>{
      window.financeTabs=document.querySelector(".fp-tabs");
      window.financeCards=document.querySelector(".mw-money-stats");
      window.financeList=document.querySelector(".mw-owner-history");
    });
    const same=()=>page.evaluate(()=>window.financeTabs===document.querySelector(".fp-tabs")&&
      window.financeCards===document.querySelector(".mw-money-stats")&&
      window.financeList===document.querySelector(".mw-owner-history"));
    const reload=gate();state.holds.set(financeName,reload);
    const financeBefore=count(calls,financeName);
    await page.evaluate(()=>void window.__rdMoneyUi.refreshFinance());
    await waitCall(calls,financeName,financeBefore+1);
    for(let index=0;index<3;index++){
      await dock(page,"orders").click();
      await dock(page,"finance").click();
      assert.equal(await data.isVisible(),true);
      assert.equal(await same(),true,"Ordinary revalidation preserves financial controls and rows");
    }
    state.holds.delete(financeName);reload.release();
    await page.waitForFunction(()=>!window.__rdFinanceStatus().refreshing);
    assert.equal(count(calls,bookName),1,"Warm navigation/finance polling does not reread the ledger");

    state.fail.add(bookName);
    await page.evaluate(()=>void window.__rdMoneyUi.cashbook({force:true}).catch(()=>{}));
    const warning=page.getByText(/Показаны последние загруженные движения кассы/);
    await warning.waitFor();
    assert.equal(await same(),true,"A network error retains the cached displayed figures");
    assert.equal(await page.locator(".mw-owner-create").isDisabled(),true);
    state.rows=[...state.rows,{id:"updated",kind:"income",amount:100,to_account:"cash",created_at:stamp,note:"Добавлено извне"}];
    await page.locator(".mw-finance-retry").click();
    await page.getByText("Добавлено извне",{exact:true}).waitFor();
    assert.equal(await warning.isVisible(),false);
    assert.deepEqual(await amounts(),["12850,00₽","250,00₽","15100,00₽","2000,00₽"]);

    await page.locator(".mw-owner-create").click();
    await page.getByRole("button",{name:"＋ Создать приход",exact:true}).click();
    const modal=page.getByRole("dialog",{name:"Создать приход"});
    await modal.getByLabel("Сумма, ₽").fill("75");
    await modal.getByLabel("Комментарий").fill("Новая тестовая операция");
    const committed=gate();state.holds.set(bookName,committed);
    state.fail.add(bookName);
    await modal.getByRole("button",{name:"Сохранить",exact:true}).click();
    await page.getByText("Операция сохранена.",{exact:true}).waitFor();
    assert.equal(await modal.isVisible(),false,"A confirmed transaction is independent of ledger reread");
    assert.equal(writes.length,1);
    assert.equal(await data.isVisible(),true);
    state.holds.delete(bookName);committed.release();
    await warning.waitFor();
    await page.waitForFunction(()=>!window.__rdMoneyUi.cashbookSnapshot().refreshing);
    await page.locator(".mw-finance-retry").click();
    await page.getByText("Новая тестовая операция",{exact:true}).waitFor();
    assert.equal(writes.length,1,"Retry reloads data and never repeats a committed write");
    assert.deepEqual(await amounts(),["12925,00₽","250,00₽","15175,00₽","2000,00₽"]);
    state.denied.add(bookName);
    await page.evaluate(()=>void window.__rdMoneyUi.cashbook({force:true}).catch(()=>{}));
    await page.getByText(/Не удалось загрузить кассу/).waitFor();
    assert.equal(await data.isVisible(),false,"An explicit access denial clears the old ledger");
  }finally{await f.close();}
}
async function latePaymentScripts(browser){
  const f=await fixture(browser);
  const payroll=gate(),money=gate();
  f.state.holds.set("/finance-payroll.js",payroll);
  f.state.holds.set("/money-workspace.js",money);
  try{
    await f.page.goto(origin+"/?view=finance",{waitUntil:"commit"});
    await f.page.waitForFunction(()=>window.__rdFinanceStatus?.().ready===true);
    assert.equal(await f.page.locator(".fp-tabs").count(),0);
    payroll.release();
    await f.page.locator(".fp-tabs").waitFor();
    assert.equal(await f.page.locator(".mw-money-stats").count(),0);
    money.release();
    await f.page.locator(".mw-money-stats").waitFor();
    assert.equal(count(f.calls,"rabota_cashbook_entries"),1);
  }finally{await f.close();}
}
async function ownerReports(browser){
  const f=await fixture(browser);
  try{
    const {page,state}=f;
    await page.goto(origin+"/?view=reports");
    await page.locator("#rdReports .pr-menu .pr-report-link").filter({hasText:"Прибыль по заказам"}).click();
    const table=page.locator(".pr-table");
    await table.waitFor();
    await page.locator(".pr-row-open").first().click();
    await page.evaluate(()=>{window.initialTotal=document.querySelector(".pr-total-row");});
    state.fail.add("rabota_finance_operations");
    await page.evaluate(()=>void window.__rdMoneyUi.refreshFinance());
    await page.getByText(/Показан последний рассчитанный отчёт/).waitFor();
    assert.equal(await table.isVisible(),true);
    assert.equal(await page.locator(".pr-export").isDisabled(),true);
    assert.equal(await page.locator(".pr-expanded:not([hidden])").count(),1);
    assert.equal(await page.evaluate(()=>window.initialTotal===document.querySelector(".pr-total-row")),true);
    await page.locator(".pr-retry").click();
    await page.waitForFunction(()=>!document.querySelector(".pr-export").disabled);
    await page.getByRole("button",{name:"Вернуться ко всем отчётам"}).click();
    await page.locator("#rdReports .rd-salary-entry").click();
    const salaries=page.locator(".fp-person-row");
    await salaries.first().waitFor();
    state.fail.add("rabota_finance_operations");
    await page.evaluate(()=>void window.__rdMoneyUi.refreshFinance());
    await page.getByText(/Показаны последние расчёты зарплаты/).waitFor();
    assert.equal(await salaries.count(),2);
    assert.equal(await salaries.first().locator(".fp-pay").isDisabled(),true);
    await page.locator("#rdSalaryReport .fp-retry").click();
    await page.waitForFunction(()=>!document.querySelector("#rdSalaryReport .fp-pay").disabled);
  }finally{await f.close();}
}

(async()=>{
  const name=process.env.TEST_BROWSER||"chromium",type=name==="webkit"?webkit:chromium;
  const browser=await type.launch({
    executablePath:process.env.TEST_BROWSER_PATH||undefined,
    args:name==="chromium"?["--no-sandbox"]:[]
  });
  try{
    if(process.env.BASELINE_ROOT){
      console.log(name,"baseline",JSON.stringify(await benchmark(browser,path.resolve(process.env.BASELINE_ROOT))));
      console.log(name,"candidate",JSON.stringify(await benchmark(browser,root)));
    }
    await ownerCashbook(browser);await ownerReports(browser);await latePaymentScripts(browser);
    console.log("PASS",name,"stable cashbook, accounting, finance faults, write acknowledgement, payroll and profit");
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
