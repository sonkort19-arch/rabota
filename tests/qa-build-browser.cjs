"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const { build } = require("../scripts/build-qa.cjs");

const app = "https://crm-qa.test";
const qa = "https://abcdefghijklmnopqrst.supabase.co";
const live = "https://yedzfmibceboncrytbqz.supabase.co";
const sha = "0123456789abcdef0123456789abcdef01234567";
const key = "sb_publishable_QA_test-public-key";
const output = fs.mkdtempSync(path.join(os.tmpdir(), "rabota-qa-build-browser-"));
const staticDir = path.join(output, "source");

async function checkRole(browser, role, width, responseHeaders) {
  const context = await browser.newContext({
    viewport: {width, height: 720}, isMobile: true, hasTouch: true, serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    const calls = [], faults = [], unexpected = [];
    page.on("pageerror", error => faults.push(error.message));
    const actor = "fixture-" + role;
    const date = new Intl.DateTimeFormat("sv-SE", {timeZone: "Europe/Moscow"}).format();
    const orders = [{
      id: "qa-order", name: "Тестовый клиент", status: "Записан",
      master: "Рауль", assigned_user_id: "fixture-master", order_number: 10200,
      appointment_date: date, appointment_time: "12:00:00",
      created_at: date + "T08:00:00Z",
    }];
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === app) {
        if (url.pathname.startsWith("/api/")) {
          unexpected.push(url.pathname);
          return route.abort();
        }
        const asset = path.resolve(staticDir, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
        if (!asset.startsWith(staticDir + path.sep) || !fs.existsSync(asset) || !fs.lstatSync(asset).isFile())
          return route.fulfill({status: 404, body: ""});
        return route.fulfill({path: asset, headers: responseHeaders});
      }
      if (url.origin !== qa || !request.headers().apikey || request.headers().apikey !== key) {
        unexpected.push(url.origin + url.pathname);
        return route.abort();
      }
      calls.push(url.pathname);
      let rows = [];
      switch (url.pathname) {
        case "/auth/v1/token":
          assert.equal(url.searchParams.get("grant_type"), "password");
          assert.deepEqual(request.postDataJSON(), {email: role + "@qa.example.test", password: "fixture-pass"});
          rows = {access_token: "qa-fixture-access", refresh_token: "qa-fixture-refresh", expires_in: 3600};
          break;
        case "/auth/v1/user":
          assert.equal(request.headers().authorization, "Bearer qa-fixture-access");
          rows = {id: actor, email: role + "@qa.example.test"};
          break;
        case "/auth/v1/logout":
          rows = {};
          break;
        case "/rest/v1/rabota_members":
          rows = [{user_id: actor, role, active: true, master_name: role === "master" ? "Рауль" : null}];
          break;
        case "/rest/v1/rabota_orders":
          rows = orders;
          break;
        case "/rest/v1/rpc/rabota_payroll_snapshot_v3":
          rows = {version: 3, state: "active", accounting_version: 1, master_id: "fixture-master",
            activated_at: date + "T08:00:00Z", earned: 0, paid: 0, due: 0,
            payouts: [], refunds: [], holds: [], orders: [], accounting_receipts: [], accounting_payouts: []};
          break;
        case "/rest/v1/rabota_finance_operations":
        case "/rest/v1/rabota_growth_plan":
        case "/rest/v1/rabota_order_notifications":
          break;
        default:
          unexpected.push(url.pathname);
          return route.abort();
      }
      return route.fulfill({headers: {"access-control-allow-origin": app}, json: rows});
    });
    await page.goto(app + "/");
    await page.getByText("ТЕСТОВАЯ СРЕДА · Искусственные данные", {exact: true}).waitFor();
    await page.locator("#loginEmail").fill(role + "@qa.example.test");
    await page.locator("#loginPassword").fill("fixture-pass");
    await page.locator("#loginSubmit").click();
    await page.locator("#appScreen:visible").waitFor();
    assert.equal(await page.locator("body").getAttribute("data-rd-role"), role);
    assert.equal(await page.locator("#signupBtn").isVisible(), false);
    assert.ok(await page.evaluate(() => localStorage.getItem("rabota-qa-auth-session-v1")));
    assert.equal(await page.evaluate(() => localStorage.getItem("rabota-auth-session-v1")), null);
    assert.deepEqual(await page.evaluate(async ({qa, live}) => {
      const get = async (url, options) => {
        try { await fetch(url, options); return true; } catch (_) { return false; }
      };
      return Promise.all([
        get(live + "/rest/v1/rabota_orders"),
        get(qa + "/auth/v1/signup", {method: "POST"}),
        get(qa + "/functions/v1/rabota-push", {method: "POST"}),
        get(qa + "/rest/v1/rpc/rabota_register_push_subscription", {method: "POST"}),
      ]);
    }, {qa, live}), [false, false, false, false]);
    // XMLHttpRequest bypasses the QA fetch wrapper but remains governed by the page's CSP.
    assert.equal(await page.evaluate(url => new Promise(resolve => {
      const request = new XMLHttpRequest();
      request.onerror = () => resolve("blocked");
      request.onload = () => resolve("passed");
      request.open("GET", url + "/rest/v1/rabota_orders");
      request.send();
    }), live), "blocked");
    if (role === "owner") {
      const reply = await page.evaluate(async () =>
        (await (await fetch("/api/ai-chat", {method: "POST"})).json()).reply);
      assert.match(reply, /Тестовый ответ ИИ/);
      const draft = await page.evaluate(() => window.__rdClientWhatsApp.rescheduleLink({
        phone: "70000000000", date: "2031-04-10", time: "15:00",
      }));
      assert.match(draft, /^\/qa-outbound\.html#whatsapp\//);
      await page.goto(new URL(draft, app).href);
      await page.getByRole("heading", {name: "Черновик WhatsApp"}).waitFor();
      assert.match(await page.locator("#qaOutboundText").innerText(), /10\.04\.2031 в 15:00/);
    }
    if (role === "master") {
      await page.locator("#pushBellBtn").click();
      await page.getByText("Доставка на телефон отключена.", {exact: false}).waitFor();
      assert.equal(await page.locator("#pushToggle").isDisabled(), true);
      assert.equal(await page.locator("#testPushBtn").isVisible(), false);
    }
    assert.deepEqual(unexpected, []);
    assert.deepEqual(faults, []);
    assert.ok(calls.includes("/auth/v1/token") && calls.includes("/rest/v1/rabota_orders"));
  } finally { await context.close(); }
}

(async () => {
  const kind = process.env.TEST_BROWSER || "chromium";
  try {
    build({env: {QA_SUPABASE_URL: qa, QA_SUPABASE_PUBLISHABLE_KEY: key, QA_BUILD_SHA: sha},
      output: staticDir, format: "source"});
    const vercel = JSON.parse(fs.readFileSync(path.join(staticDir, "vercel.json"), "utf8"));
    const headers = Object.fromEntries(vercel.headers[0].headers.map(({key, value}) => [key.toLowerCase(), value]));
    const browser = await {chromium, webkit}[kind].launch({headless: true,
      executablePath: process.env.TEST_BROWSER_PATH || undefined,
      ...(kind === "chromium" ? {args: ["--no-sandbox"]} : {}),
    });
    try {
      for (const [role, width] of [["owner", 320], ["manager", 375], ["master", 430]])
        await checkRole(browser, role, width, headers);
      console.log(`PASS ${kind} isolated QA artifact, tester roles, fixtures and blocked outbound delivery`);
    } finally { await browser.close(); }
  } finally { fs.rmSync(output, {recursive: true, force: true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
