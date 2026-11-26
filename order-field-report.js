/* CRM «Работа»: сгруппированный отчёт владельца на подтверждённом финансовом снимке. */
"use strict";
(function (root) {
  const model = root.__rdOrderFieldReportModel;
  if (!model) return;

  const columns = model.COLUMNS;
  const columnLabels = {
    label: "Источник", count: "Заказы", percent: "Доля заказов", revenue: "Оплаты",
    salary: "Зарплата", expenses: "Расходы", profit: "Прибыль", average: "Средний чек"
  };
  const money = new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2
  });
  const count = new Intl.NumberFormat("ru-RU");
  const percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 2 });
  const pluralOrders = new Intl.PluralRules("ru-RU");
  const dateRange = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric"
  });
  const PAGE_SIZE = 50;
  const TITLE = "Источники заказов";
  const orderForms = { one: "заказ", few: "заказа", many: "заказов", other: "заказа" };
  const numberFor = {
    count: value => count.format(value),
    percent: value => percent.format(value / 100)
  };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }
  function button(className, caption, handler) {
    const element = node("button", className, caption);
    element.type = "button";
    element.addEventListener("click", handler);
    return element;
  }
  function selector(options, label, selected, change) {
    const element = node("select");
    element.setAttribute("aria-label", label);
    for (const [value, caption] of options) {
      const option = node("option", "", caption);
      option.value = value;
      element.append(option);
    }
    element.value = selected;
    element.addEventListener("change", () => change(element.value));
    return element;
  }
  function field(caption, input) {
    const label = node("label", "of-control");
    label.append(node("span", "", caption), input);
    return label;
  }
  function amount(value) {
    return value == null ? "—" : money.format(value);
  }
  function amountNode(tag, value) {
    return node(tag, value < 0 ? "of-amount-negative" : "", amount(value));
  }
  function orderCount(value) {
    return count.format(value) + " " + orderForms[pluralOrders.select(value)];
  }
  function orderDay(order) {
    const day = model.moscowDay(order.completedAt) || order.date;
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.split("-").reverse().join(".") : "";
  }
  function periodLabel({ period, from, to }, today) {
    if (period === "all") return "За всё время · включая незакрытые заказы";
    const [first, last] = model.bounds(period, today, from, to);
    const start = new Date(first + "T00:00:00Z"), end = new Date(last + "T00:00:00Z");
    if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || first > last) return "";
    const interval = dateRange.formatRange ? dateRange.formatRange(start, end) :
      first === last ? dateRange.format(start) : dateRange.format(start) + " – " + dateRange.format(end);
    return interval + " · по дате закрытия";
  }
  function fillSummary(summary, values) {
    summary.replaceChildren(...[
      ["count", "Заказы"], ["revenue", "Оплаты клиентов"], ["profit", "Прибыль"]
    ].map(([key, label]) => {
      const group = node("div");
      group.dataset.metric = key;
      group.append(node("dt", "", label), key === "count"
        ? node("dd", "", count.format(values.count)) : amountNode("dd", values[key]));
      return group;
    }));
  }

  function mount(panel, {
    getOrders, getRaulMasterId, getFinanceStatus, getPayroll, getOperations,
    sourceLabel = value => root.__rdClientWhatsApp?.sourceLabel?.(value), onRetry, onViewChange, onOpenOrder
  }) {
    panel.hidden = true;
    panel.classList.add("of-report");
    const initial = {
      field: model.FIELDS[0][0], period: "month", from: "", to: "", rank: "profit", sort: "count", direction: "desc"
    };
    const state = { ...initial };
    const empty = [];
    let selected = null, selectedLabel = "", sourceTrigger = null, limit = PAGE_SIZE;
    let cached = null, overviewRendered = null, tableRendered = null, ordersRendered = null;

    const overview = node("section", "of-overview");
    const controls = node("div", "of-controls");
    const period = selector(model.PERIODS, "Период отчёта", state.period, setPeriod);
    controls.append(field("Период", period));
    const custom = node("div", "of-custom");
    const customInputs = [];
    for (const [key, label] of [["from", "Начало периода"], ["to", "Конец периода"]]) {
      const input = node("input");
      input.type = "date";
      input.addEventListener("change", () => {
        state[key] = input.value;
        render();
      });
      customInputs.push(input);
      custom.append(field(label, input));
    }
    const overviewPeriod = node("p", "of-period-caption");
    const notice = node("div", "of-notice");
    const message = node("p");
    const retry = button("secondary of-retry", "Обновить", () => {
      if (onRetry) void onRetry();
      else void root.__rdMoneyUi?.refreshFinance?.();
    });
    notice.append(message, retry);
    const note = node("p", "of-note");
    const summary = node("dl", "of-summary");
    summary.setAttribute("aria-label", "Итоги за период");

    const chart = node("section", "of-chart");
    const chartHeader = node("div", "of-chart-header");
    const rank = selector([
      ["profit", "По прибыли"], ["count", "По заказам"], ["revenue", "По оплатам"]
    ], "Сравнить по", state.rank, value => {
      state.rank = value;
      render();
    });
    const rankField = field("Сравнить", rank);
    rankField.classList.add("of-rank-control");
    chartHeader.append(node("h2", "", "Откуда пришли заказы"), rankField);
    const sourceList = node("ul", "of-source-list");
    chart.append(chartHeader, sourceList);

    const emptyResult = node("div", "of-empty");
    const showAll = button("secondary", "Показать за всё время", () => {
      setPeriod("all");
      period.focus();
    });
    emptyResult.append(node("p", "", "За выбранный период заказов нет."), showAll);

    const details = node("details", "of-details");
    const detailContent = node("div", "of-details-content");
    const grouping = model.FIELDS.length > 1 ? selector(model.FIELDS, "Поле отчёта", state.field, value => {
      state.field = value;
      render();
    }) : null;
    if (grouping) detailContent.append(field("Чем сгруппировать", grouping));
    const download = button("of-export", "Скачать таблицу", () => {
      render();
      if (download.disabled || !cached) return;
      const report = cached.report;
      const csv = model.csvFor(report, model.sortGroups(report.groups, state.sort, state.direction));
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = node("a");
      link.href = url;
      link.download = "rabota-orders-by-field-" + model.moscowDay(new Date()) + ".csv";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    download.setAttribute("aria-label", "Скачать таблицу (CSV)");
    const tableActions = node("div", "of-table-actions");
    tableActions.append(download);
    const explain = node("p", "of-note",
      "Оплаты показаны с учётом возвратов. Прибыль учитывает начисленную зарплату и расходы по этим заказам. " +
      "Средний чек считается по заказам с подтверждённой оплатой.");
    const scroll = node("div", "of-scroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Таблица с горизонтальной прокруткой");
    const table = node("table", "of-table");
    table.setAttribute("aria-label", "Заказы по источникам клиентов");
    const cols = node("colgroup");
    for (const [key] of columns) cols.append(node("col", "of-col-" + key));
    const head = node("thead");
    const headings = node("tr");
    const sortButtons = [];
    for (const [key, caption] of columns) {
      const heading = node("th");
      heading.scope = "col";
      const sort = button("of-sort", columnLabels[key] || caption, () => {
        state.direction = state.sort === key
          ? (state.direction === "asc" ? "desc" : "asc")
          : (key === "label" ? "asc" : "desc");
        state.sort = key;
        render();
      });
      const arrow = node("span", "of-sort-arrow");
      arrow.setAttribute("aria-hidden", "true");
      sort.append(arrow);
      sortButtons.push({ key, heading, arrow });
      heading.append(sort);
      headings.append(heading);
    }
    head.append(headings);
    const body = node("tbody");
    table.append(cols, head, body);
    scroll.append(table);
    detailContent.append(tableActions, explain, node("p", "of-scroll-hint", "Прокрутите таблицу вправо."), scroll);
    details.append(node("summary", "", "Подробная таблица"), detailContent);
    details.addEventListener("toggle", render);
    overview.append(controls, custom, overviewPeriod, notice, note, summary, chart, emptyResult, details);

    const list = node("section", "of-drilldown");
    list.setAttribute("aria-label", "Список заказов");
    const listPeriod = node("p", "of-period-caption");
    const listNote = node("p", "of-note");
    const sourceSummary = node("dl", "of-summary");
    sourceSummary.setAttribute("aria-label", "Итоги источника");
    const listRows = node("ul", "of-order-list");
    const more = button("secondary of-more", "Показать ещё", () => {
      limit += PAGE_SIZE;
      render();
    });
    list.append(listPeriod, listNote, sourceSummary, listRows, more);
    panel.replaceChildren(overview, list);

    function setPeriod(value) {
      state.period = period.value = value;
      render();
    }
    function openGroup(group, trigger) {
      selected = group.key;
      selectedLabel = group.label;
      sourceTrigger = trigger;
      limit = PAGE_SIZE;
      render();
      onViewChange?.();
    }
    function showSources(report, rankBy, canPickLeader) {
      const { groups } = report;
      const sorted = model.sortGroups(groups, rankBy, "desc");
      const leaders = canPickLeader ? model.profitLeaders(report) : [];
      const leaderKeys = new Set(leaders.map(group => group.key));
      const leaderLabel = leaders.length > 1 ? "Делит первое место по прибыли" :
        groups.some(group => !model.isKnownSource(group) && group.profit > leaders[0]?.profit)
          ? "Лидер по прибыли среди известных" : "Больше всего прибыли";
      sourceList.replaceChildren(...sorted.map(group => {
        const item = node("li");
        const card = button("of-source-card", "", event => openGroup(group, event.currentTarget));
        card.dataset.source = group.key;
        const title = node("span", "of-source-head");
        const chevron = node("span", "of-source-chevron", "›");
        chevron.setAttribute("aria-hidden", "true");
        title.append(node("strong", "", group.label),
          node("span", "of-source-count", orderCount(group.count) + " · " + numberFor.percent(group.percent)), chevron);
        card.append(title);
        if (leaderKeys.has(group.key)) card.append(node("span", "of-source-leader", leaderLabel));
        const measure = node("span", "of-source-measure");
        measure.setAttribute("aria-hidden", "true");
        const bar = node("span", "of-source-bar");
        bar.style.width = group.percent + "%";
        measure.append(bar);
        const finances = node("span", "of-source-finances");
        for (const [label, value] of [["Оплаты", group.revenue], ["Прибыль", group.profit]]) {
          const metric = node("span", "of-source-value");
          metric.append(node("small", "", label), amountNode("strong", value));
          finances.append(metric);
        }
        card.append(measure, finances);
        item.append(card);
        return item;
      }));
    }
    function groupRow(group, total = false) {
      const row = node("tr", total ? "of-total" : "of-source");
      if (!total) row.dataset.source = group.key;
      const heading = node("th");
      heading.scope = "row";
      if (total) heading.textContent = "Итого";
      else {
        const trigger = button("of-source-button", group.label, event => openGroup(group, event.currentTarget));
        trigger.dataset.source = group.key;
        heading.append(trigger);
      }
      row.append(heading);
      for (const [key] of columns.slice(1)) {
        const text = group[key] == null ? "—" : (numberFor[key] || amount)(group[key]);
        row.append(node("td", group[key] < 0 ? "of-amount-negative" : "", text));
      }
      return row;
    }
    function showTable(report) {
      for (const { key, heading, arrow } of sortButtons) {
        if (key === state.sort) {
          heading.setAttribute("aria-sort", state.direction === "asc" ? "ascending" : "descending");
          arrow.textContent = state.direction === "asc" ? "↑" : "↓";
        } else {
          heading.removeAttribute("aria-sort");
          arrow.textContent = "↕";
        }
      }
      const groups = model.sortGroups(report.groups, state.sort, state.direction);
      body.replaceChildren(groupRow(report.totals, true), ...groups.map(group => groupRow(group)));
    }
    function showOrders(group) {
      const rows = group?.rows ?? empty;
      sourceSummary.hidden = !rows.length;
      if (rows.length) fillSummary(sourceSummary, group);
      listNote.textContent = !rows.length ? "За выбранный период заказов нет." : incompleteNote(group.unverified);
      listNote.hidden = !listNote.textContent;
      listRows.replaceChildren(...rows.slice(0, limit).map(order => {
        const item = node("li");
        const primary = order.name || order.referenceCode || "Заказ";
        const id = String(order.id);
        const action = onOpenOrder ? button("of-order", "", () => onOpenOrder(order.id, () => {
          const target = Array.from(listRows.querySelectorAll("button[data-order-id]"))
            .find(row => row.dataset.orderId === id);
          (target || document.getElementById("rdScreenBack"))?.focus();
        })) : node("div", "of-order");
        action.dataset.orderId = id;
        const description = node("span", "of-order-description");
        const reference = order.referenceCode || (order.orderNumber ? "№" + order.orderNumber : "");
        const refund = order.reportRefundedAmount;
        description.append(node("strong", "", primary),
          node("small", "", [reference, orderDay(order), refund ? "" : order.status].filter(Boolean).join(" · ")));
        const payment = node("span", "of-order-payment");
        const caption = refund ? "Возврат" : order.reportPaymentUnverified ? "Оплата на сверке" :
          order.reportReceived > 0 ? "Оплачено" : "Не оплачено";
        payment.append(node("small", "", caption));
        if (refund || order.reportReceived > 0) payment.append(amountNode("strong", refund || order.reportReceived));
        action.append(description, payment);
        item.append(action);
        return item;
      }));
      more.hidden = rows.length <= limit;
    }
    function incompleteNote(value) {
      return value ? "Показаны подтверждённые суммы. На сверке — " + orderCount(value) + "." : "";
    }
    function readReport(today) {
      const orders = getOrders(), payroll = getPayroll?.(), masterId = getRaulMasterId?.();
      const operations = getOperations?.() ?? empty;
      const dependencies = [orders, payroll, masterId, operations, today, state.field, state.period, state.from, state.to];
      if (cached && dependencies.every((value, index) => value === cached.dependencies[index])) return cached.report;
      const report = model.build(orders, {
        field: state.field, period: state.period, from: state.from, to: state.to,
        basis: "closed", today, payroll, masterId, operations, sourceLabel
      });
      cached = { report, dependencies };
      return report;
    }
    function render() {
      if (panel.hidden) return;
      overview.hidden = selected !== null;
      list.hidden = !overview.hidden;
      const noticeParent = overview.hidden ? list : overview;
      if (notice.parentElement !== noticeParent) {
        noticeParent.insertBefore(notice, overview.hidden ? listNote : note);
      }
      custom.hidden = state.period !== "custom";
      const finance = getFinanceStatus?.();
      const unavailable = finance ? !(finance.ready ?? !(finance.loading || finance.error)) : false;
      const stale = Boolean(finance?.stale || finance?.refreshError);
      const dateError = custom.hidden ? "" : !state.from || !state.to ? "Выберите обе даты."
        : state.from > state.to ? "Дата начала должна быть раньше даты окончания или совпадать с ней." : "";
      const financeMessage = finance?.error ? "Не удалось загрузить отчёт. " + finance.error :
        unavailable ? "Загружаем отчёт…" : stale ? "Показаны последние загруженные суммы." : "";
      const statusText = dateError || financeMessage;
      if (message.textContent !== statusText) message.textContent = statusText;
      message.setAttribute("role", finance?.error || finance?.refreshError ? "alert" : "status");
      notice.hidden = !statusText;
      retry.hidden = Boolean(dateError) || !(finance?.error || stale);
      const ready = !dateError && !unavailable;
      download.disabled = !ready || stale || Boolean(finance?.error);
      const today = model.moscowDay(new Date());
      const caption = dateError ? "" : periodLabel(state, today);
      for (const element of [overviewPeriod, listPeriod]) {
        if (element.textContent !== caption) element.textContent = caption;
        element.hidden = !caption;
      }
      if (!ready) {
        note.hidden = summary.hidden = chart.hidden = details.hidden = emptyResult.hidden = true;
        if (selected !== null) {
          listRows.replaceChildren();
          sourceSummary.hidden = listNote.hidden = more.hidden = true;
          ordersRendered = null;
        }
        return;
      }
      const report = readReport(today);
      if (selected !== null) {
        const group = report.groups.find(item => item.key === selected);
        if (ordersRendered?.report !== report || ordersRendered.source !== selected || ordersRendered.limit !== limit) {
          showOrders(group);
          ordersRendered = { report, source: selected, limit };
        }
        return;
      }

      note.textContent = incompleteNote(report.totals.unverified);
      note.hidden = !note.textContent;
      summary.hidden = chart.hidden = report.groups.length === 0;
      emptyResult.hidden = report.groups.length !== 0;
      showAll.hidden = state.period === "all";
      details.hidden = false;
      if (overviewRendered?.report !== report) fillSummary(summary, report.totals);
      const canPickLeader = !stale && !finance?.error;
      if (overviewRendered?.report !== report || overviewRendered.rank !== state.rank ||
          overviewRendered.canPickLeader !== canPickLeader) showSources(report, state.rank, canPickLeader);
      overviewRendered = { report, rank: state.rank, canPickLeader };
      if (details.open && (tableRendered?.report !== report ||
          tableRendered.sort !== state.sort || tableRendered.direction !== state.direction)) {
        showTable(report);
        tableRendered = { report, sort: state.sort, direction: state.direction };
      }
    }
    function open() {
      if (!panel.hidden) return;
      panel.hidden = false;
      render();
      onViewChange?.();
    }
    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      selected = null;
      selectedLabel = "";
      sourceTrigger = null;
      onViewChange?.();
    }
    function back() {
      if (selected === null) return close();
      const key = selected;
      const returnList = sourceTrigger?.closest("table") ? body : sourceList;
      selected = null;
      selectedLabel = "";
      render();
      onViewChange?.();
      const target = sourceTrigger?.isConnected ? sourceTrigger :
        Array.from(returnList.querySelectorAll("button[data-source]")).find(element => element.dataset.source === key);
      (target || period).focus();
      sourceTrigger = null;
    }
    function reset() {
      close();
      cached = overviewRendered = tableRendered = ordersRendered = null;
      Object.assign(state, initial);
      if (grouping) grouping.value = initial.field;
      period.value = initial.period;
      rank.value = initial.rank;
      details.open = false;
      for (const input of customInputs) input.value = "";
      for (const element of [summary, sourceSummary, sourceList, body, listRows, note, listNote, message])
        element.replaceChildren();
    }
    return {
      open, close, back, render, reset,
      isOpen: () => !panel.hidden, isDrilldown: () => selected !== null, title: () => selectedLabel || TITLE
    };
  }

  root.__rdCreateOrderFieldReport = mount;
})(window);
