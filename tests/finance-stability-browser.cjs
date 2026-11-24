/* Payment, cashbook and payroll regressions against the real CRM with isolated REST fixtures. */
"use strict";
const assert=require("node:assert/strict");
const {existsSync}=require("node:fs");
const path=require("node:path");
const {chromium,webkit,devices}=require("playwright");
const {mockLegacyPayrollSnapshot}=require("./fixtures/legacy-payroll.cjs");

const root=path.resolve(__dirname,"..");
const origin="https://finance.test";
const stamp=new Date().toISOString();
const day=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const owner={user_id:"owner-fixture",role:"owner",active:true};
const master={user_id:"master-fixture",role:"master",master_name:"Рауль",active:true};
const manager={user_id:"manager-fixture",role:"manager",active:true};
const otherMaster={user_id:"other-master-fixture",role:"master",master_name:"Олег",active:true};
const payrollSnapshotRpc="rabota_payroll_snapshot_v3";
const payrollPayoutRpc="rabota_payroll_payout_v3";
const paidOrderValue=8001.01;
const salaryEarned=5500.51;
const priorPayout=700.5;
const amountDue=4800.01;
const refundedAmount=3200;
const reversedEarnings=3100;
const masterCardPayment=3456.78;
const round=value=>Math.round(value*100)/100;
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
async function fixture(browser,{source=root,latency=0,role="owner",width=390,payrollV3=false}={}){
  const device=devices["iPhone 13"];
  const context=await browser.newContext({
    ...device,viewport:{...device.viewport,width},screen:{...device.screen,width},
    timezoneId:"Europe/Moscow",serviceWorkers:"block"
  });
  const page=await context.newPage();
  page.setDefaultTimeout(7000);
  const member={owner,master,manager,"other-master":otherMaster}[role];
  const state={rows:rows.slice(),holds:new Map(),fail:new Set(),denied:new Set(),
    lostPayoutResponse:false,collections:[]};
  const payoutReceipts=new Map();
  const payroll={
    version:3,state:"active",master_id:master.user_id,activated_at:stamp,
    earned:salaryEarned,paid:priorPayout,due:amountDue,
    orders:[{
      order_id:"direct-order",paid_amount:paidOrderValue,earned_amount:salaryEarned,
      company_share:round(paidOrderValue-salaryEarned),earned_at:stamp,rule_version:3
    }],
    refunds:[{order_id:"refunded-order",amount:refundedAmount,refunded_at:stamp,
      earned_reversed:reversedEarnings,earned_at:stamp}],
    payouts:[{id:"existing-payout",order_id:null,amount:priorPayout,payment_method:"card",
      note:"Первая тестовая выплата",created_at:stamp,kind:"raul_payout"}],
    holds:role==="owner"?[{order_id:"historical-hold",order_number:104,payroll_on_hold:true,cash_on_hold:true,
      reason:"Проверить старую выплату и местонахождение наличных",earned_amount:9000,credited_amount:4000,
      linked_recorded_amount:4000,payment_amount:15000}]:[]
  };
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
    if(resource===payrollSnapshotRpc&&payrollV3){
      assert.equal(request.method(),"GET");
      return route.fulfill({json:role==="owner"||role==="master" ? payroll :
        {version:3,state:"not_applicable",activated_at:stamp}});
    }
    if(request.method()!=="GET"){
      const data=request.postDataJSON();
      writes.push({resource,data});
      if(resource===payrollPayoutRpc&&payrollV3){
        assert.equal(request.method(),"POST");
        assert.equal(role,"owner");
        assert.equal(data.p_master_user_id,master.user_id);
        assert.match(data.p_request_id,/^[\da-f]{8}-[\da-f-]{27}$/i);
        assert.ok(["card","cash"].includes(data.p_payment_method));
        const previous=payoutReceipts.get(data.p_request_id);
        if(previous){
          assert.deepEqual(data,previous.data,"The replay must use the original payout payload");
          return route.fulfill({json:{...previous.result,replayed:true}});
        }
        assert.ok(data.p_amount>0&&data.p_amount<=payroll.due);
        payroll.paid=round(payroll.paid+data.p_amount);
        payroll.due=round(payroll.earned-payroll.paid);
        const id="salary-payout-"+payoutReceipts.size;
        const result={id,amount:data.p_amount,earned:payroll.earned,paid:payroll.paid,due:payroll.due,replayed:false};
        payoutReceipts.set(data.p_request_id,{data,result});
        payroll.payouts.push({id,order_id:null,amount:data.p_amount,payment_method:data.p_payment_method,
          note:data.p_note,created_at:stamp,kind:"raul_payout"});
        if(state.lostPayoutResponse){
          state.lostPayoutResponse=false;
          return route.abort("connectionreset");
        }
        return route.fulfill({json:result});
      }
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
    if(resource==="rabota_orders")json=payrollV3 ? [
      {...orders[0],price:paidOrderValue,payment_amount:paidOrderValue},
      {...orders[1],name:"Незавершённый оплаченный заказ",status:"Записан"},
      {...orders[1],id:"master-card-order",order_number:104,name:"Оплата на карту мастера",
        status:"Записан",payment_method:"card",price:masterCardPayment,payment_amount:masterCardPayment},
      {...orders[0],id:"refunded-order",order_number:103,name:"Заказ с возвратом",
        price:refundedAmount,payment_amount:refundedAmount}
    ] : orders;
    if(resource==="rabota_finance_operations")json=payrollV3 ? [] : ops;
    if(resource==="rabota_cash_collections")json=[{
      order_id:"transfer-order",master_user_id:master.user_id,company_amount:4000,confirmed_at:stamp
    }];
    if(resource==="rabota_cash_collections"&&payrollV3)json=state.collections;
    if(resource==="rabota_cashbook_entries")json=state.rows;
    return route.fulfill({json});
  });
  if(!payrollV3)await mockLegacyPayrollSnapshot(context);
  async function close(){
    for(const value of state.holds.values())value.release();
    await context.close();
    assert.deepEqual(errors,[]);
  }
  return {page,state,calls,writes,payoutReceipts,close};
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

const v3Report=page=>page.locator(".fp-v3-payroll");
const formatMoney=value=>value.toFixed(2).replace(".",",")+"₽";
const cleanMoney=value=>value.replace(/\s/g,"");
async function salaryValues(report,paid,due){
  assert.equal(cleanMoney(await report.locator(".fp-balance-value").innerText()),formatMoney(due));
  const sums=await report.locator(".fp-person-summary-item strong").allTextContents();
  assert.deepEqual(sums.map(cleanMoney),[formatMoney(salaryEarned),formatMoney(paid)]);
}
async function assertPhoneFit(node){
  const layout=await node.evaluate(el=>{
    const {left,right}=el.getBoundingClientRect();
    return {left,right,width:el.clientWidth,scroll:el.scrollWidth,viewport:window.innerWidth};
  });
  assert.ok(layout.left>=-1&&layout.right<=layout.viewport+1&&layout.scroll<=layout.width+1,JSON.stringify(layout));
}
async function openOwnerPayroll(page){
  await page.locator("#rdReports .rd-salary-entry").click();
  await v3Report(page).waitFor();
  return v3Report(page);
}
async function assertAccrual(report){
  const accrual=report.locator(".fp-ledger-row");
  await accrual.waitFor();
  assert.equal(await accrual.count(),1);
  const text=await accrual.innerText();
  assert.match(text,/Прямой платёж/);
  assert.ok(cleanMoney(text).includes(formatMoney(paidOrderValue)));
  assert.ok(cleanMoney(text).includes("+"+formatMoney(salaryEarned)));
  assert.doesNotMatch(await report.innerText(),/Тимур|Незавершённый оплаченный заказ|Заказ с возвратом|Оплата на карту мастера/);
}
async function assertRefunds(report){
  await report.getByRole("button",{name:"Возвраты",exact:true}).click();
  const refund=report.locator(".fp-ledger-row");
  await refund.waitFor();
  const text=await refund.innerText();
  assert.match(text,/Заказ с возвратом/);
  assert.ok(cleanMoney(text).includes("Возвращеноклиенту"+formatMoney(refundedAmount)));
  assert.ok(cleanMoney(text).includes("−"+formatMoney(reversedEarnings)));
  await report.getByRole("button",{name:"Начисления",exact:true}).click();
}
async function v3Revalidation(f,report){
  const {page,calls,state}=f;
  const read=gate();state.holds.set(payrollSnapshotRpc,read);
  const before=count(calls,payrollSnapshotRpc);
  const panel=await report.elementHandle();
  try{
    await page.evaluate(()=>void window.__rdMoneyUi.reloadPayroll());
    await waitCall(calls,payrollSnapshotRpc,before+1);
    assert.equal(await report.evaluate((node,prior)=>node===prior,panel),true);
    await salaryValues(report,priorPayout,amountDue);
    state.fail.add(payrollSnapshotRpc);
    state.holds.delete(payrollSnapshotRpc);read.release();
    await page.getByText(/Показаны последние расчёты зарплаты/).waitFor();
    assert.equal(await report.getByRole("button",{name:"Выплатить всё"}).isDisabled(),true);
    assert.equal(await page.locator(".fp-person-row").count(),0,"503 must not switch to old payroll");
    await page.locator("#rdSalaryReport .fp-retry").click();
    await page.waitForFunction(()=>document.querySelector(".fp-v3-balance .fp-balance-payout:enabled"));
    await salaryValues(report,priorPayout,amountDue);
  }finally{read.release();await panel.dispose();}
}
async function v3Owner(browser,width){
  const f=await fixture(browser,{width,payrollV3:true});
  const {page,state,writes,payoutReceipts}=f;
  const partial=1234.56,paid=1935.06,left=3565.45;
  const interrupted=width===390;
  try{
    await page.goto(origin+"/?view=reports");
    const report=await openOwnerPayroll(page);
    await assertPhoneFit(report);
    await salaryValues(report,priorPayout,amountDue);
    await assertAccrual(report);
    await report.getByText(/На сверке · 1/).click();
    const review=report.locator(".fp-cutover-review");
    await review.getByText("№00104",{exact:true}).waitFor();
    assert.match(await review.innerText(),/сумма наличных к передаче уточняется/);
    await assertPhoneFit(review);
    await report.getByText(/На сверке · 1/).click();
    if(interrupted){
      await assertRefunds(report);
      await v3Revalidation(f,report);
    }
    await report.getByRole("button",{name:"Частичная выплата",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Выплата — Рауль"});
    const amount=dialog.getByRole("textbox",{name:"Сумма выплаты в рублях"});
    const save=dialog.getByRole("button",{name:"Подтвердить выплату"});
    await assertPhoneFit(dialog);
    await amount.fill("5 000,00");
    await dialog.getByText("Сумма больше остатка",{exact:true}).waitFor();
    assert.equal(await save.isDisabled(),true);
    assert.deepEqual(writes,[]);
    await amount.fill("1 234,56");
    await dialog.getByLabel("Способ выплаты").selectOption("card");
    await dialog.getByLabel("Комментарий").fill("Частичная тестовая выплата");
    state.lostPayoutResponse=interrupted;
    await save.click();
    if(interrupted){
      await dialog.getByRole("button",{name:"Повторить отправку"}).waitFor();
      assert.equal(await amount.isDisabled(),true);
      assert.equal(writes.length,1,"A network interruption does not send an automatic repeat");
      await page.reload();
      await openOwnerPayroll(page);
      await report.getByRole("button",{name:"Продолжить выплату"}).click();
      await dialog.getByRole("button",{name:"Повторить отправку"}).click();
    }
    const receipt=page.getByRole("dialog",{name:"Выплата проведена"});
    await receipt.waitFor();
    assert.ok(cleanMoney(await receipt.innerText()).includes(formatMoney(left)));
    await receipt.getByRole("button",{name:"Закрыть",exact:true}).click();
    await page.waitForFunction(expected=>document.querySelector(".fp-v3-balance .fp-balance-value")
      ?.textContent.replace(/\s/g,"")===expected,formatMoney(left));
    await salaryValues(report,paid,left);
    assert.equal(payoutReceipts.size,1);
    assert.equal(writes[0].data.p_amount,partial);
    assert.equal(writes[0].data.p_payment_method,"card");
    await report.getByRole("button",{name:"Выплаты",exact:true}).click();
    await report.getByText("Частичная тестовая выплата",{exact:true}).waitFor();
    assert.equal(await report.locator(".fp-ledger-row").count(),2);
    await report.getByRole("button",{name:"Выплатить всё",exact:true}).click();
    assert.equal(await amount.inputValue(),"3565,45");
    await save.click();
    await receipt.waitFor();
    assert.ok(cleanMoney(await receipt.innerText()).includes(formatMoney(0)));
    await receipt.getByRole("button",{name:"Закрыть",exact:true}).click();
    await page.waitForFunction(expected=>document.querySelector(".fp-v3-balance .fp-balance-value")
      ?.textContent.replace(/\s/g,"")===expected,formatMoney(0));
    await salaryValues(report,salaryEarned,0);
    assert.equal(await report.getByRole("button",{name:"Выплатить всё",exact:true}).isDisabled(),true);
    assert.equal(writes.length,interrupted?3:2);
    assert.equal(payoutReceipts.size,2);
    assert.equal(writes.at(-1).data.p_amount,left);
    assert.equal(writes.at(-1).data.p_payment_method,"cash");
    assert.notEqual(writes[0].data.p_request_id,writes.at(-1).data.p_request_id);
    assert.ok(writes.every(write=>write.resource===payrollPayoutRpc));
    if(interrupted){
      state.denied.add(payrollSnapshotRpc);
      await page.evaluate(()=>void window.__rdMoneyUi.reloadPayroll());
      await page.getByText(/Финансовые данные недоступны/).waitFor();
      assert.equal(await report.isVisible(),false,"Permission denial removes previously visible payroll");
      assert.equal(await page.locator(".fp-person-row").count(),0,"403 is not a legacy fallback");
    }
  }finally{await f.close();}
}
async function v3Master(browser,width){
  const f=await fixture(browser,{width,role:"master",payrollV3:true});
  const {page,state,writes}=f;
  if(width===390)state.collections=[{
    order_id:"transfer-order",master_user_id:master.user_id,
    company_amount:600,submitted_amount:200,confirmed_amount:50
  }];
  try{
    await page.goto(origin);
    const nav=page.locator("#mwMasterNav");
    await nav.locator('[data-mw-page="reports"]').click();
    await page.locator("#mwMasterReports").getByRole("button",{name:/Зарплата/i}).click();
    const report=v3Report(page);
    await report.waitFor();
    await salaryValues(report,priorPayout,amountDue);
    await assertPhoneFit(report);
    await assertAccrual(report);
    assert.equal(await report.locator(".fp-v3-actions").count(),0);
    await report.getByRole("button",{name:"Выплаты",exact:true}).click();
    await report.getByText("Первая тестовая выплата",{exact:true}).waitFor();
    await nav.locator('[data-mw-page="payments"]').click();
    const payments=page.locator("#mwMasterPayments");
    await payments.waitFor();
    const card=payments.locator(".mw-money-stat").filter({hasText:"Принято на карту мастера по журналу"});
    await card.waitFor();
    assert.equal(cleanMoney(await card.locator("strong").innerText()),formatMoney(masterCardPayment));
    const handoff=payments.locator(".mw-handoff-card");
    if(state.collections.length)await handoff.waitFor();
    else assert.equal(await handoff.isVisible(),false);
    assert.deepEqual(writes,[]);
  }finally{await f.close();}
}
async function v3Manager(browser,width){
  const f=await fixture(browser,{width,role:"manager",payrollV3:true});
  try{
    await f.page.goto(origin+"/?view=reports");
    await f.page.locator("#ordersArea").waitFor();
    assert.equal(await v3Report(f.page).count(),0);
    assert.equal(await f.page.locator('#rdMobileNav [data-page="reports"]').count(),0);
    assert.equal(await f.page.locator('#rdMobileMoreSheet [data-page="reports"]').count(),0);
    assert.deepEqual(f.writes,[]);
  }finally{await f.close();}
}
async function v3OtherMaster(browser){
  const f=await fixture(browser,{role:"other-master",payrollV3:true});
  try{
    await f.page.goto(origin);
    await f.page.locator('#mwMasterNav [data-mw-page="reports"]').click();
    await waitCall(f.calls,payrollSnapshotRpc,1);
    await f.page.waitForLoadState("networkidle");
    const salaryEntry=f.page.locator("#mwMasterReports").getByRole("button",{name:/Зарплата/i});
    if(await salaryEntry.isVisible())await salaryEntry.click();
    assert.equal(await v3Report(f.page).isVisible(),false,"another master cannot open Raul's payroll");
    assert.deepEqual(f.writes,[]);
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
    for(const width of [320,375,390,430]){
      await v3Owner(browser,width);await v3Master(browser,width);await v3Manager(browser,width);
      console.log("PASS",name,width,"payroll v3 owner, master and manager");
    }
    await v3OtherMaster(browser);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
