#!/usr/bin/env node
"use strict";

const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {parseArgs} = require("node:util");

const repo = path.resolve(__dirname, "..");
const staging = path.join(repo, "qa", "staging");
const pages = ["index.html", "ai.html", "expenses.html", "growth.html"];
const liveSupabase = "https://yedzfmibceboncrytbqz.supabase.co";
const notice = '<div id="qaEnvironmentNotice">ТЕСТОВАЯ СРЕДА · Искусственные данные</div>';

function onlyMatch(source, pattern, description) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw Error(`Изменился формат ${description}. Проверьте изоляцию тестовой сборки.`);
  return matches[0];
}
function readBindings(contents) {
  const literal = name => onlyMatch(contents,
    new RegExp(`\\bconst ${name}\\s*=\\s*["']([^"']+)["']`, "g"), name)[1];
  return {url: literal("SUPABASE_URL"), key: literal("SUPABASE_KEY")};
}
function readConfig(env, forbidden) {
  const {QA_SUPABASE_URL: origin, QA_SUPABASE_PUBLISHABLE_KEY: key} = env;
  const ref = /^https:\/\/([a-z]{20})\.supabase\.co$/.exec(origin || "")?.[1];
  if (!ref || forbidden.urls.has(origin)) throw Error("Укажите отдельный проект Supabase в QA_SUPABASE_URL.");
  if (!key || forbidden.keys.has(key)) throw Error("Укажите публичный ключ тестовой базы в QA_SUPABASE_PUBLISHABLE_KEY.");
  if (!/^sb_publishable_[A-Za-z0-9_-]{15,}$/.test(key)) {
    try {
      const [header, payload, signature, extra] = key.split(".");
      if (!header || !signature || extra !== undefined) throw Error();
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (claims.role !== "anon" || claims.ref !== ref ||
          !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) throw Error();
    } catch (_) {
      throw Error("QA_SUPABASE_PUBLISHABLE_KEY должен быть publishable или anon-ключом указанной базы.");
    }
  }
  const gitSha = env.QA_BUILD_SHA || env.VERCEL_GIT_COMMIT_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], {cwd: repo, encoding: "utf8"}).trim();
  if (!/^[a-f0-9]{40}$/.test(gitSha)) throw Error("Нужен точный SHA тестируемого коммита.");
  return {origin, key, gitSha};
}
function policies(origin) {
  const directives = [
    "default-src 'none'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self'", "manifest-src 'self'", `connect-src ${origin}`,
    "form-action 'none'", "worker-src 'none'", "object-src 'none'", "base-uri 'none'"
  ];
  const meta = directives.join("; ");
  return {meta, headers: {
    "Content-Security-Policy": `${meta}; frame-ancestors 'none'`,
    "Permissions-Policy": "microphone=(), camera=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  }};
}
function rewriteOutbound(contents) {
  return contents.replaceAll("https://wa.me/", "/qa-outbound.html#whatsapp/")
    .replaceAll('"tel:', '"/qa-outbound.html#call/')
    .replaceAll("https://yandex.ru/maps/?text=", "/qa-outbound.html#map/");
}
function replaceSection(contents, start, end, replacement) {
  const from = contents.indexOf(start);
  const to = contents.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw Error("Изменился модуль внешних уведомлений. Проверьте тестовую сборку.");
  return contents.slice(0, from) + replacement + contents.slice(to);
}
function rewriteModule(name, contents) {
  const externalLinks = rewriteOutbound(contents);
  if (name === "master-notifications.js") {
    return replaceSection(externalLinks, "  async function getSubscription(){", "  function reset(){", `
  async function getSubscription(){return null}
  function syncToggle(){
    state(false);toggle.disabled=true;test.disabled=true;
    feedback("Доставка на телефон отключена. Ниже показаны уведомления внутри тестовой CRM.");
  }
  async function disablePush(){}
`);
  }
  if (name === "lead-assistant.js") {
    return replaceSection(externalLinks, "  async function enableReminders(){", "  function setField(", `
  async function enableReminders(){
    notice="Системные уведомления в тестовой CRM отключены. Внутренние напоминания доступны.";
    render();
  }
  async function maybeNotify(){}
`);
  }
  return externalLinks;
}
function rewritePage(name, contents, config, meta) {
  let result = rewriteOutbound(contents);
  if (name === "index.html" || name === "ai.html") {
    const {url, key} = readBindings(result);
    result = result.replaceAll(url, config.origin).replaceAll(key, config.key)
      .replaceAll("rabota-auth-session-v1", "rabota-qa-auth-session-v1");
  }
  if (name === "index.html") {
    const preview = onlyMatch(result, /^\s*const financePreview=.*;$/gm, "financePreview")[0];
    // Finance actions exercise the isolated test database.
    result = result.replace(preview, "\n    const financePreview=false;")
      .replaceAll("/icons/raul-profile-avatar-20261114.jpg", "/icons/rabota-soft-blue-180.png");
    const push = onlyMatch(result, /^\s*const PUSH_PUBLIC_KEY\s*=.*;$/gm, "PUSH_PUBLIC_KEY")[0];
    result = result.replace(push, "");
  }
  if (name === "ai.html") {
    const speech = onlyMatch(result, /^const SpeechRecognizer=.*;$/gm, "SpeechRecognizer")[0];
    result = result.replace(speech, "const SpeechRecognizer=null;");
  }
  const charset = onlyMatch(result, /<meta charset="utf-8">/gi, "HTML charset")[0];
  result = result.replace(charset, `${charset}
  <meta http-equiv="Content-Security-Policy" content="${meta}">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex,nofollow">
  <link rel="stylesheet" href="/qa-stand.css">
  <script src="/qa-guard.js" data-qa-supabase-origin="${config.origin}"></script>`);
  const body = onlyMatch(result, /<body(?:\s[^>]*)?>/gi, "HTML body")[0];
  return result.replace(body, body + "\n  " + notice);
}
function assertSafeFile(name, contents, forbidden) {
  const secrets = [...forbidden.urls, ...forbidden.keys];
  if (secrets.some(value => contents.includes(value))) throw Error(`Обнаружена рабочая конфигурация в ${name}.`);
  if (/(?:https?:\/\/wa\.me\/|https?:\/\/yandex\.ru\/maps\/|api\.openai\.com|\.pushManager\b|serviceWorker\.register\(|\/functions\/v1\/)/i.test(contents)) {
    throw Error(`Тестовая сборка содержит внешний маршрут в ${name}.`);
  }
}
function copyIcons(to, tracked) {
  const icons = path.join(repo, "icons");
  for (const entry of fs.readdirSync(icons, {recursive: true}).sort()) {
    if (entry === "raul-profile-avatar-20261114.jpg" || !/\.(?:png|svg)$/.test(entry)) continue;
    if (tracked && !tracked.has("icons/" + entry)) continue;
    const source = path.join(icons, entry);
    if (!fs.lstatSync(source).isFile()) throw Error("Нужен обычный файл ресурса.");
    const dest = path.join(to, "icons", entry);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.copyFileSync(source, dest);
  }
}
function writeJson(file, object) {
  fs.writeFileSync(file, JSON.stringify(object, null, 2) + "\n");
}
function build({env, output, format = "prebuilt", tracked}) {
  if (!["prebuilt", "source"].includes(format)) throw Error("Формат сборки должен быть prebuilt или source.");
  const bindings = ["index.html", "ai.html"].map(name =>
    readBindings(fs.readFileSync(path.join(repo, name), "utf8")));
  const forbidden = {
    urls: new Set([liveSupabase, ...bindings.map(binding => binding.url)]),
    keys: new Set(bindings.map(binding => binding.key))
  };
  const config = readConfig(env, forbidden);
  const {meta, headers} = policies(config.origin);
  const out = path.resolve(output);
  const parent = path.dirname(out);
  if (fs.existsSync(out) && (!fs.lstatSync(out).isDirectory() || fs.readdirSync(out).length !== 0)) {
    throw Error("Для тестовой сборки нужна новая или пустая папка назначения.");
  }
  fs.mkdirSync(parent, {recursive: true});
  const temp = fs.mkdtempSync(path.join(parent, ".rabota-qa-build-"));
  try {
    const site = format === "prebuilt" ? path.join(temp, "static") : temp;
    fs.mkdirSync(site, {recursive: true});
    function writeAsset(name, text) {
      assertSafeFile(name, text, forbidden);
      fs.writeFileSync(path.join(site, name), text);
    }
    const rootFiles = tracked ? [...tracked].filter(name => !name.includes("/")) : fs.readdirSync(repo);
    for (const name of rootFiles.sort()) {
      if ((!/^[a-z][a-z0-9-]*\.(?:js|css)$/.test(name) || name === "sw.js") && !pages.includes(name)) continue;
      const source = path.join(repo, name);
      if (!fs.lstatSync(source).isFile()) throw Error("Нужен обычный файл ресурса.");
      const contents = fs.readFileSync(source, "utf8");
      writeAsset(name, pages.includes(name) ? rewritePage(name, contents, config, meta) : rewriteModule(name, contents));
    }
    writeAsset("qa-guard.js", fs.readFileSync(path.join(staging, "guard.js"), "utf8"));
    writeAsset("qa-stand.css", fs.readFileSync(path.join(staging, "stand.css"), "utf8"));
    writeAsset("qa-outbound.js", fs.readFileSync(path.join(staging, "outbound.js"), "utf8"));
    writeAsset("qa-outbound.html", rewritePage("qa-outbound.html",
      fs.readFileSync(path.join(staging, "outbound.html"), "utf8"), config, meta));
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, "manifest.webmanifest"), "utf8"));
    writeJson(path.join(site, "manifest.webmanifest"), {...manifest, id: "/qa-workspace", name: "Работа — тестовая CRM", short_name: "Работа QA"});
    writeJson(path.join(site, "qa-build.json"), {
      schemaVersion: 1, environment: "qa", gitSha: config.gitSha, supabaseOrigin: config.origin,
      integrations: {whatsapp: "draft", ai: "fixture", push: "in-app-only", email: "off"}
    });
    fs.writeFileSync(path.join(site, "robots.txt"), "User-agent: *\nDisallow: /\n");
    copyIcons(site, tracked);
    if (format === "prebuilt") {
      writeJson(path.join(temp, "config.json"), {version: 3, routes: [
        {src: "/(.*)", headers, continue: true}, {src: "^/$", dest: "/index.html"}, {handle: "filesystem"}
      ]});
    } else {
      writeJson(path.join(site, "vercel.json"), {
        framework: null, buildCommand: null,
        headers: [{source: "/(.*)", headers: Object.entries(headers).map(([key, value]) => ({key, value}))}]
      });
    }
    if (fs.existsSync(out)) fs.rmdirSync(out);
    fs.renameSync(temp, out);
    return {out, gitSha: config.gitSha};
  } catch (error) {
    fs.rmSync(temp, {recursive: true, force: true});
    throw error;
  }
}
if (require.main === module) {
  try {
    const {values} = parseArgs({options: {out: {type: "string"}, format: {type: "string"}}});
    const command = args => execFileSync("git", args, {cwd: repo, encoding: "utf8"}).trim();
    const revision = command(["rev-parse", "HEAD"]);
    const claimed = process.env.QA_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
    if ((claimed && claimed !== revision) || command(["status", "--porcelain=v1", "--untracked-files=all"]))
      throw Error("Соберите кандидат из чистой рабочей копии нужного коммита.");
    const tracked = new Set(command(["ls-files", "-z"]).split("\0"));
    for (const name of [...pages, "manifest.webmanifest", "qa/staging/guard.js", "qa/staging/stand.css",
      "qa/staging/outbound.html", "qa/staging/outbound.js"]) {
      if (!tracked.has(name)) throw Error("Ресурс тестовой сборки отсутствует в коммите: " + name);
    }
    const defaultOutput = values.format === "source" ? "qa-build" : ".vercel/output";
    const {out, gitSha} = build({env: {...process.env, QA_BUILD_SHA: revision},
      output: values.out || defaultOutput, format: values.format, tracked});
    console.log(`Тестовая сборка ${gitSha} подготовлена в ${out}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = {build};
