import {readFile, realpath, stat} from "node:fs/promises";
import {resolve, relative} from "node:path";
import {fileURLToPath} from "node:url";

const productionRef = "yedzfmibceboncrytbqz";
const accounts = [
  ["owner", "Владелец QA"],
  ["manager", "Менеджер QA"],
  ["master", "Рауль QA"]
];
const qaDomain = "rabota-qa.example";
const root = fileURLToPath(new URL("../", import.meta.url));

async function request(url, secret, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      apikey: secret,
      ...(secret.startsWith("eyJ") ? {Authorization: "Bearer " + secret} : {}),
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) throw Error("Supabase QA вернул HTTP " + response.status);
  return response.json();
}

async function provision() {
  const project = process.env.QA_SUPABASE_PROJECT_REF ?? "";
  const secret = process.env.QA_SUPABASE_ADMIN_KEY ?? "";
  const filename = process.argv[2];
  if (!/^[a-z0-9]{20}$/.test(project) || project === productionRef)
    throw Error("Укажите идентификатор отдельного QA-проекта Supabase.");
  if (!/^(?:sb_secret_[a-zA-Z0-9_-]+|eyJ[a-zA-Z0-9_.-]+)$/.test(secret))
    throw Error("Передайте закрытый административный ключ QA через QA_SUPABASE_ADMIN_KEY.");
  if (secret.startsWith("eyJ")) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(secret.split(".")[1], "base64url").toString("utf8"));
    } catch {
      throw Error("Передан некорректный административный токен.");
    }
    if (claims.ref !== project || claims.role !== "service_role")
      throw Error("Административный токен относится к другой базе или роли.");
  }
  if (!filename) throw Error("Передайте путь к закрытому JSON с паролями owner/manager/master.");
  const path = await realpath(resolve(filename));
  const location = relative(root, path);
  if (location === "" || !location.startsWith("../"))
    throw Error("Файл паролей должен находиться за пределами репозитория.");
  if ((await stat(path)).mode & 0o077)
    throw Error("Доступ к файлу паролей должен быть только у владельца файла (chmod 600).");
  let passwords;
  try {
    passwords = JSON.parse(await readFile(path, "utf8"));
    if (!passwords || typeof passwords !== "object") throw Error();
  } catch {
    throw Error("Файл паролей должен содержать JSON-объект с ключами owner, manager и master.");
  }
  const values = accounts.map(([role]) => passwords[role]);
  if (values.some(value => typeof value !== "string" || !/^[^\0]{16,}$/.test(value) ||
      Buffer.byteLength(value) > 72) ||
      new Set(values).size !== values.length)
    throw Error("Задайте три различных пароля длиной от 16 символов до 72 байт UTF-8.");

  const origin = "https://" + project + ".supabase.co";
  const marker = await request(origin + "/rest/v1/rpc/rabota_qa_project_ref", secret,{
    method: "POST",
    body: "{}"
  });
  if (marker !== project) throw Error("Указанный проект не подтвердил метку отдельной базы QA.");

  const existing = new Map();
  for (let page = 1; ; page++) {
    const users = await request(origin + "/auth/v1/admin/users?page=" + page + "&per_page=100", secret);
    if (!Array.isArray(users.users)) throw Error("Supabase QA вернул неправильный список пользователей.");
    for (const user of users.users) existing.set(user.email, user);
    if (users.users.length < 100) break;
  }
  for (const [role, name] of accounts) {
    const email = role + "@" + qaDomain;
    const account = existing.get(email);
    if (account) {
      if (!account.email_confirmed_at || account.app_metadata?.rabota_qa_fixture !== true)
        throw Error("Тестовый адрес уже занят другим аккаунтом " + email);
      process.stdout.write("Тестовый аккаунт уже существует " + email + "\n");
      continue;
    }
    try {
      await request(origin + "/auth/v1/admin/users", secret, {
        method: "POST",
        body: JSON.stringify({
          email, password: passwords[role], email_confirm: true,
          user_metadata: {full_name: name},
          app_metadata: {rabota_qa_fixture: true}
        })
      });
    } catch (error) {
      throw Error("Создание аккаунта " + email + " остановлено. " + error.message);
    }
    process.stdout.write("Создан тестовый аккаунт " + email + "\n");
  }
}

provision().catch(error => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
