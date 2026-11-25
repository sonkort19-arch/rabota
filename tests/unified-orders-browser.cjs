/* Unified orders workspace browser regression.
 * The real app is served from this checkout. Every request is intercepted:
 * synthetic responses only, with no network fallback.
 * Run with NODE_PATH pointing to Playwright, and optionally CHROMIUM_PATH.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const {mockAccountingSnapshot}=require("./fixtures/legacy-payroll.cjs");

const ROOT = path.resolve(__dirname, "..");
const CAPTURE_DIR = process.env.RABOTA_SCREENSHOT_DIR || "/tmp/rabota-unified-qa";
// UTC is still November, but the user's business date in Moscow is December 1.
const FIXED_TIME = new Date("2026-11-30T21:30:00Z");
const TODAY = "2026-12-01";
const TOMORROW = "2026-12-02";
const EMPTY_DAY = "2026-12-03";
const CANCELLED_DAY = "2026-12-04";
const COMPLETED_DAY = "2026-12-05";
const CARD_SELECTOR = "#orders .master-schedule-card:visible, #orders .rd-list-row:visible";

const MEMBERS = [
  { user_id: "fixture-owner", role: "owner", active: true, email: "owner@example.invalid" },
  { user_id: "fixture-manager", role: "manager", active: true, email: "manager@example.invalid" },
  { user_id: "fixture-raul", role: "master", active: true, master_name: "Рауль", email: "raul@example.invalid" },
  { user_id: "fixture-other", role: "master", active: true, master_name: "Другой мастер", email: "other@example.invalid" },
];

function order(id, name, date, time, status = "Записан", extra = {}) {
  return {
    id: "fixture-" + id, name, appointment_date: date, appointment_time: time,
    status, master: "Рауль", assigned_user_id: "fixture-raul",
    phone: "+79990000001", address: "Тестовая улица, 1",
    radiator_type: "Алюминиевые", radiators: 4, floor_loops: 1,
    price: 11000, paid: status === "Выполнен", client_source: "recommendation",
    order_number: 10100 + id, created_at: "2026-11-20T08:00:00Z",
    completed_at: status === "Выполнен" ? date + "T08:00:00Z" : null,
    ...extra,
  };
}

const ORDERS = [
  order(1, "Клиент Сегодня", TODAY, "10:00:00"),
  order(2, "Работа Сегодня", TODAY, "15:00:00", "В работе"),
  order(3, "Готовый Сегодня", TODAY, "08:00:00", "Выполнен"),
  order(4, "Отмена Сегодня", TODAY, "13:00:00", "Отменён"),
  order(5, "Клиент Завтра", TOMORROW, "12:00:00"),
  order(6, "Архив Завершён", "2026-11-21", "11:00:00", "Выполнен", { paid: false }),
  order(7, "Архив Отмена", "2026-11-11", "14:00:00", "Отменён"),
  order(8, "Только Отмена", CANCELLED_DAY, "10:00:00", "Отменён"),
  order(9, "Только Выполнен", COMPLETED_DAY, "09:00:00", "Выполнен"),
  order(10, "Чужой Мастер", TODAY, "10:30:00", "Записан", {
    master: "Другой мастер", assigned_user_id: "fixture-other",
  }),
  order(11, "Чужой Архив", "2026-11-21", "16:00:00", "Выполнен", {
    master: "Другой мастер", assigned_user_id: "fixture-other",
  }),
];

async function session(browser, role, width, writeFixture = null) {
  const context = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: width < 790, hasTouch: width < 790,
    timezoneId: "Europe/Moscow", locale: "ru-RU", serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(10000);
  await page.clock.setFixedTime(FIXED_TIME);
  const member = MEMBERS.find(candidate => candidate.role === role);
  const writes = [], unexpected = [], errors = [], missing = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(() => {
    localStorage.setItem("rabota-auth-session-v1", JSON.stringify({
      access_token: "synthetic-fixture-token", refresh_token: "synthetic-fixture-refresh",
      expires_at: 4102444800,
    }));
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") {
      writes.push(request.method() + " " + url.pathname);
      if (writeFixture?.expireAuth && url.pathname === "/auth/v1/token")
        return route.fulfill({ status: 401, json: { message: "Synthetic expired session" } });
      if (writeFixture?.payrollV3 && url.pathname === "/rest/v1/rpc/rabota_record_order_payment") {
        const fields=request.postDataJSON(),saved=writeFixture.saved;
        assert.equal(fields.p_order_id,saved.id);
        assert.equal(fields.p_amount,saved.price);
        assert.equal(saved.paid,false,"order save must not write an unverified payment");
        assert.equal(saved.payment_amount,undefined);
        Object.assign(saved,{paid:true,payment_amount:fields.p_amount,payment_method:fields.p_method,
          payment_received_by:"company",paid_by:member.user_id,paid_at:FIXED_TIME.toISOString()});
        return route.fulfill({json:{ok:true,amount:fields.p_amount,method:fields.p_method,receiver:"company"}});
      }
      if (writeFixture?.payrollV3 && url.pathname === "/rest/v1/rpc/rabota_payroll_refund_v3") {
        const fields=request.postDataJSON(),saved=writeFixture.saved;
        assert.equal(role,"owner");
        assert.equal(fields.p_order_id,saved.id);
        assert.equal(fields.p_amount,saved.payment_amount);
        assert.equal(fields.p_note,"Согласованный полный возврат");
        assert.match(fields.p_request_id,/^[0-9a-f-]{36}$/i);
        saved.status="Отменён";
        saved.updated_at=new Date(FIXED_TIME.getTime()+1000).toISOString();
        writeFixture.refund={order_id:saved.id,amount:fields.p_amount,refunded_at:saved.updated_at};
        return route.fulfill({json:{...writeFixture.refund,replayed:false}});
      }
      if (writeFixture && url.pathname === "/rest/v1/rabota_orders" && request.method() === "POST") {
        assert.equal(writeFixture.saved, undefined, "the form sent a duplicate write");
        const fields = request.postDataJSON();
        writeFixture.saved = { ...order(12, fields.name, fields.appointment_date, fields.appointment_time), ...fields };
        return route.fulfill({ json: [writeFixture.saved] });
      }
      return route.abort();
    }
    if (url.origin === "https://crm.test") {
      if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
      const filename = path.resolve(ROOT, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
      if (!filename.startsWith(ROOT + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        missing.push(url.pathname);
        return route.fulfill({ status: 404, body: "Missing fixture asset" });
      }
      return route.fulfill({ path: filename });
    }
    const endpoint = url.pathname.split("/").pop();
    if (url.pathname === "/auth/v1/user")
      return route.fulfill({ json: { id: member.user_id, email: member.email } });
    if (url.pathname.startsWith("/rest/v1/")) {
      if (endpoint === "rabota_payroll_snapshot_v3" && writeFixture?.payrollV3) {
        const saved=writeFixture.saved,paid=saved?.paid&&saved.status==="Выполнен";
        const orders=paid?[{order_id:saved.id,paid_amount:saved.payment_amount,earned_amount:11500,
          company_share:8500,earned_at:saved.paid_at,rule_version:3}]:[];
        const earned=paid?11500:0;
        const receipts=saved?.paid?[{order_id:saved.id,amount:saved.payment_amount,
          master_id:"fixture-raul",payment_method:saved.payment_method,paid_at:saved.paid_at,occurred_at:saved.paid_at}]:[];
        return route.fulfill({json:{version:3,state:"active",master_id:"fixture-raul",activated_at:"2026-11-24T09:00:00Z",
          earned,paid:0,due:earned,orders,payouts:[],accounting_version:1,accounting_receipts:receipts,accounting_payouts:[],refunds:writeFixture.refund?[writeFixture.refund]:[]}});
      }
      if (endpoint === "rabota_members") {
        let members = MEMBERS;
        if (url.searchParams.has("user_id")) {
          const requested = url.searchParams.get("user_id").replace(/^eq\./, "");
          members = MEMBERS.filter(candidate => candidate.user_id === requested);
        } else if (url.searchParams.get("role") === "eq.master") {
          members = MEMBERS.filter(candidate => candidate.role === "master");
        }
        return route.fulfill({ json: members });
      }
      // Deliberately include another master's rows to test the UI's role scope too.
      if (endpoint === "rabota_orders") {
        if(writeFixture?.saved && writeFixture.offline)
          return route.fulfill({ status: 503, json: { message: "Test network unavailable" } });
        return route.fulfill({ json: writeFixture?.saved ? [writeFixture.saved, ...ORDERS] : ORDERS });
      }
      if (["rabota_finance_operations", "rabota_cash_collections", "rabota_cash_deposits", "rabota_cashbook_entries",
        "rabota_order_notifications", "rabota_push_subscriptions", "rabota_leads",
        "rabota_ai_chats", "rabota_ai_messages", "rabota_ai_order_drafts"].includes(endpoint))
        return route.fulfill({ json: [] });
    }
    unexpected.push(request.method() + " " + url.origin + url.pathname);
    return route.abort();
  });
  if(!writeFixture?.payrollV3)await mockAccountingSnapshot(context,{role});
  await page.goto("https://crm.test/");
  await page.locator("#appScreen.rd-unified-orders").waitFor({ state: "visible" });
  await page.locator("#owViewSwitch").waitFor({ state: "visible" });
  await page.locator(CARD_SELECTOR).filter({ hasText: "Клиент Сегодня" }).first().waitFor();
  return {
    page, context, role, width, writes, unexpected, errors, missing,
    async close() {
      await context.close();
      if (!writeFixture) assert.deepEqual(writes, [], role + ": no write requests");
      assert.deepEqual(unexpected, [], role + ": no unhandled external requests");
      assert.deepEqual(missing, [], role + ": all app assets exist in checkout");
      assert.deepEqual(errors, [], role + ": no JavaScript errors");
    },
  };
}

const cards = page => page.locator(CARD_SELECTOR);
const selectedDay = page => page.locator("#weekDays .day.active").getAttribute("data-date");
async function namesInclude(page, names) {
  for (const name of names) await cards(page).filter({ hasText: name }).first().waitFor({ state: "visible" });
}
async function chooseMode(page, mode) {
  await page.locator('#owViewSwitch [data-ow-mode="' + mode + '"]').click();
  assert.equal(await page.locator('#owViewSwitch [data-ow-mode="' + mode + '"]').getAttribute("aria-selected"), "true");
}
async function chooseDay(page, date) {
  await page.locator('#weekDays .day[data-date="' + date + '"]').click();
  assert.equal(await selectedDay(page), date);
}
async function capture(page, name) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURE_DIR, name + ".png") });
}
async function resetFilters(page) {
  await page.locator("#owFilterToggle").click();
  await page.locator("#owFilterReset").click();
  await page.locator("#owFilterApply").click();
}

async function checkGeometry(s) {
  const { page, role, width } = s;
  assert.equal(await selectedDay(page), TODAY, role + ": Moscow date, not UTC date");
  assert.equal(await page.locator('#owViewSwitch [data-ow-mode="calendar"]').getAttribute("aria-selected"), "true");
  const tools = await page.locator("#ordersArea #owTools .ow-toolbar").evaluate(row => {
    const buttons = [...row.querySelectorAll("button")].filter(button => button.getClientRects().length);
    return buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width, height: box.height, center: box.y + box.height / 2 };
    });
  });
  assert.equal(tools.length, 4, role + ": calendar, all orders, search and filters share one row");
  assert.ok(tools.every((tool, index) => tool.width >= 44 && tool.height >= 44 &&
    Math.abs(tool.center - tools[0].center) < 2 && tool.left >= 0 &&
    tool.right <= width && (index === 0 || tool.left >= tools[index - 1].right)),
  role + ": toolbar controls fit as separate touch targets: " + JSON.stringify(tools));
  const geometry = await page.locator("#weekDays").evaluate(strip => {
    const box = strip.getBoundingClientRect();
    const visible = [...strip.querySelectorAll(".day")].filter(day => {
      const rect = day.getBoundingClientRect(), center = rect.x + rect.width / 2;
      return center >= box.left && center < box.right && rect.height > 0;
    });
    return {
      dates: visible.map(day => day.dataset.date),
      minDayWidth: Math.min(...visible.map(day => day.getBoundingClientRect().width)),
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  assert.equal(geometry.dates.length, 7, role + ": exactly seven visible day centers: " + JSON.stringify(geometry));
  assert.equal(new Set(geometry.dates).size, 7, role + ": no duplicate dates");
  assert.ok(geometry.minDayWidth >= 30, role + ": dates remain tappable");
  assert.ok(geometry.overflow <= 2, role + ": no horizontal document overflow");
  const cancelledDay = page.locator('#weekDays .day[data-date="' + CANCELLED_DAY + '"]');
  assert.doesNotMatch(await cancelledDay.getAttribute("class"), /\bhas-orders\b/, "cancelled orders do not occupy a day");
  assert.match(await cancelledDay.getAttribute("class"), /\bworkload-free\b/, "cancelled-only day stays free");
  assert.match(await page.locator('#weekDays .day[data-date="' + COMPLETED_DAY + '"]').getAttribute("class"),
    /\bworkload-completed\b/, "completed-only date has the completed visual state");
  if (width <= 790) {
    const nav = page.locator(role === "master" ? "#mwMasterNav" : "#rdMobileNav");
    const expected = role === "master" ? ["orders", "payments", "reports", "settings"] :
      role === "owner" ? ["orders", "expenses", "finance", "reports", "more"] : ["orders", "leads", "clients", "settings", "more"];
    const actions = await nav.locator("button:visible").evaluateAll(buttons =>
      buttons.map(button => button.dataset.mwPage || button.dataset.page || (button.id==="rdMobileMoreBtn"?"more":"unknown")));
    assert.deepEqual(actions, expected, role + ": correct role-specific actions; manager gains no financial rights");
    const boxes=await nav.locator("button:visible").evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width}}));
    assert.ok(boxes.every(b=>Math.abs(b.top-boxes[0].top)<1&&Math.abs(b.bottom-boxes[0].bottom)<1&&b.width>=44),role+": mobile navigation fits in one tappable row");
    const position = await nav.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { bottom: box.bottom, viewport: innerHeight, position: getComputedStyle(element).position };
    });
    assert.equal(position.position, "fixed", role + ": bottom navigation stays fixed");
    assert.ok(Math.abs(position.bottom - position.viewport) <= 3, role + ": navigation touches viewport bottom");
    const navBox = await nav.boundingBox(), addBox = await page.locator("#newOrderBtn").boundingBox();
    assert.ok(addBox && navBox && addBox.y + addBox.height <= navBox.y + 2,
      role + ": add button stays above the bottom navigation");
  }
  await capture(page, role + "-day-" + width);
}

async function checkFilters(s) {
  const { page, role } = s;
  await chooseMode(page, "all");
  const original = await cards(page).count();
  const toggle = page.locator("#ordersArea #owTools #owFilterToggle");
  await toggle.click();
  assert.equal(await page.locator("#ordersArea #owTools #owFilters").isVisible(), true);
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#owFilterMaster").isVisible(), role !== "master");
  await page.locator("#owFilterStatus").selectOption("Выполнен");
  assert.equal(await cards(page).count(), original, "draft filter does not change results");
  await page.locator("#owFilterCancel").click();
  assert.equal(await cards(page).count(), original, "cancel leaves applied filter unchanged");
  await page.locator("#owFilterToggle").click();
  assert.equal(await page.locator("#owFilterStatus").inputValue(), "", "cancel discarded draft status");
  await page.locator("#owFilterStatus").selectOption("Выполнен");
  await page.locator("#owFilterApply").click();
  await namesInclude(page, ["Готовый Сегодня", "Архив Завершён", "Только Выполнен"]);
  assert.equal(await cards(page).count(), role === "master" ? 3 : 4);
  const statuses = await cards(page).evaluateAll(rows => rows.map(row => row.dataset.status));
  assert.ok(statuses.every(status => status === "Выполнен"), "applied status filter is accurate");
  // Completed cards must use neutral styling rather than a green completion fill.
  const completedStyle = await cards(page).first().evaluate(card => {
    const badge = card.querySelector(".status-badge, .rd-list-state") || card;
    return { background: getComputedStyle(badge).backgroundColor, card: getComputedStyle(card).backgroundColor };
  });
  const components = completedStyle.background.match(/[\d.]+/g)?.map(Number) || [];
  if (components.length >= 3 && (components.length < 4 || components[3] > 0))
    assert.ok(Math.max(...components.slice(0, 3)) - Math.min(...components.slice(0, 3)) <= 40,
      "completed status uses neutral tones: " + JSON.stringify(completedStyle));
  await page.locator("#owFilterToggle").click();
  await page.locator("#owFilterReset").click();
  await page.locator("#owFilterCancel").click();
  assert.equal(await cards(page).count(), role === "master" ? 3 : 4, "cancelled reset does not apply");
  await resetFilters(page);
  assert.equal(await cards(page).count(), original, "Reset/Apply restores all results");

  await page.locator("#owFilterToggle").click();
  await page.locator("#owFilterDate").fill(TOMORROW);
  await page.locator("#owFilterApply").click();
  await namesInclude(page, ["Клиент Завтра"]);
  assert.equal(await cards(page).count(), 1, "all-orders date filter limits the results");
  await resetFilters(page);
  if (role !== "master") {
    await page.locator("#owFilterToggle").click();
    await page.locator("#owFilterMaster").selectOption("Другой мастер");
    await page.locator("#owFilterApply").click();
    await namesInclude(page, ["Чужой Мастер", "Чужой Архив"]);
    assert.equal(await cards(page).count(), 2, "owner/manager master filter is applied");
    await resetFilters(page);
  }
}

async function checkInteraction(s) {
  const { page, role } = s;
  const nav = page.locator(role === "master" ? "#mwMasterNav" : "#rdMobileNav");
  const attribute = role === "master" ? "data-mw-page" : "data-page";
  await namesInclude(page, ["Клиент Сегодня", "Работа Сегодня", "Готовый Сегодня"]);
  assert.equal(await cards(page).filter({ hasText: "Чужой Мастер" }).count(), role === "master" ? 0 : 1);
  const cancelled = page.locator(".ow-cancelled-toggle");
  assert.equal(await cancelled.getAttribute("aria-expanded"), "false");
  await cancelled.click();
  await namesInclude(page, ["Отмена Сегодня"]);
  await cards(page).filter({ hasText: "Отмена Сегодня" }).locator("button").first().click();
  const existingDialog = page.locator(role === "master" ? ".master-order-sheet" : ".rd-order-dialog");
  await existingDialog.waitFor({ state: "visible" });
  assert.match(await existingDialog.innerText(), /Отмена Сегодня/);
  await existingDialog.getByRole("button", { name: "Закрыть заказ", exact: true }).click();
  await cancelled.click();
  assert.equal(await page.locator(".ow-cancelled-body").isVisible(), false);

  await chooseDay(page, TOMORROW);
  await namesInclude(page, ["Клиент Завтра"]);
  assert.equal(await cards(page).count(), 1);
  await chooseMode(page, "all");
  await namesInclude(page, ["Клиент Сегодня", "Клиент Завтра", "Архив Завершён", "Архив Отмена"]);
  await capture(page, role + "-all-390");
  await chooseMode(page, "calendar");
  assert.equal(await selectedDay(page), TOMORROW, "day survives mode switch");

  await page.locator("#ordersArea #owTools #owSearchToggle").click();
  assert.equal(await page.locator("#ordersArea #owTools #owSearch").isVisible(), true);
  assert.equal(await page.getByRole("searchbox", { name: "Поиск по всем заказам" }).isVisible(), true);
  await page.locator("#owSearchInput").fill("Архив");
  await namesInclude(page, ["Архив Завершён", "Архив Отмена"]);
  assert.equal(await cards(page).count(), role === "master" ? 2 : 3,
    "search spans dates and completed/cancelled statuses while retaining role scope");
  await nav.locator('button[' + attribute + '="orders"]').click();
  assert.equal(await page.locator("#owSearch").isVisible(), true, "reselecting Orders keeps the active global search");
  assert.equal(await page.locator("#owSearchInput").inputValue(), "Архив");
  await namesInclude(page, ["Архив Завершён", "Архив Отмена"]);
  assert.equal(await cards(page).count(), role === "master" ? 2 : 3,
    "reselecting Orders does not narrow the search back to the selected date");
  await page.locator("#owSearchInput").fill("Чужой");
  if (role === "master") {
    assert.equal(await cards(page).count(), 0, "master cannot search other masters' jobs");
  } else {
    await namesInclude(page, ["Чужой Мастер", "Чужой Архив"]);
    assert.equal(await cards(page).count(), 2);
  }
  await page.locator("#owSearchClose").click();
  assert.equal(await page.locator("#owSearch").isVisible(), false);
  assert.equal(await selectedDay(page), TOMORROW, "search close restores selected day");
  await namesInclude(page, ["Клиент Завтра"]);

  const destination = role === "master" ? "payments" : role === "owner" ? "finance" : "clients";
  await nav.locator('button[' + attribute + '="' + destination + '"]').click();
  await nav.locator('button[' + attribute + '="orders"]').click();
  await page.locator("#owViewSwitch").waitFor({ state: "visible" });
  assert.equal(await selectedDay(page), TOMORROW, "day survives leaving and returning to orders");

  await page.locator("#newOrderBtn").click();
  await page.locator("#orderOverlay").waitFor({ state: "visible" });
  assert.equal(await page.locator("#orderDate").inputValue(), TOMORROW, "create form uses the selected date");
  if (role === "master") {
    assert.equal(await page.locator("#master").inputValue(), "Рауль");
    assert.equal(await page.locator("#master").evaluate(input => input.readOnly), true);
    assert.equal(await page.locator("#orderStatus").isDisabled(), true);
  }
  await page.locator("#clientName").fill("Несохранённый тест");
  await page.locator("#closeOrderBtn").click();
  assert.equal(await page.locator("#orderOverlay").isVisible(), false);
  assert.deepEqual(s.writes, [], "creating and cancelling a draft writes nothing");

  await chooseDay(page, EMPTY_DAY);
  assert.equal(await cards(page).count(), 0, "empty day stays empty");
  const nearest = page.locator("#masterTodaySummary .master-next-jump");
  await nearest.waitFor({ state: "visible" });
  assert.match(await nearest.innerText(), /Клиент Сегодня/);
  await nearest.click();
  await existingDialog.waitFor({ state: "visible" });
  assert.match(await existingDialog.innerText(), /Клиент Сегодня/, "nearest outside the selected day opens original order dialog");
  if (role === "master") assert.equal(await existingDialog.locator(".action.edit").count(), 0, "master gains no edit control");
  else assert.equal(await existingDialog.locator(".action.edit").count(), 1, "owner/manager original edit action is retained");
  await existingDialog.getByRole("button", { name: "Закрыть заказ", exact: true }).click();
  await checkFilters(s);
  await chooseMode(page, "calendar");
  await chooseDay(page, TODAY);
  await page.locator("#owFilterToggle").click();
  await capture(page, role + "-filters-390");
  await page.locator("#owFilterCancel").click();
  if (role === "owner") await checkOwnerDashboard(page);
  if (role === "owner" || role === "master") await checkWhatsAppSettings(s, nav, attribute);
}

async function checkWhatsAppSettings({ page, role }, nav, attribute) {
  const direct=nav.locator('button[' + attribute + '="settings"]');
  if(await direct.count())await direct.tap();
  else{await page.locator("#rdMobileMoreBtn").tap();await page.locator('#rdMobileMoreSheet [data-page="settings"]').tap();}
  const settings = page.locator(role === "master" ? "#mwMasterSettings" : "#rdSettings");
  const entry = settings.getByRole("button", { name: /^WhatsApp/ });
  const heading = settings.getByRole("heading", { name: "WhatsApp · сообщения клиентам" });

  await entry.tap();
  const back = settings.getByRole("button", { name: "← Настройки", exact: true });
  assert.equal(await heading.evaluate(element => document.activeElement === element), true, "tap focuses the heading");
  assert.equal(await back.evaluate(element => getComputedStyle(element).outlineStyle), "none", "tap does not outline the back button");
  await capture(page, role + "-whatsapp-settings-390");
  await back.tap();
  assert.equal(await entry.getAttribute("aria-expanded"), "false");

  await entry.press("Enter");
  assert.equal(await back.evaluate(element => document.activeElement === element), true, "keyboard opens at the back button");
  assert.equal(await back.evaluate(element => getComputedStyle(element).outlineStyle), "solid", "keyboard focus remains visible");
  await back.press("Enter");
  assert.equal(await entry.evaluate(element => document.activeElement === element), true, "closing restores focus to the entry");
}

async function checkOwnerDashboard(page) {
  async function home() {
    await page.locator("#rdMobileMoreBtn").click();
    await page.locator('#rdMobileMoreSheet [data-page="home"]').click();
    await page.locator("#rdHome").waitFor({ state: "visible" });
  }
  await home();
  await page.locator("#rdHome").getByRole("button", { name: /^Сегодня:/ }).click();
  await namesInclude(page, ["Клиент Сегодня", "Работа Сегодня", "Готовый Сегодня"]);
  assert.equal(await selectedDay(page), TODAY, "Home Today opens the unified day view");
  await home();
  await page.locator("#rdHome").getByRole("button", { name: /^Долги:/ }).click();
  await namesInclude(page, ["Архив Завершён"]);
  assert.equal(await cards(page).count(), 1, "Home debt metric opens the unpaid filter across dates");
  await home();
  await page.locator("#rdHome .rd-home-upcoming [role=button]").click();
  const dialog = page.locator(".rd-order-dialog");
  await dialog.waitFor({ state: "visible" });
  assert.match(await dialog.innerText(), /Клиент Сегодня/, "Home nearest opens the original order dialog");
  await dialog.getByRole("button", { name: "Закрыть заказ", exact: true }).click();
}

async function checkSavedOrderAfterReconnect(browser) {
  const fixture = { offline: true };
  const s = await session(browser, "manager", 390, fixture);
  try {
    const { page, writes } = s;
    await chooseDay(page, EMPTY_DAY);
    await page.locator("#newOrderBtn").click();
    await page.locator("#clientName").fill("Тест подтверждённой записи");
    await page.locator("#clientPhone").fill("+79990000087");
    await page.locator("#clientSource").selectOption("unknown");
    await page.locator("#orderTime").fill("13:00");
    await page.locator('#orderForm button[type="submit"]').click();
    await page.locator("#orderOverlay").waitFor({ state: "hidden" });
    await page.locator("#syncStatus").filter({ hasText: "Заказ сохранён. Список пока не обновился." }).waitFor();
    assert.deepEqual(writes, ["POST /rest/v1/rabota_orders"]);
    fixture.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await namesInclude(page, ["Тест подтверждённой записи"]);
    assert.deepEqual(writes, ["POST /rest/v1/rabota_orders"], "reconnect reads without resubmitting the form");
  } finally {
    await s.close();
  }
}

async function checkDialogsCloseOnExpiredSession(browser, role) {
  const s = await session(browser, role, 390, { expireAuth: true });
  try {
    const { page, writes } = s;
    if (role === "manager") {
      await page.locator("#owSearchToggle").click();
      await page.locator("#owSearchInput").fill("Тест конфиденциального поиска");
      await page.locator("#newOrderBtn").click();
      await page.locator("#clientName").fill("Тест конфиденциального черновика");
      await page.locator("#orderAdvanced > summary").click();
      await page.locator("#orderStatus").selectOption("Выполнен");
      await page.locator(".rd-pay-overlay").getByText("Тест конфиденциального черновика").waitFor();
    } else {
      await cards(page).filter({ hasText: "Клиент Сегодня" }).locator("button").first().click();
      await page.locator(role === "master" ? ".master-order-sheet" : ".rd-order-dialog").waitFor();
    }
    await page.evaluate(() => {
      session.expires_at = 0;
      window.dispatchEvent(new Event("online"));
    });
    await page.locator("#loginScreen").waitFor();
    assert.equal(await page.locator("#orderOverlay").isVisible(), false);
    assert.equal(await page.locator(".master-order-sheet, .rd-order-dialog, .rd-pay-overlay").count(), 0);
    assert.equal(await page.locator("#clientName").inputValue(), "");
    assert.equal(await page.locator("#owSearchInput").inputValue(), "");
    assert.deepEqual(writes, ["POST /auth/v1/token"], "no order/payment mutation on expiry");
  } finally {
    await s.close();
  }
}

async function checkActivatedPaymentAndRefund(browser) {
  const fixture={payrollV3:true};
  const s=await session(browser,"owner",390,fixture);
  try{
    const {page,writes}=s;
    await page.waitForFunction(()=>window.__rdPayrollSnapshot?.()?.accountingVersion===1);
    await chooseDay(page,EMPTY_DAY);
    await page.locator("#newOrderBtn").click();
    await page.locator("#clientName").fill("Тест оплаты и возврата");
    await page.locator("#clientPhone").fill("+79990000089");
    await page.locator("#clientSource").selectOption("unknown");
    await page.locator("#master").fill("Рауль");
    await page.locator("#orderTime").fill("13:00");
    await page.locator("#price").fill("20000");
    await page.locator("#orderAdvanced > summary").click();
    await page.locator("#orderStatus").selectOption("Выполнен");
    const payment=page.locator(".rd-pay-overlay");
    await payment.getByText("Полная стоимость заказа").waitFor();
    assert.equal(await payment.locator(".rd-pay-change").isVisible(),false);
    assert.equal(await payment.locator("#rdPayAmount").count(),0);
    await payment.getByRole("button",{name:/^Получено 20/}).click();
    await page.locator("#orderOverlay").waitFor({state:"hidden"});
    assert.deepEqual(writes,["POST /rest/v1/rabota_orders","POST /rest/v1/rpc/rabota_record_order_payment"]);
    assert.equal(fixture.saved.payment_amount,20000);
    await cards(page).filter({hasText:"Тест оплаты и возврата"}).locator("button").first().click();
    const orderDialog=page.locator(".rd-order-dialog");
    await orderDialog.getByText("Оплачено · наличные").waitFor();
    assert.equal(await orderDialog.getByRole("button",{name:"Изменить",exact:true}).count(),0);
    assert.equal(await orderDialog.locator(".compact-select").isDisabled(),true);
    page.once("dialog",dialog=>dialog.accept("Согласованный полный возврат"));
    await orderDialog.getByRole("button",{name:"Учесть полный возврат",exact:true}).click();
    await page.waitForFunction(ref=>getOrders().some(order=>order.id===ref&&order.status==="Отменён"),fixture.saved.id);
    assert.deepEqual(writes,["POST /rest/v1/rabota_orders","POST /rest/v1/rpc/rabota_record_order_payment",
      "POST /rest/v1/rpc/rabota_payroll_refund_v3"]);
    assert.equal(fixture.saved.paid,true,"refund preserves the original receipt");
    assert.equal(fixture.saved.payment_amount,20000);
  }finally{await s.close();}
}

(async () => {
  const kind = process.env.TEST_BROWSER || "chromium";
  const browser = await (kind === "webkit" ? webkit : chromium).launch({
    executablePath: process.env.TEST_BROWSER_PATH || process.env.CHROMIUM_PATH || undefined,
    args: kind === "chromium" ? ["--no-sandbox"] : [],
  });
  try {
    const roles = process.env.RABOTA_TEST_ROLES?.split(",") || ["owner", "manager", "master"];
    const widths = process.env.RABOTA_TEST_WIDTHS?.split(",").map(Number) || [320, 375, 390, 430, 1024];
    for (const role of roles) {
      for (const width of widths) {
        const s = await session(browser, role, width);
        try {
          await checkGeometry(s);
          if (width === 390) await checkInteraction(s);
        } catch (error) {
          await capture(s.page, role + "-" + width + "-failed").catch(() => {});
          throw error;
        } finally {
          await s.close();
        }
        console.log("PASS", kind, role, width, width === 390 ? "full workflow" : "responsive smoke");
      }
    }
    await checkSavedOrderAfterReconnect(browser);
    console.log("PASS", kind, "confirmed save, failed refresh and reconnect");
    await checkActivatedPaymentAndRefund(browser);
    console.log("PASS",kind,"active payroll full payment and audited refund");
    for (const role of roles) {
      await checkDialogsCloseOnExpiredSession(browser, role);
      console.log("PASS", kind, role, "private dialogs close on expired session");
    }
    console.log("Passed unified orders: Moscow startup, roles, dates, history, search, filters, original dialogs and draft cancellation");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
