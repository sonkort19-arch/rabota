/* Travel surcharge workflows with intercepted CRM HTTP requests and synthetic orders. */
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const { fixture, go } = require("./module-navigation-browser.cjs");

const source = path.resolve(__dirname, "..");
const origin = "https://crm.test";
const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
const earlier = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
const memberId = "fixture-master";
const routeFor = endpoint => new RegExp("/rest/v1/" + endpoint + "(?:\\?|$)");
const travelField = page => page.getByLabel("Дорога, ₽", { exact: true });
const orderOverlay = page => page.locator("#orderOverlay");
const saveOrder = page => page.getByRole("button", { name: "Сохранить заказ", exact: true }).click();
const stripSpaces = value => value.replace(/\s/g, "");
const money = amount => amount.toFixed(2).replace(".", ",") + "₽";

const travelCounted = row => row && (row.status !== "Отменён" || row.travel_taken === true)
  ? Number(row.travel_amount || 0) : 0;

async function setup(browser, role, width, options) {
  const f = await fixture(browser, source, width, role, options);
  const { page } = f;
  f.state.expenses.length = 0;
  const rows = [{
    id: "fixture-legacy", order_number: 10120, created_at: earlier + "T09:00:00Z", updated_at: earlier + "T09:00:00Z",
    appointment_date: earlier, appointment_time: "08:00:00", name: "Старый заказ", phone: "79001112233",
    status: "Записан", master: "Рауль", assigned_user_id: memberId, price: 2000, paid: false,
  }];
  const state = { rows, writes: [], events: [], payouts: [], loseCreateResponse: false, lostLookupId: null };
  let tick = 0;
  const stamp = () => new Date(Date.parse(day + "T05:00:00Z") + 1000 * ++tick).toISOString();
  const numeric = value => Number(value || 0);
  const travelEarned = () => state.events.reduce((total, row) => total + row.delta, 0);

  function registerTravelChange(row, previous) {
    const delta = travelCounted(row) - travelCounted(previous);
    if (!delta) return;
    state.events.push({
      id: `20000000-0000-4000-8000-${String(state.events.length + 1).padStart(12, "0")}`,
      order_id: row.id, order_number: row.order_number, delta, occurred_at: stamp(),
    });
  }

  await page.route("https://wa.me/**", route => route.fulfill({ status: 204 }));
  async function databaseRoute(endpoint, respond) {
    await page.route(routeFor(endpoint), route => {
      assert.equal(route.request().headers().authorization, "Bearer fixture-access");
      return respond(route);
    });
  }
  await databaseRoute("rabota_orders", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const filter = url.searchParams.get("id");
    if (request.method() === "GET") {
      if (filter && filter === "eq." + state.lostLookupId) {
        state.lostLookupId = null;
        return route.abort("connectionreset");
      }
      return route.fulfill({ json: filter ? rows.filter(row => filter === "eq." + row.id) : rows });
    }
    const changes = request.postDataJSON();
    state.writes.push({ endpoint: "orders", method: request.method(), data: changes });
    if (request.method() === "POST") {
      assert.match(changes.id, /^[\da-f-]{36}$/i);
      assert.ok(rows.every(row => row.id !== changes.id), "a repeated creation cannot add a second order");
      const date = stamp();
      const row = {
        order_number: 10120 + rows.length, created_at: date, updated_at: date,
        created_by: role === "master" ? memberId : "fixture-" + role, travel_amount: 0,
        ...changes, appointment_time: changes.appointment_time + ":00",
        assigned_user_id: String(changes.master).trim() === "Рауль" ? memberId : null,
      };
      rows.push(row);
      registerTravelChange(row);
      if (state.loseCreateResponse) {
        state.loseCreateResponse = false;
        state.lostLookupId = row.id;
        return route.abort("connectionreset");
      }
      return route.fulfill({ json: [row] });
    }
    assert.equal(request.method(), "PATCH");
    const row = rows.find(row => filter === "eq." + row.id);
    assert.ok(row, "only the selected order is patched");
    assert.equal(url.searchParams.get("updated_at"), "eq." + row.updated_at, "edit retains the concurrency guard");
    const previous = { ...row };
    Object.assign(row, changes, { updated_at: stamp() });
    registerTravelChange(row, previous);
    return route.fulfill({ json: [row] });
  });

  function payrollSnapshot() {
    const paidOrders = rows.filter(row => row.paid && row.status === "Выполнен");
    const orders = paidOrders.filter(row => row.assigned_user_id === memberId).map(row => ({
      order_id: row.id, paid_amount: row.price, earned_amount: row.price / 2 + 1500,
      company_share: row.price / 2 - 1500, earned_at: row.paid_at, rule_version: 3,
    }));
    const earned = orders.reduce((total, row) => total + row.earned_amount, 0) + travelEarned();
    const paid = state.payouts.reduce((total, row) => total + row.amount, 0);
    const balance = earned - paid;
    const receipts = paidOrders.map(row => ({
      order_id: row.id, master_id: row.assigned_user_id, amount: row.payment_amount,
      payment_method: row.payment_method, travel_amount: numeric(row.travel_amount), paid_at: row.paid_at, occurred_at: row.paid_at,
    }));
    return {
      version: 3, accounting_version: 1, activated_at: earlier + "T08:00:00Z", state: "active", master_id: memberId,
      earned, paid, due: Math.max(0, balance), balance, overpaid: Math.max(0, -balance), orders,
      travel_earned: travelEarned(), travel_events: state.events, payouts: state.payouts,
      accounting_receipts: receipts, accounting_refunds: [], accounting_payouts: state.payouts,
    };
  }
  await databaseRoute("rpc/rabota_payroll_snapshot_v3", route => route.fulfill({
    json: role === "manager" ? { version: 3, accounting_version: 1, activated_at: earlier + "T08:00:00Z", state: "not_applicable" } : payrollSnapshot(),
  }));
  await databaseRoute("rpc/rabota_record_order_payment", route => {
    const payment = route.request().postDataJSON();
    state.writes.push({ endpoint: "payment", method: "POST", data: payment });
    const row = rows.find(item => item.id === payment.p_order_id);
    assert.ok(row && !row.paid, "payment is recorded after the unpaid order is saved");
    assert.equal(payment.p_amount, row.price + numeric(row.travel_amount));
    const date = stamp();
    Object.assign(row, { paid: true, status: "Выполнен", payment_amount: payment.p_amount,
      payment_method: payment.p_method, payment_received_by: "company", paid_at: date,
      completed_at: row.completed_at || date, paid_by: "fixture-owner", updated_at: date });
    return route.fulfill({ json: { ok: true, amount: payment.p_amount, method: payment.p_method, receiver: "company" } });
  });
  await databaseRoute("rpc/rabota_payroll_payout_v3", route => {
    const payout = route.request().postDataJSON();
    const before = payrollSnapshot();
    assert.equal(payout.p_master_user_id, memberId);
    assert.ok(payout.p_amount <= before.due);
    state.writes.push({ endpoint: "payout", method: "POST", data: payout });
    const id = `30000000-0000-4000-8000-${String(state.payouts.length + 1).padStart(12, "0")}`;
    state.payouts.push({ id, order_id: null, amount: payout.p_amount, payment_method: payout.p_payment_method,
      note: payout.p_note, created_at: stamp(), kind: "raul_payout" });
    const { earned, paid, due } = payrollSnapshot();
    return route.fulfill({ json: { id, amount: payout.p_amount, earned, paid, due, replayed: false } });
  });
  await page.goto(origin + "/?view=orders");
  await page.locator("#owViewSwitch").waitFor();
  return { ...f, state, payrollSnapshot };
}

async function fillOrder(page, name, { wash = "10000", travel = "1000", time = "13:00" } = {}) {
  await page.locator("#newOrderBtn").click();
  assert.equal(await travelField(page).inputValue(), "0", "new orders start with no surcharge");
  await page.locator("#clientName").fill(name);
  await page.locator("#clientPhone").fill("+79990000089");
  await page.locator("#clientSource").selectOption("unknown");
  await page.locator("#master").fill("Рауль");
  await page.locator("#orderTime").fill(time);
  await page.locator("#price").fill(wash);
  await travelField(page).fill(travel);
}

async function orderCard(page, name) {
  const list = page.locator("#orders .rd-list-row:visible").filter({ hasText: name });
  await list.locator(".rd-list-toggle").click();
  const card = page.locator(".rd-order-dialog");
  await card.waitFor();
  return card;
}

async function editOrder(page, name) {
  const card = await orderCard(page, name);
  await card.getByRole("button", { name: "Изменить", exact: true }).click();
  await orderOverlay(page).waitFor();
}

async function changeStatus(page, status) {
  const advanced = page.locator("#orderAdvanced");
  if (await advanced.getAttribute("open") === null) await advanced.locator("summary").click();
  await page.locator("#orderStatus").selectOption(status);
}

async function salary(page, expectedDue) {
  await go(page, "reports");
  const report = page.locator("#rdSalaryReport .fp-v3-payroll");
  if (await page.locator("#rdSalaryReport").isHidden()) await page.locator("#rdReports .rd-salary-entry").click();
  await report.waitFor();
  try {
    await page.waitForFunction(expected =>
      document.querySelector("#rdSalaryReport .fp-balance-value")?.textContent.replace(/\s/g, "") === expected,
    money(expectedDue));
  } catch (error) {
    throw new Error(`Expected salary balance ${money(expectedDue)}. Report shows: ` +
      await page.locator("#rdSalaryReport").innerText(), { cause: error });
  }
  return report;
}

const amountNearLabel = (text, label, amount) => {
  const parts = String(amount).split(".");
  const number = parts[0].replace(/(\d)(?=(\d{3})+$)/g, "$1\\s*");
  assert.match(text, new RegExp("(?:" + label + ")[^\\d]*" + number + "(?:[,.]00)?\\s*₽", "i"));
};

async function paymentWorkflow(browser) {
  const f = await setup(browser, "owner", 390);
  const { page, state } = f;
  const name = "Промывка с выездом";
  try {
    await fillOrder(page, name);
    assert.match(stripSpaces(await page.locator("#orderCustomerTotal").innerText()), /^11000(?:,00)?₽$/);
    const [bookingRequest] = await Promise.all([
      page.waitForRequest(request => new URL(request.url()).hostname === "wa.me"), saveOrder(page),
    ]);
    await orderOverlay(page).waitFor({ state: "hidden" });
    const bookingDraft = new URL(bookingRequest.url()).searchParams.get("text");
    amountNearLabel(bookingDraft, "Стоимость промывки", 10000);
    amountNearLabel(bookingDraft, "Дорога", 1000);
    amountNearLabel(bookingDraft, "Итого", 11000);
    const order = state.rows.find(row => row.name === name);
    assert.equal(order.price, 10000);
    assert.equal(order.travel_amount, 1000);
    assert.equal(order.assigned_user_id, memberId);
    assert.equal(order.paid, false);
    assert.equal(state.events.length, 1);

    const card = await orderCard(page, name);
    const text = await card.innerText();
    amountNearLabel(text, "Промывк[аи]|Стоимость промывки", 10000);
    amountNearLabel(text, "Дорога", 1000);
    amountNearLabel(text, "Итого(?: для клиента)?|Сумма к оплате", 11000);
    await card.getByRole("button", { name: "Закрыть заказ" }).click();

    const before = await salary(page, 1000);
    const travelRow = before.locator(".fp-ledger-row").filter({ hasText: /Дорога/ });
    await travelRow.waitFor();
    assert.match(await travelRow.innerText(), /№10121/);
    assert.match(stripSpaces(await travelRow.innerText()), /\+1000,00₽/);

    await go(page, "orders");
    await editOrder(page, name);
    assert.equal(await travelField(page).inputValue(), "1000");
    await changeStatus(page, "Выполнен");
    const payment = page.locator(".rd-pay-overlay");
    await payment.waitFor();
    assert.match(stripSpaces(await payment.locator("#rdPaySumValue").innerText()), /^11000(?:,00)?₽$/);
    await payment.getByRole("button", { name: /^Получено/ }).click();
    await orderOverlay(page).waitFor({ state: "hidden" });
    assert.equal(order.price, 10000, "confirming a gross receipt preserves the wash price");
    assert.equal(order.payment_amount, 11000);
    assert.equal(state.events.length, 1, "recording payment does not accrue travel a second time");
    assert.equal(state.writes.filter(write => write.endpoint === "payment").length, 1);

    const after = await salary(page, 7500);
    const washRow = after.locator(".fp-ledger-row").filter({ hasText: name }).filter({ hasNotText: /Дорога/ });
    await washRow.waitFor();
    assert.match(stripSpaces(await washRow.innerText()), /\+6500,00₽/);
    assert.equal(await after.locator(".fp-ledger-row").filter({ hasText: /Дорога/ }).count(), 1);

    await go(page, "finance");
    const company = page.locator("#financePanel .mw-money-stat").filter({ hasText: "Прибыль компании" });
    await company.waitFor();
    amountNearLabel(await company.innerText(), "Прибыль компании", 3500);
    const received = page.locator("#financePanel .mw-money-stat").filter({ hasText: "Оплаты заказов" });
    amountNearLabel(await received.innerText(), "Оплаты заказов", 11000);
    for (const label of ["Поступило за дорогу", "Начислено за дорогу"])
      amountNearLabel(await page.locator("#financePanel .mw-money-stat").filter({ hasText: label }).innerText(), label, 1000);

    await go(page, "reports");
    if (await page.locator("#rdSalaryReport").isVisible()) await page.locator("#rdScreenBack").click();
    await page.getByRole("button", { name: /^Прибыль по заказам/ }).click();
    const profit = page.locator(".pr-table tbody tr").filter({ hasText: name });
    await profit.getByRole("button", { name: "№10121", exact: true }).click();
    const profitDetail = await page.locator(".pr-expanded:not([hidden])").innerText();
    amountNearLabel(profitDetail, "Итого по заказу", 11000);
    amountNearLabel(profitDetail, "Получено за дорогу", 1000);
    amountNearLabel(profitDetail, "Начислено за дорогу", 1000);
    assert.match(stripSpaces(await profit.innerText()), /3500(?:,00)?₽/);
  } finally {
    await f.close();
  }
}

async function recoveryAndCancellation(browser) {
  const f = await setup(browser, "owner", 390);
  const { page, state } = f;
  const name = "Выезд с неподтверждённым ответом";
  try {
    state.loseCreateResponse = true;
    await fillOrder(page, name);
    await saveOrder(page);
    await page.locator("#formStatus").filter({ hasText: /Сохранение заказа не подтверждено/ }).waitFor();
    const created = state.rows.find(row => row.name === name);
    assert.equal(state.events.length, 1);
    await page.reload();
    await page.locator("#owViewSwitch").waitFor();
    await fillOrder(page, name);
    await saveOrder(page);
    await page.getByRole("button", { name: "Проверить предыдущую запись", exact: true }).click();
    await orderOverlay(page).waitFor({ state: "hidden" });
    assert.equal(state.writes.filter(write => write.method === "POST").length, 1);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].order_id, created.id);

    await editOrder(page, name);
    await travelField(page).fill("1250");
    await saveOrder(page);
    await orderOverlay(page).waitFor({ state: "hidden" });
    assert.equal(created.travel_amount, 1250);
    assert.deepEqual(state.events.map(row => row.delta), [1000, 250]);
    await editOrder(page, name);
    await saveOrder(page);
    await orderOverlay(page).waitFor({ state: "hidden" });
    assert.deepEqual(state.events.map(row => row.delta), [1000, 250], "saving the same fee does not add an accrual");
    const report = await salary(page, 1250);
    await report.getByRole("button", { name: "Выплатить всё", exact: true }).click();
    const payout = page.getByRole("dialog", { name: "Выплата — Рауль" });
    await payout.getByLabel("Способ выплаты").selectOption("cash");
    await payout.getByLabel("Комментарий").fill("Выплата доплаты за дорогу");
    await payout.getByRole("button", { name: "Подтвердить выплату" }).click();
    const receipt = page.getByRole("dialog", { name: "Выплата проведена" });
    await receipt.getByRole("button", { name: "Закрыть", exact: true }).click();
    assert.equal(state.payouts[0].amount, 1250);

    await go(page, "orders");
    await editOrder(page, name);
    await changeStatus(page, "Отменён");
    const trip = page.locator("#orderTravelTaken");
    await trip.waitFor();
    assert.equal(await trip.inputValue(), "");
    await saveOrder(page);
    assert.equal(created.status, "Записан", "a paid travel accrual cannot disappear without the trip decision");
    await trip.selectOption("false");
    await saveOrder(page);
    await orderOverlay(page).waitFor({ state: "hidden" });
    assert.equal(created.travel_taken, false);
    assert.deepEqual(state.events.map(row => row.delta), [1000, 250, -1250]);
    const cancelled = await salary(page, 0);
    amountNearLabel(await cancelled.locator(".fp-travel-overpayment").innerText(), "Переплата", 1250);
    assert.equal(await cancelled.locator(".fp-balance-payout:enabled").count(), 0);
    await cancelled.getByRole("button", { name: "Выплаты", exact: true }).click();
    await cancelled.getByText("Выплата доплаты за дорогу", { exact: true }).waitFor();

    await go(page, "orders");
    const takenName = "Отмена после поездки";
    await fillOrder(page, takenName, { travel: "500" });
    await saveOrder(page);
    await orderOverlay(page).waitFor({ state: "hidden" });
    const taken = state.rows.find(row => row.name === takenName);
    await editOrder(page, takenName);
    await changeStatus(page, "Отменён");
    await trip.selectOption("true");
    await saveOrder(page);
    await orderOverlay(page).waitFor({ state: "hidden" });
    assert.equal(taken.travel_taken, true);
    assert.deepEqual(state.events.filter(row => row.order_id === taken.id).map(row => row.delta), [500]);
    assert.equal(f.payrollSnapshot().overpaid, 750, "the next accrual offsets the previous overpayment");
    const retained = await salary(page, 0);
    amountNearLabel(await retained.locator(".fp-travel-overpayment").innerText(), "Переплата", 750);
  } finally {
    await f.close();
  }
}

async function widths(browser, engine) {
  for (const role of ["owner", "manager", "master"]) {
    for (const width of [320, 375, 390, 430]) {
      const f = await setup(browser, role, width, {
        safeArea: { top: 47, right: 0, bottom: 34, left: 0 }, standalone: true,
      });
      try {
        await f.page.locator("#newOrderBtn").click();
        const input = travelField(f.page);
        assert.equal(await input.inputValue(), "0");
        assert.equal(await input.isEditable(), true);
        assert.equal(await f.page.locator("#orderTravelTaken").isVisible(), false);
        await input.scrollIntoViewIfNeeded();
        const layout = await input.evaluate(element => {
          const { left, right, width } = element.getBoundingClientRect();
          const scroller = document.getElementById("orderFormScroll");
          return { left, right, width, viewport: innerWidth, clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth };
        });
        assert.ok(layout.width > 0 && layout.left >= -2 && layout.right <= layout.viewport + 2 &&
          layout.scrollWidth <= layout.clientWidth + 2,
        `${engine} ${role} ${width}px travel field fits the order form ${JSON.stringify(layout)}`);
        assert.deepEqual(f.state.writes, []);
        console.log("PASS", engine, role, width, "travel input fits mobile form");
      } finally {
        await f.close();
      }
    }
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
    await paymentWorkflow(browser);
    console.log("PASS", engine, "10000 + 1000 = 11000; wash payroll 6500; Raul due 7500; company profit 3500");
    await recoveryAndCancellation(browser);
    console.log("PASS", engine, "travel retry, adjustment, trip cancellation and overpayment audit");
    await widths(browser, engine);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
