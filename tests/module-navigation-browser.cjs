"use strict";

// Playwright regression and before/after benchmark with the same isolated HTTP fixtures.
// Run with TEST_BROWSER=chromium or webkit; BASELINE_ROOT can point to a git archive of main.
// Set BENCHMARK_ONLY=1 to measure navigation without the layout and interaction checks.
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { chromium, webkit, devices } = require("playwright");

const root = path.resolve(__dirname, "..");
const browserName = process.env.TEST_BROWSER || "chromium";
const widths = [320, 375, 390, 430];
const delayMs = 75;
const origin = "https://crm.test";
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
const stamp = today + "T08:00:00Z";
const safeAreaInsets = { top: 47, right: 29, bottom: 34, left: 21 };
const fixtureMaster = { user_id: "fixture-master", role: "master", active: true, master_name: "Рауль" };
const expense = { id: "fixture-expense", kind: "expense", amount: 1200, note: "[Запчасти] Тестовый расход",
  created_at: stamp, voided_at: null, order_id: null };
const task = { id: "fixture-task", owner_id: "fixture-owner", kind: "day", title: "Тестовая задача",
  start_on: today, end_on: today, sort_order: 0, completed: false };
const leads = [
  { id: "fixture-lead-1", name: "Марина тестовый лид", phone: "79001112233", status: "new", updated_at: stamp },
  { id: "fixture-lead-2", name: "Олег тестовый лид", phone: "79134445566", status: "new", updated_at: stamp },
];
const roles = ["owner", "manager", "master"];
const trace = endpoint => ["user", "membership", "orders", "expenses", "operations", "payroll", "growth"].includes(endpoint);
const sectionRoots = {
  home: "#rdHome", orders: "#ordersArea", expenses: "#exMain", growth: "#gwMain",
  leads: "#rdLeads", clients: "#rdClients", settings: "#rdSettings", reports: "#rdReports",
  finance: "#financePanel", masterSettings: "#mwMasterSettings", masterReports: "#mwMasterReports",
  masterPayments: "#mwMasterPayments",
};
const sectionsByRole = {
  owner: ["home", "expenses", "growth", "finance", "reports", "leads", "clients", "settings", "orders"],
  manager: ["leads", "clients", "settings", "home", "orders"],
  master: ["payments", "reports", "settings", "orders"],
};
const sectionTitles = {
  home: "Главная", orders: "Заказы", calendar: "Заказы", expenses: "Расходы", growth: "Развитие MOBA",
  finance: "Платежи", payments: "Платежи", reports: "Отчёты", leads: "Лиды", clients: "Клиенты", settings: "Настройки",
};
const slowReads = { owner: ["operations", "growth"], manager: ["rabota_leads"], master: ["payroll"] };

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture(browser, source, width, role, {safeArea = null, standalone = false, height = 760, touch = true} = {}) {
  const context = await browser.newContext({
    ...(touch ? devices["iPhone 13"] : {}), viewport: { width, height }, screen: { width, height },
    timezoneId: "Europe/Moscow", reducedMotion: "reduce", serviceWorkers: "block",
  });
  const state = { expenses: [{ ...expense }], tasks: [{ ...task }], fail: new Set(), loseResponse: new Set(), gates: new Map() };
  const orders = Array.from({ length: 18 }, (_, i) => ({
    id: "fixture-order-" + i, name: "Тестовый заказ " + i, assigned_user_id: fixtureMaster.user_id,
    master: fixtureMaster.master_name, status: "Записан", price: 1000, appointment_date: today,
    appointment_time: "12:00:00", created_at: stamp, updated_at: stamp,
  }));
  const member = role === "master" ? fixtureMaster : { user_id: "fixture-" + role, role, active: true };
  const requests = [], documents = [], writes = [], errors = [];
  await context.addInitScript(standalone => {
    if (standalone) {
      Object.defineProperty(navigator, "standalone", {value: true});
      const match = window.matchMedia.bind(window);
      window.matchMedia = query => {
        const result = match(query);
        if (query === "(display-mode: standalone)") Object.defineProperty(result, "matches", {value: true});
        return result;
      };
    }
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
  }, standalone);
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      if (request.isNavigationRequest()) documents.push(url.pathname + url.search);
      const name = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.resolve(source, "." + name);
      if (!file.startsWith(source + path.sep) || !existsSync(file))
        return route.fulfill({ status: 404, body: "" });
      if (safeArea && /\.(css|html)$/.test(file)) {
        // Desktop Playwright has no configurable native screen cutout. Replace the
        // environment values while keeping the application's layout rules intact.
        const body = readFileSync(file, "utf8").replace(
          /env\(\s*safe-area-inset-(top|right|bottom|left)(?:\s*,[^)]*)?\)/g,
          (_, edge) => safeArea[edge] + "px"
        );
        return route.fulfill({contentType: file.endsWith(".css") ? "text/css" : "text/html", body});
      }
      return route.fulfill({ path: file });
    }
    if (!url.hostname.endsWith(".supabase.co")) return route.abort();
    assert.equal(request.headers().authorization, "Bearer fixture-access");
    const endpoint = url.pathname.split("/").pop();
    const bucket = ({
      rabota_orders: "orders", rabota_growth_plan: "growth", rabota_payroll_snapshot_v3: "payroll",
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
        state.expenses.push({ ...expense, id: "fixture-new-expense-" + writes.length, amount: payload.p_amount, note: payload.p_note });
      } else if (endpoint === "rabota_finance_void") {
        const item = state.expenses.find(row => row.id === payload.p_operation_id);
        item.voided_at = stamp;
      } else if (endpoint === "rabota_growth_plan" && request.method() === "PATCH") {
        assert.equal(url.searchParams.get("owner_id"), "eq.fixture-owner");
        const item = state.tasks.find(row => url.searchParams.get("id") === "eq." + row.id);
        Object.assign(item, payload);
        json = [item];
      } else assert.fail("Unexpected write to " + endpoint);
      if (state.loseResponse.delete(endpoint)) return route.abort("connectionreset");
    } else {
      if (endpoint === "user") json = { id: member.user_id, email: member.user_id + "@test.invalid" };
      if (bucket === "membership") json = url.searchParams.has("role") && role !== "owner" ? [] : [member];
      if (bucket === "staff") json = [member, fixtureMaster];
      if (bucket === "orders") json = orders;
      if (bucket === "growth") json = role === "owner" ? state.tasks : [];
      if (bucket === "rabota_leads" && role !== "master") json = leads;
      if (["expenses", "operations"].includes(bucket)) json = role === "owner" ? state.expenses : [];
      if (bucket === "payroll") {
        json = {version: 3, accounting_version: 1, activated_at: stamp,
          state: role === "manager" ? "not_applicable" : "active"};
        if (role !== "manager") Object.assign(json, {master_id: fixtureMaster.user_id,
          earned: 0, paid: 0, due: 0, orders: [], payouts: [], accounting_receipts: []});
        if (role === "owner") json.accounting_payouts = [];
      }
    }
    return route.fulfill({ json });
  });
  async function newPage() {
    const tab = await context.newPage();
    tab.setDefaultTimeout(8000);
    tab.on("pageerror", error => errors.push(error.message));
    return tab;
  }
  const page = await newPage();
  await page.addInitScript(() => {
    if (!localStorage.getItem("rabota-auth-session-v1"))
      localStorage.setItem("rabota-auth-session-v1", JSON.stringify({
        access_token: "fixture-access", refresh_token: "fixture-refresh", expires_at: 4102444800,
      }));
  });
  async function close() {
    for (const gate of state.gates.values()) gate.release();
    await context.close();
    assert.deepEqual(errors, []);
  }
  return { page, state, requests, documents, writes, close, newPage };
}

function navigation(page, view) {
  const dock = page.locator('#rdMobileNav [data-page="' + view + '"]');
  return { dock, menu: page.locator('#rdMobileMoreSheet [data-page="' + view + '"]') };
}

async function destination(page, view) {
  await page.locator("#rdMobileNav").waitFor();
  const { dock, menu } = navigation(page, view);
  if (await dock.count()) return dock;
  await page.locator("#rdMobileMoreBtn").click();
  return menu;
}

async function go(page, view) {
  await (await destination(page, view)).click();
}

async function switchSection(page, role, view) {
  if (role === "master") await page.locator('#mwMasterNav [data-mw-page="' + view + '"]').click();
  else await go(page, view);
  const key = role === "master" && view !== "orders" ? "master" + view[0].toUpperCase() + view.slice(1) : view;
  await page.locator(sectionRoots[key]).waitFor();
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

async function ownerBenchmark(browser, source, width, standaloneModules = false) {
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
    if (standaloneModules) await page.locator("#exMoreButton").click();
    await measure("growth", standaloneModules ? page.locator('#exMore a[href="/growth.html"]') : await destination(page, "growth"),
      "#gwMain", "#gwContent .gw-task");
    await measure("orders", standaloneModules ? page.locator('#gwBottom a[href="/?view=orders"]') : await destination(page, "orders"),
      "#ordersArea", "#calendarPanel");
    if (!standaloneModules) {
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

async function assertDock(page, role, view) {
  const nav = page.locator(role === "master" ? "#mwMasterNav" : "#rdMobileNav");
  await nav.waitFor();
  const state = await nav.evaluate(node => {
    const { bottom, top } = node.getBoundingClientRect();
    const box = node => {
      const { top, bottom, left, right, width } = node.getBoundingClientRect();
      return { top, bottom, left, right, width };
    };
    const buttons = [...node.querySelectorAll("button, a")].filter(button => button.getClientRects().length)
      .map(button => ({...box(button), key:button.dataset.page || button.dataset.mwPage || "more",
        current:button.getAttribute("aria-current") === "page", background:getComputedStyle(button).backgroundColor}));
    return { bottom, top, buttons, parent:node.parentElement?.tagName, position:getComputedStyle(node).position,
      viewport: innerHeight, width: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  assert.equal(state.buttons.length, role === "master" ? 4 : 5);
  assert.equal(state.parent, "BODY", "fixed navigation is outside the scroll container");
  assert.equal(state.position, "fixed");
  assert.ok(Math.abs(state.bottom - state.viewport) <= 3, JSON.stringify(state));
  assert.ok(state.documentWidth <= state.width + 1, "page must not overflow horizontally: " + JSON.stringify(state));
  for (const [index, button] of state.buttons.entries()) {
    assert.ok(button.width >= 44 && button.bottom - button.top >= 44 && button.left >= 0 &&
      button.right <= state.width + 1 && Math.abs(button.top - state.buttons[0].top) < 1 &&
      Math.abs(button.bottom - state.buttons[0].bottom) < 1 &&
      (index === 0 || state.buttons[index - 1].right <= button.left + 1), JSON.stringify(state));
  }
  const active = state.buttons.filter(button => button.current);
  assert.equal(active.length, 1, "exactly one visible dock section is selected");
  assert.deepEqual(state.buttons.filter(button => button.background !== "rgba(0, 0, 0, 0)"), active,
    "only the active dock item has selected styling");
  if (view) assert.equal(active[0].key, state.buttons.some(button => button.key === view) ? view : "more");
  return state;
}

async function assertHeaderLayout(page, view, initial = null) {
  const title = sectionTitles[view];
  const heading = page.locator("#appTitle");
  await heading.waitFor();
  assert.equal(await heading.innerText(), title, view + ": one current section title");
  assert.equal(await page.getByRole("heading", {name: title, exact: true}).count(), 1, view + ": no duplicate heading");
  assert.equal(await page.locator(".rd-top, #rdTopSearch, #rdProfileToggle, #rdShellProfileMenu").count(), 0,
    view + ": the old global toolbar and alternate profile are removed");
  assert.equal(await page.locator("#appScreen").getByText("Данные из Supabase", {exact: true}).isVisible(), false);
  const profile = page.locator("#rdProfileTrigger");
  await profile.waitFor();
  assert.equal(await page.locator('[aria-controls="rdProfileMenu"]').count(), 1, view + ": sole account trigger");
  assert.ok((await profile.innerText()).trim().length <= 2, view + ": no account name beside the circle");
  const layout = await profile.evaluate(node => {
    const app = document.getElementById("appScreen");
    const title = document.getElementById("appTitle");
    const header = document.getElementById("rdScreenHeader");
    const button = node.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(title);
    const textRects = [...text.getClientRects()];
    const style = getComputedStyle(node);
    return {
      top: button.top, right: innerWidth - button.right, width: button.width, height: button.height,
      round: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius,
        style.borderBottomRightRadius].every(value => value === "50%" || parseFloat(value) >= button.width / 2),
      clickable: node.contains(document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2)),
      titleTop: title.getBoundingClientRect().top, titleLeft: title.getBoundingClientRect().left,
      titleFits: textRects.every(rect => rect.right <= button.left + 1 || rect.top >= button.bottom || rect.bottom <= button.top),
      fixedHeader: getComputedStyle(header).position === "fixed" && header.parentElement === document.body,
      headerBottom:header.getBoundingClientRect().bottom,
      contentTop:app.getBoundingClientRect().top,
      contentWidth:app.clientWidth,
      contentScrollWidth:app.scrollWidth,
    };
  });
  assert.ok(layout.top >= 0 && layout.top <= 80 && layout.right >= 0 && layout.right <= 80,
    view + ": profile at the upper-right edge " + JSON.stringify(layout));
  assert.ok(layout.width >= 44 && Math.abs(layout.width - layout.height) < 1 && layout.round && layout.clickable,
    view + ": unobstructed, round profile touch target " + JSON.stringify(layout));
  assert.ok(layout.fixedHeader && layout.contentTop >= layout.headerBottom - 1,
    view + ": working area stays outside the reserved fixed header " + JSON.stringify(layout));
  assert.ok(layout.contentScrollWidth <= layout.contentWidth + 1,
    view + ": working area does not introduce horizontal scrolling " + JSON.stringify(layout));
  assert.ok(layout.titleTop >= 0 && layout.titleTop <= layout.top + layout.height,
    view + ": heading starts in the profile row without an empty strip");
  assert.ok(layout.titleFits, view + ": title text does not overlap profile");
  if (initial) {
    for (const key of ["top", "right", "width", "height"])
      assert.ok(Math.abs(layout[key] - initial[key]) <= 1, view + ": profile moves after transition or scroll (" + key + ")");
    assert.ok(Math.abs(layout.titleTop - initial.titleTop) <= 1 && Math.abs(layout.titleLeft - initial.titleLeft) <= 1,
      view + ": headings align between routes and stay pinned when scrolled " + JSON.stringify({initial, layout}));
  }
  return layout;
}

async function assertPeriodControls(page, selector, count) {
  const controls = page.locator(selector);
  assert.equal(await controls.count(), count);
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44, "period controls have a 44 px touch target");
  }
}

async function assertScrollRestored(page, role) {
  const scroller = page.locator("#appScreen");
  const orderModes = page.locator("#owViewSwitch");
  await orderModes.locator('[data-ow-mode="all"]').click();
  if (role !== "master") {
    await page.locator("#owFilterToggle").click();
    await page.locator("#owFilterStatus").selectOption("Записан");
    await page.locator("#owFilterApply").click();
  }
  const header = await assertHeaderLayout(page, "orders");
  const scroll = await scroller.evaluate(node => {
    node.scrollTop = 350;
    window.scrollTo(0, 350);
    return {content:node.scrollTop, document:document.scrollingElement.scrollTop};
  });
  assert.ok(scroll.content > 100, "fixture must contain a long order list");
  assert.equal(scroll.document, 0, "the shared content element is the only document scroller");
  await assertHeaderLayout(page, "orders", header);
  await assertDock(page, role, "orders");
  const waitForScroll = () => page.waitForFunction(previous =>
    Math.abs(document.getElementById("appScreen").scrollTop - previous) <= 2, scroll.content);
  await switchSection(page, role, "settings");
  if (role === "master") await switchSection(page, role, "orders");
  else {
    const filterRenders = await page.evaluate(() => {
      const summary = document.getElementById("owFilterSummary");
      const observer = new MutationObserver(() => {});
      observer.observe(summary, { childList: true });
      document.querySelector('#rdMobileNav [data-page="orders"]').click();
      const records = observer.takeRecords();
      observer.disconnect();
      return records.filter(record => [...record.addedNodes].some(node => node.nodeName === "BUTTON")).length;
    });
    assert.ok(filterRenders <= 1, "one order render updates the filter summary");
    assert.match(await page.locator("#owFilterSummary").innerText(), /Записан/);
  }
  await waitForScroll();
  if (role !== "master") {
    await switchSection(page, role, "settings");
    await page.goBack();
    await page.locator("#ordersArea").waitFor();
    await waitForScroll();
  }
  assert.equal(await orderModes.locator('[data-ow-mode="all"]').getAttribute("aria-selected"), "true");
  await assertHeaderLayout(page, "orders", header);
  await assertDock(page, role, "orders");
}

async function assertProfileTargets(page, role) {
  await switchSection(page, role, "settings");
  const trigger = page.locator("#rdProfileTrigger");
  const menuId = await trigger.getAttribute("aria-controls");
  const menu = page.locator("#" + menuId);
  assert.equal(await menu.count(), 1, "profile trigger resolves to one menu");
  assert.equal(menuId, "rdProfileMenu");
  await trigger.press("Enter");
  await menu.waitFor();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.equal(await menu.evaluate(node => node.contains(document.activeElement)), true,
    "keyboard opening advances focus into the profile menu");
  assert.equal(await menu.getByRole("button", {name:/Выйти/}).count(), 1);
  assert.equal(await menu.locator("#rdProfileRole").innerText(),
    {owner:"Владелец", manager:"Менеджер", master:"Мастер"}[role]);
  const viewport = page.viewportSize(), bounds = await menu.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1,
    "account dropdown stays inside the viewport");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
  await trigger.click();
  await menu.waitFor();
  const bell = menu.locator("#pushBellBtn");
  assert.equal(await bell.isVisible(), role === "master");
  if (role === "master") {
    await bell.click();
    const notifications = menu.locator("#pushPopover");
    await notifications.waitFor();
    await notifications.locator("#closePushPopover").click();
    await notifications.waitFor({ state: "hidden" });
  }
  await page.locator("#appTitle").click();
  await menu.waitFor({state:"hidden"});
  await trigger.click();
  await menu.waitFor();
  await switchSection(page, role, "orders");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await menu.waitFor({state:"hidden"});
}

async function assertRapidNavigation(page, role) {
  const main = page.locator("#appScreen");
  const nav = page.locator(role === "master" ? "#mwMasterNav" : "#rdMobileNav");
  const navHandle = await nav.elementHandle();
  const visibilityObserver = await page.evaluateHandle(role => {
    const failures = [];
    const selectors = ["rdScreenHeader", "appScreen", role === "master" ? "mwMasterNav" : "rdMobileNav"];
    const observer = new MutationObserver(records => {
      for (const { target, oldValue } of records) {
        if (target.hidden || oldValue !== null) failures.push(target.id);
      }
    });
    for (const id of selectors) observer.observe(document.getElementById(id), {
      attributes: true, attributeFilter: ["hidden"], attributeOldValue: true,
    });
    return { observer, failures };
  }, role);
  try {
    const views = role === "owner" ? ["finance", "expenses", "growth", "finance", "orders"] :
      role === "manager" ? ["leads", "settings", "leads", "orders"] :
        ["payments", "reports", "payments", "orders"];
    // Keep the requests held at the fixture while taps change the selected view.
    for (const view of views) {
      await switchSection(page, role, view);
      assert.ok(await main.isVisible());
      assert.ok(await nav.isVisible());
    }
    const current = await nav.evaluate((node, previous) => node === previous, navHandle);
    assert.equal(current, true, "the dock is not rebuilt while changing sections");
    assert.deepEqual(await visibilityObserver.evaluate(({ failures }) => failures), [],
      "the authenticated shell and dock stay visible");
  } finally {
    await visibilityObserver.evaluate(({ observer }) => observer.disconnect());
    await visibilityObserver.dispose();
    await navHandle.dispose();
  }
}

async function roleLayout(browser, width, role) {
  const s = await fixture(browser, root, width, role);
  const { page, state, requests, documents } = s;
  for (const read of slowReads[role]) state.gates.set(read, deferred());
  const access = deferred();
  state.gates.set("membership", access);
  try {
    await page.goto(origin + (role === "owner" ? "/" : "/?view=growth"));
    assert.equal(await page.locator("#rdProfileTrigger").isVisible(), false, "profile is hidden until the account is verified");
    state.gates.delete("membership");
    access.release();
    await page.locator("#appScreen").waitFor();
    await page.locator("#ordersArea").waitFor();
    await assertDock(page, role, "orders");
    const identity = await page.evaluate(() => window.fixtureDocument);
    await page.evaluate(() => { window.fixtureProfile = document.getElementById("rdProfileTrigger"); });
    let initialHeader;
    for (const view of sectionsByRole[role]) {
      await switchSection(page, role, view);
      const dock = await assertDock(page, role, view);
      const header = await assertHeaderLayout(page, view, initialHeader);
      initialHeader ??= header;
      assert.equal(await page.evaluate(() => window.fixtureProfile === document.getElementById("rdProfileTrigger")),
        true, "navigation retains the original account control");
      if (role !== "master") {
        assert.equal(await page.locator("#rdMobileMoreBtn").getAttribute("aria-expanded"), "false");
      }
      if (role === "owner" && ["expenses", "growth"].includes(view)) {
        if (view === "expenses") await assertPeriodControls(page, "#exPrev, #exNext", 2);
        else await assertPeriodControls(page, ".gw-tabs button", 4);
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
    await assertRapidNavigation(page, role);
    await assertScrollRestored(page, role);
    await assertProfileTargets(page, role);
    assert.equal(await page.evaluate(() => window.fixtureDocument), identity);
    assert.equal(documents.length, 1);
    assert.equal(requests.filter(name => name === "user").length, 1);
    assert.equal(requests.filter(name => name === "membership").length, 1);
    if (role !== "owner") {
      assert.equal(await page.locator("#exMain:visible, #gwMain:visible").count(), 0);
      assert.ok(!requests.includes("growth") && !requests.includes("expenses") && !requests.includes("operations"),
        JSON.stringify(requests));
      assert.equal(await page.locator('#rdMobileNav [data-page="expenses"], #rdMobileMoreSheet [data-page="growth"]').count(), 0);
    }
    for (const read of slowReads[role]) {
      assert.ok(requests.includes(read), "fixture exercised the delayed " + read + " request");
      state.gates.get(read).release();
    }
    const reopenedView = role === "owner" ? "growth" : role === "manager" ? "leads" : "settings";
    await switchSection(page, role, reopenedView);
    // Reopen in the same browser profile with only the session the app persisted.
    const reopenUrl=page.url();
    await page.close();
    const reopened=await s.newPage();
    await reopened.goto(reopenUrl,{waitUntil:"commit",timeout:20000});
    await reopened.waitForFunction(previous=>Boolean(window.fixtureDocument&&window.fixtureDocument!==previous),
      identity,{timeout:20000});
    await reopened.locator(sectionRoots[role === "master" ? "orders" : reopenedView]).waitFor({timeout:20000});
    await assertDock(reopened, role, role === "master" ? "orders" : reopenedView);
    await assertHeaderLayout(reopened, role === "master" ? "orders" : reopenedView, initialHeader);
    assert.equal(documents.length, 2, "only the explicit reopen requested a new document");
    assert.equal(requests.filter(name => name === "user").length, 2);
    if (role === "owner") {
      await reopened.getByRole("checkbox", { name: task.title }).waitFor();
      await reopened.locator('.gw-tabs [data-period="week"]').click();
      await assertPeriodControls(reopened, ".gw-period-selector button", 2);
      await assertDock(reopened, role);
    }
    assert.deepEqual(s.writes, []);
  } finally { await s.close(); }
}

async function assertClippedControl(page, header) {
  const filter = page.locator("#owFilterToggle");
  await filter.waitFor();
  const displacement = await filter.evaluate(button => {
    const scroller = document.getElementById("appScreen");
    const profile = document.getElementById("rdProfileTrigger");
    const before = scroller.scrollTop;
    // Move this real, right-aligned control to precisely the avatar's vertical
    // position. Without clipping, it is painted under the avatar at this offset.
    scroller.scrollTop += button.getBoundingClientRect().top - profile.getBoundingClientRect().top;
    return scroller.scrollTop - before;
  });
  assert.ok(displacement > 0, "the fixture exercised scrolling into the profile row");
  const visible = await filter.evaluate(button => new Promise(resolve => {
    const observer = new IntersectionObserver(([entry]) => {
      observer.disconnect();
      const {top, height} = entry.intersectionRect;
      resolve({top, height});
    });
    observer.observe(button);
  }));
  assert.ok(visible.height === 0 || visible.top >= header.headerBottom - 1,
    "a scrolled working control is clipped out of the fixed header: " + JSON.stringify(visible));
  await assertHeaderLayout(page, "orders", header);
  await filter.evaluate(button => button.scrollIntoView({block:"start", behavior:"instant"}));
  await filter.click({trial:true});
  const filterBox = await filter.boundingBox();
  assert.ok(filterBox.y >= header.headerBottom - 1, "bringing the filter into view leaves it available below the header");
}

function assertDockInsets(dock, insets) {
  for (const button of dock.buttons) {
    assert.ok(button.left >= insets.left - 1 && button.right <= dock.width - insets.right + 1,
      "dock controls stay inside the left and right safe areas " + JSON.stringify({button, dockWidth:dock.width, insets}));
    assert.ok(button.bottom <= dock.viewport - insets.bottom + 1,
      "dock controls clear the bottom home indicator " + JSON.stringify({button, insets}));
  }
}

async function safeAreaLayout(browser, width, role, height = 760, insets = safeAreaInsets) {
  const s = await fixture(browser, root, width, role, {safeArea:insets, standalone:true, height});
  const {page, documents, writes} = s;
  try {
    await page.goto(origin);
    await switchSection(page, role, "orders");
    assert.match(await page.locator('meta[name="viewport"]').getAttribute("content"), /viewport-fit=cover/);
    assert.equal(await page.evaluate(() => navigator.standalone && matchMedia("(display-mode: standalone)").matches), true);
    await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
    const header = await assertHeaderLayout(page, "orders");
    assert.ok(header.top >= insets.top && header.right >= insets.right && header.titleLeft >= insets.left,
      "header respects top, right and left safe areas " + JSON.stringify({header, insets}));
    const dock = await assertDock(page, role, "orders");
    assertDockInsets(dock, insets);
    assert.ok(await page.locator("#appScreen").evaluate((node, dockTop) =>
      node.getBoundingClientRect().bottom <= dockTop + 1, dock.top), "content stops above the fixed dock");
    await assertClippedControl(page, header);
    const scrolled = await page.locator("#appScreen").evaluate(node => {
      node.scrollTop = 280;
      window.scrollTo(0, 280);
      return {content:node.scrollTop, document:document.scrollingElement.scrollTop};
    });
    assert.deepEqual(scrolled, {content:280, document:0}, "only the shared working area scrolls");
    await assertHeaderLayout(page, "orders", header);
    assertDockInsets(await assertDock(page, role, "orders"), insets);
    const add = page.locator("#newOrderBtn");
    await add.waitFor();
    const addBox = await add.boundingBox();
    assert.ok(addBox.x >= insets.left - 1 && addBox.x + addBox.width <= width - insets.right + 1 &&
      addBox.y + addBox.height <= dock.top + 1, "add order stays inside the safe area above the dock");
    await add.click({trial:true});

    if (role !== "master") {
      const more = page.locator("#rdMobileMoreBtn");
      const paint = () => more.evaluate(node => getComputedStyle(node).backgroundColor);
      const idle = await paint();
      await more.evaluate(node => node.click());
      const sheet = page.locator("#rdMobileMoreSheet");
      await sheet.waitFor();
      await assertDock(page, role, "orders");
      assert.equal(await paint(), idle, "opening More does not highlight a second dock item");
      const bounds = await sheet.boundingBox();
      assert.ok(bounds.x >= insets.left - 1 && bounds.x + bounds.width <= width - insets.right + 1 &&
        bounds.y >= insets.top - 1 && bounds.y + bounds.height < dock.top, "More stays within the safe content area");
      const view = role === "owner" ? "growth" : "home";
      await sheet.locator('[data-page="' + view + '"]').click();
      await page.locator(sectionRoots[view]).waitFor();
      await assertDock(page, role, view);
      assert.notEqual(await paint(), idle, "More represents a secondary active section");
      await more.evaluate(node => node.click());
      await sheet.waitFor();
      assert.equal(await sheet.locator('[aria-current="page"]').count(), 1);
      assert.equal(await sheet.locator('[aria-current="page"]').getAttribute("data-page"), view);
      await page.keyboard.press("Escape");
      await sheet.waitFor({state:"hidden"});
    } else await switchSection(page, role, "payments");
    await switchSection(page, role, "orders");
    await page.waitForFunction(previous => document.getElementById("appScreen").scrollTop === previous, scrolled.content);
    await assertHeaderLayout(page, "orders", header);
    assertDockInsets(await assertDock(page, role, "orders"), insets);
    assert.equal(documents.length, 1);
    assert.deepEqual(writes, []);
  } finally { await s.close(); }
}

async function desktopScrollLayout(browser) {
  const s = await fixture(browser, root, 1366, "owner", {height:800, touch:false});
  try {
    const {page} = s;
    await page.goto(origin);
    await page.locator('.rd-shell [data-page="orders"]').click();
    assert.equal(await page.locator("#rdMobileNav").isVisible(), false, "desktop retains sidebar navigation");
    await page.locator('#owViewSwitch [data-ow-mode="all"]').click();
    const header = await assertHeaderLayout(page, "orders");
    await assertClippedControl(page, header);
    const scroll = await page.locator("#appScreen").evaluate(node => {
      node.scrollTop = 300;
      window.scrollTo(0, 300);
      return {content:node.scrollTop, document:document.scrollingElement.scrollTop};
    });
    assert.deepEqual(scroll, {content:300, document:0});
    await assertHeaderLayout(page, "orders", header);
    await page.locator('.rd-shell [data-page="expenses"]').click();
    await assertHeaderLayout(page, "expenses");
    assert.equal(await page.locator("#appScreen").evaluate(node => node.scrollTop), 0);
    await page.locator('.rd-shell [data-page="orders"]').click();
    await page.waitForFunction(() => document.getElementById("appScreen").scrollTop === 300);
    assert.equal(s.documents.length, 1);
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
    // The cancel path removes the row before its authoritative ledger refresh returns.
    await page.waitForLoadState("networkidle");
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

    await go(page, "expenses");
    state.loseResponse.add("rabota_finance_record");
    await page.locator("#exAmount").fill("42,75");
    await page.locator("#exDetail").fill("Сбой доставки ответа");
    await page.locator("#exSave").click();
    await page.locator("#exMessage").getByText(/Не удалось подтвердить запись/).waitFor();
    await page.locator("#exList").getByText("Сбой доставки ответа").waitFor();
    const attempts = writes.filter(value => value.endpoint === "rabota_finance_record").length;
    const confirmation = page.waitForEvent("dialog");
    const click = page.locator("#exSave").click();
    const dialog = await confirmation;
    assert.match(dialog.message(), /Проверьте историю/);
    await dialog.dismiss();
    await click;
    assert.equal(writes.filter(value => value.endpoint === "rabota_finance_record").length, attempts,
      "a committed expense with a dropped reply is never replayed automatically");
  } finally { await s.close(); }
}

async function legacyLinks(browser) {
  for (const role of roles) {
    const s = await fixture(browser, root, 390, role);
    try {
      for (const [legacy, view, selector] of [
        ["/expenses.html", "expenses", "#exList .ex-item"], ["/growth.html", "growth", "#gwContent .gw-task"],
      ]) {
        const destination = origin + "/?view=" + view;
        // Owners see integrated modules before order/team startup has finished.
        // Observe this redirected document's team read before replacing it.
        const staffRead = role === "owner" ? s.page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname === "/rest/v1/rabota_members" && !url.searchParams.has("user_id") &&
            response.request().frame().url() === destination;
        }) : null;
        const [, staff] = await Promise.all([s.page.goto(origin + legacy, { waitUntil: "commit" }), staffRead]);
        await s.page.waitForURL(destination, {waitUntil:"commit"});
        await s.page.locator(role === "owner" ? selector : "#ordersArea").waitFor();
        if (staff) {
          assert.ok(staff.ok());
          assert.equal(await staff.finished(), null);
        }
        await s.page.waitForLoadState("networkidle");
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

module.exports = { fixture, go, assertHeaderLayout };
if (require.main === module) (async () => {
  const browser = await (browserName === "webkit" ? webkit : chromium).launch({
    executablePath: process.env.TEST_BROWSER_PATH || undefined,
    args: browserName === "chromium" ? ["--no-sandbox"] : [],
  });
  try {
    const baseline = process.env.BASELINE_ROOT && path.resolve(process.env.BASELINE_ROOT);
    if (baseline) {
      const results = [];
      const standaloneModules = !readFileSync(path.join(baseline, "index.html"), "utf8").includes('id="exMain"');
      for (const width of widths) results.push(await ownerBenchmark(browser, baseline, width, standaloneModules));
      console.log(browserName, "baseline", JSON.stringify(summarize(results)));
    }
    const results = [];
    for (const width of widths) {
      results.push(await ownerBenchmark(browser, root, width));
      if (process.env.BENCHMARK_ONLY === "1") continue;
      for (const role of roles) {
        await roleLayout(browser, width, role);
        console.log("PASS", browserName, width, role);
      }
    }
    console.log(browserName, "candidate", JSON.stringify(summarize(results)));
    if (process.env.BENCHMARK_ONLY === "1") return;
    for (const role of roles) await safeAreaLayout(browser, 320, role);
    for (const role of ["owner", "master"])
      await safeAreaLayout(browser, 844, role, 390, {top:21, right:44, bottom:21, left:44});
    await desktopScrollLayout(browser);
    console.log("PASS", browserName, "safe areas, standalone portrait and landscape, clipped profile strip and shared scrolling");
    await dataFlow(browser);
    await legacyLinks(browser);
    console.log("PASS", browserName, "progressive rendering, connection retry, writes, freshness, history and legacy links");
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
