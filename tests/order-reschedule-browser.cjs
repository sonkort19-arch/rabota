/* Quick rescheduling workflows with the actual CRM UI and isolated HTTP fixtures. */
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const { fixture } = require("./module-navigation-browser.cjs");

const source = path.resolve(__dirname, "..");
const today = "2031-04-09";
const originalDay = "2031-04-10";
const appointmentDay = "2031-04-13";
const memberId = "fixture-master";
const customer = "Клиент для переноса";
const initialRevision = today + "T03:00:00Z";
const targetId = "10000000-0000-4000-8000-000000000001";
const busyId = "10000000-0000-4000-8000-000000000002";
const concurrentId = "10000000-0000-4000-8000-000000000003";
const endpoint = name => new RegExp("/rest/v1/" + name + "(?:\\?|$)");
const dateLabel = date => date.split("-").reverse().join(".");
const withSlot = (slot, order) => ({
  ...order, appointment_date: slot.date, appointment_time: slot.time + ":00",
});
const dialog = page => page.locator(".rd-reschedule [role=dialog]");
const slotButtons = sheet => sheet.locator("[data-reschedule-slot]:visible");
const submit = sheet => sheet.getByRole("button", { name: /^Подтвердить перенос/ });

async function setup(browser, role = "owner", width = 390) {
  const f = await fixture(browser, source, width, role, {
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 }, standalone: true, height: 700,
  });
  const { page } = f;
  await page.clock.setFixedTime(new Date(today + "T05:00:00Z"));
  const makeOrder = props => ({
    created_at: initialRevision, updated_at: initialRevision, created_by: "fixture-owner",
    master: "Рауль", assigned_user_id: memberId, status: "Записан", paid: false,
    price: 10000, travel_amount: 1200, travel_taken: null, phone: "79181234567",
    details: "Комментарий, который должен остаться в заказе", address: "Город, улица Тестовая, 10",
    radiators: 7, floor_loops: 2, ...props,
  });
  const original = makeOrder(withSlot({ date: originalDay, time: "13:00" }, {
    id: targetId, name: customer, order_number: 10351,
  }));
  const busy = makeOrder(withSlot({ date: today, time: "14:00" }, {
    id: busyId, name: "Занятое окно", order_number: 10352,
  }));
  const state = { order: { ...original }, otherOrders: [busy], writes: [], events: [], historyReads: [], whatsapp: [],
    loseResponse: false, loseBeforeWrite: false, occupyNext: false };
  const receipts = new Map();
  let revision = 0;
  const timestamp = () => new Date(Date.parse(initialRevision) + (++revision * 1000)).toISOString();
  const rows = () => [state.order, ...state.otherOrders];
  const rpc = async (name, handle) => page.route(endpoint("rpc/" + name), async route => {
    assert.equal(route.request().headers().authorization, "Bearer fixture-access");
    assert.equal(route.request().method(), "POST");
    return handle(route, route.request().postDataJSON());
  });
  await page.context().route("https://wa.me/**", route => {
    state.whatsapp.push(new URL(route.request().url()));
    return route.fulfill({ status: 204 });
  });
  await page.route(endpoint("rabota_orders"), route => {
    const request = route.request();
    assert.equal(request.headers().authorization, "Bearer fixture-access");
    assert.equal(request.method(), "GET", "no new, canceled or partially patched order");
    const id = new URL(request.url()).searchParams.get("id");
    return route.fulfill({ json: id ? rows().filter(row => id === "eq." + row.id) : rows() });
  });
  await rpc("rabota_order_reschedule_history", (route, payload) => {
    assert.deepEqual(payload, { p_order_id: original.id });
    state.historyReads.push(payload.p_order_id);
    return route.fulfill({ json: state.events });
  });
  await rpc("rabota_reschedule_order", async (route, payload) => {
    assert.ok(role === "owner" || role === "manager");
    assert.deepEqual(Object.keys(payload).sort(), ["p_appointment_date", "p_appointment_time",
      "p_expected_updated_at", "p_order_id", "p_request_id"]);
    assert.equal(payload.p_order_id, original.id);
    assert.match(payload.p_request_id, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
    assert.match(payload.p_appointment_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(payload.p_appointment_time, /^\d{2}:\d{2}(?::00)?$/);
    state.writes.push(payload);
    if (state.loseBeforeWrite) {
      state.loseBeforeWrite = false;
      return route.abort("connectionreset");
    }
    const receipt = receipts.get(payload.p_request_id);
    if (receipt) {
      assert.deepEqual(payload, receipt.payload, "retry of an uncertain write preserves the original intent");
      return route.fulfill({ json: { state: "saved", event: receipt.event, replayed: true } });
    }
    if (payload.p_expected_updated_at !== state.order.updated_at)
      return route.fulfill({ json: { state: "stale" } });
    const slot = { date: payload.p_appointment_date, time: payload.p_appointment_time.slice(0, 5) };
    if (state.occupyNext) {
      state.occupyNext = false;
      state.otherOrders.push(makeOrder(withSlot(slot, {
        id: concurrentId, name: "Заказ, записанный другим сотрудником", order_number: 10353,
        updated_at: timestamp(),
      })));
      return route.fulfill({ json: { state: "occupied" } });
    }
    const movedAt = timestamp();
    const event = { id: payload.p_request_id, previous_date: state.order.appointment_date,
      previous_time: state.order.appointment_time.slice(0, 5), new_date: slot.date, new_time: slot.time,
      moved_at: movedAt, actor_name: role === "owner" ? "Владелец CRM" : "Менеджер CRM" };
    state.events.push(event);
    receipts.set(payload.p_request_id, { payload, event });
    state.order = { ...withSlot(slot, state.order), updated_at: movedAt };
    if (state.loseResponse) {
      state.loseResponse = false;
      return route.abort("connectionreset");
    }
    return route.fulfill({ json: { state: "saved", event, replayed: false } });
  });

  await page.goto("https://crm.test/?view=orders");
  await page.locator("#owViewSwitch").waitFor();
  if (role !== "master") await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
  return { ...f, original, state };
}

async function card(page, name = customer) {
  const detail = page.locator(".rd-order-dialog");
  if (!await detail.isVisible()) {
    await page.locator("#orders .rd-list-row:visible").filter({ hasText: name }).locator(".rd-list-toggle").click();
    await detail.waitFor();
  }
  return detail;
}

async function slotValues(sheet) {
  await slotButtons(sheet).first().waitFor();
  return slotButtons(sheet).evaluateAll(buttons => buttons.map(button => ({
    date: button.dataset.date, time: button.dataset.time,
  })));
}

async function openMove(page) {
  const order = await card(page);
  await order.getByRole("button", { name: "Перенести", exact: true }).click();
  const sheet = dialog(page);
  await page.getByRole("dialog", { name: "Перенести заказ", exact: true }).waitFor();
  return sheet;
}

async function waitForSave(sheet) {
  await sheet.getByRole("button", { name: "Готово", exact: true }).waitFor();
}

function assertPreserved(original, saved) {
  const businessData = ({ appointment_date, appointment_time, updated_at, ...unchanged }) => unchanged;
  assert.deepEqual(businessData(saved), businessData(original), "number, client, prices, travel, assignee and fields are preserved");
}

async function recommendedAndHistory(browser, engine) {
  const f = await setup(browser);
  const { page, state, original } = f;
  try {
    const order = await card(page);
    const button = order.getByRole("button", { name: "Перенести", exact: true });
    assert.equal(await button.evaluate(element => element.previousElementSibling?.textContent), "Изменить");
    const sheet = await openMove(page);
    assert.match(await sheet.innerText(), /Клиент для переноса/);
    assert.match(await sheet.innerText(), /10351/);
    assert.ok((await sheet.innerText()).includes(dateLabel(originalDay)));
    assert.match(await sheet.innerText(), /13:00/);
    assert.equal(await submit(sheet).isEnabled(), false);
    assert.deepEqual(await slotValues(sheet), [
      { date: today, time: "10:00" }, { date: today, time: "18:00" }, { date: originalDay, time: "10:00" },
    ], "the third candidate may overlap the order's own time that will be freed");
    assert.match(await slotButtons(sheet).first().innerText(), /Рекомендуем/);
    assert.equal(state.writes.length, 0, "opening never writes the suggested slot");
    await slotButtons(sheet).first().click();
    assert.equal(state.writes.length, 0, "choosing a slot alone never saves");
    assert.match(await sheet.innerText(), /10:00/);
    await submit(sheet).click();
    await waitForSave(sheet);
    assertPreserved(original, state.order);
    assert.equal(state.order.appointment_date, today);
    assert.equal(state.order.appointment_time, "10:00:00");
    assert.equal(state.writes.length, 1);
    assert.equal(state.events.length, 1);
    assert.deepEqual(f.documents, ["/?view=orders"], "save updates the calendar in the existing document");
    assert.equal(state.whatsapp.length, 0, "the message is offered without navigation or sending");
    await sheet.getByRole("link", { name: "Открыть WhatsApp", exact: true }).waitFor();
    await sheet.getByRole("button", { name: "Готово", exact: true }).click();
    await page.waitForFunction(id => getOrders().some(order => order.id === id && order.time === "10:00"), targetId);
    const refreshed = await card(page);
    const history = refreshed.locator(".rd-reschedule-history");
    assert.equal(state.historyReads.length, 0, "history loads when expanded");
    await history.locator("summary").click();
    await history.getByText(/Владелец CRM/).waitFor();
    const historyText = await history.innerText();
    assert.match(historyText, /13:00/);
    assert.match(historyText, /10:00/);
    assert.equal(state.historyReads.length, 1);
    await refreshed.getByRole("button", { name: "Закрыть заказ" }).click();
    const refreshedListRow = page.locator("#orders .rd-list-row:visible").filter({ hasText: customer });
    await refreshedListRow.getByText("10:00", { exact: true }).waitFor();
    await page.locator('#owViewSwitch [data-ow-mode="calendar"]').click();
    await page.locator(`#weekDays .day[data-date="${today}"]`).click();
    await refreshedListRow.getByText("10:00", { exact: true }).waitFor();
    await page.locator(`#weekDays .day[data-date="${originalDay}"]`).click();
    assert.equal(await refreshedListRow.count(), 0, "the previous day no longer contains the order");
    assert.deepEqual(f.documents, ["/?view=orders"]);
    console.log("PASS", engine, "three taps, ranked windows, preserved order, calendar and audit history");
  } finally {
    await f.close();
  }
}

async function occupiedAndWhatsApp(browser, engine) {
  const f = await setup(browser, "manager");
  const { page, state, original } = f;
  try {
    const sheet = await openMove(page);
    const first = (await slotValues(sheet))[0];
    state.occupyNext = true;
    await slotButtons(sheet).first().click();
    await submit(sheet).click();
    await sheet.getByRole("status").filter({ hasText: /занят/i }).waitFor();
    assert.ok(!(await slotValues(sheet)).some(slot => slot.date === first.date && slot.time === first.time));
    assert.equal(await submit(sheet).isEnabled(), false, "conflict requires a new choice");
    assert.deepEqual(state.order, original);
    assert.equal(state.events.length, 0);

    await sheet.getByRole("button", { name: "Выбрать другую дату", exact: true }).click();
    await sheet.locator("#rdRescheduleDate").fill(appointmentDay);
    await sheet.locator("#rdRescheduleTime").fill("16:30");
    const confirm = submit(sheet);
    await confirm.evaluate(button => {
      button.click();
      button.click();
    });
    await waitForSave(sheet);
    assertPreserved(original, state.order);
    assert.equal(state.order.appointment_date, appointmentDay);
    assert.equal(state.order.appointment_time, "16:30:00");
    assert.equal(state.writes.length, 2, "rapid confirmation clicks issue one RPC for the second choice");
    assert.notEqual(state.writes[0].p_request_id, state.writes[1].p_request_id);
    assert.equal(state.events.length, 1);
    assert.equal(state.whatsapp.length, 0);
    const whatsapp = sheet.getByRole("link", { name: "Открыть WhatsApp", exact: true });
    const [draft] = await Promise.all([
      page.context().waitForEvent("request", request => new URL(request.url()).hostname === "wa.me"),
      whatsapp.click(),
    ]);
    const url = new URL(draft.url());
    assert.equal(url.pathname, "/79181234567");
    assert.equal(url.searchParams.get("text"), "Здравствуйте! Ваша запись на промывку системы отопления перенесена на " +
      dateLabel(appointmentDay) + " в 16:30. Благодарим за понимание!");
    console.log("PASS", engine, "server slot race, another date, duplicate click and opt-in WhatsApp draft");
  } finally {
    await f.close();
  }
}

async function recoveryAndStale(browser, engine) {
  const f = await setup(browser);
  const { page, state, original } = f;
  try {
    let sheet = await openMove(page);
    state.loseResponse = true;
    await slotButtons(sheet).first().click();
    await submit(sheet).click();
    const retry = sheet.getByRole("button", { name: "Проверить перенос", exact: true });
    await retry.waitFor();
    assert.equal(state.events.length, 1, "first request committed even though the response was lost");
    const newPhone = "79997774455";
    state.order = { ...state.order, phone: newPhone, updated_at: today + "T05:19:00Z" };
    await retry.click();
    await waitForSave(sheet);
    assert.deepEqual(state.writes[1], state.writes[0]);
    assert.equal(state.events.length, 1);
    assertPreserved({ ...original, phone: newPhone }, state.order);
    const whatsapp = sheet.getByRole("link", { name: "Открыть WhatsApp", exact: true });
    await whatsapp.waitFor();
    assert.equal(new URL(await whatsapp.getAttribute("href")).pathname, "/" + newPhone,
      "the opt-in draft uses the current phone even after replay");
    await sheet.getByRole("button", { name: "Готово", exact: true }).click();

    sheet = await openMove(page);
    await slotButtons(sheet).first().click();
    state.order = { ...state.order, details: "Новый комментарий коллеги", updated_at: today + "T05:23:00Z" };
    await submit(sheet).click();
    await sheet.getByRole("status").filter({ hasText: /измен[иеё]/i }).waitFor();
    assert.equal(state.order.details, "Новый комментарий коллеги");
    assert.equal(state.events.length, 1);
    assert.equal(state.writes.length, 3, "concurrent edit needs a new confirmation");
    assert.equal(await submit(sheet).isEnabled(), false);
    await page.waitForFunction(id => getOrders().some(order => order.id === id && order.details === "Новый комментарий коллеги"), targetId);

    state.loseBeforeWrite = true;
    await slotButtons(sheet).first().click();
    await submit(sheet).click();
    await sheet.getByRole("button", { name: "Проверить перенос", exact: true }).waitFor();
    assert.equal(state.events.length, 1, "a transport interruption before the write adds no event");
    await page.reload();
    await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
    sheet = await openMove(page);
    await slotButtons(sheet).first().click();
    await submit(sheet).click();
    await waitForSave(sheet);
    assert.deepEqual(state.writes[4], state.writes[3], "retry after navigation recovers the persisted request identity");
    assert.equal(state.events.length, 2);
    assert.equal(state.order.details, "Новый комментарий коллеги");
    console.log("PASS", engine, "pre-commit and post-commit transport loss, stable retry and concurrent order edit");
  } finally {
    await f.close();
  }
}

async function mobile(browser, engine) {
  for (const [role, width] of [["owner", 320], ["manager", 375], ["owner", 390], ["manager", 430]]) {
    const f = await setup(browser, role, width);
    try {
      const sheet = await openMove(f.page);
      await slotButtons(sheet).first().waitFor();
      const geometry = await sheet.evaluate(element => {
        const { left, right, top, bottom } = element.getBoundingClientRect();
        return { left, right, top, bottom, width: innerWidth, height: innerHeight,
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
      });
      assert.ok(geometry.left >= -1 && geometry.right <= geometry.width + 1 &&
        geometry.top >= 45 && geometry.bottom <= geometry.height - 32 &&
        geometry.scrollWidth <= geometry.clientWidth + 1,
      "quick move fits the mobile viewport and safe areas: " + JSON.stringify(geometry));
      await sheet.getByRole("button", { name: "Выбрать другую дату", exact: true }).click();
      const time = sheet.locator("#rdRescheduleTime");
      await time.scrollIntoViewIfNeeded();
      const input = await time.boundingBox();
      assert.ok(input && input.x >= 0 && input.x + input.width <= width + 1);
      if (width === 390) {
        await sheet.getByRole("button", { name: "Закрыть перенос", exact: true }).focus();
        await f.page.keyboard.press("Shift+Tab");
        assert.equal(await f.page.evaluate(() => document.activeElement?.id), "rdRescheduleTime");
        await f.page.keyboard.press("Escape");
        await sheet.waitFor({ state: "hidden" });
        assert.equal(await f.page.evaluate(() => document.activeElement?.textContent), "Перенести");
      }
      assert.equal(f.state.writes.length, 0);
      console.log("PASS", engine, role, width, "quick move fits mobile safe areas");
    } finally {
      await f.close();
    }
  }
}

async function masterPermissions(browser, engine) {
  const f = await setup(browser, "master", 390);
  const { page, state } = f;
  try {
    await page.locator(`#weekDays .day[data-date="${originalDay}"]`).click();
    await page.locator(".master-schedule-card").filter({ hasText: customer }).locator(".master-schedule-toggle").click();
    const detail = page.getByRole("dialog", { name: "Заказ " + customer, exact: true });
    await detail.waitFor();
    assert.equal(await detail.getByRole("button", { name: "Перенести", exact: true }).count(), 0);
    const history = detail.locator(".rd-reschedule-history");
    await history.locator("summary").click();
    await history.getByText("Переносов пока не было.", { exact: true }).waitFor();
    assert.equal(state.historyReads.length, 1);
    assert.equal(state.writes.length, 0);
    console.log("PASS", engine, "master retains read-only history access for the assigned order");
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
    await recommendedAndHistory(browser, engine);
    await occupiedAndWhatsApp(browser, engine);
    await recoveryAndStale(browser, engine);
    await mobile(browser, engine);
    await masterPermissions(browser, engine);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
