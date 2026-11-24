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
  const collection = {order_id: "fixture-paid", master_user_id: master.user_id,
    company_amount: 3700, submitted_amount: null, confirmed_amount: null};
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
    if (endpoint === "rabota_orders") data = [order];
    if (endpoint === "rabota_finance_operations" && await finance.promise === "error")
      return route.fulfill({status: 503, json: {message: "Временная ошибка чтения"}});
    if (endpoint === "rabota_cash_collections") data = [collection];
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
    const balance = payments.locator(".mw-handoff-amount");
    if (await balance.count()) assert.doesNotMatch(await balance.innerText(), /\d/);
    assert.equal(await payments.locator(".mw-handoff-action:enabled").count(), 0);

    s.finance.release(failFinance ? "error" : "ok");
    if (failFinance) {
      const alert = payments.getByRole("alert");
      await alert.first().waitFor();
      assert.match(await alert.first().innerText(), /ошибк|не удал|недоступ/i);
      assert.equal(await payments.locator(".mw-handoff-action:enabled").count(), 0);
    } else {
      await payments.getByText(/3\s?700\s*₽/).first().waitFor();
      await payments.locator(".mw-handoff-action:enabled").waitFor();
    }
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
    assert.equal(await panel.locator("button:visible").filter({hasText: /Подтвердить получение/}).count(), 0);
    assert.equal(await s.page.locator("#mwMasterNav:visible").count(), 0);
    s.finance.release(); s.notices.release();
    await panel.locator('[data-finance-tab="cash"]').click();
    await panel.getByText(/3\s?700\s*₽/).first().waitFor();
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
    await s.page.locator("#mwMasterPayments").getByText(/3\s?700\s*₽/).first().waitFor();
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
