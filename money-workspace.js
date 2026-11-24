/* Работа — мобильные отчёты мастера и кассовые движения владельца.
 * UI reads through __rdMoneyUi; all writes are validated in Supabase RPC. */
"use strict";
(()=>{
  const $=id=>document.getElementById(id);
  const el=(tag,cls="",value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
  const append=(parent,...children)=>{parent.append(...children);return parent};
  const box=(cls,...items)=>append(el("div",cls),...items);
  const btn=(label,cls,fn)=>{const n=el("button",cls,label);n.type="button";if(fn)n.addEventListener("click",fn);return n};
  const rub=n=>new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0)+" ₽";
  const date=s=>{const d=new Date(s||0);return Number.isFinite(+d)?d.toLocaleString("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"short",year:"numeric",hour:s?.includes("T")?"2-digit":undefined,minute:s?.includes("T")?"2-digit":undefined}):String(s||"—")};
  const parseSum=s=>{const v=String(s||"").trim().replace(/[\s\u00a0\u202f]/g,"").replace(",",".");if(!/^\d+(?:\.\d{1,2})?$/.test(v))return null;const c=Math.round(Number(v)*100);return Number.isSafeInteger(c)&&c>0?c/100:null};
  // Booking dates are local YYYY-MM-DD; payroll operation timestamps are grouped in Moscow time.
  const monthOf=(value,booking=false)=>{
    const text=String(value||"");
    if(booking && /^\d{4}-\d{2}-\d{2}$/.test(text))return text.slice(0,7);
    const d=new Date(text);
    if(!Number.isFinite(d.getTime()))return "unknown";
    const parts=new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit"}).formatToParts(d);
    const year=parts.find(part=>part.type==="year")?.value;
    const month=parts.find(part=>part.type==="month")?.value;
    return year&&month?year+"-"+month:"unknown";
  };
  const monthTitle=key=>{
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))return "Без даты";
    const label=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",month:"long",year:"numeric"})
      .format(new Date(key+"-01T12:00:00Z")).replace(/\s*г\.?$/i,"").trim();
    return label.charAt(0).toLocaleUpperCase("ru-RU")+label.slice(1)+" г.";
  };
  const accountName=m=>m==="cash"?"Наличные":m==="card"?"Карта":"Не указан";
  const validMethod=m=>m==="cash"||m==="card";
  const api=()=>window.__rdMoneyUi;
  const token=()=>{if(typeof window.crypto?.randomUUID!=="function")throw Error("Браузер не поддерживает безопасный идентификатор операции");return window.crypto.randomUUID()};
  const isPreview=()=>/^rabota-(?:git-[a-z0-9-]+-|[a-z0-9]{7,}-)sonkort19-6069s-projects\.vercel\.app$/i.test(String(window.location?.hostname||""));
  let page="day",step="menu",salaryTab="accruals",masterReady=false,masterProfitReport=null;
  let orderQuery="",orderStatus="all",paymentMethod="all",navigationUser=null;
  let paymentBreakdownOpen=false, handoffMessage="", handoffRefreshError="";
  let ownerView=null, masterPaymentSignature=null;
  const paymentCurrency=new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",
    minimumFractionDigits:2,maximumFractionDigits:2,trailingZeroDisplay:"stripIfInteger"});
  const paymentDay=new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",
    day:"numeric",month:"long",year:"numeric"});
  const paymentTime=new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const scrollPositions=new Map();
  const statusOptions=[["all","Все"],["Записан","Записаны"],
    ["В работе","В работе"],["Выполнен","Выполнены"],["Отменён","Отменены"]];
  function navIcon(name){
    const span=el("span","mw-icon");
    const shapes={
      day:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
      orders:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
      payments:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 15h3"/>',
      reports:'<path d="M4 20V11M10 20V4M16 20v-9M22 20V7M2 21h21"/>',
      settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
    };
    span.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+shapes[name]+'</svg>';
    return span;
  }
  function statusIcon(value){
    // Static SVG glyphs: status values and filter behavior remain unchanged.
    const shapes={
      all:'<path d="M4 7h16M4 12h16M4 17h16"/>',
      "Записан":'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15l2 2 4-4"/>',
      "В работе":'<path d="M14.7 6.3a6 6 0 0 0-8 8l-4 4a2 2 0 0 0 2.8 2.8l4-4a6 6 0 0 0 8-8l-3.2 3.2-3-3z"/>',
      "Выполнен":'<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>',
      "Отменён":'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>'
    };
    const icon=el("span","mw-filter-icon");
    icon.setAttribute("aria-hidden","true");
    icon.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+shapes[value]+'</svg>';
    return icon;
  }
  function setupMaster(){
    if(masterReady||api()?.snapshot()?.role!=="master")return;
    const app=$("appScreen"),orders=$("ordersArea"),finance=$("financePanel");
    if(!app||!orders||!finance)return;
    const reports=el("section","mw-master-reports");reports.id="mwMasterReports";reports.hidden=true;
    reports.setAttribute("aria-label","Отчёты мастера");
    const payments=el("section","mw-master-payments");payments.id="mwMasterPayments";payments.hidden=true;
    payments.setAttribute("aria-label","Платежи мастера");
    const settings=el("section","mw-master-settings");settings.id="mwMasterSettings";settings.hidden=true;
    settings.setAttribute("aria-label","Настройки мастера");
    settings.append(el("h2","mw-settings-title","Настройки"));
    window.__rdWhatsAppSettings?.mount(settings);
    const toolbar=el("section","mw-master-filterbar");toolbar.id="mwMasterFilterbar";
    toolbar.setAttribute("aria-label","Фильтры заказов");
    const search=el("input","mw-filter-search");search.type="search";
    search.placeholder="Поиск по заказам";search.autocomplete="off";
    search.setAttribute("aria-label","Поиск по имени, адресу, телефону, дате");
    search.addEventListener("input",()=>{orderQuery=window.__rdOrderReference.normalize(search.value);filterRows()});
    const filters=el("div","mw-status-filters");
    for(const [value,label] of statusOptions){
      const chip=btn("","mw-filter-chip",()=>{
        orderStatus=value;syncFilterChips(filters);filterRows();
      });
      chip.setAttribute("aria-label","Фильтр: "+label);
      chip.append(statusIcon(value));
      chip.dataset.status=value;filters.append(chip);
    }
    toolbar.append(search,filters);
    orders.insertBefore(toolbar,orders.querySelector(".tabs"));
    app.insertBefore(reports,finance);app.insertBefore(payments,finance);app.insertBefore(settings,finance);
    const nav=el("nav","mw-bottom-nav");nav.id="mwMasterNav";
    nav.setAttribute("aria-label","Разделы мастера");
    for(const [key,label,icon] of [["orders","Заказы","orders"],
      ["payments","Платежи","payments"],["reports","Отчёты","reports"],
      ["settings","Настройки","settings"]]){
      const item=btn("","mw-nav-btn",()=>switchPage(key==="orders"&&
        window.__rdOrdersWorkspace?.currentMode?.()==="calendar"?"day":key));
      item.dataset.mwPage=key;
      item.append(navIcon(icon),el("span","",label));nav.append(item);
    }
    app.append(nav);masterReady=true;
    syncFilterChips(filters);updateNav();
  }
  function syncFilterChips(filters){
    for(const chip of filters.querySelectorAll("[data-status]")){
      const active=chip.dataset.status===orderStatus;
      chip.classList.toggle("active",active);chip.setAttribute("aria-pressed",String(active));
    }
  }
  function filterRows(){
    if(window.__rdOrdersWorkspace?.isActive?.())return;
    if(page!=="orders"||api()?.snapshot()?.role!=="master")return;
    const root=$("orders");if(!root)return;
    let heading=null,shown=0,visibleInGroup=0;
    const finishGroup=()=>{
      if(!heading)return;
      heading.hidden=visibleInGroup===0;
      const count=heading.querySelector(".muted");
      if(count)count.textContent=visibleInGroup+" "+(
        visibleInGroup%100>=11&&visibleInGroup%100<=14?"заказов":
        visibleInGroup%10===1?"заказ":
        visibleInGroup%10>=2&&visibleInGroup%10<=4?"заказа":"заказов");
    };
    for(const element of root.children){
      if(element.classList.contains("master-day-heading")){
        finishGroup();heading=element;visibleInGroup=0;
      }else if(element.classList.contains("master-schedule-card")){
        const statusMatch=orderStatus==="all"||element.dataset.status===orderStatus;
        const match=statusMatch&&(!orderQuery||String(element.dataset.search||"").includes(orderQuery));
        element.hidden=!match;
        if(match){shown++;visibleInGroup++;}
      }
    }
    finishGroup();
    const count=$("orderCount");if(count)count.textContent=shown+" шт.";
    let empty=root.querySelector(".mw-filter-empty");
    if(shown===0&&!root.querySelector(".empty")){
      if(!empty){
        empty=el("div","mw-filter-empty","По выбранным фильтрам заказов нет.");
        root.append(empty);
      }
    }else empty?.remove();
  }
  function updateNav(){
    // Only Raul's order list uses the simplified header. Restore headings on other pages.
    $("appScreen")?.classList.toggle("mw-orders-minimal-header",
      page==="orders"&&api()?.snapshot()?.role==="master");
    $("appScreen")?.classList.toggle("mw-payments-header",page==="payments"&&api()?.snapshot()?.role==="master");
    const nav=$("mwMasterNav");if(!nav)return;
    for(const b of nav.querySelectorAll("button")){
      const active=b.dataset.mwPage===(page==="day"||page==="orders"?"orders":page);
      b.classList.toggle("is-active",active);
      b.setAttribute("aria-current",active?"page":"false");
    }
  }
  function switchPage(which,restore=true){
    if(api()?.snapshot()?.role!=="master")return;
    const reports=$("mwMasterReports"),payments=$("mwMasterPayments"),
      settings=$("mwMasterSettings"),orders=$("ordersArea"),finance=$("financePanel");
    if(!reports||!payments||!orders||!finance)return;
    if(restore&&which!==page){
      scrollPositions.set(page,window.__rdMasterViewportScroll?.position?.()??window.scrollY??0);
    }
    page=which;
    window.__rdMasterCurrentPage=page;
    window.__rdCurrentPage=which==="day"||which==="orders"?"orders":which;
    reports.hidden=which!=="reports";payments.hidden=which!=="payments";
    if(settings)settings.hidden=which!=="settings";
    const filters=$("mwMasterFilterbar");
    if(filters)filters.hidden=which!=="orders"||Boolean(window.__rdOrdersWorkspace?.isActive?.());
    const title=$("appTitle");
    if(which==="reports"||which==="payments"||which==="settings"){
      orders.hidden=true;finance.hidden=true;
      if(title)title.textContent=which==="reports"?"Отчёты":which==="payments"?"Платежи":"Настройки";
      if(which==="reports")renderMaster();
      else if(which==="payments")renderMasterPayments();
      else window.__rdWhatsAppSettings?.refresh();
    }else{
      if(title)title.textContent="Заказы";
      // Legacy tab handlers remain for calendar calculations, but tabs are not visible to master.
      if(!finance.hidden)$("masterFinanceBack")?.click();
      orders.hidden=false;finance.hidden=true;
      if(which==="day")window.__rdSyncMasterToday?.();
      const tab=orders.querySelector('.tab[data-tab="'+(which==="day"?"calendar":"all")+'"]');
      const sameTab=tab?.dataset.tab===currentTab;
      tab?.click();
      if(sameTab&&window.__rdOrdersWorkspace?.isActive?.())render();
      if(which==="orders")filterRows();
    }
    updateNav();
    window.__rdOrdersWorkspace?.refresh?.();
    if(restore){
      const y=scrollPositions.get(which)||0;
      if(window.__rdMasterViewportScroll?.restore)window.__rdMasterViewportScroll.restore(y);
      else window.scrollTo({top:y,behavior:"instant"});
    }
  }
  window.__rdMasterNavigate=(which,restore=false)=>switchPage(which,restore);
  function settlementTotals(collections){
    const sums={waiting:0,pending:0,confirmed:0};
    for(const c of collections){
      // Before partial handoffs, one status covered the whole collection.
      const legacy=c.confirmedAt?"confirmed":c.submittedAt?"pending":"waiting";
      for(const key of Object.keys(sums)){
        const value=c[key+"Amount"]??(key===legacy?c.companyAmount:0);
        sums[key]+=Math.round(Number(value)*100);
      }
    }
    return {waiting:sums.waiting/100,pending:sums.pending/100,confirmed:sums.confirmed/100};
  }

  function openMasterHandoff(available,preview){
    const {sheet,close,header}=modalBase(preview?"Проверить сумму":"Отметить передачу",()=>{
      $("mwMasterPayments")?.querySelector(".mw-handoff-action:not(:disabled), summary")?.focus({preventScroll:true});
    });
    header.querySelector("button").setAttribute("aria-label","Закрыть");
    const form=el("form","mw-handoff-form");
    const amount=el("input","mw-input");
    amount.type="text";amount.inputMode="decimal";amount.autocomplete="off";
    amount.value=Number.isInteger(available)?String(available):available.toFixed(2).replace(".",",");
    const error=el("p","mw-error");error.id="mwHandoffError";error.setAttribute("role","alert");
    const save=el("button","mw-main-button",preview?"Проверить сумму":"Подтвердить передачу");save.type="submit";
    const cancel=btn("Отмена","mw-minor",close);
    form.append(field("Переданная сумма, ₽",amount),
      el("p","mw-handoff-limit","Доступно к передаче "+paymentCurrency.format(available)),
      error,box("mw-modal-actions",cancel,save));
    if(preview)form.insertBefore(el("p","mw-handoff-limit","Предпросмотр · проверка суммы без записи."),error);
    sheet.append(form);
    let requestId=null,requestAmount=null;
    sheet.addEventListener("keydown",event=>{
      if(event.key==="Escape"){event.preventDefault();close();return;}
      if(event.key!=="Tab")return;
      const controls=[...sheet.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
      const first=controls[0],last=controls.at(-1);
      if(!first||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){
        event.preventDefault();(event.shiftKey?last:first)?.focus();
      }
    });
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(sheet.dataset.busy==="1")return;
      const value=parseSum(amount.value);
      if(!value||value>available){
        error.textContent=value?"Сумма больше доступного остатка.":"Укажите положительную сумму с точностью до копеек.";
        amount.setAttribute("aria-invalid","true");amount.setAttribute("aria-describedby",error.id);amount.focus();return;
      }
      amount.removeAttribute("aria-invalid");amount.removeAttribute("aria-describedby");
      error.textContent="";
      if(preview){
        handoffMessage="Сумма проверена. В предпросмотре передача не записывается.";
        renderMasterPayments();close();return;
      }
      sheet.dataset.busy="1";sheet.setAttribute("aria-busy","true");
      for(const control of [amount,save,cancel,header.querySelector("button")])control.disabled=true;
      save.textContent="Сохраняем…";
      try{
        if(!requestId||requestAmount!==value){requestId=token();requestAmount=value;}
        const result=await api().submitMasterHandoff(value,requestId);
        handoffRefreshError=result?.refreshError||"";
        handoffMessage="Передача "+paymentCurrency.format(value)+" отмечена.";
        sheet.dataset.busy="0";renderMasterPayments();close();
      }catch(e){
        sheet.dataset.busy="0";sheet.removeAttribute("aria-busy");
        for(const control of [amount,save,cancel,header.querySelector("button")])control.disabled=false;
        save.textContent="Подтвердить передачу";
        error.textContent=e?.message||"Не удалось подтвердить передачу. Проверьте соединение и повторите.";
        save.focus();
      }
    });
    amount.focus({preventScroll:true});amount.select();
  }

  function renderPaymentHistory(list,orders){
    list.replaceChildren();
    const filtered=orders.filter(o=>paymentMethod==="all"||(paymentMethod==="unknown"?
      !validMethod(o.method):o.method===paymentMethod));
    if(!filtered.length){
      list.append(el("p","mw-notice",orders.length?"Оплат с таким способом нет.":"Оплат по заказам пока нет."));
      return;
    }
    const payments=filtered.map(order=>{
      const timestamp=Date.parse(order.paidAt||"");
      return {order,timestamp:Number.isFinite(timestamp)?timestamp:null};
    });
    payments.sort((a,b)=>(b.timestamp??-Infinity)-(a.timestamp??-Infinity));
    let currentDay="",rows;
    for(const {order,timestamp} of payments){
      const day=timestamp===null?"Дата оплаты не указана":paymentDay.format(timestamp);
      if(day!==currentDay){
        currentDay=day;
        const group=el("section","mw-payment-day");
        rows=el("div","mw-payment-day-rows");
        group.append(el("h3","mw-payment-date",day),rows);list.append(group);
      }
      const name=box("mw-payment-name",el("strong","",order.name||"Клиент"));
      if(order.reference)name.append(el("span","mw-payment-reference",order.reference));
      const method=validMethod(order.method)?accountName(order.method):"Способ не указан";
      const recipient=order.receivedBy==="master"?"Принял мастер":
        order.receivedBy==="company"?"Получено компанией":"Получатель не указан";
      const item=btn("","mw-payment-row",()=>window.__rdOpenMasterOrder?.(order.id));
      item.dataset.orderId=order.id;
      const chevron=el("span","mw-payment-chevron","›");chevron.setAttribute("aria-hidden","true");
      item.append(name,el("strong","mw-payment-amount","+"+paymentCurrency.format(order.amount)),chevron,
        el("small","mw-payment-meta",timestamp===null?method:paymentTime.format(timestamp)+" · "+method),
        el("small","mw-payment-recipient",recipient));
      rows.append(item);
    }
  }

  const hasSnapshot=state=>Boolean(state && (state.ready ?? !(state.loading||state.error)));
  const financeRetry=()=>api()?.refreshFinance?.();
  function retryRead(read){
    // Reads publish their error through the snapshot. A retry must not create a
    // second notification or become an unhandled rejection.
    void Promise.resolve().then(()=>read?.()).catch(()=>{});
  }
  function updateReadStatus(root,message,retry=null){
    const copy=root.firstElementChild,button=copy.nextElementSibling;
    root.hidden=!message;
    if(copy.textContent!==message)copy.textContent=message;
    copy.setAttribute("role",retry?"alert":"status");
    button.hidden=!retry;button.onclick=retry?()=>retryRead(retry):null;
  }
  function readStatus(){
    const message=el("span");message.setAttribute("role","status");
    return box("mw-finance-status",message,btn("Повторить","secondary mw-finance-retry"));
  }
  function financeStatusMessage(state){
    if(state.error)return "Не удалось загрузить финансовые данные. "+state.error;
    if(!hasSnapshot(state))return "Загружаем финансовые данные…";
    if(!state.stale&&!state.refreshError)return "";
    const time=state.updatedAt?" от "+date(new Date(state.updatedAt).toISOString()):"";
    return "Показаны данные"+time+". Обновите расчёты перед операцией."+
      (state.refreshError?" "+state.refreshError:"");
  }
  function renderMasterPayments(){
    const root=$("mwMasterPayments");if(!root||root.hidden)return;
    const cards=document.createDocumentFragment();
    let m;
    try{
      m=api()?.masterPayments?.();
      if(!m)throw Error("Данные платежей пока недоступны.");
    }catch(error){
      const message=el("p","mw-error",error.message||"Не удалось загрузить платежи.");
      message.setAttribute("role","alert");root.replaceChildren(message);return;
    }
    const ready=hasSnapshot(m),dataError=m.stale||m.refreshError||handoffRefreshError;
    const signature=JSON.stringify([
      m.revision,ready,m.error,m.stale,m.refreshError,!!m.canSubmit,handoffMessage,handoffRefreshError,
      m.revision==null?[m.orders,m.collections]:null
    ]);
    if(masterPaymentSignature===signature&&root.firstChild)return;
    masterPaymentSignature=signature;
    const status=readStatus();
    const message=financeStatusMessage(m)||(handoffRefreshError?
      "Показаны последние расчёты передачи. "+handoffRefreshError:"");
    if(message){
      updateReadStatus(status,message,(m.error||dataError)?financeRetry:null);
      cards.append(status);
    }
    if(!ready){root.replaceChildren(cards);return;}
    if(handoffMessage){
      const status=el("p","mw-handoff-status",handoffMessage);
      status.setAttribute("role","status");cards.append(status);
    }
    const totals=settlementTotals(m.collections);
    const balance=value=>paymentCurrency.format(value);
    const transfer=btn("Отметить передачу","mw-handoff-action",()=>openMasterHandoff(totals.waiting,m.preview));
    const writeUnavailable=m.canSubmit===false||typeof api()?.submitMasterHandoff!=="function";
    transfer.disabled=Boolean(dataError)||!(totals.waiting>0)||(!m.preview&&writeUnavailable);
    const hero=el("section","mw-handoff-card");hero.setAttribute("aria-label","Расчёты с компанией");
    hero.append(el("h2","mw-handoff-label","Осталось передать компании"),
      el("strong","mw-handoff-amount",balance(totals.waiting)),transfer);
    if(!dataError&&totals.waiting>0&&transfer.disabled)
      hero.append(el("p","mw-handoff-limit","Отметить передачу сейчас недоступно."));
    hero.append(box("mw-handoff-lines",
      box("",el("span","","Ждёт подтверждения"),el("strong","",balance(totals.pending))),
      box("",el("span","","Компания подтвердила"),el("strong","",balance(totals.confirmed)))));
    cards.append(hero);

    const paid=m.orders.filter(o=>o.paid&&o.status!=="Отменён"&&o.amount!=null&&
      Number.isFinite(Number(o.amount))&&Number(o.amount)>=0);
    const amounts={cash:0,card:0,unknown:0};
    for(const o of paid)amounts[validMethod(o.method)?o.method:"unknown"]+=Math.round(Number(o.amount)*100);
    const total=(amounts.cash+amounts.card+amounts.unknown)/100;
    const breakdown=el("details","mw-payment-breakdown");
    breakdown.open=paymentBreakdownOpen;
    const summary=el("summary");
    summary.append(el("span","","Оплачено клиентами"),el("strong","",paymentCurrency.format(total)));
    const methodRows=el("div","mw-breakdown-lines");
    for(const [method,label] of [["cash","Наличные"],["card","Карта"],["unknown","Способ не указан"]]){
      methodRows.append(box("",el("span","",label),el("strong","",paymentCurrency.format(amounts[method]/100))));
    }
    breakdown.append(summary,methodRows);
    breakdown.addEventListener("toggle",()=>{if(breakdown.isConnected)paymentBreakdownOpen=breakdown.open;});
    cards.append(breakdown);
    // Keep the filter mounted while its native iOS picker is open.
    let heading=root.querySelector(".mw-payments-list-head");
    let list,select;
    if(heading){
      list=heading.nextElementSibling;select=heading.querySelector("select");
      while(root.firstChild!==heading)root.firstChild.remove();
      root.insertBefore(cards,heading);
    }else{
      list=el("div","mw-payments-history");
      select=el("select","mw-method-select");select.setAttribute("aria-label","Способ оплаты заказов");
      for(const [key,label] of [["all","Все способы"],["cash","Наличные"],["card","Карта"],["unknown","Без способа"]]){
        const option=el("option","",label);option.value=key;select.append(option);
      }
      heading=box("mw-payments-list-head",el("h2","mw-payments-heading","Оплаты заказов"),
        box("mw-method-control",select));
      root.replaceChildren(cards,heading,list);
    }
    select.value=paymentMethod;
    select.onchange=()=>{paymentMethod=select.value;renderPaymentHistory(list,paid);};
    renderPaymentHistory(list,paid);
  }
  function renderMaster(){
    const root=$("mwMasterReports");if(!root||root.hidden)return;
    const m=api()?.snapshot();
    if(!m||m.role!=="master")return;
    if(step==="orderProfit"&&masterProfitReport?.container?.isConnected){
      masterProfitReport.api.render();return;
    }
    masterProfitReport=null;
    root.replaceChildren();
    const back=(label,fn)=>btn("‹ "+label,"mw-back",fn);
    const isRaul=String(m.masterName||"").trim().toLocaleLowerCase("ru")==="рауль";
    if(step==="menu"){
      // The authenticated master only has one report: no extra staff directory.
      const entry=btn("","mw-entry",()=>{step="detail";salaryTab="accruals";renderMaster()});
      entry.append(el("span","mw-entry-icon","▤"),box("mw-entry-copy",
        el("strong","","Зарплата"),el("small","","Баланс, начисления и выплаты")),el("span","mw-chevron","›"));
      root.append(entry);
      if(isRaul){
        const orderProfit=btn("","mw-entry",()=>{step="orderProfit";renderMaster()});
        orderProfit.append(el("span","mw-entry-icon","▤"),box("mw-entry-copy",
          el("strong","","Прибыль по заказам"),
          el("small","","Мои заказы, оплаты и начисления")),el("span","mw-chevron","›"));
        root.append(orderProfit);
      }
      return;
    }
    if(step==="orderProfit"){
      if(!isRaul){step="menu";renderMaster();return;}
      const container=el("div","mw-profit-report");root.append(container);
      const maker=window.__rdCreateProfitReport;
      if(typeof maker!=="function"){
        root.append(back("Отчёты",()=>{step="menu";renderMaster()}),
          el("p","mw-error","Отчёт временно недоступен."));return;
      }
      const report=maker(container,{
        getOrders:()=>api()?.masterReportOrders?.()||[],
        getRaulMasterId:()=>api()?.snapshot()?.masterId||null,
        getFinanceStatus:()=>api()?.snapshot(),
        onRetry:financeRetry,
        startOpen:true,onBack:()=>{step="menu";masterProfitReport=null;renderMaster()}
      });
      masterProfitReport={container,api:report};
      return;
    }
    root.append(back("Отчёты",()=>{step="menu";renderMaster()}));
    root.append(el("h2","mw-heading","Моя зарплата"));
    const message=financeStatusMessage(m);
    if(message){
      const status=readStatus();
      updateReadStatus(status,message,(m.error||m.stale||m.refreshError)?financeRetry:null);
      root.append(status);
    }
    if(!hasSnapshot(m))return;
    if(!m.masterId){root.append(el("p","mw-notice","Данные зарплаты для этого мастера не подключены."));return;}
    const hero=box("mw-salary-hero",
      box("mw-salary-head",
        box("mw-salary-balance",
          el("span","mw-small","Баланс к выплате"),
          el("strong","mw-big",rub(m.due)))),
      box("mw-numbers",
        box("",el("small","","Начислено"),el("strong","",rub(m.accrued))),
        box("",el("small","","Выплачено"),el("strong","",rub(m.paid)))),
      el("p","mw-help","Выплату проводит владелец. Для получения денег обратитесь к нему.")
    );
    root.append(hero);
    if(m.due<=0)root.append(el("p","mw-help","Доступной суммы к выплате нет. Проверь начисления и уже проведённые выплаты."));
    const tabs=el("div","mw-tabs");
    for(const [key,label] of [["accruals","Начисления"],["payments","Выплаты"]]){
      const b=btn(label,"mw-tab"+(salaryTab===key?" active":""),()=>{salaryTab=key;renderMaster()});
      b.setAttribute("aria-pressed",String(salaryTab===key));tabs.append(b);
    }
    root.append(tabs);
    const list=el("div","mw-history");
    const items=salaryTab==="accruals"
      ?m.orders.map(o=>({at:String(o.date||"")+"T12:00:00Z",month:monthOf(o.date,true),
        label:"Заказ · "+(o.name||"Клиент"),sub:"Начисление за выполненный и оплаченный заказ",amount:Number(o.amount)||0}))
      :m.payouts.map(o=>({at:o.created_at,month:monthOf(o.created_at),
        label:o.order_id?"Доля по заказу":"Выплата зарплаты",
        sub:(o.note||"")+(o.payment_method?" · "+accountName(o.payment_method):" · способ не указан"),
        amount:-(Number(o.amount)||0)}));
    if(!items.length)list.append(el("p","mw-notice","Записей пока нет."));
    // Group monthly statements, newest first; add up only the entries in that month.
    const grouped=new Map();
    for(const item of items){
      if(!grouped.has(item.month))grouped.set(item.month,[]);
      grouped.get(item.month).push(item);
    }
    const months=[...grouped.keys()].sort((a,b)=>a==="unknown"?1:b==="unknown"?-1:b.localeCompare(a));
    for(const month of months){
      const entries=grouped.get(month).sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
      const total=Math.round(entries.reduce((sum,item)=>sum+Math.abs(item.amount),0)*100)/100;
      const group=el("section","mw-month-group");
      group.setAttribute("aria-label",monthTitle(month));
      group.append(box("mw-month-header",
        el("h3","mw-month-title",monthTitle(month)),
        el("strong","mw-month-total",rub(total))));
      const rows=el("div","mw-month-rows");
      for(const item of entries){
        rows.append(box("mw-history-row",box("mw-history-main",
          el("strong","",item.label),el("small","",date(item.at)),el("small","",item.sub)),
          el("strong",item.amount<0?"mw-minus":"mw-plus",
            (item.amount<0?"−":"+")+rub(Math.abs(item.amount)))));
      }
      group.append(rows);list.append(group);
    }
    root.append(list);
    root.append(el("p","mw-help","Это учёт выплат. Программа не переводит деньги между банковскими счетами."));
  }
  function modalBase(title,onClosed){
    const prev=document.activeElement,overlay=el("div","mw-modal-backdrop");
    const sheet=el("section","mw-modal");
    sheet.setAttribute("role","dialog");sheet.setAttribute("aria-modal","true");sheet.setAttribute("aria-label",title);
    const close=()=>{if(sheet.dataset.busy==="1")return;overlay.remove();onClosed?.();prev?.focus?.({preventScroll:true});};
    const header=box("mw-modal-header",el("h2","",title),btn("×","mw-modal-close",close));
    sheet.append(header);overlay.append(sheet);document.body.append(overlay);
    overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
    sheet.tabIndex=-1;sheet.focus({preventScroll:true});
    return {overlay,sheet,close,header};
  }
  function radioSet(name,defaultValue){
    const wrap=el("div","mw-radio-row");
    for(const [key,label] of [["cash","Наличные"],["card","Карта"]]){
      const item=el("label","mw-radio"),input=el("input");
      input.type="radio";input.name=name;input.value=key;input.checked=key===defaultValue;
      item.append(input,el("span","",label));wrap.append(item);
    }
    return {node:wrap,value:()=>wrap.querySelector("input:checked")?.value};
  }
  function field(label,control){const n=el("label","mw-field");n.append(el("span","",label),control);return n}
  function canRecordCashbook(d,book){
    return hasSnapshot(d)&&hasSnapshot(book)&&!d.stale&&!book.stale&&!d.refreshError&&!book.refreshError;
  }
  function ownerPayments(panel,activate=false){
    if(!ownerView||ownerView.panel!==panel){
      const menu=el("div","mw-create-menu");menu.hidden=true;
      const create=btn("Создать ▾","mw-owner-create",()=>{
        if(isPreview()){window.alert("В предпросмотре изменения отключены.");return;}
        menu.hidden=!menu.hidden;create.setAttribute("aria-expanded",String(!menu.hidden));
      });
      create.setAttribute("aria-expanded","false");
      for(const [type,label] of [["income","＋ Создать приход"],["expense","− Создать расход"],["transfer","⇄ Перевод между счетами"]])
        menu.append(btn(label,"mw-menu-action",()=>{
          menu.hidden=true;create.setAttribute("aria-expanded","false");openOwnerEntry(type);
        }));
      const status=readStatus(),receipt=el("p","mw-handoff-status"),content=el("div","mw-owner-data");
      receipt.setAttribute("role","status");receipt.hidden=true;
      panel.append(box("mw-owner-payments",
        box("mw-owner-heading",el("h2","","Платежи"),create),menu,status,receipt,content));
      ownerView={panel,menu,create,status,receipt,content,revision:null,book:null};
    }
    updateOwnerPayments();
    if(activate)retryRead(()=>api()?.cashbook?.());
  }
  function updateOwnerPayments(){
    if(!ownerView||ownerView.panel.hidden||$("financePanel")?.hidden)return;
    const {create,menu,status,content}=ownerView;
    const d=api()?.ownerSnapshot?.(),book=api()?.cashbookSnapshot?.();
    if(!d||!book)return;
    create.disabled=!canRecordCashbook(d,book);
    if(create.disabled){
      menu.hidden=true;create.setAttribute("aria-expanded","false");
    }
    const retryFinance=Boolean(d.error||d.stale||d.refreshError);
    const retryBook=Boolean(book.error||book.stale||book.refreshError);
    const message=retryFinance?financeStatusMessage(d):
      book.error?"Не удалось загрузить кассу. "+book.error:
      book.stale||book.refreshError?"Показаны последние загруженные движения кассы."+
        (book.refreshError?" "+book.refreshError:""):
      !hasSnapshot(book)||!hasSnapshot(d)?"Загружаем данные платежей…":"";
    updateReadStatus(status,message,(retryFinance||retryBook)?()=>Promise.all([
      retryFinance&&financeRetry(),retryBook&&api().cashbook({force:true})
    ]):null);
    if(!hasSnapshot(d)||!hasSnapshot(book)){
      if(content.firstChild)content.replaceChildren();
      ownerView.revision=null;ownerView.book=null;
      return;
    }
    const revision=d.revision??JSON.stringify([d.paidOrders,d.operations,d.collections,d.deposits]);
    if(ownerView.revision===revision&&ownerView.book===book.rows)return;
    ownerView.revision=revision;ownerView.book=book.rows;
    renderOwner(content,book.rows,d);
  }
  function renderOwner(root,book,d){
    const items=[],balance={cash:0,card:0},stat={income:0,expense:0,unknown:0};
    const add=(kind,value,method,title,at,sub)=>{
      const n=Number(value)||0;const known=validMethod(method);
      if(known)balance[method]+=kind==="income"?n:-n;
      else stat.unknown+=Math.abs(n);
      if(kind==="income")stat.income+=n;else stat.expense+=n;
      items.push({kind,title,amount:n,method,at,sub:sub||""});
    };
    const cashOrders=new Set(d.collections.map(c=>String(c.id)));
    for(const o of d.paidOrders){
      if(o.receivedBy==="master"||cashOrders.has(String(o.id)))continue;
      add("income",o.amount,o.method,"Оплата заказа · "+(o.name||"Клиент"),o.paidAt||o.date,"По выполненным/оплаченным заказам");
    }
    for(const c of d.deposits)
      add("income",c.amount,"cash","Сдача компании от мастера",c.confirmed_at,"Подтверждена владельцем");
    for(const row of d.operations){
      if(row.order_id)continue; // auto cash distribution already accounts for retained funds
      add("expense",row.amount,row.payment_method,
        row.kind==="expense"?"Расход кассы":row.kind==="raul_payout"?"Зарплата Рауля":"Зарплата Тимура",
        row.created_at,row.note);
    }
    for(const row of book){
      if(row.kind==="transfer"){
        const val=Number(row.amount)||0;balance[row.from_account]-=val;balance[row.to_account]+=val;
        items.push({kind:"transfer",title:"Перевод: "+accountName(row.from_account)+" → "+accountName(row.to_account),
          amount:val,method:null,at:row.created_at,sub:row.note});
      }else add(row.kind,row.amount,row.kind==="income"?row.to_account:row.from_account,
        row.kind==="income"?"Приход":"Расход",row.created_at,row.note);
    }
    root.replaceChildren();
    root.append(el("p","mw-help","Расчётные движения по наличным и карте. Не является выпиской банка: начальные остатки не заданы, старые операции без способа не распределены."));
    root.append(box("mw-money-stats",
      box("mw-money-stat",el("small","","Наличные · расчёт"),el("strong","",rub(balance.cash))),
      box("mw-money-stat",el("small","","Карта · расчёт"),el("strong","",rub(balance.card))),
      box("mw-money-stat",el("small","","Приход"),el("strong","",rub(stat.income))),
      box("mw-money-stat",el("small","","Расход"),el("strong","",rub(stat.expense)))
    ));
    if(stat.unknown)root.append(el("p","mw-notice","Операции без указанного способа: "+rub(stat.unknown)+
      ". Они есть в истории, но не относятся автоматически к наличным или карте."));
    root.append(el("h3","mw-subheading","История движений"));
    const history=el("div","mw-owner-history");
    items.sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
    if(!items.length)history.append(el("p","mw-notice","Операций ещё нет."));
    for(const row of items.slice(0,250)){
      history.append(box("mw-owner-row",
        box("",el("strong","",row.title),el("small","",date(row.at)),el("small","",row.sub)),
        box("mw-owner-row-right",el("strong",row.kind==="income"?"mw-plus":row.kind==="expense"?"mw-minus":"",
          (row.kind==="income"?"+":row.kind==="expense"?"−":"⇄ ")+rub(row.amount)),
          el("small","",row.kind==="transfer"?"Перевод":accountName(row.method)))));
    }
    root.append(history);
  }
  function openOwnerEntry(kind){
    if(isPreview()||!canRecordCashbook(api()?.ownerSnapshot(),api()?.cashbookSnapshot()))return;
    if(ownerView)ownerView.receipt.hidden=true;
    const labels={income:"Создать приход",expense:"Создать расход",transfer:"Перевести между счетами"};
    const {sheet,close}=modalBase(labels[kind]);
    const amount=el("input","mw-input");amount.type="text";amount.inputMode="decimal";amount.placeholder="0,00";
    const note=el("textarea","mw-input");note.rows=2;note.maxLength=240;
    note.placeholder=kind==="income"?"Например: прочий доход":kind==="expense"?"Например: покупка материалов":"Например: снял с карты и положил в кассу";
    let methods,from,to;
    sheet.append(field("Сумма, ₽",amount));
    if(kind==="transfer"){
      from=el("select","mw-input");to=el("select","mw-input");
      for(const [v,label] of [["cash","Наличные"],["card","Карта"]]){
        const a=el("option","",label);a.value=v;from.append(a);
        const b=el("option","",label);b.value=v;to.append(b);
      }
      from.value="card";to.value="cash";
      sheet.append(field("Откуда",from),field("Куда",to));
    }else{
      methods=radioSet("mw-owner-account","cash");
      sheet.append(field(kind==="income"?"Куда поступили деньги":"Откуда списать",methods.node));
    }
    sheet.append(field("Комментарий",note));
    const error=el("p","mw-error");error.setAttribute("role","alert");
    const save=btn("Сохранить","mw-main-button"),cancel=btn("Отмена","mw-minor",close);
    const requestId=token();let busy=false,used=false;
    sheet.append(error,box("mw-modal-actions",cancel,save));
    save.addEventListener("click",async()=>{
      if(busy||used)return;
      if(!canRecordCashbook(api()?.ownerSnapshot(),api()?.cashbookSnapshot())){
        error.textContent="Обновите данные кассы перед сохранением.";
        return;
      }
      const value=parseSum(amount.value),method=methods?.value();
      const src=kind==="income"?null:kind==="expense"?method:from.value;
      const dst=kind==="expense"?null:kind==="income"?method:to.value;
      if(!value||!note.value.trim()||(kind==="transfer"&&src===dst)){
        error.textContent=!value?"Укажи корректную положительную сумму":
          !note.value.trim()?"Добавь комментарий":"Счета должны отличаться";return;
      }
      busy=true;used=true;sheet.dataset.busy="1";save.disabled=true;cancel.disabled=true;error.textContent="Сохраняю...";
      try{
        await api().recordCashbook({kind,amount:value,from:src,to:dst,note:note.value.trim(),requestId});
        if(!sheet.isConnected)return;
        sheet.dataset.busy="0";close();
        if(ownerView){
          ownerView.receipt.hidden=false;
          ownerView.receipt.textContent="Операция сохранена.";
        }
        updateOwnerPayments();
      }catch(e){
        if(!sheet.isConnected)return;
        busy=false;sheet.dataset.busy="0";
        error.textContent="Запись не подтверждена: "+(e.message||"ошибка связи")+
          ". Проверь историю перед повторной попыткой.";
        cancel.disabled=false;save.disabled=true;
      }
    });
  }
  window.__rdMasterOrdersRefresh=()=>{
    filterRows();
    if(page==="reports"&&step==="orderProfit")masterProfitReport?.api.render();
  };
  window.__rdMoneyAccess=()=>{
    const member=api()?.snapshot();
    if(member?.role==="master"){
      const user=typeof currentUser!=="undefined"&&currentUser?.id||member.masterName||"master";
      if(masterReady&&navigationUser===user)return;
      setupMaster();
      if(!masterReady)return;
      navigationUser=user;
      const nav=$("mwMasterNav");if(nav)nav.hidden=false;
      page="day";step="menu";paymentMethod="all";paymentBreakdownOpen=false;
      handoffMessage="";handoffRefreshError="";
      switchPage("day",false);
    }else{
      navigationUser=null;
      $("appScreen")?.classList.remove("mw-orders-minimal-header");
      $("appScreen")?.classList.remove("mw-payments-header");
      const nav=$("mwMasterNav"),reports=$("mwMasterReports"),
        payments=$("mwMasterPayments"),settings=$("mwMasterSettings");
      if(nav)nav.hidden=true;
      if(reports)reports.hidden=true;
      if(payments)payments.hidden=true;
      if(settings)settings.hidden=true;
      if(member?.role==="owner"&&!$("financePanel")?.hidden){
        const ownerPanel=$("financeContent")?.querySelector(".fp-payments-panel");
        if(ownerPanel&&!ownerPanel.hidden)ownerPayments(ownerPanel);
      }
    }
  };
  window.__rdMoneyUpdated=()=>{
    const master=api()?.snapshot();
    if(master?.role==="owner"&&ownerView?.panel.isConnected)updateOwnerPayments();
    if(hasSnapshot(master)&&!master.stale&&!master.refreshError)handoffRefreshError="";
    const focus=document.activeElement;
    if(page==="reports"&&$("mwMasterReports")&&!focus?.closest?.("#mwMasterReports"))renderMaster();
    if(page!=="payments")return;
    const payments=$("mwMasterPayments");
    if(!payments||payments.hidden)return;
    const paymentControl=payments.contains(focus)?focus.closest(".mw-payment-row, summary, .mw-handoff-action"):null;
    renderMasterPayments();
    if(paymentControl){
      const replacement=paymentControl.matches(".mw-payment-row")?
        [...payments.querySelectorAll(".mw-payment-row")].find(row=>row.dataset.orderId===paymentControl.dataset.orderId):
        payments.querySelector(paymentControl.matches("summary")?"summary":".mw-handoff-action:not(:disabled), summary");
      replacement?.focus({preventScroll:true});
    }
  };
  window.__rdPaymentsRender=ownerPayments;
  window.__rdResetMoneyViews=()=>{
    ownerView?.panel.replaceChildren();ownerView=null;
    for(const id of ["mwMasterReports","mwMasterPayments"])$(id)?.replaceChildren();
    for(const modal of document.querySelectorAll(".mw-modal-backdrop"))modal.remove();
    masterPaymentSignature=null;masterProfitReport=null;navigationUser=null;
    paymentBreakdownOpen=false;handoffMessage="";handoffRefreshError="";
    scrollPositions.clear();
    window.__rdResetPayrollUi?.();
  };
  if($("appScreen")?.hidden===false)window.__rdMoneyAccess();
})();
