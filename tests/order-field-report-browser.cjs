/* Independent report checks through the actual CRM and intercepted, synthetic REST responses. */
"use strict";
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const { fixture, assertHeaderLayout } = require("./module-navigation-browser.cjs");

const root = path.resolve(__dirname, "..");
const origin = "https://crm.test";
const frozen = new Date("2026-06-01T22:30:00Z"); // 2 June, 01:30 in Moscow.
const activated = "2026-01-01T00:00:00Z";
const raul = "fixture-master";
const other = "another-fixture-master";
const reportTitle = "Источники заказов";
const stickyWidths = [320, 375, 390, 430];
const endpoint = name => new RegExp("/rest/v1/" + name + "(?:\\?|$)");
const stampFor = day => day + "T09:00:00Z";

function order(id, number, name, price, source, completedAt, options = {}) {
  const travel = options.travel || 0;
  const paid = options.paid ?? true;
  return {
    id, name, order_number: number, client_source: source, price,
    master: options.master === raul ? "Рауль" : "Другой мастер",
    assigned_user_id: options.master || other,
    status: completedAt ? "Выполнен" : "Записан",
    paid, travel_amount: travel,
    payment_amount: paid ? Math.round((price + travel) * 100) / 100 : null,
    payment_method: paid ? "card" : null,
    payment_received_by: paid ? "company" : null,
    paid_at: paid ? completedAt : null,
    completed_at: completedAt,
    // Deliberately different from closing date. The report must use closing date.
    created_at: activated, updated_at: activated,
    appointment_date: "2026-06-10", appointment_time: "12:00:00",
  };
}

const avitoToday = order("avito-today", 12345, "Клиент Авито с дорогой", 10000.25, "avito",
  "2026-06-01T21:05:00Z", { master: raul, travel: 1000 });
const avitoYesterday = order("avito-yesterday", 12346, "Клиент Авито без дороги", 5000.75,
  "Авито", "2026-06-01T20:55:00Z", { master: raul });
const missing = order("no-source", 12347, "Клиент без источника", 8000, null, stampFor("2026-06-01"));
const refunded = order("refunded", 12348, "Клиент с полным возвратом", 7000, "vk",
  "2026-06-01T21:09:00Z", { master: raul, travel: 500 });
const unpaid = order("unpaid", 12349, "Клиент с неоплаченной дорогой", 1500, "telegram",
  "2026-06-01T21:12:00Z", { master: raul, travel: 300, paid: false });
const google = order("google", 12350, "Майский заказ", 4000, "google", stampFor("2026-05-31"));
const formula = order("legacy-source", 12351, "Старый заказ", 999.19, "=1+1", stampFor("2026-04-30"));
const booked = order("booked", 12352, "Клиент с будущей записью", 7000, " ", null, { paid: false });
const orders = [avitoToday, avitoYesterday, missing, refunded, unpaid, google, formula, booked];
const expenses = [
  { id: "expense-linked-a", kind: "expense", order_id: avitoToday.id, amount: 125.25 },
  { id: "expense-linked-b", kind: "expense", order_id: avitoToday.id, amount: 2 },
  { id: "expense-linked-legacy", kind: "expense", order_id: null, amount: 7.75,
    note: "[Расходники] Прокладки · Заказ №12345" },
  { id: "expense-linked-c", kind: "expense", order_id: missing.id, amount: 80.01 },
  { id: "expense-void", kind: "expense", order_id: avitoToday.id, amount: 5000, voided_at: activated },
  { id: "expense-general", kind: "expense", order_id: null, amount: 9999, note: "Общий расход" },
  { id: "payout-linked", kind: "raul_payout", order_id: avitoToday.id, amount: 999, master_user_id: raul },
].map(operation => ({ created_at: activated, payment_method: "cash", voided_at: null, ...operation }));

function baseEarning(row, earned, share) {
  return { order_id: row.id, earned_amount: earned, paid_amount: row.price, company_share: share,
    earned_at: row.paid_at, rule_version: 3 };
}
const payroll = {
  version: 3, state: "active", master_id: raul, accounting_version: 1, activated_at: activated,
  earned: 12300.51, paid: 999, due: 11301.51, balance: 11301.51, overpaid: 0, travel_earned: 1800,
  payouts: [{ id: "payout-linked", order_id: avitoToday.id, created_at: activated, amount: 999,
    payment_method: "cash", kind: "raul_payout" }],
  orders: [baseEarning(avitoToday, 6500.13, 3500.12), baseEarning(avitoYesterday, 4000.38, 1000.37)],
  travel_events: [avitoToday, refunded, unpaid].map(row => ({
    id: "travel-event-" + row.id, order_id: row.id, order_number: row.order_number,
    delta: row.travel_amount, occurred_at: row.completed_at,
  })),
  accounting_receipts: orders.filter(row => row.paid).map(row => ({
    order_id: row.id, master_id: row.assigned_user_id, amount: row.payment_amount, travel_amount: row.travel_amount,
    payment_method: row.payment_method, paid_at: row.paid_at, occurred_at: row.paid_at,
  })),
  accounting_refunds: [{ order_id: refunded.id, amount: refunded.payment_amount, travel_amount: 500,
    refunded_at: refunded.completed_at }],
};
payroll.accounting_payouts = payroll.payouts;

async function setup(browser, width, role, extraOrders = []) {
  const f = await fixture(browser, root, width, role, {
    height: 780, standalone: true, safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  });
  const { page } = f;
  await page.clock.setFixedTime(frozen);
  const reads = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.hostname.endsWith(".supabase.co"))
      reads.push({ method: request.method(), resource: url.pathname.split("/").at(-1) });
  });
  if (role === "owner") {
    const routeJson = async (name, data) => page.route(endpoint(name), route => {
      assert.equal(route.request().method(), "GET");
      assert.equal(route.request().headers().authorization, "Bearer fixture-access");
      return route.fulfill({ json: data });
    });
    const visibleOrders = [...orders, ...extraOrders];
    await page.route(endpoint("rabota_orders"), route => {
      const request = route.request();
      assert.equal(request.method(), "GET");
      assert.equal(request.headers().authorization, "Bearer fixture-access");
      const params = new URL(request.url()).searchParams;
      const offset = Number(params.get("offset") ?? 0);
      const limit = Number(params.get("limit") ?? visibleOrders.length);
      const id = params.get("id");
      const scoped = id ? visibleOrders.filter(row => "eq." + row.id === id) : visibleOrders;
      return route.fulfill({ json: scoped.slice(offset, offset + limit) });
    });
    await routeJson("rabota_finance_operations", expenses);
    await routeJson("rpc/rabota_payroll_snapshot_v3", payroll);
  }
  await page.goto(origin + (role === "owner" ? "/?view=reports" : "/?view=orders"));
  await page.locator("#appScreen").waitFor();
  if (role === "owner") await page.waitForFunction(() => window.__rdFinanceStatus?.().ready);
  return { ...f, reads };
}

const fieldReport = page => page.locator(".of-report");
const sourceTable = panel => panel.getByRole("table", { name: "Заказы по источникам клиентов" });
const sourceCard = (panel, source) => panel.locator(`.of-source-card[data-source="${source}"]`);
const tableToggle = panel => panel.locator(".of-details > summary");
const totals = table => table.locator("tbody > tr:first-child");
const reportBack = page => page.locator("#rdScreenBack");
const reportEntry = page => page.getByRole("button", { name: /^Источники заказов(?:\s*›)?$/ });
const periodSelect = panel => panel.getByLabel("Период отчёта", { exact: true });
const normalize = value => value.trim().replace(/\s+/g, " ");
const amount = value => Number(value.replace(/[\s₽%]/g, "").replace("−", "-").replace(",", "."));

async function openFieldReport(page) {
  await reportEntry(page).click();
  const panel = fieldReport(page);
  await panel.getByLabel("Итоги за период", { exact: true }).waitFor();
  assert.equal(await periodSelect(panel).inputValue(), "month", "opens immediately on this month");
  assert.equal(await panel.getByLabel("Поле отчёта", { exact: true }).isVisible(), false,
    "a visitor does not have to select the only grouping field");
  assert.equal(await sourceTable(panel).isVisible(), false, "detailed table is collapsed on first use");
  return panel;
}

async function assertSummary(panel, expected) {
  const values = await Promise.all([
    ["count", "Заказы"], ["revenue", "Оплаты клиентов"], ["profit", "Прибыль"],
  ].map(async ([key, label]) => {
    const metric = panel.locator(`.of-summary [data-metric="${key}"]:visible`);
    assert.equal(await metric.locator("dt").innerText(), label);
    return amount(await metric.locator("dd").innerText());
  }));
  assert.deepEqual(values, expected);
}

async function assertSourceOverview(page, panel) {
  await assertSummary(panel, [5, 24001, 11485.48]);
  const chart = panel.locator(".of-chart:visible");
  const by = panel.getByLabel("Сравнить по", { exact: true });
  const cards = chart.locator(".of-source-card");
  const order = () => cards.evaluateAll(items => items.map(item => item.dataset.source));
  assert.equal(await by.inputValue(), "profit");
  assert.deepEqual(await order(), ["", "avito", "telegram", "vk"]);
  const leader = panel.locator(".of-source-leader");
  assert.equal(await leader.count(), 1);
  assert.match(await sourceCard(chart, "avito").locator(".of-source-leader").innerText(), /среди известных/);
  assert.equal(await sourceCard(chart, "").locator(".of-source-leader").count(), 0,
    "a missing source is not an advertising recommendation even when it has the largest profit");
  const blank = normalize(await sourceCard(chart, "").innerText());
  assert.match(blank, /Не указан/);
  assert.match(blank, /20\s*%/);
  const avito = normalize(await sourceCard(chart, "avito").innerText());
  assert.match(avito, /40\s*%/);
  assert.match(avito, /16\s*001/);
  assert.match(avito, /4\s*365,49/);
  assert.equal(amount(await sourceCard(chart, "vk").locator(".of-amount-negative").innerText()), -500);
  await by.selectOption("count");
  assert.equal((await order())[0], "avito");
  await by.selectOption("revenue");
  assert.deepEqual((await order()).slice(0, 2), ["avito", ""]);
  await by.selectOption("profit");

  await sourceCard(chart, "vk").click();
  const details = panel.locator(".of-drilldown:visible");
  assert.match(normalize(await details.innerText()), /Клиент с полным возвратом.*Возврат/);
  await reportBack(page).click();
  await page.locator('.of-source-card[data-source="vk"]:focus').waitFor();
  await sourceCard(chart, "telegram").click();
  assert.match(normalize(await details.innerText()), /Клиент с неоплаченной дорогой.*Не оплачено/);
  await reportBack(page).click();
  assert.equal(await periodSelect(panel).inputValue(), "month");
}

async function cellValues(row) {
  return (await row.locator("td,th").allTextContents()).map(normalize);
}

async function assertTotals(table, expected) {
  const cells = await cellValues(totals(table));
  assert.equal(cells[0], "Итого", "total is always the first body row");
  assert.deepEqual(cells.slice(1).map(amount), expected);
}

async function filterAndAccounting(page, table, panel) {
  const period = periodSelect(panel);
  const options = await period.locator("option").allTextContents();
  for (const label of ["Сегодня", "Вчера", "Текущая неделя", "Текущий месяц", "Прошлый месяц",
    "За всё время", "Произвольный период"]) assert.ok(options.includes(label), label);
  const periods = [
    ["today", [3, 100, 11000.25, 8300.13, 135, 2565.12, 11000.25]],
    ["yesterday", [2, 100, 13000.75, 4000.38, 80.01, 8920.36, 6500.38]],
    ["week", [5, 100, 24001, 12300.51, 215.01, 11485.48, 8000.33]],
    ["month", [5, 100, 24001, 12300.51, 215.01, 11485.48, 8000.33]],
    ["previous", [1, 100, 4000, 0, 0, 4000, 4000]],
    ["all", [8, 100, 29000.19, 12300.51, 215.01, 16484.67, 5800.04]],
  ];
  for (const [name, expected] of periods) {
    await period.selectOption(name);
    await assertTotals(table, expected);
  }
  await period.selectOption("custom");
  await panel.getByLabel("Начало периода", { exact: true }).fill("2026-06-01");
  await panel.getByLabel("Конец периода", { exact: true }).fill("2026-06-01");
  await assertTotals(table, periods[1][1]);
  await period.selectOption("all");
  assert.deepEqual((await cellValues(table.locator("tbody > tr").filter({
    has: page.getByRole("button", { name: "Авито", exact: true }),
  }))).slice(1).map(amount), [2, 25, 16001, 11500.51, 135, 4365.49, 8000.5]);
  assert.deepEqual((await cellValues(table.locator("tbody > tr").filter({
    has: page.getByRole("button", { name: "Не указан", exact: true }),
  }))).slice(1).map(amount), [2, 25, 8000, 0, 80.01, 7919.99, 8000]);
}

async function sortAndExport(page, panel, table) {
  const reveal = table.getByRole("button", { name: "Оплаты", exact: true });
  const values = async () => (await table.locator("tbody > tr:not(:first-child) > :nth-child(4)")
    .allTextContents()).map(amount);
  const header = table.getByRole("columnheader").filter({
    has: page.getByRole("button", { name: "Оплаты", exact: true }),
  });
  for (let direction = 0; direction < 2; direction++) {
    await reveal.click();
    const ordered = await values();
    const state = await header.getAttribute("aria-sort");
    assert.ok(["ascending", "descending"].includes(state));
    assert.deepEqual(ordered, [...ordered].sort((a, b) => state === "ascending" ? a - b : b - a));
    await assertTotals(table, [8, 100, 29000.19, 12300.51, 215.01, 16484.67, 5800.04]);
  }
  const downloadEvent = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Скачать таблицу (CSV)", exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.csv$/);
  const csv = await readFile(await download.path(), "utf8");
  const lines = csv.trim().split(/\r?\n/);
  assert.match(lines[0], /Выручка.*Начисленная зарплата/);
  assert.match(lines[1], /Итого.*29000\.19.*12300\.51.*215\.01.*16484\.67/);
  assert.match(csv, /"'=1\+1"/, "the legacy user-controlled source is exported as text");
  assert.match(csv, /;-500;/, "verified negative profit is exported as a number");
}

async function detailAndParity(page, panel, table) {
  await table.getByRole("button", { name: "Авито", exact: true }).click();
  const details = panel.locator(".of-drilldown:visible");
  await details.waitFor();
  const names = normalize(await details.innerText());
  assert.match(names, /Клиент Авито с дорогой/);
  assert.match(names, /Клиент Авито без дороги/);
  assert.doesNotMatch(names, /Клиент без источника|Майский заказ/);
  assert.match(names, /За всё время/);
  await assertSummary(panel, [2, 16001, 4365.49]);
  const firstOrder = details.getByRole("button", { name: /Клиент Авито с дорогой/ });
  await firstOrder.click();
  const orderDialog = page.getByRole("dialog", { name: "Клиент Авито с дорогой", exact: true });
  await orderDialog.getByRole("button", { name: "Назад к источнику", exact: true }).click();
  await firstOrder.and(page.locator(":focus")).waitFor();
  await firstOrder.click();
  await orderDialog.waitFor();
  await page.keyboard.press("Escape");
  await orderDialog.waitFor({ state: "hidden" });
  await firstOrder.and(page.locator(":focus")).waitFor();
  assert.match(normalize(await details.innerText()), /За всё время/);
  assert.equal(await reportBack(page).getAttribute("aria-label"), "Назад к источникам");
  await reportBack(page).click();
  assert.equal(await table.isVisible(), true, "return from source preserves the open detailed table");
  assert.equal(await periodSelect(panel).inputValue(), "all");
  await assertTotals(table, [8, 100, 29000.19, 12300.51, 215.01, 16484.67, 5800.04]);
  await reportBack(page).click();
  await page.getByRole("button", { name: /^Прибыль по заказам(?:\s*›)?$/ }).click();
  const profit = page.locator(".pr-detail:visible");
  await profit.locator(".pr-filter-button").click();
  await profit.getByRole("radio", { name: "За всё время", exact: true }).check();
  await profit.getByRole("button", { name: "Применить", exact: true }).click();
  const comparable = await Promise.all(["count", "revenue", "salary", "profit"].map(metric =>
    profit.locator('.pr-metric[data-metric="' + metric + '"] strong').textContent()));
  assert.deepEqual(comparable.map(amount), [8, 29000.19, 12300.51, 16484.67],
    "both reports show identical confirmed revenue, salary with travel, and profit after linked expenses");
  assert.match(normalize(await profit.locator(".pr-average").innerText()), /5\s*800,04/,
    "both reports derive the same average from the confirmed paid orders");
}

async function incompleteOverview(browser, engine) {
  const f = await setup(browser, 390, "owner");
  const { page } = f;
  try {
    const panel = await openFieldReport(page);
    const period = periodSelect(panel);
    await period.selectOption("custom");
    await panel.getByLabel("Начало периода", { exact: true }).fill("2026-03-01");
    await panel.getByLabel("Конец периода", { exact: true }).fill("2026-03-31");
    assert.match(normalize(await panel.innerText()), /[Нн]ет заказов|заказов нет/);
    assert.equal(await panel.locator(".of-chart").isVisible(), false);
    assert.equal(await panel.locator(".of-source-leader").isVisible(), false);
    await panel.getByRole("button", { name: "Показать за всё время", exact: true }).click();
    assert.equal(await period.inputValue(), "all");
    await assertSummary(panel, [8, 29000.19, 16484.67]);
    await tableToggle(panel).click();
    const download = panel.getByRole("button", { name: "Скачать таблицу (CSV)", exact: true });
    assert.equal(await download.isEnabled(), true);

    await page.evaluate(() => {
      const complete = window.__rdOwnerReportOrders;
      window.__rdOwnerReportOrders = () => complete().filter(row => ["refunded", "unpaid", "no-source"].includes(row.id));
      window.__rdReportUpdated();
      window.__rdOwnerReportOrders = complete;
    });
    await assertSummary(panel, [3, 8000, 7119.99]);
    assert.equal(await panel.locator(".of-source-leader").isVisible(), false,
      "neither an unknown source with a profit nor a known source with a loss receives a recommendation");

    await page.evaluate(() => {
      const complete = window.__rdPayrollSnapshot;
      const snapshot = complete();
      window.__rdPayrollSnapshot = () => ({ ...snapshot, accounting: { ...snapshot.accounting,
        receipts: snapshot.accounting.receipts.filter(receipt => receipt.orderId !== "no-source") },
      });
      window.fixtureRestorePayroll = () => {
        window.__rdPayrollSnapshot = complete;
        delete window.fixtureRestorePayroll;
      };
      window.__rdReportUpdated();
    });
    await assertSummary(panel, [8, 21000.19, 8484.67]);
    assert.equal(await panel.locator(".of-source-leader").isVisible(), false,
      "unverified orders can change which source is most profitable");
    const chart = panel.locator(".of-chart:visible");
    await sourceCard(chart, "").click();
    const drilldown = panel.locator(".of-drilldown:visible");
    assert.match(normalize(await drilldown.innerText()), /Клиент без источника.*Оплата на сверке/);
    await reportBack(page).click();

    await page.evaluate(() => {
      window.fixtureRestorePayroll();
      const financeStatus = window.__rdFinanceStatus;
      window.__rdFinanceStatus = () => ({ ...financeStatus(), stale: true });
      window.__rdReportUpdated();
    });
    assert.equal(await panel.locator(".of-source-leader").isVisible(), false,
      "stale data cannot recommend a source");
    assert.equal(await download.isEnabled(), false, "stale data cannot be exported as a current table");
    await assertSummary(panel, [8, 29000.19, 16484.67]);
    assert.match(normalize(await panel.innerText()), /последние загруженные суммы|последние данные|[Уу]старевш/);
    console.log("PASS", engine, "empty range, one-tap recovery, and recommendations skip missing, negative, unverified and stale sources");
  } finally {
    await f.close();
  }
}

async function ownerWorkflow(browser, engine) {
  const f = await setup(browser, 390, "owner");
  const { page, reads, documents, writes } = f;
  try {
    const panel = await openFieldReport(page);
    const grid = sourceTable(panel);
    const before = reads.length;
    await assertSourceOverview(page, panel);
    await tableToggle(panel).click();
    await grid.waitFor();
    await filterAndAccounting(page, grid, panel);
    await sortAndExport(page, panel, grid);
    assert.equal(reads.length, before, "grouping, filters, sorting, and CSV are local to the existing financial snapshot");
    await detailAndParity(page, panel, grid);
    assert.equal(writes.length, 0, "report interactions never write");
    assert.deepEqual(documents, ["/?view=reports"], "switching reports and drilldowns stays in one app document");
    console.log("PASS", engine, "immediate summary, source comparison, drilldown and return, Moscow periods, financial parity, sorting and CSV");
  } finally {
    await f.close();
  }
}

async function mobile(browser, engine, width) {
  const f = await setup(browser, width, "owner");
  try {
    const panel = await openFieldReport(f.page);
    const header = await assertHeaderLayout(f.page, "reports", null, { title: reportTitle, back: "Назад к отчётам" });
    const summary = await panel.getByLabel("Итоги за период", { exact: true }).boundingBox();
    assert.ok(summary && summary.y >= header.header.bottom - 1 && summary.y + summary.height < header.dockTop,
      "opening the report puts the summary between the fixed panels on the first screen");
    const firstCard = await panel.locator(".of-source-card").first().boundingBox();
    assert.ok(firstCard && firstCard.x >= 0 && firstCard.x + firstCard.width <= width + 1 &&
      firstCard.y >= header.header.bottom && firstCard.y + firstCard.height < header.dockTop && firstCard.height >= 44,
      "source comparison is visible and fits the viewport without a horizontal gesture");
    await tableToggle(panel).click();
    await totals(sourceTable(panel)).waitFor();
    const geometry = await panel.locator(".of-scroll").evaluate(scroll => {
      const table = scroll.querySelector("table");
      const head = table.querySelector("thead th");
      const total = table.querySelector("tbody tr:first-child > :first-child");
      const second = head.nextElementSibling;
      const before = [head, total, second].map(node => node.getBoundingClientRect().left);
      scroll.scrollLeft = scroll.scrollWidth;
      const after = [head, total, second].map(node => node.getBoundingClientRect().left);
      return { before, after, width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        scrolled: scroll.scrollLeft, firstCellWidth: head.getBoundingClientRect().width };
    });
    const { before, after } = geometry;
    assert.ok(geometry.documentWidth <= width + 1, JSON.stringify(geometry));
    assert.ok(geometry.scrolled > 100 && before[2] - after[2] > 100, JSON.stringify(geometry));
    assert.ok(Math.abs(before[0] - after[0]) <= 2 && Math.abs(before[1] - after[1]) <= 2,
      "header and total row retain the frozen first column " + JSON.stringify(geometry));
    assert.ok(geometry.firstCellWidth < geometry.width * 0.65, "sticky source leaves space for numeric columns");
    console.log("PASS", engine, width, "iPhone first screen, touch target and frozen first column");
  } finally {
    await f.close();
  }
}

async function permissions(browser, engine, role) {
  const f = await setup(browser, 390, role);
  try {
    const { page } = f;
    await page.goto(origin + "/?view=reports");
    await page.locator("#appScreen").waitFor();
    if (role === "master") {
      await page.locator('#mwMasterNav [data-mw-page="reports"]').click();
      await page.locator("#mwMasterReports").waitFor();
    }
    assert.equal(await reportEntry(page).count(), 0);
    assert.equal(await fieldReport(page).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__rdOwnerReportOrders?.()), []);
    assert.ok(f.reads.every(request => request.resource !== "rabota_finance_operations"),
      role + " cannot request owner financial operations");
    console.log("PASS", engine, role, "cannot open the source report");
  } finally {
    await f.close();
  }
}

async function benchmark(browser, engine) {
  const fields = ["avito", "instagram", "2gis", "yandex", "google", "vk", "telegram", "website",
    "recommendation", "walk_in", "regular", "other", "unknown", null];
  const extra = Array.from({ length: 1192 }, (_, index) => order(
    "history-" + index, 20000 + index, "Тестовый клиент " + index, 1000 + index,
    fields[index % fields.length], "2026-06-01T21:20:00Z", { paid: false }));
  const f = await setup(browser, 390, "owner", extra);
  try {
    const { page, reads } = f;
    const panel = fieldReport(page);
    const marker = reads.length;
    const renderMs = await reportEntry(page).evaluate(entry => {
      const start = performance.now();
      entry.click();
      document.querySelector(".of-chart").getBoundingClientRect();
      return performance.now() - start;
    });
    const grid = sourceTable(panel);
    await periodSelect(panel).selectOption("all");
    await tableToggle(panel).click();
    const sortTimings = await grid.getByRole("button", { name: "Оплаты", exact: true }).evaluate(button => {
      const samples = [];
      for (let index = 0; index < 7; index++) {
        const start = performance.now();
        button.click();
        button.closest("table").getBoundingClientRect();
        samples.push(performance.now() - start);
      }
      return samples.sort((a, b) => a - b);
    });
    await assertTotals(grid, [1200, 100, 29000.19, 12300.51, 215.01, 16484.67, 5800.04]);
    assert.equal(reads.length, marker, "large loaded data sets need no API requests for grouping and sorting");
    console.log("PASS", engine, "1200 orders: first overview", renderMs.toFixed(1), "ms, median table sort",
      sortTimings[3].toFixed(1), "ms");
  } finally {
    await f.close();
  }
}

async function main() {
  const engine = process.env.TEST_BROWSER || "chromium";
  assert.ok(["chromium", "webkit"].includes(engine));
  const browser = await (engine === "webkit" ? webkit : chromium).launch({
    executablePath: process.env.TEST_BROWSER_PATH || (engine === "chromium" ? process.env.CHROMIUM_PATH : undefined),
    args: engine === "chromium" ? ["--no-sandbox"] : [],
  });
  try {
    await ownerWorkflow(browser, engine);
    await incompleteOverview(browser, engine);
    for (const width of stickyWidths) await mobile(browser, engine, width);
    for (const role of ["manager", "master"]) await permissions(browser, engine, role);
    await benchmark(browser, engine);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
