"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const {chromium} = require("playwright");
const root = path.resolve(__dirname, "..");
const member = {user_id: "qa-master", role: "master", master_name: "Рауль", active: true};
const orders = [
  [51, "Виктория", 18000, "cash", "2026-11-22T23:11:00Z"],
  [52, "Виктория", 7000, "card", "2026-11-22T23:10:00Z"],
  [null, "Заказ без номера", 1100.5, null, "2026-11-22T17:30:00Z"],
  [53, "Сергей", 5400, "cash", "2026-11-22T16:10:00Z"],
  [54, "Олег", 4100, "cash", "2026-11-22T15:30:00Z"]
].map(([number, name, price, method, paidAt], index) => ({
  id: "order-" + index, order_number: number, name, price,
  assigned_user_id: member.user_id, master: member.master_name, paid: true,
  status: "Выполнен", payment_method: method, payment_amount: price,
  paid_at: paidAt, payment_received_by: "master", created_at: paidAt,
  appointment_date: "2026-11-21", appointment_time: "11:00:00",
  address: "Тестовый адрес " + index
}));

async function startSession(browser, width) {
  const context = await browser.newContext({
    viewport: {width, height: 844}, isMobile: true, hasTouch: true,
    timezoneId: "UTC", serviceWorkers: "block"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [], writes = [], transfers = [], confirmations = [];
  const committed = new Set(), receiptQueries = [];
  const owner = {user_id: "qa-owner", role: "owner", active: true};
  let active = member;
  const collections = [
    {company_amount: 7500, submitted_at: null, confirmed_at: null},
    {company_amount: 1200, submitted_at: "2026-11-22T10:00:00Z", confirmed_at: null},
    {company_amount: 550, submitted_at: "2026-11-21T10:00:00Z", confirmed_at: "2026-11-21T12:00:00Z"}
  ].map((record, index) => ({
    order_id: orders[[0, 3, 4][index]].id, master_user_id: member.user_id,
    submitted_amount: null, confirmed_amount: null, ...record
  }));
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(() => {
    localStorage.setItem("rabota-auth-session-v1", JSON.stringify({
      access_token: "test", refresh_token: "test", expires_at: 4102444800
    }));
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "crm.test") {
      const source = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
      if (!source.startsWith(root + path.sep) || !fs.existsSync(source))
        return route.fulfill({status: 404, body: "Missing local asset"});
      const type = {".css": "text/css", ".html": "text/html", ".js": "text/javascript",
        ".svg": "image/svg+xml", ".png": "image/png"}[path.extname(source)];
      return route.fulfill({contentType: type || "application/octet-stream", body: fs.readFileSync(source)});
    }
    if (request.method() === "POST" && url.pathname.endsWith("/rpc/rabota_cash_submit_amount")) {
      const payload = request.postDataJSON();
      transfers.push(payload);
      if (!committed.has(payload.p_request_id)) {
        committed.add(payload.p_request_id);
        collections[0].submitted_amount = (collections[0].submitted_amount || 0) + payload.p_amount;
        collections[0].confirmed_amount ??= 0;
      }
      // The server committed before the client lost its first response.
      if (transfers.length === 1) return route.abort("connectionreset");
      return route.fulfill({json: true});
    }
    if (request.method() === "POST" && url.pathname.endsWith("/rpc/rabota_cash_confirm_amount")) {
      confirmations.push(request.postDataJSON());
      collections[0].confirmed_amount = collections[0].submitted_amount;
      return route.fulfill({json: true});
    }
    if (request.method() !== "GET") {
      writes.push(url.pathname);
      return route.abort();
    }
    let result = [];
    if (url.pathname === "/auth/v1/user") result = {id: active.user_id};
    if (url.pathname.endsWith("/rabota_members"))
      result = url.searchParams.has("user_id") ? [active] : [member];
    if (url.pathname.endsWith("/rabota_orders")) result = [
      ...orders, {...orders[0], id: "unpaid", name: "Неоплаченный заказ", paid: false},
      {...orders[0], id: "cancelled", name: "Отменённый заказ", status: "Отменён"},
      {...orders[0], id: "other", name: "Другой мастер", assigned_user_id: "other"}
    ];
    if (url.pathname.endsWith("/rabota_cash_transfer_events") && url.searchParams.has("request_id")) {
      const id = url.searchParams.get("request_id").replace(/^eq\./, "");
      receiptQueries.push(id);
      if (committed.has(id)) result = [{id: "recorded-event"}];
    }
    if (url.pathname.endsWith("/rabota_cash_collections")) {
      result = collections;
    }
    return route.fulfill({json: result});
  });
  async function open() {
    active = member;
    await page.goto("https://crm.test/");
    await page.locator('#mwMasterNav [data-mw-page="payments"]').click();
    await page.getByText("Осталось передать компании", {exact: true}).waitFor();
  }
  await open();
  async function confirm() {
    active = owner;
    await page.goto("https://crm.test/?view=finance");
    await page.locator('[data-finance-tab="cash"]').click();
    const payment = page.locator(".finance-activity").filter({hasText: "№00051"});
    page.once("dialog", dialog => dialog.accept());
    await payment.getByRole("button", {name: "Подтвердить получение в кассу"}).click();
    await payment.waitFor({state: "detached"});
    assert.deepEqual(confirmations, [{
      p_order_id: orders[0].id, p_expected_submitted: 1250.5, p_expected_confirmed: 0
    }]);
  }
  return {context, page, errors, writes, transfers, receiptQueries, open, confirm};
}

async function check(browser, width) {
  const {context, page, errors, writes, transfers, receiptQueries, open, confirm} = await startSession(browser, width);
  const payments = page.locator("#mwMasterPayments");
  try {
    const text = async () => (await payments.innerText()).replace(/[\u00a0\u202f]/g, " ");
    assert.match(await text(), /7 500 ₽/);
    assert.match(await text(), /1 200 ₽/);
    assert.match(await text(), /550 ₽/);
    assert.match(await text(), /35 600,50? ₽/);
    assert.doesNotMatch(await text(), /Неоплаченный заказ|Отменённый заказ|Другой мастер/);
    assert.equal(await payments.getByText(/23 ноября/).count(), 1);
    assert.equal(await payments.getByText(/22 ноября/).count(), 1);
    assert.match(await text(), /02:11/);
    assert.equal(await page.getByRole("heading", {name: "Платежи", exact: true}).count(), 1);
    const summary = payments.locator("summary").filter({hasText: "Оплачено клиентами"});
    await summary.click();
    assert.match(await text(), /1 100,50? ₽/);
    await summary.click();
    const filter = payments.getByRole("combobox");
    const rows = payments.getByRole("button").filter({hasText: /Виктория|Заказ без номера|Сергей|Олег/});
    assert.equal(await rows.count(), 5);
    await filter.selectOption("card");
    assert.equal(await rows.count(), 1);
    assert.match(await rows.innerText(), /№00052/);
    await rows.click();
    const sheet = page.locator(".master-order-sheet");
    await sheet.waitFor();
    assert.match(await sheet.innerText(), /Тестовый адрес 1/);
    await sheet.locator(".mw-order-modal-close").click();
    await filter.selectOption("unknown");
    assert.equal(await rows.count(), 1);
    assert.doesNotMatch(await rows.innerText(), /№|order-2/);
    await filter.selectOption("all");
    const geometry = await payments.evaluate(el => {
      const r = el.getBoundingClientRect();
      return {width: el.clientWidth, scrollWidth: el.scrollWidth,
        left: r.left, right: r.right, viewport: document.documentElement.clientWidth};
    });
    assert.ok(geometry.scrollWidth <= geometry.width + 1 && geometry.left >= 0 &&
      geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
    if (process.env.PAYMENTS_SCREENSHOTS)
      await page.screenshot({path: path.join(process.env.PAYMENTS_SCREENSHOTS, "payments-" + width + ".png")});

    await payments.getByRole("button", {name: "Отметить передачу"}).click();
    const amount = page.locator('input[inputmode="decimal"]:visible');
    const form = amount.locator("xpath=ancestor::form[1]");
    const submit = form.locator('[type="submit"]');
    await amount.fill("7500,01");
    await submit.click();
    assert.equal(await amount.getAttribute("aria-invalid"), "true");
    assert.equal(transfers.length, 0);
    await amount.fill("1250,50");
    await submit.click();
    await form.getByRole("alert").waitFor({state: "visible"});
    await submit.click();
    await page.waitForFunction(() => {
      const text = document.getElementById("mwMasterPayments").innerText.replace(/[\u00a0\u202f]/g, " ");
      return /6 249,50? ₽/.test(text) && /2 450,50? ₽/.test(text);
    });
    assert.equal(transfers.length, 2);
    assert.deepEqual(transfers[1], transfers[0]);
    assert.equal(transfers[0].p_amount, 1250.5);
    assert.match(transfers[0].p_request_id, /^[0-9a-f-]{36}$/i);
    await confirm();
    await open();
    assert.match(await text(), /1 800,50? ₽/);
    assert.match(await text(), /1 200 ₽/);
    assert.match(await text(), /6 249,50? ₽/);
    // Simulate reopening the page after a committed response was lost on another
    // form instance. A fresh handoff of the same amount must remain possible.
    const previousId = transfers[0].p_request_id;
    await page.evaluate(id => sessionStorage.setItem("rabota.handoff.qa-master.all.125050", id), previousId);
    await open();
    await payments.getByRole("button", {name: "Отметить передачу"}).click();
    await amount.fill("1250,50");
    await submit.click();
    await form.getByText(/^Предыдущая передача/).waitFor();
    assert.equal(transfers.length, 2);
    assert.deepEqual(receiptQueries, [previousId]);
    await submit.click();
    await page.waitForFunction(() => document.querySelector(".mw-handoff-form") === null);
    assert.equal(transfers.length, 3);
    assert.notEqual(transfers[2].p_request_id, previousId);
    assert.match(await text(), /4 999 ₽/);
    assert.match(await text(), /2 450,50? ₽/);
    assert.match(await text(), /1 800,50? ₽/);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log("Passed master payments mobile flow at", width, "px");
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"]});
  try {
    for (const width of [390, 320]) await check(browser, width);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
