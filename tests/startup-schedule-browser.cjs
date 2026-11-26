"use strict";

// Cold mobile startup against the actual app. All HTTP traffic stays in this fixture.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium, webkit, devices } = require("playwright");
const { assertHeaderLayout } = require("./module-navigation-browser.cjs");
const root = path.resolve(__dirname, "..");
const fixtureManagerUuid = "10000000-0000-4000-8000-000000000001";

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {promise, release};
}

async function session(browser, {role = "master", active = true, delayModule = "", view = "", abortFirstAccess = false,
  hangFirstOrders = false, holdLogout = false, hangFirstAccess = "", loginManually = false,
  mode = "safari", width = 390, safeArea = null, failEssentialBundle = false, jwtSubject = ""} = {}) {
  const device = devices["iPhone 13"];
  const inAppUserAgent = device.userAgent.replace(/\sVersion\/[^\s]+|\sSafari\/[^\s]+/g, "") + " Telegram";
  const context = await browser.newContext({
    ...device, viewport: {...device.viewport, width}, screen: {...device.screen, width},
    ...(mode === "embedded" ? {userAgent: inAppUserAgent} : {}),
    timezoneId: "Europe/Moscow", reducedMotion: "reduce", serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const master = {user_id: "fixture-raul", master_name: "Рауль", role: "master", active: role === "master" ? active : true};
  const member = role === "master" ? master : {user_id: jwtSubject ? fixtureManagerUuid : "fixture-" + role, role, active};
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
  const ordersGate=gate(),logoutGate=gate(),logoutRequested=gate(),accessGate=gate(),accessSettled=gate();
  const firstOrdersRequested = gate(), controlledReads = new Set(), verifiedUser = gate();
  const requests = [], writes = [], errors = [], documents = [];
  const accessRequests=[];
  let heldAccess=false, heldModule=false, failedBundle=false, nextOrderRead=null;
  page.on("pageerror", error => errors.push(error.message));
  const token = jwtSubject ? "fixture." + Buffer.from(JSON.stringify({sub: jwtSubject, session_id: "fixture-id"})).toString("base64url") + ".fixture" : "fixture";
  await context.addInitScript(({loginManually,expired,mode,token}) => {
    window.fixtureDocument = crypto.randomUUID();
    if (mode === "standalone") {
      Object.defineProperty(navigator, "standalone", {value: true});
      const match = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const result = match(query);
        if (query === "(display-mode: standalone)") Object.defineProperty(result, "matches", {value: true});
        return result;
      };
    }
    if(loginManually)return;
    if (sessionStorage.getItem("fixture-opened")) return;
    if (!localStorage.getItem("rabota-auth-session-v1")) {
      localStorage.setItem("rabota-auth-session-v1",
        JSON.stringify({access_token:token,refresh_token:"fixture",expires_at:expired?1:4102444800}));
    }
    sessionStorage.setItem("fixture-opened","1");
  },{loginManually,expired:hangFirstAccess==="refresh",mode,token});
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "crm.test") {
      if (request.isNavigationRequest()) documents.push(url.pathname + url.search);
      if (url.pathname === "/session-observer")
        return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Session observer</title>"});
      const file = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
        return route.fulfill({status: 404, body: ""});
      if (failEssentialBundle && url.pathname === "/orders-workspace.js" && !failedBundle) {
        failedBundle = true;
        return route.fulfill({status: 503, body: "Temporary CDN failure"});
      }
      if (url.pathname === delayModule && !heldModule) {
        heldModule = true;
        moduleRequested.release();
        await module.promise;
        return route.fulfill({path: file}).catch(() => {});
      }
      if (safeArea && /\.(css|html)$/.test(file)) {
        const body = fs.readFileSync(file, "utf8").replace(
          /env\(\s*safe-area-inset-(top|right|bottom|left)(?:\s*,[^)]*)?\)/g,
          (_, edge) => safeArea[edge] + "px"
        );
        return route.fulfill({contentType: file.endsWith(".css") ? "text/css" : "text/html", body});
      }
      return route.fulfill({path: file});
    }
    if (!url.hostname.endsWith(".supabase.co")) return route.abort();
    const endpoint = url.pathname.split("/").pop();
    requests.push(endpoint);
    const grant=url.searchParams.get("grant_type");
    const accessStage=endpoint==="user"?"session":
      endpoint==="rabota_members"&&url.searchParams.has("user_id")?"role":
      endpoint==="token"&&grant==="refresh_token"?"refresh":"";
    if(accessStage)accessRequests.push(accessStage);
    if(accessStage&&accessStage===hangFirstAccess&&!heldAccess){
      heldAccess=true;
      await accessGate.promise;
      return route.fulfill({status:401,json:{message:"Поздний ответ первой проверки"}}).catch(()=>{}).finally(accessSettled.release);
    }
    if(endpoint==="token"&&(grant==="password"||grant==="refresh_token")){
      if(grant==="password")assert.deepEqual(request.postDataJSON(),{email:"qa@example.test",password:"fixture-qa-password"});
      return route.fulfill({json:{access_token:"fixture",refresh_token:"fixture",expires_in:3600}});
    }
    if (endpoint === "user" && abortFirstAccess) {
      abortFirstAccess = false;
      return route.abort("internetdisconnected");
    }
    if(endpoint==="logout"&&holdLogout){
      assert.equal(request.method(),"POST");
      assert.equal(request.headers().authorization,"Bearer fixture");
      assert.equal(url.searchParams.get("scope"),"local");
      logoutRequested.release();
      await logoutGate.promise;
      return route.fulfill({json:{}});
    }
    if (request.method() !== "GET") { writes.push(endpoint); return route.abort(); }
    let data = [];
    if (endpoint === "user") {
      if (jwtSubject) await verifiedUser.promise;
      data = {id: member.user_id};
    }
    if (endpoint === "rabota_members") data = url.searchParams.has("user_id") ? [member] : [master];
    if (endpoint === "rabota_orders") {
      firstOrdersRequested.release();
      if (hangFirstOrders) {
        hangFirstOrders = false;
        await ordersGate.promise;
        return route.fulfill({json: [{...order, name: "Устаревший выезд"}, paid]}).catch(() => {});
      }
      if (nextOrderRead) {
        const pending = nextOrderRead;
        nextOrderRead = null;
        pending.requested.release();
        const result = await pending.response.promise;
        controlledReads.delete(pending.response);
        if (result === "offline") return route.abort("internetdisconnected");
      }
      data = [order, paid];
    }
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
    finance.release(); notices.release(); module.release(); ordersGate.release(); logoutGate.release(); accessGate.release();
    verifiedUser.release();
    for (const response of controlledReads) response.release();
    await context.close();
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  }
  return {page, context, finance, notices, module, moduleRequested, requests, documents, ordersGate, firstOrdersRequested,
    logoutRequested, logoutGate, accessGate, accessSettled, accessRequests, verifiedUser, close,
    blockOrderRead() {
      const requested = gate(), response = gate();
      controlledReads.add(response);
      nextOrderRead = {requested, response};
      return {requested: requested.promise, release: response.release};
    },
    deactivateMember() { member.active = false; },
  };
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
  const s = await session(browser, {delayModule: "/money-workspace.js"});
  try {
    s.finance.release(); s.notices.release();
    await s.moduleRequested.promise;
    // The core workspace becomes usable while the finance renderer is still downloading.
    await s.page.locator("#appScreen").waitFor();
    await s.page.locator("#orders .master-schedule-card").filter({hasText: "Тестовый выезд"}).waitFor();
    assert.deepEqual(s.accessRequests, ["session", "role"]);
    s.module.release();
    await s.page.waitForLoadState("domcontentloaded");
    await s.page.locator('#mwMasterNav [data-mw-page="payments"]').click();
    await s.page.locator('#mwMasterPayments [data-order-id="fixture-paid"][data-payment-type="receipt"]').waitFor();
    assert.equal(await s.page.locator("#mwMasterNav").count(), 1);
    assert.equal(await s.page.locator('#mwMasterNav [data-mw-page="payments"]').count(), 1);
  } finally { await s.close(); }
}

async function stalledBundleOffersRetry(browser, path) {
  const s = await session(browser, {role: "manager", delayModule: path, view: "orders"});
  try {
    await s.moduleRequested.promise;
    const recovery = s.page.locator("#bootstrapRecovery");
    await recovery.waitFor({timeout: 15000});
    assert.deepEqual(s.accessRequests, []);
    assert.deepEqual(s.documents, ["/?view=orders"], "delayed assets must not force an automatic reload");
    const retry = recovery.getByRole("button", {name: "Повторить запуск", exact: true});
    await retry.evaluate(button => document.addEventListener("click", event => {
      if(event.target===button)sessionStorage.setItem("fixture-restarting", document.documentElement.dataset.rdBootFailed || "");
    }, {once:true}));
    // WebKit can defer animation frames while an intercepted stylesheet is pending.
    // Hit-test the actual control and use mobile input without a frame-stability preflight.
    const point = await retry.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
      return document.elementFromPoint(x, y) === node ? {x, y} : null;
    });
    assert.ok(point, path + " held: the recovery button receives touch input");
    await s.page.touchscreen.tap(point.x, point.y);
    s.module.release();
    await s.page.locator("#appScreen").waitFor();
    assert.deepEqual(s.documents, ["/?view=orders", "/?view=orders"], "the explicit retry opens the same view");
    assert.ok(await s.page.evaluate(() => sessionStorage.getItem("fixture-restarting")),
      "the old document blocks late startup scripts as soon as reload is requested");
    assert.deepEqual(s.accessRequests, ["session", "role"]);
  } finally { await s.close(); }
}

async function failedEssentialBundleOffersRetry(browser) {
  const s = await session(browser, {role: "manager", failEssentialBundle: true});
  try {
    await s.page.waitForLoadState("domcontentloaded");
    assert.deepEqual(s.accessRequests, [], "missing required code cannot start an incomplete workspace");
    await s.page.getByRole("button", {name: "Повторить запуск", exact: true}).click({timeout: 15000});
    await s.page.locator("#appScreen").waitFor();
    assert.deepEqual(s.accessRequests, ["session", "role"]);
    assert.deepEqual(s.documents, ["/", "/"]);
  } finally { await s.close(); }
}

async function accessBoundaries(browser) {
  for (const active of [false, true]) {
    const s = await session(browser, {role: "manager", active});
    try {
      const screen = s.page.locator(active ? "#appScreen" : "#accessScreen");
      await screen.waitFor();
      if (active) await s.firstOrdersRequested.promise;
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

async function logoutHidesBothTabsBeforeServerResponse(browser) {
  const fixture=await session(browser,{role:"manager",holdLogout:true});
  try{
    const second=await fixture.context.newPage();
    await second.goto("https://crm.test/");
    await Promise.all([fixture.page.locator("#appScreen").waitFor(),second.locator("#appScreen").waitFor()]);
    await fixture.page.locator("#rdProfileTrigger").click();
    await fixture.page.locator("#logoutBtn").click();
    await fixture.logoutRequested.promise;
    for(const tab of [fixture.page,second]){
      await tab.locator("#loginScreen").waitFor({timeout:1800});
      assert.equal(await tab.locator("#appScreen").isVisible(),false);
      assert.equal(await tab.evaluate(()=>localStorage.getItem("rabota-auth-session-v1")),null);
    }
    fixture.logoutGate.release();
  }finally{await fixture.close();}
}

async function slowScheduleHasBoundedRetry(browser, role) {
  const fixture = await session(browser, {role, hangFirstOrders: true});
  try{
    const {page, accessRequests, requests} = fixture;
    fixture.finance.release();
    fixture.notices.release();
    await fixture.firstOrdersRequested.promise;
    const status = page.locator("#syncStatus");
    await page.locator("#appScreen").waitFor({timeout: 1800});
    await page.locator(role === "master" ? "#mwMasterNav" : "#rdMobileNav").waitFor();
    await status.getByText(/загружаем/i).waitFor();
    assert.equal(await page.locator("#startupScreen").isVisible(), false);
    const retry = page.locator("#retryOrderSync");
    await retry.waitFor({timeout:8500});
    assert.match(await status.innerText(), /загруз|обнов/i);
    await retry.click();
    await page.waitForFunction(() => window.__rdOrdersRevision >= 1);
    assert.equal(await retry.isVisible(), false);
    assert.deepEqual(accessRequests, ["session", "role"], "schedule retry does not repeat auth or role checks");
    assert.equal(requests.filter(endpoint => endpoint === "rabota_orders").length, 2);
    fixture.ordersGate.release();
    await page.waitForLoadState("networkidle");
    assert.equal(await page.getByText("Устаревший выезд", {exact: true}).count(), 0,
      "the abandoned first read does not overwrite the result of the retry");
  }finally{await fixture.close();}
}

async function slowAccessHasBoundedRetry(browser,stage){
  const fixture=await session(browser,{role:"manager",hangFirstAccess:stage});
  try{
    const status=fixture.page.locator("#startupScheduleStatus");
    await status.filter({hasText:"Проверяем сеанс и права доступа"}).waitFor();
    const retry=fixture.page.getByRole("button",{name:"Повторить проверку доступа",exact:true});
    await retry.waitFor({timeout:8500});
    assert.equal(await fixture.page.locator("#appScreen").isVisible(),false);
    assert.equal(fixture.requests.includes("rabota_orders"),false);
    assert.match(await status.innerText(),/Не удалось вовремя проверить доступ/);
    await retry.click();
    await fixture.page.locator("#appScreen").waitFor();
    assert.equal(fixture.accessRequests.filter(value=>value===stage).length,2);
    fixture.accessGate.release();
    await fixture.accessSettled.promise;
    assert.equal(await fixture.page.locator("#appScreen").isVisible(),true);
    assert.equal(await retry.isVisible(),false);
  }finally{await fixture.close();}
}

async function jwtSubjectIsOnlyAHint(browser, matching) {
  const s = await session(browser, {
    role: "manager", jwtSubject: matching ? fixtureManagerUuid : "10000000-0000-4000-8000-000000000002",
  });
  try {
    const {page} = s;
    await page.locator("#startupScheduleStatus").filter({hasText: /проверяем сеанс/i}).waitFor();
    assert.deepEqual(s.accessRequests, ["session", "role"], "the membership read can run before /user responds");
    assert.equal(await page.locator("#appScreen").isVisible(), false);
    assert.equal(s.requests.includes("rabota_orders"), false);
    s.verifiedUser.release();
    if (matching) {
      await page.locator("#appScreen").waitFor();
      await s.firstOrdersRequested.promise;
    } else {
      await page.locator("#loginScreen").waitFor();
      assert.equal(await page.locator("#appScreen").isVisible(), false);
      assert.equal(s.requests.includes("rabota_orders"), false, "mismatched verified identity exposes no data");
    }
  } finally { await s.close(); }
}

async function logoutClearsPasswordFromManualLogin(browser){
  const fixture=await session(browser,{role:"manager",loginManually:true,holdLogout:true});
  try{
    const password=fixture.page.locator("#loginPassword");
    await fixture.page.locator("#loginEmail").fill("qa@example.test");
    await password.fill("fixture-qa-password");
    await fixture.page.locator("#loginSubmit").click();
    await fixture.page.locator("#appScreen").waitFor();
    await fixture.page.locator("#rdProfileTrigger").click();
    await fixture.page.locator("#logoutBtn").click();
    await fixture.logoutRequested.promise;
    await fixture.page.locator("#loginScreen").waitFor();
    assert.equal(await password.inputValue(),"");
    fixture.logoutGate.release();
  }finally{await fixture.close();}
}

async function iphoneEntryMode(browser, mode, width) {
  const standalone = mode === "standalone";
  const safeArea = {top: standalone ? 47 : 0, bottom: standalone ? 34 : 0, left: 0, right: 0};
  const s = await session(browser, {role: "owner", mode, width, safeArea, view: "orders"});
  try {
    s.finance.release(); s.notices.release();
    const {page} = s;
    await page.locator("#appScreen").waitFor();
    const launch = await page.evaluate(async () => {
      const manifest = document.querySelector('link[rel="manifest"]');
      const settings = await fetch(manifest.href).then(response => response.json());
      return {
        userAgent: navigator.userAgent,
        iosStandalone: Boolean(navigator.standalone),
        displayStandalone: matchMedia("(display-mode: standalone)").matches,
        nativeMode: settings.display,
        startUrl: settings.start_url,
        scope: settings.scope,
        browserFullscreen: Boolean(document.fullscreenElement || document.webkitFullscreenElement),
        iosInstallation: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
        viewport: document.querySelector('meta[name="viewport"]')?.content,
      };
    });
    assert.match(launch.userAgent, mode === "embedded" ? /iPhone.*Telegram/ : /iPhone.*Safari\//);
    assert.equal(launch.iosStandalone, standalone);
    assert.equal(launch.displayStandalone, standalone);
    assert.equal(launch.nativeMode, "standalone");
    assert.equal(launch.startUrl, "/");
    assert.equal(launch.scope, "/");
    assert.equal(launch.iosInstallation, "yes");
    assert.match(launch.viewport, /viewport-fit=cover/);
    assert.equal(launch.browserFullscreen, false, "the app does not request fullscreen from a browser tab");
    const initial = await assertHeaderLayout(page, "orders");
    assert.equal(initial.safeTop, safeArea.top);
    const dock = await page.locator("#rdMobileNav").evaluate(nav => ({
      end: nav.getBoundingClientRect().bottom,
      viewport: window.innerHeight,
      touchEnd: Math.max(...Array.from(nav.querySelectorAll("button"), button => button.getBoundingClientRect().bottom)),
    }));
    assert.ok(Math.abs(dock.end - dock.viewport) <= 1 && dock.touchEnd <= dock.end - safeArea.bottom + 1,
      "dock attaches to the viewport while touch targets remain above the home indicator");
    await page.locator('#rdMobileNav [data-page="expenses"]').click();
    await page.locator("#exMain").waitFor();
    await assertHeaderLayout(page, "expenses", initial);
    await page.locator('#rdMobileNav [data-page="orders"]').click();
    await assertHeaderLayout(page, "orders", initial);
    assert.deepEqual(s.accessRequests, ["session", "role"]);
    assert.deepEqual(s.documents, ["/?view=orders"]);
  } finally { await s.close(); }
}

async function foregroundReconnectPreservesWorkspace(browser) {
  const s = await session(browser, {role: "master", mode: "standalone"});
  try {
    s.finance.release(); s.notices.release();
    const {page} = s;
    const order = page.locator("#orders .master-schedule-card").filter({hasText: "Тестовый выезд"});
    await order.waitFor();
    await page.waitForLoadState("networkidle");
    const doc = await page.evaluate(() => window.fixtureDocument);
    const readsBeforeWake = s.requests.filter(endpoint => endpoint === "rabota_orders").length;
    const nextRead = s.blockOrderRead();
    const refresh = page.waitForRequest(request => new URL(request.url()).pathname.endsWith("/rabota_orders"), {timeout: 2500});
    // The desktop browser cannot suspend an iPhone app. Drive the same DOM lifecycle signals.
    await page.evaluate(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 45000;
      window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    await Promise.all([nextRead.requested, refresh]);
    await page.locator('#mwMasterNav [data-mw-page="reports"]').click();
    await page.locator("#mwMasterReports").waitFor();
    assert.equal(s.requests.filter(endpoint => endpoint === "rabota_orders").length, readsBeforeWake + 1,
      "the persisted page, visibility, focus and online signals share one order refresh");
    assert.deepEqual(s.accessRequests, ["session", "role"], "a short return still has verified access");
    assert.equal(await page.locator("#startupScreen").isVisible(), false);
    await page.locator('#mwMasterNav [data-mw-page="orders"]').click();
    await order.waitFor();
    nextRead.release("offline");
    await page.locator("#retryOrderSync").waitFor();
    assert.equal(await order.isVisible(), true, "a background error keeps the last confirmed order list visible");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.locator("#retryOrderSync").waitFor({state: "hidden"});
    assert.equal(await order.isVisible(), true);
    assert.equal(await page.evaluate(() => window.fixtureDocument), doc);
    assert.deepEqual(s.documents, ["/"]);
  } finally { await s.close(); }
}

async function outdatedAccessIsRecheckedOnResume(browser) {
  const s = await session(browser, {role: "manager", mode: "standalone"});
  try {
    s.finance.release(); s.notices.release();
    const {page} = s;
    await page.locator("#appScreen").waitFor();
    await page.waitForLoadState("networkidle");
    const previousDocument = await page.evaluate(() => window.fixtureDocument);
    const requestsBeforeWake = s.requests.filter(endpoint => endpoint === "rabota_orders").length;
    s.deactivateMember();
    await page.evaluate(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 6 * 60000;
      window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}));
    });
    await page.locator("#accessScreen").waitFor();
    assert.equal(await page.locator("#appScreen").isVisible(), false);
    assert.equal(await page.locator("#rdMobileNav").isVisible(), false);
    assert.deepEqual(s.accessRequests, ["session", "role", "session", "role"]);
    assert.equal(s.requests.filter(endpoint => endpoint === "rabota_orders").length, requestsBeforeWake,
      "after an old session resumes, no new protected reads run before the role is verified");
    assert.equal(await page.evaluate(() => window.fixtureDocument), previousDocument);
  } finally { await s.close(); }
}

(async () => {
  const type=process.env.TEST_BROWSER==="webkit"?webkit:chromium;
  const browser = await type.launch({executablePath: process.env.TEST_BROWSER_PATH||process.env.CHROMIUM_PATH,
    args:type===chromium?["--no-sandbox"]:[]});
  try {
    await masterStartup(browser, false);
    await masterStartup(browser, true);
    await ownerFinance(browser);
    await lateModule(browser);
    await Promise.all([
      stalledBundleOffersRetry(browser, "/orders-workspace.js"),
      stalledBundleOffersRetry(browser, "/redesign.css"),
      failedEssentialBundleOffersRetry(browser),
    ]);
    await accessBoundaries(browser);
    await reconnectAndSignOutAcrossTabs(browser);
    await logoutHidesBothTabsBeforeServerResponse(browser);
    await Promise.all(["master", "manager", "owner"].map(role => slowScheduleHasBoundedRetry(browser, role)));
    await Promise.all(["session","role","refresh"].map(stage=>slowAccessHasBoundedRetry(browser,stage)));
    await Promise.all([true, false].map(matching => jwtSubjectIsOnlyAHint(browser, matching)));
    await logoutClearsPasswordFromManualLogin(browser);
    await Promise.all([["safari", 375], ["embedded", 320], ["standalone", 430]]
      .map(([mode, width]) => iphoneEntryMode(browser, mode, width)));
    await foregroundReconnectPreservesWorkspace(browser);
    await outdatedAccessIsRecheckedOnResume(browser);
    console.log("Passed mobile startup, delayed assets, all roles, emulated iPhone entry modes, foreground recovery and access revalidation");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
