"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {existsSync} = require("node:fs");
const {chromium, webkit, devices} = require("playwright");
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
  paid_at: paidAt, completed_at: paidAt, payment_received_by: index % 2 ? "owner" : "master", created_at: paidAt,
  appointment_date: "2026-11-21", appointment_time: "11:00:00",
  address: "Тестовый адрес " + index
}));
const receipts = orders.map(order => ({
  order_id: order.id, master_id: order.assigned_user_id, amount: order.payment_amount,
  payment_method: order.payment_method, paid_at: order.paid_at, occurred_at: order.completed_at
}));
const excludedOrders = [
  {...orders[0], id: "unpaid", name: "Неоплаченный заказ", paid: false},
  {...orders[0], id: "cancelled", name: "Отменённый заказ", status: "Отменён"},
  {...orders[0], id: "advance", name: "Оплата до завершения", status: "Записан"},
  {...orders[0], id: "partial", name: "Частичная оплата", payment_amount: 1000},
  {...orders[0], id: "other", name: "Другой мастер", assigned_user_id: "other"}
];

async function check(browser, browserName, width) {
  const device = devices["iPhone 13"];
  const context = await browser.newContext({
    ...device, viewport: {...device.viewport, width}, screen: {...device.screen, width},
    timezoneId: "UTC", serviceWorkers: "block"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [], writes = [], reads = [];
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
      if (source.startsWith(root + path.sep) && existsSync(source)) return route.fulfill({path: source});
      return route.fulfill({status: 404, body: "Missing local asset"});
    }
    if (!url.hostname.endsWith(".supabase.co")) return route.abort();
    if (request.method() !== "GET") {
      writes.push(url.pathname);
      return route.abort();
    }
    const resource = url.pathname.split("/").pop();
    reads.push(resource);
    let json = [];
    if (resource === "user") json = {id: member.user_id};
    if (resource === "rabota_members") json = [member];
    if (resource === "rabota_orders") json = [...orders, ...excludedOrders];
    if (resource === "rabota_payroll_snapshot_v3") json = {
      version: 3, state: "active", activated_at: "2026-11-22T00:00:00Z", master_id: member.user_id,
      earned: 0, paid: 0, due: 0, orders: [], payouts: [], accounting_version: 1,
      accounting_receipts: receipts
    };
    if (resource === "rabota_cash_collections") json = [{
      order_id: orders[0].id, master_user_id: member.user_id,
      company_amount: 7500, submitted_amount: 1250.5, confirmed_amount: 550
    }];
    return route.fulfill({json});
  });
  try {
    await page.goto("https://crm.test/");
    const nav = page.locator("#mwMasterNav");
    const payments = page.locator("#mwMasterPayments");
    const openPayments = () => nav.locator('[data-mw-page="payments"]').click();
    await openPayments();
    const summary = payments.locator("summary").filter({hasText: "Оплачено клиентами"});
    await summary.waitFor();
    const readText = async () => (await payments.innerText()).replace(/[\u00a0\u202f]/g, " ");
    assert.match(await readText(), /35 600,50? ₽/);
    assert.doesNotMatch(await readText(), /Неоплаченный заказ|Отменённый заказ|Другой мастер|Оплата до завершения|Частичная оплата|7 500 ₽|1 250,50? ₽|550 ₽/);
    assert.equal(await payments.getByText(/23 ноября/).count(), 1);
    assert.equal(await payments.getByText(/22 ноября/).count(), 1);
    assert.match(await readText(), /02:11/);
    assert.equal(await page.getByRole("heading", {name: "Платежи", exact: true}).count(), 1);
    await summary.click();
    assert.match(await readText(), /Способ не указан\s+1 100,50? ₽/);
    await summary.click();
    const filter = payments.getByRole("combobox", {name: "Способ оплаты заказов"});
    const rows = payments.locator('.mw-payment-row[data-payment-type="receipt"]');
    assert.equal(await rows.count(), orders.length);
    assert.deepEqual(await rows.evaluateAll(items => items.map(item => item.dataset.orderId)), orders.map(order => order.id));
    await filter.selectOption("cash");
    assert.equal(await rows.count(), 3);
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
    await nav.locator('[data-mw-page="reports"]').click();
    await openPayments();
    assert.equal(await filter.inputValue(), "unknown");
    assert.equal(await rows.count(), 1);
    await filter.selectOption("all");
    assert.equal(await rows.count(), orders.length);
    const geometry = await payments.evaluate(el => {
      const r = el.getBoundingClientRect();
      return {width: el.clientWidth, scrollWidth: el.scrollWidth,
        left: r.left, right: r.right, viewport: document.documentElement.clientWidth};
    });
    assert.ok(geometry.scrollWidth <= geometry.width + 1 && geometry.left >= 0 &&
      geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
    assert.equal(await payments.locator('.mw-handoff-card, .mw-payment-recipient').count(), 0);
    assert.doesNotMatch(await readText(), /Осталось передать|Ожидает подтверждения|Деньги у мастера|Передать деньги|Отметить передачу|Подтвердить получение|Ручное распределение/);
    assert.ok(reads.includes("rabota_payroll_snapshot_v3"));
    assert.ok(!reads.some(resource => /^rabota_cash_(?:collections|transfer_events)$/.test(resource)));
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    if (process.env.PAYMENTS_SCREENSHOTS)
      await page.screenshot({path: path.join(process.env.PAYMENTS_SCREENSHOTS, `payments-${browserName}-${width}.png`)});
    console.log("PASS", browserName, width, "px master customer receipts, filtering and details");
  } finally {
    await context.close();
  }
}

(async () => {
  const name = process.env.TEST_BROWSER || "chromium";
  const type = name === "webkit" ? webkit : chromium;
  const browser = await type.launch({
    executablePath: process.env.TEST_BROWSER_PATH || (name === "chromium" ? process.env.CHROMIUM_PATH : undefined),
    args: name === "chromium" ? ["--no-sandbox"] : []
  });
  try {
    for (const width of [320, 375, 390, 430]) await check(browser, name, width);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
