"use strict";
(() => {
  const BASE = "https://yedzfmibceboncrytbqz.supabase.co";
  const KEY = "sb_publishable_tSqbw3aeAgxYuzHhQurCuw_yDze4ZNn";
  const SESSION_KEY = "rabota-auth-session-v1";
  const ZONE = "Europe/Moscow";
  const $ = id => document.getElementById(id);
  let session = null;
  let refreshPromise = null;
  let ownerId = null;
  let rows = [];
  let mode = "day";
  let selectedMonth = "";
  let selectedWeek = "";
  let loading = false;

  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch (_) { session = null; }

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const moscowToday = () => new Intl.DateTimeFormat("sv-SE", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const datePlus = (iso, days) => {
    const date = new Date(iso + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const weekStart = iso => {
    const day = new Date(iso + "T12:00:00Z").getUTCDay();
    return datePlus(iso, -((day + 6) % 7));
  };
  const monthPlus = (value, offset) => {
    const d = new Date(value + "-01T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + offset);
    return d.toISOString().slice(0, 7);
  };
  const prettyDate = iso => new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC", day: "numeric", month: "long"
  }).format(new Date(iso + "T12:00:00Z"));
  const prettyMonth = iso => {
    const name = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "UTC", month: "long", year: "numeric"
    }).format(new Date(iso.slice(0, 7) + "-01T12:00:00Z"));
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  const sectionTitle = (title, subtitle) => {
    const container = el("div");
    container.append(el("div", "gw-section-head"));
    container.firstChild.append(el("h2", "", title));
    if (subtitle) container.append(el("p", "gw-sub", subtitle));
    return container;
  };
  const empty = (title, info) => {
    const node = el("div", "gw-empty");
    node.append(el("strong", "", title), el("p", "", info));
    return node;
  };
  const notice = message => { $("gwNotice").textContent = message || ""; };

  function saveSession(data) {
    session = {
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  async function ensureSession() {
    if (!session || !session.refresh_token)
      throw new Error("Войдите в CRM «Работа», затем откройте раздел снова.");
    if (Number(session.expires_at || 0) > Math.floor(Date.now() / 1000) + 90) return;
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const response = await fetch(BASE + "/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          headers: { apikey: KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.access_token)
          throw new Error("Сессия истекла. Повторите вход в CRM «Работа».");
        saveSession(result);
      })().finally(() => { refreshPromise = null; });
    }
    await refreshPromise;
  }
  async function request(path, method = "GET", payload) {
    await ensureSession();
    const headers = {
      apikey: KEY, Authorization: "Bearer " + session.access_token, Accept: "application/json"
    };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") headers.Prefer = "return=representation";
    const response = await fetch(BASE + "/rest/v1/" + path, {
      method, headers, body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || "Ошибка загрузки плана (HTTP " + response.status + ").");
    return data;
  }
  async function verifyOwner() {
    await ensureSession();
    const response = await fetch(BASE + "/auth/v1/user", {
      headers: { apikey: KEY, Authorization: "Bearer " + session.access_token }
    });
    if (!response.ok) throw new Error("Нужно войти в CRM заново.");
    const user = await response.json();
    if (!user?.id) throw new Error("Не удалось проверить аккаунт.");
    const members = await request("rabota_members?select=user_id&user_id=eq." +
      encodeURIComponent(user.id) + "&role=eq.owner&active=is.true&limit=1");
    if (!Array.isArray(members) || members.length !== 1)
      throw new Error("Раздел «Развитие MOBA» доступен только владельцу.");
    ownerId = user.id;
  }
  async function fetchPlan() {
    const result = await request("rabota_growth_plan?select=id,owner_id,kind,title,details,start_on,end_on,parent_id,sort_order,target_rub,completed,completed_at" +
      "&order=start_on.asc,sort_order.asc&limit=600");
    if (!Array.isArray(result)) throw new Error("Ошибка формата плана.");
    rows = result;
    const year = rows.find(x => x.kind === "year" && x.start_on === "2027-01-01");
    $("gwTarget").textContent = year?.target_rub != null
      ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(year.target_rub)) + " ₽/мес."
      : "Цель не задана";
    const months = rows.filter(x => x.kind === "month" && x.start_on.startsWith("2027-"));
    $("gwYearMeta").textContent = "Цели по месяцам: " + months.filter(x => x.completed).length +
      " из " + months.length + " выполнено. Прибыль проверяем отдельно по отчётам.";
  }
  async function toggleTask(item, checked, input) {
    input.disabled = true;
    notice("");
    try {
      const payload = {
        completed: checked, completed_at: checked ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      };
      const updated = await request("rabota_growth_plan?id=eq." + encodeURIComponent(item.id) +
        "&owner_id=eq." + encodeURIComponent(ownerId), "PATCH", payload);
      if (!Array.isArray(updated) || updated.length !== 1)
        throw new Error("Не удалось сохранить отметку. Обновите страницу.");
      item.completed = Boolean(updated[0].completed);
      item.completed_at = updated[0].completed_at;
      render();
    } catch (error) {
      input.checked = !checked;
      input.disabled = false;
      notice(error.message);
    }
  }
  function taskRow(item, info) {
    const row = el("label", "gw-task" + (item.completed ? " is-complete" : ""));
    const input = el("input", "gw-check");
    input.type = "checkbox";
    input.checked = Boolean(item.completed);
    input.setAttribute("aria-label", item.title);
    input.addEventListener("change", () => void toggleTask(item, input.checked, input));
    const copy = el("span", "gw-task-label");
    copy.append(el("strong", "", item.title));
    if (info || item.details) copy.append(el("p", "", info || item.details));
    row.append(input, copy);
    return row;
  }
  function taskList(items, infoFn) {
    if (!items.length) return null;
    const list = el("div", "gw-card");
    items.forEach(item => list.append(taskRow(item, infoFn ? infoFn(item) : "")));
    return list;
  }
  function showDay(container) {
    const today = moscowToday();
    container.append(sectionTitle("Сегодня · " + prettyDate(today)));
    const due = rows.filter(x => x.kind === "day" && x.start_on === today);
    const overdue = rows.filter(x => x.kind === "day" && !x.completed && x.start_on < today &&
      x.start_on >= datePlus(today, -21));
    const tasks = [...overdue, ...due].sort((a, b) =>
      a.start_on.localeCompare(b.start_on) || a.sort_order - b.sort_order);
    if (tasks.length) {
      container.append(taskList(tasks, x => x.start_on < today ?
        "Перенесено с " + prettyDate(x.start_on) + (x.details ? " · " + x.details : "") : x.details));
      const done = tasks.filter(x => x.completed).length;
      container.append(el("p", "gw-sub", "Выполнено " + done + " из " + tasks.length + " задач"));
    } else {
      const next = rows.filter(x => x.kind === "day" && !x.completed && x.start_on > today)
        .sort((a, b) => a.start_on.localeCompare(b.start_on))[0];
      container.append(empty("На сегодня задач нет",
        next ? "Следующая задача — " + prettyDate(next.start_on) + ". Задания можно менять в чате ChatGPT." :
        "Новые задачи добавим после проверки предыдущих результатов в чате ChatGPT."));
    }
  }
  function periodSelector(label, back, next) {
    const wrap = el("div", "gw-period-selector");
    const prev = el("button", "", "‹");
    prev.type = "button";
    prev.setAttribute("aria-label", "Предыдущий период");
    prev.addEventListener("click", back);
    const name = el("span", "", label);
    const forward = el("button", "", "›");
    forward.type = "button";
    forward.setAttribute("aria-label", "Следующий период");
    forward.addEventListener("click", next);
    wrap.append(prev, name, forward);
    return wrap;
  }
  function showWeek(container) {
    const start = selectedWeek || weekStart(moscowToday());
    const end = datePlus(start, 6);
    container.append(periodSelector(prettyDate(start) + " — " + prettyDate(end),
      () => { selectedWeek = datePlus(start, -7); render(); },
      () => { selectedWeek = datePlus(start, 7); render(); }));
    const goals = rows.filter(x => x.kind === "week" && x.start_on === start);
    const days = rows.filter(x => x.kind === "day" && x.start_on >= start && x.start_on <= end);
    if (goals.length) {
      container.append(el("div", "gw-block-title", "Цель недели"));
      container.append(taskList(goals));
    }
    if (days.length) {
      container.append(el("div", "gw-block-title", "Задачи по дням"));
      container.append(taskList(days, x => prettyDate(x.start_on) + (x.details ? " · " + x.details : "")));
    }
    if (!goals.length && !days.length)
      container.append(empty("План на неделю пока пуст", "Следующие задачи определим здесь, в чате, по результатам предыдущей недели."));
  }
  function showMonth(container) {
    const month = selectedMonth || moscowToday().slice(0, 7);
    container.append(periodSelector(prettyMonth(month),
      () => { selectedMonth = monthPlus(month, -1); render(); },
      () => { selectedMonth = monthPlus(month, 1); render(); }));
    const monthGoal = rows.find(x => x.kind === "month" && x.start_on.slice(0, 7) === month);
    if (monthGoal) {
      container.append(el("div", "gw-block-title", "Главная цель месяца"));
      container.append(taskList([monthGoal]));
    }
    const weekly = rows.filter(x => x.kind === "week" &&
      (monthGoal && x.parent_id === monthGoal.id || x.start_on.slice(0, 7) === month));
    if (weekly.length) {
      container.append(el("div", "gw-block-title", "Задачи по неделям"));
      container.append(taskList(weekly, x => prettyDate(x.start_on) + " — " + prettyDate(x.end_on)));
    }
    if (!monthGoal && !weekly.length)
      container.append(empty("План ещё не составлен", "Цели на этот месяц можно подготовить и изменить через ChatGPT."));
  }
  function showYear(container) {
    container.append(sectionTitle("План на 2027 год", "Каждый месяц — один измеримый результат."));
    const months = rows.filter(x => x.kind === "month" && x.start_on.startsWith("2027-"))
      .sort((a, b) => a.start_on.localeCompare(b.start_on));
    if (!months.length) {
      container.append(empty("Годовой план ещё не загружен", "После настройки базы появятся 12 месячных этапов."));
      return;
    }
    const list = el("div", "gw-card");
    months.forEach((item, index) => {
      const button = el("button", "gw-month-row" + (item.completed ? " is-complete" : ""));
      button.type = "button";
      button.append(el("span", "gw-month-num", String(index + 1).padStart(2, "0")));
      const copy = el("span", "gw-month-copy");
      copy.append(el("strong", "", item.title),
        el("small", "", prettyMonth(item.start_on) + (item.completed ? " · Выполнено" : "")));
      button.append(copy, el("span", "gw-chevron", "›"));
      button.addEventListener("click", () => {
        selectedMonth = item.start_on.slice(0, 7);
        mode = "month";
        render();
        document.querySelector(".gw-app")?.scrollTo({ top: 0, behavior: "instant" });
      });
      list.append(button);
    });
    container.append(list);
  }
  function render() {
    const content = $("gwContent");
    content.replaceChildren();
    document.querySelectorAll("[data-period]").forEach(button => {
      const active = button.dataset.period === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (mode === "day") showDay(content);
    if (mode === "week") showWeek(content);
    if (mode === "month") showMonth(content);
    if (mode === "year") showYear(content);
  }
  function setupNavigation() {
    document.querySelectorAll("[data-period]").forEach(button => {
      button.addEventListener("click", () => {
        mode = button.dataset.period;
        render();
      });
    });
    const moreBtn = $("gwMoreBtn"), menu = $("gwMenu"), veil = $("gwMenuVeil");
    const close = () => {
      menu.hidden = true;
      veil.hidden = true;
      moreBtn.setAttribute("aria-expanded", "false");
    };
    moreBtn.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open;
      veil.hidden = !open;
      moreBtn.setAttribute("aria-expanded", String(open));
    });
    veil.addEventListener("click", close);
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  }
  async function refreshData() {
    if (loading || !ownerId) return;
    loading = true;
    try {
      await fetchPlan();
      render();
      notice("");
    } catch (error) { notice(error.message || "Не удалось обновить план."); }
    finally { loading = false; }
  }
  async function init() {
    setupNavigation();
    selectedMonth = moscowToday().slice(0, 7);
    selectedWeek = weekStart(moscowToday());
    try {
      await verifyOwner();
      await fetchPlan();
      $("gwGate").hidden = true;
      $("gwMain").hidden = false;
      $("gwBottom").hidden = false;
      render();
    } catch (error) {
      $("gwGate").replaceChildren(el("div", "", error.message || "Не удалось открыть раздел."));
      const link = el("a", "", "Открыть CRM «Работа»");
      link.href = "/";
      $("gwGate").append(link);
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void refreshData();
    });
  }
  void init();
})();
