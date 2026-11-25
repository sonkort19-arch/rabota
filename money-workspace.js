/* Работа — платежи, отчёты мастера и учётная касса владельца. */
"use strict";
(()=>{
  const $=id=>document.getElementById(id);
  const el=(tag,cls="",value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
  const append=(parent,...children)=>{parent.append(...children);return parent};
  const box=(cls,...items)=>append(el("div",cls),...items);
  const btn=(label,cls,fn)=>{const n=el("button",cls,label);n.type="button";if(fn)n.addEventListener("click",fn);return n};
  const rubFormat=new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
  const rub=n=>rubFormat.format(Number(n)||0)+" ₽";
  const date=s=>{const d=new Date(s||0);return Number.isFinite(+d)?d.toLocaleString("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"short",year:"numeric",hour:s?.includes("T")?"2-digit":undefined,minute:s?.includes("T")?"2-digit":undefined}):String(s||"—")};
  const parseSum=s=>{const v=String(s||"").trim().replace(/[\s\u00a0\u202f]/g,"").replace(",",".");if(!/^\d+(?:\.\d{1,2})?$/.test(v))return null;const c=Math.round(Number(v)*100);return Number.isSafeInteger(c)&&c>0?c/100:null};
  const accountName=m=>m==="cash"?"Наличные":m==="card"?"Карта":"Не указан";
  const validMethod=m=>m==="cash"||m==="card";
  const api=()=>window.__rdMoneyUi;
  const token=()=>{if(typeof window.crypto?.randomUUID!=="function")throw Error("Браузер не поддерживает безопасный идентификатор операции");return window.crypto.randomUUID()};
  const isPreview=()=>/^rabota-(?:git-[a-z0-9-]+-|[a-z0-9]{7,}-)sonkort19-6069s-projects\.vercel\.app$/i.test(String(window.location?.hostname||""));
  let page="day",step="menu",masterReady=false,masterProfitReport=null,masterPayrollReport=null;
  let orderQuery="",orderStatus="all",paymentMethod="all",navigationUser=null;
  let paymentBreakdownOpen=false;
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
    window.__rdWhatsAppSettings?.mount(settings,{embedded:typeof window.__rdSetScreenHeader==="function"});
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
    document.body.append(nav);masterReady=true;
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
    const nav=$("mwMasterNav");if(!nav)return;
    const destination=page==="day"?"orders":page;
    window.__rdSetActiveNavItem(nav,nav.querySelector('[data-mw-page="'+destination+'"]'));
  }
  function switchPage(which,restore=true){
    if(api()?.snapshot()?.role!=="master")return;
    const reports=$("mwMasterReports"),payments=$("mwMasterPayments"),
      settings=$("mwMasterSettings"),orders=$("ordersArea"),finance=$("financePanel");
    if(!reports||!payments||!orders||!finance)return;
    if(which!==page){
      window.__rdCloseHeaderMenus?.();
      if(restore)scrollPositions.set(page,window.__rdViewportScroll.position());
    }
    page=which;
    window.__rdMasterCurrentPage=page;
    window.__rdCurrentPage=which==="day"||which==="orders"?"orders":which;
    if(which!=="reports")window.__rdSetScreenHeader?.(
      {payments:"Платежи",settings:"Настройки"}[which]||"Заказы");
    reports.hidden=which!=="reports";payments.hidden=which!=="payments";
    if(settings)settings.hidden=which!=="settings";
    const filters=$("mwMasterFilterbar");
    if(filters)filters.hidden=which!=="orders"||Boolean(window.__rdOrdersWorkspace?.isActive?.());
    if(which==="reports"||which==="payments"||which==="settings"){
      orders.hidden=true;finance.hidden=true;
      if(which==="reports")renderMaster();
      else if(which==="payments")renderMasterPayments();
      else window.__rdWhatsAppSettings?.refresh();
    }else{
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
      window.__rdViewportScroll.restore(y);
    }
  }
  window.__rdMasterNavigate=(which,restore=false)=>switchPage(which,restore);
  function renderPaymentHistory(list,orders){
    list.replaceChildren();
    const filtered=orders.filter(o=>paymentMethod==="all"||(paymentMethod==="unknown"?
      !validMethod(o.method):o.method===paymentMethod));
    if(!filtered.length){
      list.append(el("p","mw-notice",orders.length?"Оплат с таким способом нет.":"Оплат по заказам пока нет."));
      return;
    }
    const payments=filtered.map(order=>{
      const timestamp=Date.parse(order.occurredAt||order.paidAt||"");
      return {order,timestamp:Number.isFinite(timestamp)?timestamp:null};
    });
    payments.sort((a,b)=>(b.timestamp??-Infinity)-(a.timestamp??-Infinity));
    let currentDay="",rows;
    for(const {order,timestamp} of payments){
      const day=timestamp===null?"Дата операции не указана":paymentDay.format(timestamp);
      if(day!==currentDay){
        currentDay=day;
        const group=el("section","mw-payment-day");
        rows=el("div","mw-payment-day-rows");
        group.append(el("h3","mw-payment-date",day),rows);list.append(group);
      }
      const name=box("mw-payment-name",el("strong","",order.name||"Клиент"));
      if(order.reference)name.append(el("span","mw-payment-reference",order.reference));
      const method=validMethod(order.method)?accountName(order.method):"Способ не указан";
      const refund=order.type==="refund";
      const orderId=order.orderId??order.id;
      const item=btn("","mw-payment-row",()=>window.__rdOpenMasterOrder?.(orderId));
      item.dataset.orderId=orderId;
      item.dataset.paymentType=order.type;
      const chevron=el("span","mw-payment-chevron","›");chevron.setAttribute("aria-hidden","true");
      const detail=[timestamp===null?"":paymentTime.format(timestamp),method,refund?"Возврат клиенту":""].filter(Boolean);
      item.append(name,el("strong",refund?"mw-payment-amount mw-minus":"mw-payment-amount",
        (refund?"−":"+")+paymentCurrency.format(order.amount)),chevron,el("small","mw-payment-meta",detail.join(" · ")));
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
    const ready=hasSnapshot(m),unavailable=ready&&!Array.isArray(m.receipts);
    const signature=JSON.stringify([
      m.revision,ready,m.error,m.stale,m.refreshError,
      m.revision==null?[m.receipts,m.refunds]:null
    ]);
    if(masterPaymentSignature===signature&&root.firstChild)return;
    masterPaymentSignature=signature;
    const status=readStatus();
    const message=financeStatusMessage(m)||(unavailable?"Не удалось получить журнал клиентских оплат.":"");
    if(message){
      updateReadStatus(status,message,(m.error||m.stale||m.refreshError||unavailable)?financeRetry:null);
      cards.append(status);
    }
    if(!ready||unavailable){root.replaceChildren(cards);return;}
    const rows=m.receipts.map(o=>({...o,type:"receipt"}))
      .concat((m.refunds||[]).map(o=>({...o,type:"refund"})))
      .filter(o=>o.amount!=null&&Number.isFinite(Number(o.amount))&&Number(o.amount)>=0);
    const amounts={cash:0,card:0,unknown:0};
    for(const o of rows){
      const cents=Math.round(Number(o.amount)*100);
      amounts[validMethod(o.method)?o.method:"unknown"]+=o.type==="refund"?-cents:cents;
    }
    const total=(amounts.cash+amounts.card+amounts.unknown)/100;
    const breakdown=el("details","mw-payment-breakdown");
    breakdown.open=paymentBreakdownOpen;
    const summary=el("summary");
    summary.append(el("span","",rows.some(row=>row.type==="refund")?"Оплаты за вычетом возвратов":"Оплачено клиентами"),
      el("strong","",paymentCurrency.format(total)));
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
    select.onchange=()=>{paymentMethod=select.value;renderPaymentHistory(list,rows);};
    renderPaymentHistory(list,rows);
  }
  function showMasterReport(next){
    const previous=step;
    step=next;
    renderMaster();
    window.__rdViewportScroll?.restore(0);
    const reports=$("mwMasterReports");
    const focus=next==="menu"
      ?reports?.querySelector('[data-report="'+previous+'"]')
      :$("rdScreenBack")||reports?.querySelector(".pr-back,.fp-report-back");
    focus?.focus({preventScroll:true});
  }
  function closeMasterReport(){showMasterReport("menu");}
  function renderMaster(){
    const root=$("mwMasterReports");if(!root||root.hidden)return;
    const m=api()?.snapshot();
    if(!m||m.role!=="master")return;
    const isRaul=String(m.masterName||"").trim().toLocaleLowerCase("ru")==="рауль";
    if(step==="orderProfit"&&!isRaul)step="menu";
    const embedded=typeof window.__rdSetScreenHeader==="function";
    const title=step==="orderProfit"?"Прибыль по заказам":step==="detail"?"Зарплата":"Отчёты";
    if(embedded)window.__rdSetScreenHeader(title,step==="menu"?null:closeMasterReport,
      step==="menu"?"Назад":"Назад к отчётам");
    if(step==="orderProfit"&&masterProfitReport?.container?.isConnected){
      masterProfitReport.api.render();return;
    }
    if(step==="detail"&&masterPayrollReport?.container?.isConnected){
      masterPayrollReport.api.render();return;
    }
    masterProfitReport=null;
    masterPayrollReport=null;
    root.replaceChildren();
    if(step==="menu"){
      const entry=btn("","mw-entry",()=>showMasterReport("detail"));
      entry.dataset.report="detail";
      entry.append(el("span","mw-entry-icon","▤"),box("mw-entry-copy",
        el("strong","","Зарплата"),el("small","","Баланс, начисления и выплаты")),el("span","mw-chevron","›"));
      root.append(entry);
      if(isRaul){
        const orderProfit=btn("","mw-entry",()=>showMasterReport("orderProfit"));
        orderProfit.dataset.report="orderProfit";
        orderProfit.append(el("span","mw-entry-icon","▤"),box("mw-entry-copy",
          el("strong","","Прибыль по заказам"),
          el("small","","Мои заказы, оплаты и начисления")),el("span","mw-chevron","›"));
        root.append(orderProfit);
      }
      return;
    }
    const unavailable=()=>{
      if(!embedded){
        const heading=el("header","pr-heading");
        const back=btn("Назад","pr-back",closeMasterReport);
        back.setAttribute("aria-label","Назад к отчётам");
        heading.append(back,el("h2","",title));
        root.append(heading);
      }
      root.append(el("p","mw-error","Отчёт временно недоступен."));
    };
    if(step==="orderProfit"){
      const maker=window.__rdCreateProfitReport;
      if(typeof maker!=="function"){
        unavailable();return;
      }
      const container=el("div","mw-profit-report");root.append(container);
      const report=maker(container,{
        getOrders:()=>api()?.masterReportOrders?.()||[],
        getRaulMasterId:()=>api()?.snapshot()?.masterId||null,
        getFinanceStatus:()=>api()?.snapshot(),
        getPayroll:()=>window.__rdPayrollSnapshot?.(),
        onRetry:financeRetry,
        startOpen:true,embedded,onBack:closeMasterReport
      });
      masterProfitReport={container,api:report};
      return;
    }
    if(window.__rdPayrollReport?.mount){
      const container=el("div","fp-master-payroll");
      root.append(container);
      const report=window.__rdPayrollReport.mount(container,{master:true,embedded,
        onBack:closeMasterReport
      });
      masterPayrollReport={container,api:report};
      return;
    }
    unavailable();
  }
  function modalBase(title){
    const prev=document.activeElement,overlay=el("div","mw-modal-backdrop");
    const sheet=el("section","mw-modal");
    sheet.setAttribute("role","dialog");sheet.setAttribute("aria-modal","true");sheet.setAttribute("aria-label",title);
    const close=()=>{if(sheet.dataset.busy==="1")return;overlay.remove();prev?.focus?.({preventScroll:true});};
    const header=box("mw-modal-header",el("h2","",title),btn("×","mw-modal-close",close));
    sheet.append(header);overlay.append(sheet);document.body.append(overlay);
    overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
    sheet.tabIndex=-1;sheet.focus({preventScroll:true});
    return {sheet,close};
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
    return hasSnapshot(d)&&hasSnapshot(book)&&Boolean(d.accounting)&&!d.stale&&!book.stale&&!d.refreshError&&!book.refreshError;
  }
  function ownerPayments(panel,activate=false){
    if(!ownerView||ownerView.panel!==panel){
      const menu=el("div","mw-create-menu");menu.hidden=true;
      const create=btn("Создать ▾","mw-owner-create",()=>{
        if(isPreview()){window.alert("В предпросмотре изменения отключены.");return;}
        menu.hidden=!menu.hidden;create.setAttribute("aria-expanded",String(!menu.hidden));
      });
      create.setAttribute("aria-expanded","false");
      for(const [type,label] of [["income","＋ Создать приход"],["expense","− Создать расход"]])
        menu.append(btn(label,"mw-menu-action",()=>{
          menu.hidden=true;create.setAttribute("aria-expanded","false");openOwnerEntry(type);
        }));
      const status=readStatus(),receipt=el("p","mw-owner-receipt"),content=el("div","mw-owner-data");
      receipt.setAttribute("role","status");receipt.hidden=true;
      panel.append(box("mw-owner-payments",box("mw-owner-actions",create),menu,status,receipt,content));
      ownerView={panel,menu,create,status,receipt,content,revision:null,book:null};
    }
    updateOwnerPayments();
    if(activate)retryRead(()=>api()?.cashbook?.());
  }
  function updateOwnerPayments(){
    if(!ownerView||ownerView.panel.hidden||$("financePanel")?.hidden)return;
    const {create,menu,status,content}=ownerView;
    const book=api()?.cashbookSnapshot?.();
    let d;
    try{d=api()?.ownerSnapshot?.();}
    catch(error){d={error:error?.message||"Не удалось проверить данные учётной кассы."};}
    if(!d||!book)return;
    create.disabled=!canRecordCashbook(d,book);
    if(create.disabled){
      menu.hidden=true;create.setAttribute("aria-expanded","false");
    }
    const retryFinance=Boolean(d.error||d.stale||d.refreshError);
    const retryBook=Boolean(book.error||book.stale||book.refreshError);
    const unavailable=hasSnapshot(d)&&hasSnapshot(book)&&!d.accounting;
    const message=retryFinance?financeStatusMessage(d):
      book.error?"Не удалось загрузить кассу. "+book.error:
      book.stale||book.refreshError?"Показаны последние загруженные движения кассы."+
        (book.refreshError?" "+book.refreshError:""):
      !hasSnapshot(book)||!hasSnapshot(d)?"Загружаем данные платежей…":
      unavailable?"Не удалось получить данные учётной кассы.":"";
    updateReadStatus(status,message,(retryFinance||retryBook||unavailable)?()=>Promise.all([
      (retryFinance||unavailable)&&financeRetry(),retryBook&&api().cashbook({force:true})
    ]):null);
    if(!hasSnapshot(d)||!hasSnapshot(book)||unavailable){
      if(content.firstChild)content.replaceChildren();
      ownerView.revision=null;ownerView.book=null;
      return;
    }
    const revision=JSON.stringify([d.revision??d.accounting,d.companyProfit]);
    if(ownerView.revision===revision&&ownerView.book===book.rows)return;
    ownerView.revision=revision;ownerView.book=book.rows;
    renderOwner(content,d.accounting,d.companyProfit);
  }
  function renderOwner(root,accounting,companyProfit){
    const items=[];
    for(const row of accounting.receipts){
      items.push({...row,kind:"receipt",title:"Оплата заказа · "+(row.name||"Клиент"),
        occurredAt:row.occurredAt||row.paidAt,note:row.reference});
    }
    for(const row of accounting.refunds){
      items.push({...row,kind:"refund",title:"Возврат по заказу · "+(row.name||"Клиент"),
        note:row.note||row.reference});
    }
    for(const row of accounting.expenses)items.push({...row,kind:"expense",title:"Расход"});
    for(const row of accounting.payouts)items.push({...row,kind:"payout",title:"Выплата зарплаты"});
    for(const row of accounting.manualEntries){
      const title=row.kind==="income"?"Прочий приход":row.kind==="expense"?"Расход":"Перевод между счетами";
      items.push({...row,title,method:row.kind==="income"?row.to:row.from});
    }
    const stats=box("mw-money-stats");
    const metrics=[
      ["Остаток учётной кассы",accounting.recordedNet],["Оплаты заказов",accounting.receiptTotal],
      ["Возвраты клиентам",accounting.refundTotal],["Прочие приходы",accounting.manualIncome],
      ["Расходы",accounting.expenseTotal+accounting.manualExpense],["Выплаты зарплаты",accounting.payoutTotal],
      [accounting.unverifiedMarginCount?"Подтверждённая доля компании":"Доля компании по заказам",accounting.companyShare]
    ];
    if(companyProfit!=null)metrics.push([accounting.unverifiedMarginCount?"Учтённая прибыль":"Прибыль компании",companyProfit]);
    for(const [label,amount] of metrics)
      stats.append(box("mw-money-stat",el("small","",label),el("strong","",rub(amount))));
    root.replaceChildren(stats,el("h3","mw-subheading","История операций"));
    if(accounting.unverifiedMarginCount){
      root.insertBefore(el("p","mw-notice","Прибыль компании уточняется после сверки заказов."),stats.nextElementSibling);
    }
    const history=el("div","mw-owner-history");
    items.sort((a,b)=>String(b.occurredAt||"").localeCompare(String(a.occurredAt||"")));
    if(!items.length)history.append(el("p","mw-notice","Операций ещё нет."));
    const renderItem=row=>{
      const incoming=row.kind==="receipt"||row.kind==="income";
      const transfer=row.kind==="transfer";
      const voided=Boolean(row.voidedAt);
      const amountClass=transfer||voided?"":incoming?"mw-plus":"mw-minus";
      const entry=box("mw-owner-row",
        box("",el("strong","",row.title),el("small","",row.occurredAt?date(row.occurredAt):"Дата не указана"),el("small","",row.note||"")),
        box("mw-owner-row-right",el("strong",amountClass,
          (transfer?"⇄ ":incoming?"+":"−")+rub(row.amount)),
          el("small","",transfer?"Из прежнего учёта":accountName(row.method))));
      entry.dataset.kind=row.kind;
      if(row.orderId!=null)entry.dataset.orderId=row.orderId;
      if(voided){
        entry.dataset.status="voided";
        entry.firstElementChild.append(el("small","mw-owner-voided","Отменён · "+date(row.voidedAt)));
      }
      return entry;
    };
    const batchSize=250;
    let visible=0;
    const more=btn("Показать ещё","secondary mw-owner-more",appendHistory);
    function appendHistory(){
      const batch=items.slice(visible,visible+batchSize);
      history.append(...batch.map(renderItem));
      visible+=batch.length;
      more.hidden=visible>=items.length;
    }
    appendHistory();
    root.append(history,more);
  }
  function openOwnerEntry(kind){
    if(isPreview()||ownerView?.create.disabled!==false)return;
    if(ownerView)ownerView.receipt.hidden=true;
    const income=kind==="income";
    const {sheet,close}=modalBase(income?"Создать приход":"Создать расход");
    const amount=el("input","mw-input");amount.type="text";amount.inputMode="decimal";amount.placeholder="0,00";
    const note=el("textarea","mw-input");note.rows=2;note.maxLength=240;
    note.placeholder=income?"Например: прочий доход":"Например: покупка материалов";
    const methods=radioSet("mw-owner-account","cash");
    sheet.append(field("Сумма, ₽",amount),field("Способ операции",methods.node));
    sheet.append(field("Комментарий",note));
    const error=el("p","mw-error");error.setAttribute("role","alert");
    const save=btn("Сохранить","mw-main-button"),cancel=btn("Отмена","mw-minor",close);
    const requestId=token();let busy=false,used=false;
    sheet.append(error,box("mw-modal-actions",cancel,save));
    save.addEventListener("click",async()=>{
      if(busy||used)return;
      if(ownerView?.create.disabled!==false){
        error.textContent="Обновите данные кассы перед сохранением.";
        return;
      }
      const value=parseSum(amount.value),method=methods.value();
      if(!value||!note.value.trim()){
        error.textContent=!value?"Укажи корректную положительную сумму":"Добавь комментарий";
        return;
      }
      busy=true;used=true;sheet.dataset.busy="1";save.disabled=true;cancel.disabled=true;error.textContent="Сохраняю...";
      try{
        await api().recordCashbook({kind,amount:value,from:income?null:method,to:income?method:null,note:note.value.trim(),requestId});
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
      switchPage("day",false);
    }else{
      navigationUser=null;
      const nav=$("mwMasterNav"),reports=$("mwMasterReports"),
        payments=$("mwMasterPayments"),settings=$("mwMasterSettings");
      if(nav)nav.hidden=true;
      if(reports)reports.hidden=true;
      if(payments)payments.hidden=true;
      if(settings)settings.hidden=true;
      if(member?.role==="owner"&&!$("financePanel")?.hidden)window.__rdOpenFinanceView?.();
    }
  };
  window.__rdMoneyUpdated=()=>{
    const master=api()?.snapshot();
    if(master?.role==="owner"&&ownerView?.panel.isConnected)updateOwnerPayments();
    const focus=document.activeElement;
    if(page==="reports"&&(step==="detail"||!focus?.closest?.("#mwMasterReports")))renderMaster();
    if(page!=="payments")return;
    const payments=$("mwMasterPayments");
    if(!payments||payments.hidden)return;
    const paymentControl=payments.contains(focus)?focus.closest(".mw-payment-row, summary"):null;
    renderMasterPayments();
    if(paymentControl){
      const replacement=paymentControl.matches(".mw-payment-row")?
        [...payments.querySelectorAll(".mw-payment-row")].find(row=>row.dataset.orderId===paymentControl.dataset.orderId&&
          row.dataset.paymentType===paymentControl.dataset.paymentType):
        payments.querySelector("summary");
      replacement?.focus({preventScroll:true});
    }
  };
  window.__rdPaymentsRender=ownerPayments;
  window.__rdResetMoneyViews=()=>{
    ownerView?.panel.replaceChildren();ownerView=null;
    for(const id of ["mwMasterReports","mwMasterPayments"])$(id)?.replaceChildren();
    for(const modal of document.querySelectorAll(".mw-modal-backdrop"))modal.remove();
    masterPaymentSignature=null;masterProfitReport=null;masterPayrollReport=null;navigationUser=null;
    paymentBreakdownOpen=false;
    scrollPositions.clear();
    window.__rdResetPayrollUi?.();
  };
  if($("appScreen")?.hidden===false)window.__rdMoneyAccess();
})();
