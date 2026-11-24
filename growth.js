"use strict";
window.__rdCreateGrowth = function createGrowth({root, dbRequest, scrollToTop = () => window.scrollTo(0, 0)}) {
  const ZONE = "Europe/Moscow";
  const $ = id => root.querySelector("#" + id);
  const periodButtons = root.querySelectorAll("[data-period]");
  const pendingTasks = new Map();
  let ownerId = null;
  let generation = 0;
  let rows = null;
  let mode = "day";
  let selectedMonth = "";
  let selectedWeek = "";
  let renderedOn = "";
  let read = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const todayFormat = new Intl.DateTimeFormat("sv-SE", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  });
  const moscowToday = () => todayFormat.format(new Date());
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

  function setLoadStatus(message, error = false) {
    $("gwLoadStatus").textContent = message;
    $("gwRetry").hidden = !error;
    $("gwLoad").hidden = !message;
  }
  function drawTarget() {
    const year = rows?.find(item => item.kind === "year" && item.start_on === "2027-01-01");
    $("gwTarget").textContent = year?.target_rub != null
      ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(year.target_rub)) + " ₽/мес."
      : rows ? "Цель не задана" : "—";
    const months = rows?.filter(item => item.kind === "month" && item.start_on.startsWith("2027-"));
    $("gwYearMeta").textContent = months
      ? "Цели по месяцам: " + months.filter(item => item.completed).length +
        " из " + months.length + " выполнено. Прибыль проверяем отдельно по отчётам."
      : "—";
  }
  async function toggleTask(item, checked, input) {
    if (!ownerId || pendingTasks.has(item.id)) return;
    const account = generation;
    pendingTasks.set(item.id, checked);
    input.disabled = true;
    notice("");
    try {
      const stamp = new Date().toISOString();
      const payload = { completed: checked, completed_at: checked ? stamp : null, updated_at: stamp };
      const updated = await dbRequest("rabota_growth_plan?id=eq." + encodeURIComponent(item.id) +
        "&owner_id=eq." + encodeURIComponent(ownerId), "PATCH", payload);
      if (account !== generation) return;
      if (!Array.isArray(updated) || updated.length !== 1)
        throw new Error("Не удалось сохранить отметку. Проверьте доступ и повторите попытку.");
      const completion = { completed: Boolean(updated[0].completed), completed_at: updated[0].completed_at };
      if (rows) rows = rows.map(row => row.id === item.id ? { ...row, ...completion } : row);
      // A read that started before the write may still return the previous mark.
      read?.completions.set(item.id, completion);
    } catch (error) {
      if (account === generation) notice(error?.message || "Не удалось сохранить отметку.");
    } finally {
      if (account === generation) {
        pendingTasks.delete(item.id);
        render();
      }
    }
  }
  function taskRow(item, info) {
    const row = el("label", "gw-task" + (item.completed ? " is-complete" : ""));
    const input = el("input", "gw-check");
    input.type = "checkbox";
    input.checked = pendingTasks.get(item.id) ?? Boolean(item.completed);
    input.disabled = pendingTasks.has(item.id);
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
        scrollToTop();
      });
      list.append(button);
    });
    container.append(list);
  }
  function render() {
    renderedOn = moscowToday();
    const content = $("gwContent");
    content.replaceChildren();
    periodButtons.forEach(button => {
      const active = button.dataset.period === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    drawTarget();
    if (!rows) return;
    if (mode === "day") showDay(content);
    if (mode === "week") showWeek(content);
    if (mode === "month") showMonth(content);
    if (mode === "year") showYear(content);
  }
  function refresh() {
    if (!ownerId) return;
    if (rows && renderedOn !== moscowToday()) render();
    if (read) return read.promise;
    setLoadStatus(rows ? "" : "Загружаем задачи…");
    const pending = { completions: new Map() };
    pending.promise = dbRequest("rabota_growth_plan?select=id,owner_id,kind,title,details,start_on,end_on,parent_id,sort_order,target_rub,completed,completed_at" +
      "&order=start_on.asc,sort_order.asc,id.asc&limit=600", "GET").then(result => {
      if (read !== pending) return;
      if (!Array.isArray(result)) throw new Error("Ошибка формата плана.");
      const next = result.map(item => {
        const completion = pending.completions.get(item.id);
        return completion ? { ...item, ...completion } : item;
      });
      if (JSON.stringify(rows) !== JSON.stringify(next)) {
        rows = next;
        render();
      }
      setLoadStatus("");
    }).catch(error => {
      if (read !== pending) return;
      if (error?.status === 401 || error?.status === 403 || error?.code === "42501") {
        rows = null;
        render();
      }
      const message = error instanceof TypeError ? "Проверьте подключение к интернету." : error?.message;
      setLoadStatus("Не удалось обновить план. " + (message || ""), true);
    }).finally(() => {
      if (read === pending) read = null;
    });
    read = pending;
    return pending.promise;
  }
  function reset() {
    generation++;
    ownerId = null;
    rows = null;
    read = null;
    pendingTasks.clear();
    mode = "day";
    selectedMonth = "";
    selectedWeek = "";
    notice("");
    setLoadStatus("");
    render();
  }
  function open(userId) {
    if (!userId) return;
    if (ownerId !== userId) {
      reset();
      ownerId = userId;
    }
    return refresh();
  }
  periodButtons.forEach(button => {
    button.addEventListener("click", () => {
      mode = button.dataset.period;
      render();
    });
  });
  $("gwRetry").addEventListener("click", () => void refresh());
  return { open, refresh, reset };
};
