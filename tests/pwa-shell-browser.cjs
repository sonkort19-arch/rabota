"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium, devices, webkit } = require("playwright");

const repo = path.join(__dirname, "..");
const worker = fs.readFileSync(path.join(repo, "sw.js"), "utf8");
const runtime = fs.readFileSync(path.join(repo, "pwa-runtime.js"), "utf8");

function fixtureHtml(release) {
  return `<!doctype html><html lang="ru"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Работа QA ${release}</title>
  <link rel="stylesheet" href="/fixture-shell.css?v=${release}">
  <script defer src="/pwa-runtime.js?v=fixture"></script>
  <script defer src="/fixture-shell.js?v=${release}"></script></head>
  <body><form id="loginForm"></form><main id="appScreen" data-html-release="${release}">
  <input id="draft" aria-label="Черновик"></main></body></html>`;
}

async function startServer() {
  const state = { release: 1, workerRevision: 1, document: "healthy", missingCss: null, slowCss: null, requests: [] };
  const server = http.createServer((request, reply) => {
    const url = new URL(request.url, "http://localhost");
    const assetVersion = url.searchParams.get("v");
    state.requests.push({ path: url.pathname, assetVersion, method: request.method });
    const send = (status, type, value, cache = "public, max-age=0, must-revalidate") =>
      reply.writeHead(status, { "Content-Type": type, "Cache-Control": cache }).end(value);
    if (state.document === "disconnected") return request.socket.destroy();

    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (state.document === "error") return send(503, "text/plain", "Fixture gateway unavailable");
      if (state.document === "stalled-body") {
        reply.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "public, max-age=0" });
        reply.write("<!doctype html><html lang=ru><head>");
        return;
      }
      reply.setHeader("ETag", '"fixture-shell-' + state.release + '"');
      return send(200, "text/html; charset=utf-8", fixtureHtml(state.release));
    }
    if (url.pathname === "/sw.js") {
      // Report actual activation to the local fixture without creating another controlled client.
      const receipt = JSON.stringify("/fixture-worker-activated?v=" + state.workerRevision);
      const reportActivation = `\nself.addEventListener("activate", event => event.waitUntil(fetch(${receipt})));\n`;
      return send(200, "application/javascript", worker + reportActivation);
    }
    if (url.pathname === "/fixture-worker-activated") return send(204, "text/plain", "", "no-store");
    if (url.pathname === "/pwa-runtime.js") return send(200, "application/javascript", runtime);
    if (url.pathname === "/fixture-shell.css") {
      const content = `#appScreen { --test-release: ${Number(assetVersion)}; }`;
      if (assetVersion === state.missingCss) {
        const timer = setTimeout(() => send(404, "text/plain", "Unavailable release stylesheet"), 300);
        reply.once("close", () => clearTimeout(timer));
        return;
      }
      if (assetVersion === state.slowCss) {
        const timer = setTimeout(() => send(200, "text/css", content), 2500);
        reply.once("close", () => clearTimeout(timer));
        return;
      }
      return send(200, "text/css", content);
    }
    if (url.pathname === "/fixture-shell.js") {
      return send(200, "application/javascript",
        `document.getElementById("appScreen").dataset.scriptRelease = "${Number(assetVersion)}";`);
    }
    if (url.pathname === "/api/private-session") {
      if (state.document === "error") return send(503, "application/json", '{"error":"fixture unavailable"}', "no-store");
      if (request.headers.authorization !== "Bearer synthetic-token") {
        return send(401, "application/json", '{"error":"fixture authentication required"}', "no-store");
      }
      return send(200, "application/json", '{"account":"synthetic-only"}', "private, no-store");
    }
    return send(404, "text/plain", "Not a fixture resource");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, state, origin: "http://127.0.0.1:" + server.address().port };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const marker = await caches.match(location.origin + "/.rabota-shell-metadata", { cacheName: "rabota-shell-v1" });
    if (!marker) return null;
    const { current, previous } = await marker.json();
    const cache = await caches.open(current);
    return { current, previous, urls: (await cache.keys()).map(request => request.url) };
  });
}

async function pollFor(description, read) {
  const deadline = Date.now() + 12000;
  do {
    const result = await read();
    if (result) return result;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for " + description);
}

function waitForSnapshot(page, release) {
  return pollFor("static shell revision " + release, async () => {
    const candidate = await snapshot(page);
    return candidate?.urls.some(url => url.endsWith("/fixture-shell.js?v=" + release)) && candidate;
  });
}

async function assertRelease(page, release) {
  const main = page.locator("#appScreen");
  assert.equal(await main.getAttribute("data-html-release"), String(release), "HTML release");
  assert.equal(await main.getAttribute("data-script-release"), String(release), "script release");
  assert.equal(await main.evaluate(el => getComputedStyle(el).getPropertyValue("--test-release").trim()),
    String(release), "stylesheet release");
}

async function fetchPrivate(page) {
  return page.evaluate(async () => {
    try {
      const response = await fetch("/api/private-session", {
        headers: { Authorization: "Bearer synthetic-token" }
      });
      return { status: response.status, payload: await response.json() };
    } catch (_) {
      return { status: 0 };
    }
  });
}

async function verify(browserType, executablePath) {
  const { server, state, origin } = await startServer();
  let browser;
  try {
    browser = await browserType.launch({ executablePath });
    const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "allow" });
    const page = await context.newPage();
    await page.goto(origin + "/?view=orders");
    await assertRelease(page, 1);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const first = await waitForSnapshot(page, 1);
    assert.deepEqual(first.urls.sort(), [
      origin + "/", origin + "/fixture-shell.css?v=1", origin + "/fixture-shell.js?v=1",
      origin + "/pwa-runtime.js?v=fixture"
    ].sort());
    assert.deepEqual(await fetchPrivate(page), { status: 200, payload: { account: "synthetic-only" } });
    assert.equal((await snapshot(page)).urls.some(url => url.includes("/api/")), false);

    state.document = "error";
    const requestsBeforeFallback = state.requests.length;
    await page.goto(origin + "/?view=offline-fallback");
    await assertRelease(page, 1);
    assert.match(page.url(), /\?view=offline-fallback$/);
    assert.equal(state.requests.slice(requestsBeforeFallback).some(request => request.path.startsWith("/fixture-shell.")),
      false, "cached exact asset versions avoid a repeat network request");
    assert.deepEqual(await fetchPrivate(page), { status: 503, payload: { error: "fixture unavailable" } });

    state.document = "stalled-body";
    const beforeStall = Date.now();
    await page.goto(origin + "/?view=stalled", { timeout: 10000 });
    await assertRelease(page, 1);
    const stalledMs = Date.now() - beforeStall;
    assert(stalledMs < 6500, "a stalled HTML body must not block a verified fallback shell");

    state.document = "healthy";
    state.release = 2;
    await page.goto(origin + "/?view=after-deploy");
    await assertRelease(page, 2);
    const second = await waitForSnapshot(page, 2);
    assert.notEqual(second.current, first.current);
    assert.equal(second.previous, first.current, "the earlier complete snapshot remains available");

    state.release = 3;
    state.missingCss = "3";
    const beforeIncomplete = state.requests.length;
    await page.goto(origin + "/?view=incomplete-deploy");
    await assertRelease(page, 2);
    assert.equal(state.requests.slice(beforeIncomplete).some(request =>
      request.path === "/fixture-shell.css" && request.assetVersion === "3"), true, "the browser saw the failing release");
    await pollFor("cleanup of the rejected candidate", () => page.evaluate(async () => (await caches.keys()).length === 3));
    assert.equal((await snapshot(page)).current, second.current, "the incomplete candidate cannot replace a complete shell");

    state.document = "error";
    await page.goto(origin + "/?view=after-incomplete-deploy");
    await assertRelease(page, 2);
    state.document = "disconnected";
    await page.goto(origin + "/?view=offline");
    await assertRelease(page, 2);
    assert.deepEqual(await fetchPrivate(page), { status: 0 });
    if (browserType === chromium) {
      await context.setOffline(true);
      await page.goto(origin + "/?view=device-offline");
      await assertRelease(page, 2);
      await context.setOffline(false);
    }

    state.document = "healthy";
    state.release = 2;
    state.workerRevision++;
    await page.locator("#draft").fill("Несохранённый черновик");
    await page.evaluate(async () => {
      window.originalDocument = document;
      await (await navigator.serviceWorker.ready).update();
    });
    await pollFor("updated worker in the waiting state", () => page.evaluate(async () =>
      Boolean((await navigator.serviceWorker.getRegistration("/")).waiting)));
    assert.equal(await page.locator("#draft").inputValue(), "Несохранённый черновик");
    assert.equal(await page.evaluate(() => window.originalDocument === document), true);
    assert.match(page.url(), /\?view=(?:device-)?offline$/);

    await page.close();
    await pollFor("worker activation after the last controlled page closes", () => state.requests.some(request =>
      request.path === "/fixture-worker-activated" && request.assetVersion === String(state.workerRevision)));
    const reopened = await context.newPage();
    await reopened.goto(origin + "/?view=reopened");
    await assertRelease(reopened, 2);
    await pollFor("worker activation after reopen", () => reopened.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      return registration?.active?.state === "activated" && !registration.waiting && !registration.installing;
    }));

    await reopened.evaluate(async () => {
      await Promise.all((await caches.keys()).map(name => caches.delete(name)));
    });
    state.document = "disconnected";
    const retryUrl = origin + "/?view=retry-after-storage-cleared";
    const response = await reopened.goto(retryUrl);
    assert.equal(response.status(), 503);
    const retry = reopened.getByRole("link", { name: "Повторить загрузку" });
    await retry.waitFor();
    state.document = "healthy";
    await retry.click();
    await assertRelease(reopened, 2);
    assert.equal(reopened.url(), retryUrl);

    await waitForSnapshot(reopened, 2);
    state.release = 4;
    state.slowCss = "4";
    await reopened.goto(origin + "/?view=slow-update");
    await assertRelease(reopened, 2);
    await waitForSnapshot(reopened, 4);
    await assertRelease(reopened, 2);
    await reopened.goto(origin + "/?view=next-open");
    await assertRelease(reopened, 4);

    await context.close();
    return { stalledMs };
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const name = process.env.TEST_BROWSER || "chromium";
const browserType = { chromium, webkit }[name];
if (!browserType) throw new Error("Unsupported TEST_BROWSER " + name);
verify(browserType, process.env.TEST_BROWSER_PATH).then(({ stalledMs }) => {
  console.log("PASS", name, "real service worker preserves complete static shells, private reads and drafts across updates");
  console.log("PASS", name, "reopen, retry, and background installation of slow release. Stalled HTML fallback in", stalledMs, "ms");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
