import {readFile, realpath, stat} from "node:fs/promises";
import {relative} from "node:path";
import {fileURLToPath} from "node:url";

const productionRef = "yedzfmibceboncrytbqz";
const roles = ["owner", "manager", "master"];
const unassignedOrder = "a0000000-0000-4000-8000-000000000005";
const movedOrder = "a0000000-0000-4000-8000-000000000009";

async function request(origin, path, {key, token, payload} = {}) {
  const headers = {accept: "application/json"};
  if (key) headers.apikey = key;
  if (token) headers.Authorization = "Bearer " + token;
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  return fetch(origin + path, {
    method: payload === undefined ? "GET" : "POST",
    headers, redirect: "error", signal: AbortSignal.timeout(15_000),
    ...(payload === undefined ? {} : {body: JSON.stringify(payload)})
  });
}

async function json(origin, path, options) {
  const response = await request(origin, path, options);
  if (!response.ok) throw Error(path.split("?")[0] + " вернул HTTP " + response.status);
  return response.json();
}

async function readPasswords() {
  const argument = process.argv[2];
  if (!argument) throw Error("Передайте закрытый JSON с паролями тестовых аккаунтов.");
  const filename = await realpath(argument);
  const info = await stat(filename);
  const location = relative(fileURLToPath(new URL("../", import.meta.url)), filename);
  if (!location.startsWith("../") || !info.isFile() || info.mode & 0o077)
    throw Error("Файл паролей должен находиться за пределами репозитория и иметь права 600.");
  let passwords;
  try {
    passwords = JSON.parse(await readFile(filename, "utf8"));
  } catch {
    throw Error("Не удалось прочитать JSON с тестовыми паролями.");
  }
  if (roles.some(role => typeof passwords?.[role] !== "string" || passwords[role].length < 16))
    throw Error("Укажите пароли всех трёх ролей тестовой CRM.");
  return passwords;
}

async function verify() {
  const {QA_VERCEL_URL: site, QA_SUPABASE_URL: database, QA_SUPABASE_PUBLISHABLE_KEY: key,
    QA_BUILD_SHA: sha} = process.env;
  if (!/^https:\/\/rabota-qa(?:-[a-z0-9-]+)?\.vercel\.app$/.test(site ?? "") ||
    !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(database ?? "") ||
    database.includes(productionRef) || !/^[a-f0-9]{40}$/.test(sha ?? "") || !key)
    throw Error("Проверьте адреса отдельной QA CRM и Supabase, публичный ключ и полный SHA.");
  const passwords = await readPasswords();
  const [metadata, page, sw, ai] = await Promise.all([
    json(site, "/qa-build.json"),
    request(site, "/"),
    request(site, "/sw.js"),
    request(site, "/api/ai-chat")
  ]);
  if (metadata.environment !== "qa" || metadata.gitSha !== sha || metadata.supabaseOrigin !== database)
    throw Error("Стенд публикует другую сборку или другое подключение.");
  if (!page.ok || sw.status !== 404 || ai.status !== 404)
    throw Error("Проверьте страницу входа и отсутствие внешних обработчиков.");
  const csp = page.headers.get("content-security-policy") ?? "";
  const html = await page.text();
  if (!csp.split(";").map(value => value.trim()).includes("connect-src " + database) ||
    !csp.includes("worker-src 'none'") || !html.includes("ТЕСТОВАЯ СРЕДА") || html.includes(productionRef))
    throw Error("Опубликованная страница не подтвердила изоляцию QA.");
  console.log("Подтверждены SHA опубликованной QA CRM и изоляция внешних запросов.");

  for (const role of roles) {
    const email = role + "@rabota-qa.example";
    const login = await json(database, "/auth/v1/token?grant_type=password", {
      key, payload: {email,password: passwords[role]}
    });
    const token = login?.access_token;
    const userId = login?.user?.id;
    if (typeof token !== "string" || typeof userId !== "string" ||
      login.user.email !== email || login.user.app_metadata?.rabota_qa_fixture !== true)
      throw Error("Auth не подтвердил тестовую учётную запись " + role + ".");
    const options = {key, token};
    const [member, unassigned, history] = await Promise.all([
      json(database, "/rest/v1/rabota_members?select=role,active&user_id=eq." + encodeURIComponent(userId), options),
      json(database, "/rest/v1/rabota_orders?select=id&id=eq." + unassignedOrder, options),
      json(database, "/rest/v1/rpc/rabota_order_reschedule_history", {...options,payload:{p_order_id:movedOrder}})
    ]);
    if (!Array.isArray(member) || member.length !== 1 || member[0].role !== role || member[0].active !== true ||
      !Array.isArray(unassigned) || unassigned.length !== (role === "master" ? 0 : 1) ||
      !Array.isArray(history) || history.length === 0)
      throw Error("Права или начальные данные не совпали для роли " + role + ".");
    if (role !== "manager") {
      const payroll = await json(database, "/rest/v1/rpc/rabota_payroll_snapshot_v3", {...options,payload:{}});
      if (payroll?.state !== "active" || !Array.isArray(payroll.travel_events) || !payroll.travel_events.length)
        throw Error("В базе отсутствует тестовый журнал начислений " + role + ".");
    }
    console.log("Подтверждены вход, права и данные роли " + role + ".");
  }
}

verify().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
