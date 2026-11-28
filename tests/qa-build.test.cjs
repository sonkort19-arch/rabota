"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {build} = require("../scripts/build-qa.cjs");
const {install, isAllowedDatabaseRequest} = require("../qa/staging/guard.js");

const qa = "https://abcdefghijklmnopqrst.supabase.co";
const live = "https://yedzfmibceboncrytbqz.supabase.co";
const sha = "0123456789abcdef0123456789abcdef01234567";
const env = {QA_SUPABASE_URL: qa, QA_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_QA_test-public-key",
  QA_BUILD_SHA: sha};
const repo = path.resolve(__dirname, "..");

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rabota-qa-build-test-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test("QA configuration refuses production, absent values and service role keys", t => {
  const output = path.join(tmp(t), "output");
  const token = role => "aaa." + Buffer.from(JSON.stringify({role, ref: "abcdefghijklmnopqrst"}))
    .toString("base64url") + ".test";
  for (const overrides of [
    {QA_SUPABASE_URL: live},
    {QA_SUPABASE_URL: ""},
    {QA_SUPABASE_URL: qa + "/"},
    {QA_SUPABASE_URL: "https://other.example.test"},
    {QA_SUPABASE_PUBLISHABLE_KEY: ""},
    {QA_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test-only"},
    {QA_SUPABASE_PUBLISHABLE_KEY: token("service_role")},
    {QA_BUILD_SHA: "test"},
  ]) {
    assert.throws(() => build({output, env: {...env, ...overrides}}));
    assert.equal(fs.existsSync(output), false);
  }
});

test("generated QA static build and Vercel sources carry the same policy and no production services", t => {
  const parent = tmp(t);
  const prebuilt = path.join(parent, "prebuilt"), source = path.join(parent, "source");
  const original = fs.readFileSync(path.join(repo, "index.html"), "utf8");
  build({output: prebuilt, env});
  build({output: source, env, format: "source"});
  const staticDir = path.join(prebuilt, "static");
  for (const artifact of fs.readdirSync(staticDir, {recursive: true})) {
    const file = path.join(staticDir, artifact);
    if (!fs.lstatSync(file).isFile()) continue;
    assert.deepEqual(fs.readFileSync(path.join(source, artifact)), fs.readFileSync(file), artifact);
    if (!/\.(?:js|html|webmanifest)$/.test(artifact)) continue;
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text.includes(live), false, artifact);
    assert.doesNotMatch(text, /https:\/\/(wa\.me|api\.openai\.com|yandex\.ru\/maps)/, artifact);
    assert.doesNotMatch(text, /\.pushManager\b|serviceWorker\.register\(|Notification\.requestPermission\(/, artifact);
    if (artifact.endsWith(".js")) assert.doesNotThrow(() => new vm.Script(text), artifact);
    if (artifact.endsWith(".html")) {
      assert.match(text, /ТЕСТОВАЯ СРЕДА/);
      assert.ok(text.includes(`connect-src ${qa}`));
    }
  }
  for (const name of ["api", "sw.js", "whatsapp-client-test.html", "icons/raul-profile-avatar-20261114.jpg"])
    assert.equal(fs.existsSync(path.join(source, name)), false);
  const qaMetadata = JSON.parse(fs.readFileSync(path.join(source, "qa-build.json"), "utf8"));
  assert.equal(qaMetadata.gitSha, sha);
  assert.equal(qaMetadata.supabaseOrigin, qa);
  assert.equal(qaMetadata.integrations.email, "off");
  const config = JSON.parse(fs.readFileSync(path.join(prebuilt, "config.json"), "utf8"));
  const vercel = JSON.parse(fs.readFileSync(path.join(source, "vercel.json"), "utf8"));
  assert.deepEqual(Object.fromEntries(vercel.headers[0].headers.map(h => [h.key, h.value])),
    config.routes[0].headers);
  assert.ok(config.routes[0].headers["Content-Security-Policy"].includes(`connect-src ${qa};`));
  assert.equal(config.routes[0].headers["Permissions-Policy"].includes("microphone=()"), true);
  assert.match(fs.readFileSync(path.join(source, "index.html"), "utf8"), /const financePreview=false/);
  assert.match(fs.readFileSync(path.join(source, "whatsapp-client.js"), "utf8"), /\/qa-outbound\.html#whatsapp\//);
  assert.equal(fs.readFileSync(path.join(repo, "index.html"), "utf8"), original);
});

test("outbound policy permits testing password login, refresh, database writes and logout only in QA", async () => {
  const allowed = (suffix, method = "GET") => isAllowedDatabaseRequest(new URL(suffix, qa), method, qa);
  assert.equal(allowed("/auth/v1/token?grant_type=password", "POST"), true);
  assert.equal(allowed("/auth/v1/token?grant_type=refresh_token", "POST"), true);
  assert.equal(allowed("/auth/v1/user"), true);
  assert.equal(allowed("/auth/v1/logout", "POST"), true);
  assert.equal(allowed("/rest/v1/rabota_orders", "PATCH"), true);
  assert.equal(allowed("/rest/v1/rpc/rabota_payroll_payout_v3", "POST"), true);
  for (const endpoint of ["/auth/v1/signup", "/auth/v1/recover", "/auth/v1/otp", "/auth/v1/invite",
    "/functions/v1/rabota-push", "/rest/v1/rabota_push_subscriptions",
    "/rest/v1/rpc/rabota_register_push_subscription", live + "/rest/v1/rabota_orders"])
    assert.equal(allowed(endpoint, "POST"), false, endpoint);

  const requests = [], opened = [];
  const page = "https://qa.example.test";
  const win = {
    location: {href: page + "/", origin: page},
    document: {addEventListener() {}},
    open: (...args) => opened.push(args),
    async fetch(...args) { requests.push(args); return {ok: true}; }
  };
  install(qa, win);
  assert.match((await (await win.fetch("/api/ai-chat", {method: "POST"})).json()).reply, /Тестовый ответ/);
  await assert.rejects(win.fetch(live + "/rest/v1/rabota_orders"), TypeError);
  await assert.rejects(win.fetch(qa + "/auth/v1/signup", {method: "POST"}), TypeError);
  await win.fetch(qa + "/rest/v1/rabota_orders");
  assert.deepEqual(requests, [[qa + "/rest/v1/rabota_orders", {redirect: "error"}]]);
  assert.equal(win.open("https://wa.me/79180000000"), null);
  win.open("/qa-outbound.html#whatsapp/79180000000", "_blank");
  assert.deepEqual(opened, [[page + "/qa-outbound.html#whatsapp/79180000000", "_blank"]]);
});
