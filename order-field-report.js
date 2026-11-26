/* CRM «Работа»: сгруппированный отчёт владельца на подтверждённом финансовом снимке. */
"use strict";
(function (root) {
  const model = root.__rdOrderFieldReportModel;
  if (!model) return;

  const columns = model.COLUMNS;
  const chartColors = ["#4656f5", "#008076", "#8b55cf", "#ac5e14", "#007aaf", "#be4875"];
  const money = new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2
  });
  const count = new Intl.NumberFormat("ru-RU");
  const percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 2 });
  const dates = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const PAGE_SIZE = 50;
  const TITLE = "Заказы по полю";
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
  function showDate(day) {
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.split("-").reverse().join(".") : "";
  }
  function orderDay(order) {
    const completed = order.completedAt && new Date(order.completedAt);
    return showDate(completed && Number.isFinite(completed.valueOf()) ? dates.format(completed) : order.date);
  }

  function mount(panel, {
    getOrders, getRaulMasterId, getFinanceStatus, getPayroll, getOperations,
    sourceLabel = value => root.__rdClientWhatsApp?.sourceLabel?.(value), onRetry, onViewChange, onOpenOrder
  }) {
    panel.hidden = true;
    panel.classList.add("of-report");
    const initial = { field: "", period: "month", from: "", to: "", sort: "count", direction: "desc" };
    const state = { ...initial };
    const empty = [];
    let selected = null, limit = PAGE_SIZE, cached = null, displayed = null;
    let selectedLabel = "";
    const controls = node("div", "of-controls");
    const grouping = selector([["", "Выберите поле"], ...model.FIELDS], "Поле отчёта", "", value => {
      state.field = value;
      render();
    });
    const period = selector(model.PERIODS, "Период отчёта", state.period, value => {
      state.period = value;
      render();
    });
    const periodControl = field("Период", period);
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
    const download = button("of-export", "CSV ↓", () => {
      render();
      if (download.disabled || !cached) return;
      const report = cached.report;
      const csv = model.csvFor(report, model.sortGroups(report.groups, state.sort, state.direction));
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = node("a");
      link.href = url;
      link.download = "rabota-orders-by-field-" + dates.format(new Date()) + ".csv";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    download.setAttribute("aria-label", "Скачать CSV");
    controls.append(field("Поле", grouping), periodControl, download);

    const overview = node("section", "of-overview");
    const notice = node("div", "of-notice");
    const message = node("p");
    const retry = button("secondary of-retry", "Повторить", () => {
      if (onRetry) void onRetry();
      else void root.__rdMoneyUi?.refreshFinance?.();
    });
    notice.append(message, retry);
    const note = node("p", "of-note");
    const chart = node("figure", "of-chart");
    chart.setAttribute("aria-label", "Распределение заказов по источникам");

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
      const sort = button("of-sort", caption, () => {
        state.direction = state.sort === key
          ? (state.direction === "asc" ? "desc" : "asc")
          : (key === "label" ? "asc" : "desc");
        state.sort = key;
        render();
      });
      const arrow = node("span", "of-sort-arrow", "↕");
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
    const emptyResult = node("p", "of-empty", "За выбранный период заказов нет.");
    overview.append(controls, custom, notice, note, chart, scroll, emptyResult);

    const list = node("section", "of-drilldown");
    list.setAttribute("aria-label", "Список заказов");
    const listNotice = node("p", "of-note");
    const listRows = node("ul", "of-order-list");
    const more = button("secondary of-more", "Показать ещё", () => {
      limit += PAGE_SIZE;
      render();
    });
    list.append(listNotice, listRows, more);
    panel.replaceChildren(overview, list);

    function openGroup(group) {
      selected = group.key;
      selectedLabel = group.label;
      limit = PAGE_SIZE;
      onViewChange?.();
      render();
    }
    function showChart(groups) {
      const bar = node("div", "of-chart-bar");
      bar.setAttribute("aria-hidden", "true");
      const legend = node("ul", "of-chart-legend");
      groups.forEach((group, index) => {
        const color = chartColors[index % chartColors.length];
        const segment = node("span");
        segment.style.flexGrow = group.count;
        segment.style.backgroundColor = color;
        bar.append(segment);
        const marker = node("span", "of-chart-marker");
        marker.setAttribute("aria-hidden", "true");
        marker.style.backgroundColor = color;
        const entry = node("li");
        entry.append(marker, node("span", "of-chart-label", group.label),
          node("span", "of-chart-count", count.format(group.count) + " · " + numberFor.percent(group.percent)));
        legend.append(entry);
      });
      chart.replaceChildren(bar, legend);
    }
    function groupRow(group, total = false) {
      const row = node("tr", total ? "of-total" : "of-source");
      if (!total) row.dataset.source = group.key;
      const heading = node("th");
      heading.scope = "row";
      if (total) heading.textContent = "Итого";
      else heading.append(button("of-source-button", group.label, () => openGroup(group)));
      row.append(heading);
      for (const [key] of columns.slice(1)) {
        const text = group[key] == null ? "—" : (numberFor[key] || amount)(group[key]);
        row.append(node("td", "", text));
      }
      return row;
    }
    function showTable(report, groups) {
      for (const { key, heading, arrow } of sortButtons) {
        if (key === state.sort) {
          heading.setAttribute("aria-sort", state.direction === "asc" ? "ascending" : "descending");
          arrow.textContent = state.direction === "asc" ? "↑" : "↓";
        } else {
          heading.removeAttribute("aria-sort");
          arrow.textContent = "↕";
        }
      }
      body.replaceChildren(groupRow(report.totals, true), ...groups.map(group => groupRow(group)));
    }
    function showOrders(group) {
      const rows = group?.rows ?? empty;
      listNotice.textContent = rows.length ? "Заказов — " + count.format(rows.length) : "За выбранный период заказов нет.";
      listRows.replaceChildren();
      for (const order of rows.slice(0, limit)) {
        const item = node("li");
        const primary = order.name || order.referenceCode || "Заказ";
        const action = onOpenOrder ? button("of-order", "", () => onOpenOrder(order.id)) : node("div", "of-order");
        const description = node("span", "of-order-description");
        const reference = order.referenceCode || (order.orderNumber ? "№" + order.orderNumber : "");
        description.append(node("strong", "", primary),
          node("small", "", [reference, orderDay(order), order.status].filter(Boolean).join(" · ")));
        action.append(description, node("span", "of-order-amount",
          amount(order.reportPaymentUnverified ? null : order.reportReceived)));
        item.append(action);
        listRows.append(item);
      }
      more.hidden = rows.length <= limit;
    }
    function readReport() {
      const orders = getOrders(), payroll = getPayroll?.(), masterId = getRaulMasterId?.();
      const operations = getOperations?.() ?? empty;
      const today = dates.format(new Date());
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
        noticeParent.insertBefore(notice, overview.hidden ? listNotice : note);
      }
      const hasField = Boolean(state.field);
      periodControl.hidden = download.hidden = !hasField;
      custom.hidden = !hasField || state.period !== "custom";
      const finance = getFinanceStatus?.();
      const unavailable = finance ? !(finance.ready ?? !(finance.loading || finance.error)) : false;
      const stale = Boolean(finance?.stale || finance?.refreshError);
      const dateError = custom.hidden ? "" : !state.from || !state.to ? "Укажите начало и конец периода."
        : state.from > state.to ? "Проверьте порядок дат начала и окончания." : "";
      const financeMessage = finance?.error ? "Не удалось загрузить расчёты. " + finance.error :
        unavailable ? "Загружаем данные отчёта…" :
        stale ? "Показаны последние доступные данные. Перед выгрузкой обновите отчёт." : "";
      const statusText = hasField ? dateError || financeMessage : "";
      if (message.textContent !== statusText) message.textContent = statusText;
      message.setAttribute("role", finance?.error || finance?.refreshError ? "alert" : "status");
      notice.hidden = !statusText;
      retry.hidden = Boolean(dateError) || !(finance?.error || stale);
      const ready = hasField && !dateError && !unavailable;
      download.disabled = !ready || stale;
      note.hidden = chart.hidden = scroll.hidden = emptyResult.hidden = true;
      if (!ready) {
        displayed = null;
        if (selected !== null) {
          listRows.replaceChildren();
          listNotice.textContent = "";
          more.hidden = true;
        }
        return;
      }
      const report = readReport();
      if (selected !== null) {
        const group = report.groups.find(item => item.key === selected);
        if (displayed?.report === report && displayed.source === selected && displayed.limit === limit) return;
        showOrders(group);
        displayed = { report, source: selected, limit };
        return;
      }
      note.hidden = scroll.hidden = false;
      chart.hidden = report.groups.length === 0;
      emptyResult.hidden = report.groups.length !== 0;
      note.textContent = "По дате закрытия." + (report.totals.unverified > 0
        ? " Показаны подтверждённые суммы. Заказов с неполным расчётом — " +
          count.format(report.totals.unverified) + "." : "");
      if (displayed?.report === report && displayed.sort === state.sort && displayed.direction === state.direction) return;
      const groups = model.sortGroups(report.groups, state.sort, state.direction);
      if (displayed?.report !== report || displayed.source !== undefined) showChart(model.sortGroups(report.groups, "count", "desc"));
      showTable(report, groups);
      displayed = { report, sort: state.sort, direction: state.direction };
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
      onViewChange?.();
    }
    function back() {
      if (selected === null) return close();
      selected = null;
      selectedLabel = "";
      render();
      onViewChange?.();
    }
    function reset() {
      close();
      cached = displayed = null;
      Object.assign(state, initial);
      grouping.value = initial.field;
      period.value = initial.period;
      for (const input of customInputs) input.value = "";
      for (const element of [chart, body, listRows, note, listNotice, message]) element.replaceChildren();
    }
    return {
      open, close, back, render, reset,
      isOpen: () => !panel.hidden, isDrilldown: () => selected !== null, title: () => selectedLabel || TITLE
    };
  }

  root.__rdCreateOrderFieldReport = mount;
})(window);
