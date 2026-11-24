"use strict";

// Playwright regression and before/after benchmark with the same isolated HTTP fixtures.
// Run with TEST_BROWSER=chromium or webkit; BASELINE_ROOT can point to a git archive of main.
// Set BENCHMARK_ONLY=1 to measure navigation without the layout and interaction checks.
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { chromium, webkit, devices } = require("playwright");

const root = path.resolve(__dirname, "..");
const browserName = process.env.TEST_BROWSER || "chromium";
const widths = [320, 375, 390, 430];
const delayMs = 75;
const origin = "https://crm.test";
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
const stamp = today + "T08:00:00Z";
const fixtureMaster = { user_id: "fixture-master", role: "master", active: true, master_name: "Рауль" };
const expense = { id: "fixture-expense", kind: "expense", amount: 1200, note: "[Запчасти] Тестовый расход",
  created_at: stamp, voided_at: null, order_id: null };
const task = { id: "fixture-task", owner_id: "fixture-owner", kind: "day", title: "Тестовая задача",
  start_on: today, end_on: today, sort_order: 0, completed: false };
const roles = ["owner", "manager", "master"];
const trace = endpoint => ["user", "membership", "orders", "expenses", "operations", "growth"].includes(endpoint);

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture(browser, source, width, role) {
  const context = await browser.newContext({
    ...devices["iPhone 13"], viewport: { width, height: 760 }, screen: { width, height: 760 },
    timezoneId: "Europe/Moscow", reducedMotion: "reduce", serviceWorkers: "block",
  });
  const state = { expenses: [{ ...expense }], tasks: [{ ...task }], fail: new Set(), gates: new Map() };
  const orders = Array.from({ length: 18 }, (_, i) => ({
    id: "fixture-order-" + i, name: "Тестовый заказ " + i, assigned_user_id: fixtureMaster.user_id,
    master: fixtureMaster.master_name, status: "Записан", price: 1000, appointment_date: today,
    appointment_time: "12:00:00", created_at: stamp, updated_at: stamp,
  }));
  const member = role === "master" ? fixtureMaster : { user_id: "fixture-" + role, role, active: true };
  const requests = [], documents = [], writes = [], errors = [];
  await context.addInitScript(() => {
    localStorage.setItem("rabota-auth-session-v1", JSON.stringify({
      access_token: "fixture-access", refresh_token: "fixture-refresh", expires_at: 4102444800,
    }));
    window.fixtureDocument = crypto.randomUUID();
    window.observeFixtureNavigation = () => {
      const transition = JSON.parse(sessionStorage.getItem("fixture-transition") || "null");
      if (!transition) return;
      const { start, selectors } = transition;
      const visibleAt = {};
      function frame() {
        const elapsed = performance.timeOrigin + performance.now() - start;
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (node?.getClientRects().length && getComputedStyle(node).visibility === "visible")
            visibleAt[selector] ??= elapsed;
        }
        if (selectors.every(selector => Object.hasOwn(visibleAt, selector))) {
          window.fixtureVisibleAt = visibleAt;
          sessionStorage.removeItem("fixture-transition");
        } else if (elapsed < 10000) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    };
    window.observeFixtureNavigation();
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      if (request.isNavigationRequest()) documents.push(url.pathname + url.search);
      const name = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.resolve(source, "." + name);
      if (!file.startsWith(source + path.sep) || !existsSync(file))
        return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: file });
    }
    if (!url.hostname.endsWith(".supabase.co")) return route.abort();
    assert.equal(request.headers().authorization, "Bearer fixture-access");
    const endpoint = url.pathname.split("/").pop();
    const bucket = ({
      rabota_orders: "orders", rabota_growth_plan: "growth",
      rabota_finance_operations: url.searchParams.has("kind") ? "expenses" : "operations",
      rabota_members: url.searchParams.has("user_id") ? "membership" : "staff",
    })[endpoint] || endpoint;
    requests.push(bucket);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await state.gates.get(bucket)?.promise;
    if (state.fail.delete(bucket)) return route.abort("internetdisconnected");
    let json = [];
    if (request.method() !== "GET") {
      assert.equal(role, "owner", "fixture owner-only mutation");
      const payload = request.postDataJSON();
      writes.push({ endpoint, method: request.method(), payload });
      if (endpoint === "rabota_finance_record") {
        state.expenses.push({ ...expense, id: "fixture-new-expense", amount: payload.p_amount, note: payload.p_note });
      } else if (endpoint === "rabota_finance_void") {
        const item = state.expenses.find(row => row.id === payload.p_operation_id);
        item.voided_at = stamp;
      } else if (endpoint === "rabota_growth_plan" && request.method() === "PATCH") {
        assert.equal(url.searchParams.get("owner_id"), "eq.fixture-owner");
        const item = state.tasks.find(row => url.searchParams.get("id") === "eq." + row.id);
        Object.assign(item, payload);
        json = [item];
      } else assert.fail("Unexpected write to " + endpoint);
    } else {
      if (endpoint === "user") json = { id: member.user_id, email: member.user_id + "@test.invalid" };
      if (bucket === "membership") json = url.searchParams.has("role") && role !== "owner" ? [] : [member];
      if (bucket === "staff") json = [member, fixtureMaster];
      if (bucket === "orders") json = orders;
      if (bucket === "growth") json = role === "owner" ? state.tasks : [];
      if (["expenses", "operations"].includes(bucket)) json = role === "owner" ? state.expenses : [];
    }
    return route.fulfill({ json });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  async function close() {
    for (const gate of state.gates.values()) gate.release();
    await context.close();
    assert.deepEqual(errors, []);
  }
  return { page, state, requests, documents, writes, close };
}

function navigation(page, view) {
  const dock = page.locator('#rdMobileNav [data-page="' + view + '"]');
  return { dock, menu: page.locator('#rdMobileMoreSheet [data-page="' + view + '"]') };
}

async function destination(page, view) {
  const { dock, menu } = navigation(page, view);
  if (await dock.count()) return dock;
  await page.locator("#rdMobileMoreBtn").click();
  return menu;
}

async function go(page, view) {
  await (await destination(page, view)).click();
}

async function watchTransition(page, button, shell, content) {
  // Measure the first frame where each selector is visible using the same clock across documents.
  await button.evaluate((element, selectors) => {
    element.addEventListener("click", () => {
      window.fixtureVisibleAt = null;
      sessionStorage.setItem("fixture-transition", JSON.stringify({
        start: performance.timeOrigin + performance.now(), selectors,
      }));
      window.observeFixtureNavigation();
    }, { once: true, capture: true });
  }, [shell, content]);
  await button.click();
  const firstVisibleFrame = await page.waitForFunction(() => window.fixtureVisibleAt);
  const times = await firstVisibleFrame.jsonValue();
  return { interfaceMs: Math.round(times[shell]), dataMs: Math.round(times[content]) };
}

async function ownerBenchmark(browser, source, width, baseline) {
  const s = await fixture(browser, source, width, "owner");
  const { page, requests, documents } = s;
  try {
    await page.goto(origin);
    await page.locator("#rdMobileNav").waitFor();
    await page.waitForFunction(() => document.getElementById("calendarPanel")?.getClientRects().length);
    const documentId = await page.evaluate(() => window.fixtureDocument);
    // Keep startup reads outside the switch counters.
    await page.waitForLoadState("networkidle");
    const result = {};
    async function measure(view, button, shell, content) {
      const requestStart = requests.length, documentStart = documents.length;
      result[view] = {
        ...await watchTransition(page, button, shell, content),
        requests: requests.slice(requestStart).filter(trace),
        documents: documents.length - documentStart,
      };
    }
    await measure("expenses", await destination(page, "expenses"), "#exMain", "#exList .ex-item");
    if (baseline) await page.locator("#exMoreButton").click();
    await measure("growth", baseline ? page.locator('#exMore a[href="/growth.html"]') : await destination(page, "growth"),
      "#gwMain", "#gwContent .gw-task");
    await measure("orders", baseline ? page.locator('#gwBottom a[href="/?view=orders"]') : await destination(page, "orders"),
      "#ordersArea", "#calendarPanel");
    if (!baseline) {
      assert.equal(await page.evaluate(() => window.fixtureDocument), documentId, "same browser document");
      for (const entry of Object.values(result)) {
        assert.equal(entry.documents, 0, "switch must not load an HTML document");
        assert.ok(entry.requests.every(name => !["user", "membership", "orders", "expenses"].includes(name)),
          "switch must reuse auth and shared reads: " + JSON.stringify(entry));
      }
      assert.equal(result.growth.requests.filter(name => name === "growth").length, 1);
    }
    return result;
  } finally { await s.close(); }
}

async function assertDock(page, role) {
  const nav = page.locator(role === "master" ? "#mwMasterNav" : "#rdMobileNav");
  await nav.waitFor();
  const state = await nav.evaluate(node => {
    const { bottom, top } = node.getBoundingClientRect();
    const box = node => {
      const { top, bottom, left, right, width } = node.getBoundingClientRect();
      return { top, bottom, left, right, width };
    };
    const buttons = [...node.querySelectorAll("button, a")].map(box);
    return { bottom, top, buttons, viewport: innerHeight, width: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  assert.equal(state.buttons.length, role === "master" ? 4 : 5);
  assert.ok(Math.abs(state.bottom - state.viewport) <= 3, JSON.stringify(state));
  assert.ok(state.documentWidth <= state.width + 1, "page must not overflow horizontally: " + JSON.stringify(state));
  for (const [index, button] of state.buttons.entries()) {
    assert.ok(button.width >= 40 && Math.abs(button.top - state.buttons[0].top) < 1 &&
      Math.abs(button.bottom - state.buttons[0].bottom) < 1 &&
      (index === 0 || state.buttons[index - 1].right <= button.left + 1), JSON.stringify(state));
  }
  return state;
}

async function roleLayout(browser, width, role) {
  const s = await fixture(browser, root, width, role);
  const { page, requests, documents } = s;
  try {
    await page.goto(origin + (role === "owner" ? "/" : "/?view=growth"));
    await page.locator("#appScreen").waitFor();
    await page.locator("#ordersArea").waitFor();
    await assertDock(page, role);
    const identity = await page.evaluate(() => window.fixtureDocument);
    let previousHeader;
    const selectors = {
      home: "#rdHome", orders: "#ordersArea", expenses: "#exMain", growth: "#gwMain",
      leads: "#rdLeads", clients: "#rdClients", settings: "#rdSettings", reports: "#rdReports",
      finance: "#financePanel", masterSettings: "#mwMasterSettings", masterReports: "#mwMasterReports",
      masterPayments: "#mwMasterPayments",
    };
    const views = role === "master" ? ["payments", "reports", "settings", "orders"] :
      role === "manager" ? ["leads", "clients", "settings", "home", "orders"] :
        ["home", "expenses", "growth", "finance", "reports", "leads", "clients", "settings", "orders"];
    for (const view of views) {
      if (role === "master") await page.locator('#mwMasterNav [data-mw-page="' + view + '"]').click();
      else await go(page, view);
      const key = role === "master" && view !== "orders" ? "master" + view[0].toUpperCase() + view.slice(1) : view;
      await page.locator(selectors[key]).waitFor();
      const dock = await assertDock(page, role);
      if (role !== "master") {
        assert.equal(await page.locator("#rdMobileMoreBtn").getAttribute("aria-expanded"), "false");
        assert.equal(await page.locator('#rdMobileNav [aria-current="page"]').count(), 1);
      }
      if (role === "owner" && ["expenses", "growth"].includes(view)) {
        const header = await page.locator("#rdProfileToggle").boundingBox();
        assert.ok(header && header.y >= 0 && header.x + header.width <= width + 1, JSON.stringify(header));
        if (previousHeader) assert.ok(Math.abs(header.y - previousHeader.y) <= 2, "header jumps between modules");
        previousHeader = header;
      }
      if (role !== "master" && view === "orders") {
        const add = page.locator("#newOrderBtn");
        const button = await add.boundingBox();
        assert.ok(button && button.x >= 0 && button.x + button.width <= width + 1);
        assert.ok(button.y + button.height <= dock.top + 1, "new order must sit above the navigation");
        await add.click({ trial: true });
      }
    }
    if (role !== "master") {
      await page.locator("#rdMobileMoreBtn").click();
      const menu = await page.locator("#rdMobileMoreSheet").boundingBox();
      const dock = await assertDock(page, role);
      assert.ok(menu && menu.y >= 0 && menu.y + menu.height <= dock.top + 1);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#rdMobileMoreBtn").getAttribute("aria-expanded"), "false");
    }
    assert.equal(await page.evaluate(() => window.fixtureDocument), identity);
    assert.equal(documents.length, 1);
    if (role !== "owner") {
      assert.equal(await page.locator("#exMain:visible, #gwMain:visible").count(), 0);
      assert.ok(!requests.includes("growth") && !requests.includes("expenses"), JSON.stringify(requests));
      assert.equal(await page.locator('#rdMobileNav [data-page="expenses"], #rdMobileMoreSheet [data-page="growth"]').count(), 0);
    }
    assert.deepEqual(s.writes, []);
  } finally { await s.close(); }
}

async function dataFlow(browser) {
  const s = await fixture(browser, root, 390, "owner");
  const { page, state, requests, documents, writes } = s;
  state.gates.set("orders", deferred());
  state.gates.set("growth", deferred());
  state.gates.set("operations", deferred());
  state.fail.add("growth");
  try {
    await page.goto(origin + "/?view=growth");
    await page.locator("#gwMain").waitFor();
    await page.locator("#rdMobileNav").waitFor();
    assert.equal(await page.locator("#gwContent .gw-task").count(), 0);
    assert.equal(await page.locator("#startupScreen:visible, #gwGate:visible").count(), 0);
    state.gates.get("growth").release();
    await page.locator("#gwRetry").click();
    await page.getByRole("checkbox", { name: task.title }).waitFor();
    await page.getByRole("checkbox", { name: task.title }).check();
    await page.waitForFunction(() => document.querySelector("#gwContent .gw-task.is-complete"));
    state.gates.get("orders").release();
    await go(page, "expenses");
    assert.equal(requests.filter(value => value === "operations").length, 1, "startup and Expenses share the running ledger read");
    assert.equal(await page.locator("#exList .ex-item").count(), 0);
    state.gates.get("operations").release();
    await page.locator("#exList").getByText("Тестовый расход").waitFor();
    await page.locator("#exAmount").fill("99,50");
    await page.locator("#exDetail").fill("Тестовая запись");
    await page.locator("#exSave").click();
    const savedExpense = page.locator("#exList .ex-item").filter({ hasText: "Тестовая запись" });
    await savedExpense.waitFor();
    page.once("dialog", dialog => dialog.accept());
    await savedExpense.getByRole("button", { name: /отменить/i }).click();
    await savedExpense.waitFor({ state: "hidden" });
    await go(page, "orders");
    state.expenses[0].note = "[Запчасти] Обновлённый расход";
    state.tasks[0].title = "Обновлённая задача";
    state.fail.add("operations");
    await go(page, "expenses");
    await page.locator("#exRetry").waitFor();
    await page.locator("#exList").getByText("Тестовый расход").waitFor();
    await page.locator("#exRetry").click();
    await page.locator("#exList").getByText("Обновлённый расход").waitFor();
    const previousGrowthReads = requests.filter(value => value === "growth").length;
    state.gates.set("growth", deferred());
    await go(page, "growth");
    await page.getByRole("checkbox", { name: task.title }).waitFor();
    await go(page, "expenses");
    await go(page, "growth");
    assert.equal(requests.filter(value => value === "growth").length, previousGrowthReads + 1,
      "an in-flight growth read is reused on reentry");
    state.gates.get("growth").release();
    await page.getByRole("checkbox", { name: "Обновлённая задача" }).waitFor();
    await page.goBack();
    await page.locator("#exMain").waitFor();
    await page.goForward();
    await page.locator("#gwMain").waitFor();
    assert.equal(documents.length, 1, "browser history remains within the SPA");
    assert.equal(requests.filter(value => value === "user").length, 1);
    assert.equal(requests.filter(value => value === "membership").length, 1);
    assert.deepEqual(writes.map(value => value.endpoint), ["rabota_growth_plan", "rabota_finance_record", "rabota_finance_void"]);
  } finally { await s.close(); }
}

async function legacyLinks(browser) {
  for (const role of roles) {
    const s = await fixture(browser, root, 390, role);
    try {
      for (const [legacy, view, selector] of [
        ["/expenses.html", "expenses", "#exMain"], ["/growth.html", "growth", "#gwMain"],
      ]) {
        await s.page.goto(origin + legacy, { waitUntil: "commit" });
        await s.page.locator(role === "owner" ? selector : "#ordersArea").waitFor();
        if (role === "owner") assert.equal(new URL(s.page.url()).searchParams.get("view"), view);
      }
    } finally { await s.close(); }
  }
}

function summarize(results) {
  const out = {};
  for (const view of ["expenses", "growth", "orders"]) {
    const times = key => results.map(result => result[view][key]).sort((a, b) => a - b);
    const median = values => Math.round((values[values.length / 2 - 1] + values[values.length / 2]) / 2);
    out[view] = {
      medianInterfaceMs: median(times("interfaceMs")), medianDataMs: median(times("dataMs")),
      requests: results.map(result => result[view].requests),
      documents: results.map(result => result[view].documents),
    };
  }
  return out;
}

(async () => {
  const browser = await (browserName === "webkit" ? webkit : chromium).launch({
    executablePath: process.env.TEST_BROWSER_PATH || undefined,
    args: browserName === "chromium" ? ["--no-sandbox"] : [],
  });
  try {
    const baseline = process.env.BASELINE_ROOT && path.resolve(process.env.BASELINE_ROOT);
    if (baseline) {
      const results = [];
      for (const width of widths) results.push(await ownerBenchmark(browser, baseline, width, true));
      console.log(browserName, "baseline", JSON.stringify(summarize(results)));
    }
    const results = [];
    for (const width of widths) {
      results.push(await ownerBenchmark(browser, root, width, false));
      if (process.env.BENCHMARK_ONLY === "1") continue;
      for (const role of roles) {
        await roleLayout(browser, width, role);
        console.log("PASS", browserName, width, role);
      }
    }
    console.log(browserName, "candidate", JSON.stringify(summarize(results)));
    if (process.env.BENCHMARK_ONLY === "1") return;
    await dataFlow(browser);
    await legacyLinks(browser);
    console.log("PASS", browserName, "progressive rendering, connection retry, writes, freshness, history and legacy links");
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
