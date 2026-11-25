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
const expenseRecordRpc = "rabota_record_expense_v1";
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
const notification = {id:"fixture-notice-1", client_name:"Тестовая заявка для мастера",
  visit_date:today, visit_time:"12:30:00", created_at:stamp};
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
  const state = { expenses: [{ ...expense }], tasks: [{ ...task }], fail: new Set(),
    loseResponse: new Set(), loseBeforeWrite: new Set(), invalidReceipt: new Set(), gates: new Map(),
    staleGrowthRead: null, failGrowthRead: false };
  const expenseReceipts = new Map();
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
    if (bucket === "growth" && request.method() === "GET" && state.staleGrowthRead) {
      const { started, finish } = state.staleGrowthRead;
      const captured = state.tasks.map(task => ({ ...task }));
      state.staleGrowthRead = null;
      started.release();
      await finish.promise;
      return route.fulfill({ json: captured });
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await state.gates.get(bucket)?.promise;
    if (bucket === "growth" && request.method() === "GET" && state.failGrowthRead) {
      state.failGrowthRead = false;
      return route.abort("internetdisconnected");
    }
    if (state.fail.delete(bucket)) return route.abort("internetdisconnected");
    let json = [];
    if (request.method() !== "GET") {
      assert.equal(role, "owner", "fixture owner-only mutation");
      const payload = request.postDataJSON();
      writes.push({ endpoint, method: request.method(), payload });
      if (state.loseBeforeWrite.delete(endpoint)) return route.abort("connectionreset");
      if (endpoint === expenseRecordRpc) {
        assert.match(payload.p_request_id, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
        const previous = expenseReceipts.get(payload.p_request_id);
        if (previous) {
          assert.deepEqual(payload, previous.payload);
          json = previous.id;
        } else {
          json = "a0000001-0000-4000-8000-" + String(expenseReceipts.size + 1).padStart(12, "0");
          expenseReceipts.set(payload.p_request_id, { id: json, payload });
          state.expenses.push({ ...expense, id: json, request_id: payload.p_request_id,
            created_by: member.user_id, amount: payload.p_amount, note: payload.p_note });
        }
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
      if (state.invalidReceipt.delete(endpoint)) return route.fulfill({ json: true });
    } else {
      if (endpoint === "user") json = { id: member.user_id, email: member.user_id + "@test.invalid" };
      if (bucket === "membership") json = url.searchParams.has("role") && role !== "owner" ? [] : [member];
      if (bucket === "staff") json = [member, fixtureMaster];
      if (bucket === "orders") json = orders;
      if (bucket === "growth") json = role === "owner" ? state.tasks : [];
      if (bucket === "rabota_leads" && role !== "master") json = leads;
      if (bucket === "rabota_order_notifications" && role === "master") json = [notification];
      if (["expenses", "operations"].includes(bucket)) {
        const requestId=url.searchParams.get("request_id");
        json=role!=="owner"?[]:requestId?state.expenses.filter(row=>"eq."+row.request_id===requestId):state.expenses;
      }
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

async function assertHeaderLayout(page, view, initial = null, detail = null) {
  const header = page.locator("#rdScreenHeader");
  await header.waitFor();
  assert.equal(await header.count(), 1);
  const title = detail?.title || sectionTitles[view];
  assert.equal(await header.locator("#appTitle").innerText(), title, view + ": title matches the active route");
  assert.equal(await page.getByRole("heading", {name:title, exact:true}).count(), 1, view + ": one visible title");
  const back = header.locator("#rdScreenBack");
  assert.equal(await back.isVisible(), Boolean(detail), "only a detail screen has Back");
  if (detail) assert.equal(await back.getAttribute("aria-label"), detail.back);
  assert.equal(await page.locator(".rd-top, #rdTopSearch, #rdProfileToggle, #rdShellProfileMenu").count(), 0);
  assert.doesNotMatch(await header.innerText(), /Supabase|Синхронизац|Московское время|МСК/i);
  const profile = header.getByRole("button", {name:"Открыть меню профиля", exact:true});
  const bell = header.getByRole("button", {name:/Открыть уведомления/});
  await profile.waitFor();
  await bell.waitFor();
  assert.equal(await profile.getAttribute("id"), "rdProfileTrigger");
  assert.equal(await bell.getAttribute("id"), "pushBellBtn");

  const layout = await header.evaluate(node => {
    const box = element => {
      const {left,right,top,bottom,width,height} = element.getBoundingClientRect();
      return {left,right,top,bottom,width,height};
    };
    const action = id => {
      const element = document.getElementById(id), bounds = box(element);
      const center = document.elementFromPoint((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
      return {...bounds, clickable:element.contains(center), radius:getComputedStyle(element).borderTopLeftRadius};
    };
    const app = document.getElementById("appScreen"), style = getComputedStyle(node);
    const dock = [...document.querySelectorAll("#rdMobileNav, #mwMasterNav")].find(element => element.getClientRects().length);
    return {
      header:box(node), app:box(app), title:box(document.getElementById("appTitle")),
      profile:action("rdProfileTrigger"), bell:action("pushBellBtn"), back:action("rdScreenBack"),
      safeTop:parseFloat(getComputedStyle(document.body).getPropertyValue("--rd-safe-top")) || 0,
      viewport:innerWidth, dockTop:dock ? box(dock).top : null,
      fixed:style.position === "fixed" && node.parentElement === document.body,
      border:parseFloat(style.borderBottomWidth), background:style.backgroundColor,
      clip:getComputedStyle(app).clipPath, scrollWidth:app.scrollWidth, clientWidth:app.clientWidth,
    };
  });
  const {header:bounds, app, profile:avatar, bell:notice, safeTop, title:caption} = layout;
  assert.ok(layout.fixed && Math.abs(bounds.bottom - safeTop - 56) <= 1,
    "the fixed header is 56 CSS pixels plus the top safe area " + JSON.stringify(layout));
  assert.ok(layout.border > 0 && layout.border <= 2 && (layout.background.match(/\d+/g) || []).slice(0,3).every(channel => +channel > 225),
    "the shared header has a light surface and thin divider");
  assert.ok(Math.abs(app.top - bounds.bottom) <= 1, "the work area begins at the header edge");
  if (layout.dockTop !== null) assert.ok(Math.abs(app.bottom - layout.dockTop) <= 1, "the work area ends at the dock edge");
  assert.equal(layout.clip, "none", "a separate header does not require an avatar notch in the work area");
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, "the scroller fits the visible width");
  for (const button of [avatar, notice, ...(detail ? [layout.back] : [])]) {
    assert.ok(button.width >= 44 && button.height >= 44 && button.top >= safeTop - 1 && button.bottom <= bounds.bottom + 1 && button.clickable,
      "header actions have full touch targets within the safe row " + JSON.stringify(button));
  }
  assert.ok(Math.abs(avatar.width - avatar.height) < 1 &&
    (avatar.radius === "50%" || parseFloat(avatar.radius) >= avatar.width / 2), "the profile is round");
  assert.ok(caption.right <= notice.left + 1 && notice.right <= avatar.left + 1 && avatar.right <= layout.viewport,
    "title, bell and profile fit in one row without overlap " + JSON.stringify(layout));
  if (detail) assert.ok(layout.back.right <= caption.left + 1, "Back does not cover the detail title");
  if (initial) {
    assert.deepEqual(bounds, initial.header, view + ": the header stays fixed on navigation and scroll");
    assert.deepEqual(avatar, initial.profile, view + ": the profile stays anchored");
    assert.deepEqual(notice, initial.bell, view + ": the bell stays anchored");
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

async function assertFloatingAction(page, selector, dock, insets = {left:0, right:0}) {
  const action = page.locator(selector);
  await action.waitFor();
  assert.equal(await action.evaluate(node => node.parentElement === document.body), true);
  const box = await action.boundingBox();
  assert.ok(box.x >= insets.left - 1 && box.x + box.width <= dock.width - insets.right + 1 &&
    box.y + box.height <= dock.top + 1, selector + " stays inside the safe area above the dock");
  await action.click({trial:true});
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
  const bell = page.locator("#rdScreenHeader #pushBellBtn");
  const notifications = page.locator("#rdScreenHeader #pushPopover");
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
  assert.equal(await menu.locator("#pushBellBtn").count(), 0, "notifications have their own header action");
  await bell.press("Enter");
  await notifications.waitFor();
  await menu.waitFor({state:"hidden"});
  assert.equal(await bell.getAttribute("aria-controls"), "pushPopover");
  assert.equal(await bell.getAttribute("aria-expanded"), "true");
  const badge = bell.locator("#pushUnreadCount");
  if (role === "master") {
    await notifications.getByText("Новая заявка: " + notification.client_name, {exact:true}).waitFor();
    assert.equal(await badge.innerText(), "1", "only the seeded unread notification counts towards the badge");
    assert.equal(await notifications.getByRole("button", {name:"Прочитано", exact:true}).count(), 1);
  } else {
    await notifications.locator("#pushRoleMessage").getByText("Уведомления о новых заявках доступны мастерам.", {exact:true}).waitFor();
    assert.equal(await badge.isVisible(), false, "the unavailable inbox has no fabricated count");
    assert.equal(await notifications.locator("#pushToggle").isVisible(), false);
    assert.equal(await notifications.getByRole("button", {name:"Прочитано", exact:true}).count(), 0);
  }
  await page.keyboard.press("Escape");
  await notifications.waitFor({state:"hidden"});
  assert.equal(await bell.evaluate(node => node === document.activeElement), true);
  await bell.click();
  await notifications.waitFor();
  await trigger.click();
  await notifications.waitFor({state:"hidden"});
  await menu.waitFor();
  const work = await page.locator("#appScreen").boundingBox();
  await page.mouse.click(work.x + 2, work.y + 2);
  await menu.waitFor({state:"hidden"});
  await trigger.click();
  await menu.waitFor();
  await switchSection(page, role, "orders");
  await menu.waitFor({state:"hidden"});
  await bell.click();
  await notifications.waitFor();
  await switchSection(page, role, "settings");
  await notifications.waitFor({state:"hidden"});
  assert.equal(await bell.getAttribute("aria-expanded"), "false");
  await switchSection(page, role, "orders");
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
    assert.equal(await page.locator("#rdScreenHeader").isVisible(), false, "header actions are hidden until the account is verified");
    state.gates.delete("membership");
    access.release();
    await page.locator("#appScreen").waitFor();
    await page.locator("#ordersArea").waitFor();
    await assertDock(page, role, "orders");
    const identity = await page.evaluate(() => window.fixtureDocument);
    await page.evaluate(() => { window.fixtureHeader = document.getElementById("rdScreenHeader"); });
    let initialHeader;
    for (const view of sectionsByRole[role]) {
      await switchSection(page, role, view);
      const dock = await assertDock(page, role, view);
      const header = await assertHeaderLayout(page, view, initialHeader);
      initialHeader ??= header;
      assert.equal(await page.evaluate(() => window.fixtureHeader === document.getElementById("rdScreenHeader")),
        true, "navigation retains the same header element");
      if (role !== "master") {
        assert.equal(await page.locator("#rdMobileMoreBtn").getAttribute("aria-expanded"), "false");
      }
      if (role === "owner" && ["expenses", "growth"].includes(view)) {
        if (view === "expenses") {
          await assertPeriodControls(page, "#exPrev, #exNext", 2);
          await assertFloatingAction(page, "#newExpenseBtn", dock);
          assert.equal(await page.locator("#exForm").isVisible(), false);
        }
        else await assertPeriodControls(page, ".gw-tabs button", 4);
      }
      if (role !== "owner" || view !== "expenses")
        assert.equal(await page.locator("#newExpenseBtn").isVisible(), false, "expense entry only appears in the owner module");
      if (role !== "master" && view === "orders") {
        await assertFloatingAction(page, "#newOrderBtn", dock);
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
    assert.equal(requests.includes("rabota_order_notifications"), role === "master");
    if (role !== "master") assert.equal(requests.includes("rabota_push_subscriptions"), false);
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

async function assertWorkScroll(page, layout) {
  const filter = page.locator("#owFilterToggle");
  await filter.waitFor();
  const placed = await filter.boundingBox();
  assert.ok(placed.y >= layout.header.bottom - 1 && placed.y <= layout.header.bottom + 16,
    "the opening order filters remain just below the shared header");
  if (layout.viewport <= 430) {
    const rightGap = await filter.evaluate(node => {
      const app = document.getElementById("appScreen");
      return app.getBoundingClientRect().right - parseFloat(getComputedStyle(app).paddingRight) - node.getBoundingClientRect().right;
    });
    assert.ok(Math.abs(rightGap) <= 8, "the filter row can use the work area's full width");
  }
  await filter.click({trial:true});

  const row = page.locator("#orders :is(.rd-list-toggle, .master-schedule-toggle)").nth(3);
  await row.waitFor();
  const displacement = await row.evaluate(button => {
    const scroller = document.getElementById("appScreen");
    const header = document.getElementById("rdScreenHeader");
    const before = scroller.scrollTop;
    scroller.scrollTop += button.getBoundingClientRect().top - header.getBoundingClientRect().bottom + 8;
    return scroller.scrollTop - before;
  });
  assert.ok(displacement > 100, "the fixture exercised real content scrolling");
  const rowBox = await row.boundingBox();
  assert.ok(rowBox.y < layout.header.bottom && rowBox.y + rowBox.height > layout.header.bottom,
    "the row crossed the top of the working viewport");
  assert.equal(await page.evaluate(({x,y}) =>
    document.getElementById("appScreen").contains(document.elementFromPoint(x,y)),
  {x:rowBox.x + rowBox.width / 2, y:layout.header.bottom - 2}), false,
  "scrolling clips the order row at the header edge");
  await assertHeaderLayout(page, "orders", layout);
  await row.click({trial:true});
  await filter.evaluate(button => button.scrollIntoView({block:"start", behavior:"instant"}));
  await filter.click({trial:true});
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
    assert.ok(header.safeTop === insets.top && header.title.left >= insets.left &&
      header.profile.right <= width - insets.right + 1 && header.app.left >= insets.left &&
      header.app.right <= width - insets.right + 1,
      "the header and work area respect the top and side safe areas " + JSON.stringify({header, insets}));
    if (width <= 430) assert.ok(Math.abs(header.app.left - insets.left) <= 1 &&
      Math.abs(header.app.right - (width - insets.right)) <= 1,
      "the shared scroller uses the phone's safe width");
    const dock = await assertDock(page, role, "orders");
    assertDockInsets(dock, insets);
    const bell = page.locator("#rdScreenHeader #pushBellBtn"), popup = page.locator("#pushPopover");
    await bell.click();
    await popup.waitFor();
    const popupBox = await popup.boundingBox();
    assert.ok(popupBox.x >= insets.left - 1 && popupBox.x + popupBox.width <= width - insets.right + 1 &&
      popupBox.y >= header.header.bottom - 1 && popupBox.y + popupBox.height <= dock.top + 1,
      "the notifications popup fits between the safe edges and navigation");
    await page.keyboard.press("Escape");
    await popup.waitFor({state:"hidden"});
    assert.ok(await page.locator("#appScreen").evaluate((node, dockTop) =>
      node.getBoundingClientRect().bottom <= dockTop + 1, dock.top), "content stops above the fixed dock");
    await assertWorkScroll(page, header);
    const scrolled = await page.locator("#appScreen").evaluate(node => {
      node.scrollTop = 280;
      window.scrollTo(0, 280);
      return {content:node.scrollTop, document:document.scrollingElement.scrollTop};
    });
    assert.deepEqual(scrolled, {content:280, document:0}, "only the shared working area scrolls");
    await assertHeaderLayout(page, "orders", header);
    assertDockInsets(await assertDock(page, role, "orders"), insets);
    await assertFloatingAction(page, "#newOrderBtn", dock, insets);

    if (role === "owner") {
      await switchSection(page, role, "expenses");
      await assertFloatingAction(page, "#newExpenseBtn", dock, insets);
      const editor = await openExpenseDialog(page);
      const box = await editor.boundingBox();
      assert.ok(box.x >= insets.left - 1 && box.x + box.width <= width - insets.right + 1 &&
        box.y >= insets.top - 1 && box.y + box.height <= height - insets.bottom + 1,
        "the expense form stays within the safe viewport in portrait and landscape");
      await editor.locator("#exSave").click({trial:true});
      await editor.locator("#exClose").click();
      await editor.waitFor({state:"hidden"});

      await switchSection(page, role, "reports");
      await page.locator("#rdReports").getByRole("button", {name:/^Прибыль по заказам/}).click();
      await assertHeaderLayout(page, "reports", header, {title:"Прибыль по заказам", back:"Назад к отчётам"});
      const back = page.locator("#rdScreenHeader").getByRole("button", {name:"Назад к отчётам"});
      await back.click();
      await assertHeaderLayout(page, "reports", header);
      await switchSection(page, role, "orders");
      await page.waitForFunction(previous => document.getElementById("appScreen").scrollTop === previous, scrolled.content);
    }

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
    await assertWorkScroll(page, header);
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

async function openExpenseDialog(page) {
  await page.locator("#newExpenseBtn").click();
  const dialog = page.getByRole("dialog", {name:"Новый расход"});
  await dialog.waitFor();
  return dialog;
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
    assert.equal(await page.locator("#exMonth").isVisible(), true);
    assert.equal(await page.locator("#exMonthlyTotal").isVisible(), true);
    assert.equal(await page.getByRole("heading", {name:"История расходов"}).isVisible(), true);
    assert.equal(await page.locator("#exForm").isVisible(), false, "the history is available without the expense editor");
    state.gates.get("operations").release();
    await page.locator("#exList").getByText("Тестовый расход").waitFor();

    let editor = await openExpenseDialog(page);
    await editor.locator("#exAmount").fill("77,23");
    await editor.locator("#exClose").click();
    await editor.waitFor({state:"hidden"});
    assert.equal(await page.locator("#newExpenseBtn").evaluate(node => node === document.activeElement), true);
    editor = await openExpenseDialog(page);
    const amount = editor.locator("#exAmount"), save = editor.locator("#exSave");
    assert.equal(await amount.inputValue(), "", "cancel discards an ordinary draft");
    await amount.fill("0");
    await save.click();
    await editor.locator("#exMessage").getByText(/сумму от 0,01/i).waitFor();
    assert.deepEqual(writes.map(write => write.endpoint), ["rabota_growth_plan"], "cancel and invalid input never write expenses");
    await amount.fill("99,50");
    await editor.locator("#exCategory").selectOption("Расходники");
    await editor.locator("#exDetail").fill("Тестовая запись");
    await editor.locator("#exOrder").fill("12345");
    const savingExpense = deferred();
    state.gates.set(expenseRecordRpc, savingExpense);
    state.fail.add("operations");
    await save.click();
    assert.equal(await save.isDisabled(), true);
    assert.equal(await editor.locator("#exClose").isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await editor.isVisible(), true, "a pending write cannot be dismissed as canceled");
    savingExpense.release();
    await editor.waitFor({state:"hidden"});
    assert.equal(await page.locator("#newExpenseBtn").evaluate(node => node === document.activeElement), true);
    await page.locator("#exStatus").getByText(/сохранён/i).waitFor();
    await page.locator("#exRetry").waitFor();
    await page.locator("#exList").getByText("Тестовый расход").waitFor();
    const {p_request_id:createdExpenseId,...createdExpensePayload}=writes.at(-1).payload;
    assert.ok(createdExpenseId);
    assert.deepEqual(createdExpensePayload, {p_amount:99.5,p_note:"[Расходники] Тестовая запись · Заказ №12345"});
    await page.locator("#exRetry").click();
    const savedExpense = page.locator("#exList .ex-item").filter({ hasText: "Тестовая запись" });
    await savedExpense.waitFor();
    const monthlyTotal = await page.locator("#exMonthlyTotal").innerText();
    assert.equal(Number(monthlyTotal.replace(/[\s₽]/g, "").replace(",", ".")), 1299.5);
    assert.equal(documents.length, 1, "acknowledged expense and recovery remain in the same document");
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
    assert.deepEqual(writes.map(value => value.endpoint), ["rabota_growth_plan", expenseRecordRpc, "rabota_finance_void"]);

    await go(page, "expenses");
    async function submitExpense(tab,note,value="40"){
      const dialog=await openExpenseDialog(tab);
      await dialog.locator("#exAmount").fill(value);
      await dialog.locator("#exDetail").fill(note);
      await dialog.locator("#exSave").click();
      return dialog;
    }
    async function closeExpense(dialog){
      await dialog.locator("#exClose").click();
      await dialog.waitFor({state:"hidden"});
    }
    async function reloadExpenses(){
      // WebKit can leave the load event pending after a deliberately aborted write.
      // Wait for the new document and its actual expense surface.
      await page.reload({waitUntil:"commit"});
      await page.locator("#exMain").waitFor({state:"visible"});
    }
    state.loseResponse.add(expenseRecordRpc);
    const lostNote="Сбой доставки ответа";
    editor=await submitExpense(page,lostNote);
    await editor.locator("#exMessage").getByText(/Не удалось подтвердить запись/).waitFor();
    const pendingId=writes.at(-1).payload.p_request_id;
    await closeExpense(editor);
    const committed=page.locator("#exList .ex-item").filter({hasText:lostNote});
    await committed.waitFor();

    await reloadExpenses();
    editor=await submitExpense(page,"Сбой  доставки ответа","40,00");
    await editor.locator("#exMessage").getByText("Предыдущий расход уже сохранён.").waitFor();
    const beforeAcknowledgement=writes.length;
    await editor.getByRole("button",{name:"Закрыть без новой записи"}).click();
    await editor.waitFor({state:"hidden"});
    await page.locator("#exStatus").getByText(/сохранён/i).waitFor();
    assert.equal(writes.length,beforeAcknowledgement,"known receipt closes the previous attempt without a second POST");
    assert.equal(await committed.count(),1);

    editor=await submitExpense(page,lostNote);
    await editor.waitFor({state:"hidden"});
    assert.notEqual(writes.at(-1).payload.p_request_id,pendingId,"a genuine second expense with equal requisites gets a fresh ID");
    await committed.nth(1).waitFor();
    assert.equal(await committed.count(),2);
    assert.equal(state.expenses.filter(row=>row.note.includes(lostNote)).reduce((total,row)=>total+row.amount,0),80);

    const twoTabsNote="Два независимых расхода в разных вкладках";
    state.loseBeforeWrite.add(expenseRecordRpc);
    editor=await submitExpense(page,twoTabsNote,"42,75");
    await editor.locator("#exMessage").getByText(/Не удалось подтвердить запись/).waitFor();
    const firstTabId=writes.at(-1).payload.p_request_id;
    await closeExpense(editor);

    const secondTab=await s.newPage();
    await secondTab.goto(origin+"/?view=expenses");
    const secondEditor=await submitExpense(secondTab,twoTabsNote,"42,75");
    await secondEditor.waitFor({state:"hidden"});
    assert.notEqual(writes.at(-1).payload.p_request_id,firstTabId,"an independent tab never inherits the first tab's pending ID");
    await secondTab.close();

    await reloadExpenses();
    editor=await submitExpense(page,twoTabsNote,"42.75");
    await editor.locator("#exMessage").getByText(/Предыдущий расход .* не подтверждён/).waitFor();
    state.invalidReceipt.add(expenseRecordRpc);
    await editor.getByRole("button",{name:"Проверить и повторить предыдущий расход"}).click();
    await editor.locator("#exMessage").getByText(/Не удалось подтвердить запись/).waitFor();
    assert.equal(writes.at(-1).payload.p_request_id,firstTabId,"the explicit retry reuses the same ID after reload");
    assert.equal(await page.locator("#exStatus").textContent(),"","a boolean response does not acknowledge the expense");
    const beforeRetry=writes.length;
    await editor.getByRole("button",{name:"Проверить и повторить предыдущий расход"}).click();
    await editor.waitFor({state:"hidden"});
    assert.equal(writes.length,beforeRetry,"an exact lookup reconciles a committed malformed response");
    await page.locator("#exList .ex-item").filter({hasText:twoTabsNote}).nth(1).waitFor();

    await page.evaluate(()=>{
      const setItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(this===sessionStorage)throw new DOMException("Synthetic storage quota","QuotaExceededError");
        return setItem.call(this,key,value);
      };
    });
    const beforeQuota=writes.length;
    editor=await submitExpense(page,"Расход без доступного хранения");
    await editor.locator("#exMessage").getByText(/Запись не отправлена/).waitFor();
    assert.equal(writes.length,beforeQuota,"no expense POST without a persisted request ID");
    await closeExpense(editor);
  } finally { await s.close(); }
}

async function growthRecovery(browser) {
  const s = await fixture(browser, root, 390, "owner");
  const { page, state, writes, documents } = s;
  const stale = { started: deferred(), finish: deferred() };
  const currentTask = page.getByRole("checkbox", {name:task.title,exact:true});
  const status = page.locator("#gwNotice");
  try {
    await page.goto(origin + "/?view=growth");
    await currentTask.waitFor();
    assert.equal(await currentTask.isChecked(), false);

    // The old GET captures an incomplete task before the successful PATCH.
    await go(page, "orders");
    state.staleGrowthRead = stale;
    await go(page, "growth");
    await stale.started.promise;
    state.loseResponse.add("rabota_growth_plan");
    await currentTask.click();
    await status.getByText("Отметка сохранена.", {exact:true}).waitFor();
    assert.equal(await currentTask.isChecked(), true);
    assert.equal(await currentTask.isEnabled(), true);
    stale.finish.release();
    await page.waitForLoadState("networkidle");
    assert.equal(await currentTask.isChecked(), true, "a pre-write GET cannot undo a reconciled checkbox");

    // The second write also commits, but its reply and the immediate reading are lost.
    state.loseResponse.add("rabota_growth_plan");
    state.failGrowthRead = true;
    await currentTask.click();
    await page.locator("#gwRetry").waitFor();
    assert.equal(await currentTask.evaluate(input => input.indeterminate && input.disabled), true);
    assert.equal(state.tasks[0].completed, false);
    await page.locator("#gwRetry").click();
    await status.getByText("Отметка сохранена.", {exact:true}).waitFor();
    assert.equal(await currentTask.evaluate(input => !input.indeterminate && !input.disabled && !input.checked), true);
    assert.equal(writes.length, 2, "retry only reconciles the existing writes");
    assert.equal(documents.length, 1, "reconciliation stays in the same app document");
  } finally {
    stale.finish.release();
    await s.close();
  }
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

async function assertFocus(locator, message) {
  assert.equal(await locator.evaluate(node => node === document.activeElement), true, message);
}

async function assertModalKeyboard(page, dialog, background, save, close) {
  assert.equal(await dialog.getAttribute("aria-modal"), "true");
  await background.evaluate(node => node.focus());
  assert.equal(await background.evaluate(node => node === document.activeElement), false);
  assert.equal(await background.evaluate(node => Boolean(node.closest("[inert]"))), true);

  await save.focus();
  await page.keyboard.press("Tab");
  await assertFocus(close, "Tab from Save must return to Close");
  await page.keyboard.press("Shift+Tab");
  await assertFocus(save, "Shift+Tab from Close must return to Save");
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press(key);
      assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true,
        key + " must keep focus in the dialog");
    }
  }
}

async function cashbookFocus(browser) {
  const f = await fixture(browser, root, 390, "owner");
  try {
    const { page } = f;
    await page.goto(origin + "/?view=finance");
    const create = page.locator(".mw-owner-create");
    const expenses = page.locator('#rdMobileNav [data-page="expenses"]');
    await create.click();
    await page.getByRole("button", { name: "− Создать расход", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Создать расход" });
    await dialog.waitFor();
    await assertModalKeyboard(page, dialog, expenses,
      dialog.getByRole("button", { name: "Сохранить", exact: true }),
      dialog.getByRole("button", { name: "Закрыть окно", exact: true }));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await assertFocus(create, "Escape restores the cashbook Create opener");
    await expenses.focus();
    await page.keyboard.press("Enter");
    await page.locator("#exMain").waitFor();
    assert.deepEqual(f.writes, [], "Keyboard navigation and cancellation must not record an expense");
  } finally { await f.close(); }
}

async function orderFocus(browser, role, width) {
  const f = await fixture(browser, root, width, role);
  try {
    const { page } = f;
    await page.goto(origin + "/?view=orders");
    if (role !== "master") await go(page, "orders");
    const create = page.locator("#newOrderBtn");
    const background = page.locator(role === "master"
      ? '#mwMasterNav [data-mw-page="reports"]'
      : '#rdMobileNav [data-page="orders"]');
    await create.click();
    const dialog = page.getByRole("dialog", { name: "Новый заказ" });
    await dialog.waitFor();
    await assertModalKeyboard(page, dialog, background,
      dialog.getByRole("button", { name: "Сохранить заказ", exact: true }),
      dialog.getByRole("button", { name: "Закрыть", exact: true }));

    if (role === "owner") {
      await dialog.locator("#orderAdvanced summary").click();
      await dialog.locator("#price").fill("1200");
      await dialog.locator("#orderStatus").selectOption("Выполнен");
      const payment = page.getByRole("dialog", { name: "Завершение заказа" });
      await payment.waitFor();
      await page.keyboard.press("Escape");
      await payment.waitFor({ state: "hidden" });
      assert.equal(await dialog.isVisible(), true, "Escape only dismisses the top payment dialog");
    }

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await assertFocus(create, "Escape restores the new order opener");
    assert.equal(await background.evaluate(node => Boolean(node.closest("[inert]"))), false);
    assert.deepEqual(f.writes, [], "Keyboard navigation and cancellation must not create an order");
  } finally { await f.close(); }
}

async function modalFocus(browser) {
  await cashbookFocus(browser);
  for (const [role, width] of [["owner", 390], ["manager", 375], ["master", 320]])
    await orderFocus(browser, role, width);
}

module.exports = { fixture, go, assertHeaderLayout, modalFocus };
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
    console.log("PASS", browserName, "safe areas, standalone portrait and landscape, the shared header, expenses and scrolling");
    await dataFlow(browser);
    await growthRecovery(browser);
    await modalFocus(browser);
    console.log("PASS", browserName, "cashbook and order dialog keyboard focus");
    await legacyLinks(browser);
    console.log("PASS", browserName, "progressive rendering, connection retry, writes, freshness, history and legacy links");
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
