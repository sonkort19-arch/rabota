"use strict";

// Cold mobile startup against the actual app. All HTTP traffic stays in this fixture.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {promise, release};
}

async function session(browser, {role = "master", active = true, delayModule = false, view = "", abortFirstAccess = false} = {}) {
  const context = await browser.newContext({
    viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true,
    timezoneId: "Europe/Moscow", serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const master = {user_id: "fixture-raul", master_name: "Рауль", role: "master", active: true};
  const member = role === "master" ? master : {user_id: "fixture-" + role, role, active};
  const day = new Intl.DateTimeFormat("sv-SE", {timeZone: "Europe/Moscow"}).format(new Date());
  const order = {
    id: "fixture-appointment", name: "Тестовый выезд", status: "Записан",
    assigned_user_id: master.user_id, master: master.master_name, price: 10000,
    appointment_date: day, appointment_time: "12:00:00", created_at: day + "T05:00:00Z",
  };
  const paidAt = day + "T06:00:00Z";
  const paid = {...order,id:"fixture-paid",name:"Тестовая оплата",price:10000,status:"Выполнен",
    paid:true,payment_amount:10000,payment_method:"cash",paid_at:paidAt,completed_at:paidAt};
  const payroll = {
    version:3,accounting_version:1,state:"active",master_id:master.user_id,activated_at:paidAt,
    earned:6500,paid:0,due:6500,payouts:[],refunds:[],holds:[],
    orders:[{order_id:paid.id,paid_amount:10000,earned_amount:6500,company_share:3500,
      earned_at:paidAt,rule_version:3}],
    accounting_receipts:[{order_id:paid.id,master_id:master.user_id,amount:10000,
      payment_method:"cash",paid_at:paidAt,occurred_at:paidAt}]
  };
  if(role==="owner")payroll.accounting_payouts=[];
  const finance = gate(), notices = gate(), module = gate(), moduleRequested = gate();
  const requests = [], writes = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(() => {
    if (sessionStorage.getItem("fixture-opened")) return;
    if (!localStorage.getItem("rabota-auth-session-v1")) {
      localStorage.setItem("rabota-auth-session-v1",
        JSON.stringify({access_token:"fixture",refresh_token:"fixture",expires_at:4102444800}));
    }
    sessionStorage.setItem("fixture-opened","1");
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "crm.test") {
      if (url.pathname === "/session-observer")
        return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Session observer</title>"});
      const file = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
        return route.fulfill({status: 404, body: ""});
      if (delayModule && url.pathname === "/money-workspace.js") {
        moduleRequested.release();
        await module.promise;
      }
      return route.fulfill({path: file});
    }
    const endpoint = url.pathname.split("/").pop();
    requests.push(endpoint);
    if (endpoint === "user" && abortFirstAccess) {
      abortFirstAccess = false;
      return route.abort("internetdisconnected");
    }
    if (request.method() !== "GET") { writes.push(endpoint); return route.abort(); }
    let data = [];
    if (endpoint === "user") data = {id: member.user_id};
    if (endpoint === "rabota_members") data = url.searchParams.has("user_id") ? [member] : [master];
    if (endpoint === "rabota_orders") data = [order, paid];
    if (endpoint === "rabota_finance_operations" && role === "owner") data = [
      {id:"fixture-expense",kind:"expense",amount:100,payment_method:"card",created_at:paidAt,note:"Материалы"},
      {id:"fixture-void",kind:"expense",amount:600,payment_method:"cash",created_at:paidAt,
        voided_at:day+"T07:00:00Z",note:"Отменённая запись"}
    ];
    if (endpoint === "rabota_payroll_snapshot_v3") {
      if(await finance.promise==="error")
        return route.fulfill({status:503,json:{message:"Временная ошибка чтения"}});
      data=payroll;
    }
    if (endpoint === "rabota_order_notifications") await notices.promise;
    return route.fulfill({json: data});
  });
  await page.goto("https://crm.test/" + (view ? "?view=" + view : ""), {waitUntil: "commit"});
  async function close() {
    finance.release(); notices.release(); module.release();
    await context.close();
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  }
  return {page, context, finance, notices, module, moduleRequested, requests, close};
}

async function masterStartup(browser, failFinance) {
  const s = await session(browser);
  try {
    const schedule = s.page.locator("#orders .master-schedule-card").filter({hasText: "Тестовый выезд"});
    await schedule.waitFor();
    await s.page.locator('#mwMasterNav [data-mw-page="payments"]').click();
    const payments = s.page.locator("#mwMasterPayments");
    assert.match(await payments.innerText(), /загруз|загруж|получаем|обновляем/i);
    const receipt = payments.locator('[data-order-id="fixture-paid"][data-payment-type="receipt"]');
    assert.equal(await receipt.count(), 0);

    const reports = s.page.locator("#mwMasterReports");
    await s.page.locator('#mwMasterNav [data-mw-page="reports"]').click();
    await reports.getByRole("button",{name:/зарплата/i}).click();
    const salary = reports.locator(".fp-master-payroll");
    await salary.getByText(/загружаем данные зарплаты/i).waitFor();
    await s.page.locator('#mwMasterNav [data-mw-page="payments"]').click();

    s.finance.release(failFinance ? "error" : "ok");
    if (failFinance) {
      const alert = payments.getByRole("alert");
      await alert.first().waitFor();
      assert.match(await alert.first().innerText(), /ошибк|не удал|недоступ/i);
      assert.equal(await receipt.count(), 0);
    } else {
      await receipt.waitFor();
      assert.match(await receipt.innerText(), /10\s?000\s*₽/);
    }
    assert.equal(await payments.getByRole("button",{name:/передач/i}).count(),0);
    await s.page.locator('#mwMasterNav [data-mw-page="reports"]').click();
    if(failFinance)await salary.getByRole("alert").waitFor();
    else {
      await salary.locator(".fp-balance-value").waitFor();
      assert.match(await salary.locator(".fp-balance-value").innerText(),/6\s?500(?:,00)?\s*₽/);
    }
    assert.equal(await salary.locator(".fp-v3-actions").count(),0);
    s.notices.release();
    await s.page.locator('#mwMasterNav [data-mw-page="orders"]').click();
    assert.equal(await s.page.locator('#owViewSwitch [data-ow-mode="calendar"]').getAttribute("aria-selected"), "true");
    await schedule.waitFor();
  } finally { await s.close(); }
}

async function ownerFinance(browser) {
  const s = await session(browser, {role: "owner", view: "finance"});
  try {
    const panel = s.page.locator("#financePanel");
    await panel.waitFor();
    await panel.getByText(/загруз|загруж|получаем/i).first().waitFor();
    assert.equal(await s.page.locator("#mwMasterNav:visible").count(), 0);
    s.finance.release(); s.notices.release();
    await panel.locator('[data-order-id="fixture-paid"][data-kind="receipt"]').waitFor();
    const voided = panel.locator('[data-kind="expense"][data-status="voided"]');
    assert.match(await voided.innerText(), /Отменён/);
    const expenseTotal = panel.locator(".mw-money-stat").filter({hasText:"Расходы"});
    assert.match(await expenseTotal.innerText(), /100,00\s*₽/);
  } finally { await s.close(); }
}

async function lateModule(browser) {
  const s = await session(browser, {delayModule: true});
  try {
    s.finance.release(); s.notices.release();
    await s.moduleRequested.promise;
    // The cached session/API can finish while a rendering module is still downloading.
    // Complete the download only after the parser reaches that module.
    await s.page.waitForFunction(() => typeof window.__rdAccess === "function");
    if (s.requests.includes("user")) {
      await s.page.locator("#orders .master-schedule-card").first().waitFor({state: "attached"});
      await s.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    s.module.release();
    await s.page.locator('#mwMasterNav [data-mw-page="payments"]').click();
    await s.page.locator('#mwMasterPayments [data-order-id="fixture-paid"][data-payment-type="receipt"]').waitFor();
    assert.equal(await s.page.locator("#mwMasterNav").count(), 1);
    assert.equal(await s.page.locator('#mwMasterNav [data-mw-page="payments"]').count(), 1);
  } finally { await s.close(); }
}

async function accessBoundaries(browser) {
  for (const active of [false, true]) {
    const s = await session(browser, {role: "manager", active});
    try {
      const screen = s.page.locator(active ? "#appScreen" : "#accessScreen");
      await screen.waitFor();
      assert.equal(await s.page.locator("#mwMasterNav:visible").count(), 0);
      assert.equal(s.requests.includes("rabota_finance_operations"), false);
      assert.equal(s.requests.includes("rabota_order_notifications"), false);
      assert.equal(s.requests.includes("rabota_orders"), active);
    } finally { await s.close(); }
  }
}

async function reconnectAndSignOutAcrossTabs(browser) {
  const s = await session(browser,{role:"owner",view:"expenses",abortFirstAccess:true});
  try {
    await s.page.locator("#resumeSession").waitFor();
    await s.page.locator("#resumeSession").click();
    await s.page.locator("#exMain").waitFor();
    assert.equal(s.requests.filter(endpoint=>endpoint==="user").length,2);
    const settings=s.page.locator("#rdMobileMoreSheet [data-page=settings]");
    await s.page.locator("#rdMobileMoreBtn").click();
    await settings.click();
    await s.page.locator("#teamMembers").getByText("Рауль",{exact:true}).waitFor();
    const tab = await s.context.newPage();
    await tab.goto("https://crm.test/session-observer");
    await tab.evaluate(()=>localStorage.removeItem("rabota-auth-session-v1"));
    await s.page.locator("#loginScreen").waitFor();
    assert.equal(await s.page.locator("#appScreen").isVisible(),false);
    assert.equal(await s.page.locator("#rdMobileNav").isVisible(),false);
    assert.equal(await s.page.locator("#teamMembers").innerText(),"");
  }finally {await s.close();}
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox"]});
  try {
    await masterStartup(browser, false);
    await masterStartup(browser, true);
    await ownerFinance(browser);
    await lateModule(browser);
    await accessBoundaries(browser);
    await reconnectAndSignOutAcrossTabs(browser);
    console.log("Passed mobile startup, pending finance, delayed module and access checks");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
