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
  const isPreview=()=>/^rabota-[a-z0-9]{7,}-sonkort19-6069s-projects\.vercel\.app$/i.test(String(window.location?.hostname||""));
  let page="orders",step="menu",salaryTab="accruals",payDialog=false,masterReady=false;
  let orderQuery="",orderStatus="all",paymentMethod="all";
  const scrollPositions=new Map();
  const statusOptions=[["all","Все"],["Новый","Новые"],["Записан","Записаны"],
    ["В работе","В работе"],["Выполнен","Выполнены"],["Отменён","Отменены"]];
  function navIcon(name){
    const span=el("span","mw-icon");
    const shapes={
      day:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
      orders:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
      payments:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 15h3"/>',
      reports:'<path d="M4 20V11M10 20V4M16 20v-9M22 20V7M2 21h21"/>'
    };
    span.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+shapes[name]+'</svg>';
    return span;
  }
  function setupMaster(){
    if(masterReady||api()?.snapshot()?.role!=="master")return;
    const app=$("appScreen"),orders=$("ordersArea"),finance=$("financePanel");
    if(!app||!orders||!finance)return;
    const reports=el("section","mw-master-reports");reports.id="mwMasterReports";reports.hidden=true;
    reports.setAttribute("aria-label","Отчёты мастера");
    const payments=el("section","mw-master-payments");payments.id="mwMasterPayments";payments.hidden=true;
    payments.setAttribute("aria-label","Платежи мастера");
    const toolbar=el("section","mw-master-filterbar");toolbar.id="mwMasterFilterbar";
    toolbar.setAttribute("aria-label","Фильтры заказов");
    const search=el("input","mw-filter-search");search.type="search";
    search.placeholder="Поиск по заказам";search.autocomplete="off";
    search.setAttribute("aria-label","Поиск по имени, адресу, телефону, дате");
    search.addEventListener("input",()=>{orderQuery=search.value.trim().toLocaleLowerCase("ru");filterRows()});
    const filters=el("div","mw-status-filters");
    for(const [value,label] of statusOptions){
      const chip=btn(label,"mw-filter-chip",()=>{
        orderStatus=value;syncFilterChips(filters);filterRows();
      });
      chip.dataset.status=value;filters.append(chip);
    }
    toolbar.append(search,filters);
    orders.insertBefore(toolbar,orders.querySelector(".tabs"));
    app.insertBefore(reports,finance);app.insertBefore(payments,finance);
    const nav=el("nav","mw-bottom-nav");nav.id="mwMasterNav";
    nav.setAttribute("aria-label","Разделы мастера");
    for(const [key,label,icon] of [["day","По дням","day"],["orders","Заказы","orders"],
      ["payments","Платежи","payments"],["reports","Отчёты","reports"]]){
      const item=btn("","mw-nav-btn",()=>switchPage(key));
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
    if(shown===0){
      if(!empty){
        empty=el("div","mw-filter-empty","По выбранным фильтрам заказов нет.");
        root.append(empty);
      }
    }else empty?.remove();
  }
  function updateNav(){
    const nav=$("mwMasterNav");if(!nav)return;
    for(const b of nav.querySelectorAll("button")){
      const active=b.dataset.mwPage===page;
      b.classList.toggle("is-active",active);
      b.setAttribute("aria-current",active?"page":"false");
    }
  }
  function switchPage(which,restore=true){
    if(api()?.snapshot()?.role!=="master")return;
    const reports=$("mwMasterReports"),payments=$("mwMasterPayments"),
      orders=$("ordersArea"),finance=$("financePanel");
    if(!reports||!payments||!orders||!finance)return;
    if(restore&&which!==page)scrollPositions.set(page,window.scrollY||0);
    page=which;reports.hidden=which!=="reports";payments.hidden=which!=="payments";
    const filters=$("mwMasterFilterbar");
    if(filters)filters.hidden=which!=="orders";
    const title=$("appTitle");
    if(which==="reports"||which==="payments"){
      orders.hidden=true;finance.hidden=true;
      if(title)title.textContent=which==="reports"?"Отчёты":"Платежи";
      if(which==="reports")renderMaster();else renderMasterPayments();
    }else{
      if(title)title.textContent=which==="day"?"По дням":"Мои заказы";
      // Legacy tab handlers remain for calendar calculations, but tabs are not visible to master.
      if(!finance.hidden)$("masterFinanceBack")?.click();
      orders.hidden=false;finance.hidden=true;
      const tab=orders.querySelector('.tab[data-tab="'+(which==="day"?"calendar":"all")+'"]');
      tab?.click();
      if(which==="orders")filterRows();
    }
    updateNav();
    if(restore)window.scrollTo({top:scrollPositions.get(which)||0,behavior:"instant"});
  }
  function renderMasterPayments(){
    const root=$("mwMasterPayments");if(!root||root.hidden)return;
    root.replaceChildren();
    let m;
    try{m=api()?.masterPayments?.()}catch(error){
      root.append(el("p","mw-error",error.message));return;
    }
    if(!m)return;
    root.append(el("h2","mw-heading","Платежи"));
    if(m.error)root.append(el("p","mw-error","Финансовые данные не обновились: "+m.error));
    const paid=m.orders.filter(o=>o.paid&&o.status!=="Отменён"&&
      Number.isFinite(Number(o.amount))&&Number(o.amount)>=0);
    const sum=rows=>Math.round(rows.reduce((total,o)=>total+(Number(o.amount)||0),0)*100)/100;
    const cash=paid.filter(o=>o.method==="cash"),card=paid.filter(o=>o.method==="card"),
      unknown=paid.filter(o=>!validMethod(o.method));
    const total=sum(paid);
    const confirmed=m.collections.filter(c=>c.confirmedAt).reduce((t,c)=>t+c.companyAmount,0);
    const pending=m.collections.filter(c=>c.submittedAt&&!c.confirmedAt)
      .reduce((t,c)=>t+c.companyAmount,0);
    const waiting=m.collections.filter(c=>!c.submittedAt&&!c.confirmedAt)
      .reduce((t,c)=>t+c.companyAmount,0);
    root.append(box("mw-money-stats",
      box("mw-money-stat",el("small","","Оплачено клиентами"),el("strong","",rub(total))),
      box("mw-money-stat",el("small","","Наличные"),el("strong","",rub(sum(cash)))),
      box("mw-money-stat",el("small","","Карта"),el("strong","",rub(sum(card)))),
      box("mw-money-stat",el("small","","Не указан способ"),el("strong","",rub(sum(unknown))))));
    root.append(el("p","mw-help","Это суммы платежей по твоим заказам, а не баланс банковского счёта или кассы."));
    root.append(box("mw-settlement-summary",
      box("",el("small","","Подтверждено компанией"),el("strong","",rub(confirmed))),
      box("",el("small","","Ожидает подтверждения"),el("strong","",rub(pending))),
      box("",el("small","","Осталось передать"),el("strong","",rub(waiting)))));
    root.append(el("h3","mw-subheading","Оплаты заказов"));
    const tabs=el("div","mw-payment-filters");
    for(const [key,label] of [["all","Все"],["cash","Наличные"],["card","Карта"],["unknown","Без способа"]]){
      const b=btn(label,"mw-filter-chip"+(paymentMethod===key?" active":""),()=>{
        paymentMethod=key;renderMasterPayments();
      });b.setAttribute("aria-pressed",String(paymentMethod===key));tabs.append(b);
    }
    root.append(tabs);
    const list=el("div","mw-owner-history");
    const filtered=paid.filter(o=>paymentMethod==="all"|| (paymentMethod==="unknown"?
      !validMethod(o.method):o.method===paymentMethod));
    filtered.sort((a,b)=>String(b.paidAt||b.date||"").localeCompare(String(a.paidAt||a.date||"")));
    if(!filtered.length)list.append(el("p","mw-notice","Оплат по выбранному фильтру нет."));
    for(const o of filtered){
      const item=btn("","mw-payment-row",()=>window.__rdOpenMasterOrder?.(o.id));
      item.append(box("mw-payment-row-main",
        el("strong","","Заказ · "+(o.name||"Клиент")),
        el("small","",date(o.paidAt||o.date)),
        el("small","",accountName(o.method)+" · "+
          (o.receivedBy==="master"?"Принял мастер":"Получено компанией"))),
        box("mw-payment-row-value",el("strong","mw-plus","+"+rub(o.amount)),
          el("span","","›")));
      list.append(item);
    }
    root.append(list);
    root.append(el("p","mw-help","Платежи клиентов, передача денег компании и выплаты зарплаты учитываются отдельно. Зарплату смотри в «Отчётах»."));
  }
  function renderMaster(){
    const root=$("mwMasterReports");if(!root||root.hidden)return;
    const m=api()?.snapshot();root.replaceChildren();
    if(!m||m.role!=="master")return;
    const back=(label,fn)=>btn("‹ "+label,"mw-back",fn);
    if(step==="menu"){
      // The authenticated master only has one report: no extra staff directory.
      const entry=btn("","mw-entry",()=>{step="detail";salaryTab="accruals";renderMaster()});
      entry.append(el("span","mw-entry-icon","▤"),box("mw-entry-copy",
        el("strong","","Зарплата"),el("small","","Баланс, начисления и выплаты")),el("span","mw-chevron","›"));
      root.append(entry);
      return;
    }
    root.append(back("Отчёты",()=>{step="menu";renderMaster()}));
    root.append(el("h2","mw-heading","Моя зарплата"));
    if(!m.masterId){root.append(el("p","mw-notice","Данные зарплаты для этого мастера не подключены."));return;}
    if(m.error)root.append(el("p","mw-error","Финансовые данные не обновились: "+m.error));
    const payoutDisabled=!!m.error||!m.masterId||m.due<=0;
    const wallet=btn("","mw-wallet-action",()=>openMasterPayout(m));
    wallet.setAttribute("aria-label","Оформить выплату зарплаты");
    wallet.title=payoutDisabled?"Нет доступной суммы к выплате":"Оформить выплату";
    wallet.disabled=payoutDisabled;
    const walletIcon=el("span","mw-wallet-glyph");
    walletIcon.setAttribute("aria-hidden","true");
    walletIcon.innerHTML='<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h15a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a3 3 0 0 1 0-6"/><path d="M16 12h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><path d="M17 14.5h.01"/></svg>';
    wallet.append(walletIcon);
    const payout=btn("Оформить выплату","mw-main-button mw-salary-payout",()=>openMasterPayout(m));
    payout.disabled=payoutDisabled;
    const hero=box("mw-salary-hero",
      box("mw-salary-head",
        box("mw-salary-balance",
          el("span","mw-small","Баланс к выплате"),
          el("strong","mw-big",m.error?"—":rub(m.due))),
        wallet),
      box("mw-numbers",
        box("",el("small","","Начислено"),el("strong","",rub(m.accrued))),
        box("",el("small","","Выплачено"),el("strong","",rub(m.paid)))),
      payout
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
  function openMasterPayout(m){
    if(payDialog||m.error||m.due<=0)return;
    payDialog=true;
    const {sheet,close}=modalBase("Выплата зарплаты",()=>{payDialog=false});
    const amount=el("input","mw-input");amount.type="text";amount.inputMode="decimal";
    amount.value=Number(m.due).toFixed(2).replace(".",",");
    const methods=radioSet("mw-master-pay-method","cash");
    const note=el("textarea","mw-input");note.rows=2;note.maxLength=240;note.value="Выплата зарплаты Раулю";
    const received=el("input");received.type="checkbox";received.className="mw-checkbox";
    const acknowledge=el("label","mw-ack");acknowledge.append(received,el("span","","Подтверждаю, что фактически получил указанную сумму."));
    const error=el("p","mw-error");error.setAttribute("role","alert");
    const save=btn("Сохранить выплату","mw-main-button");
    const cancel=btn("Отмена","mw-minor",()=>closeDialog());
    let busy=false,used=false;
    let requestId;try{requestId=token()}catch(e){error.textContent=e.message;save.disabled=true}
    const closeDialog=()=>{if(busy)return;close()};
    sheet.append(box("mw-modal-balance",el("span","","Доступно к выплате"),el("strong","",rub(m.due))));
    sheet.append(field("Сумма, ₽",amount),field("Способ получения",methods.node),field("Комментарий",note),acknowledge,error);
    sheet.append(box("mw-modal-actions",cancel,save));
    const originalClose=close;
    if(isPreview()){error.textContent="Режим предпросмотра: выплата отключена.";save.disabled=true;}
    save.addEventListener("click",async()=>{
      if(busy||used||!requestId||isPreview())return;
      const value=parseSum(amount.value);
      if(!value||value>m.due||!note.value.trim()||!received.checked){
        error.textContent=!received.checked?"Подтверди фактическое получение денег.":
          !value||value>m.due?"Сумма должна быть больше нуля и не превышать доступный остаток.":"Укажи комментарий.";
        return;
      }
      const method=methods.value();
      if(!window.confirm("Ты действительно получил "+rub(value)+" ("+accountName(method).toLowerCase()+")? Будет создана финансовая запись."))return;
      busy=true;used=true;sheet.dataset.busy="1";save.disabled=true;cancel.disabled=true;amount.disabled=true;note.disabled=true;
      error.textContent="Сохраняю...";
      try{
        const receipt=await api().payout({kind:"raul_payout",amount:value,method,note:note.value.trim(),requestId,masterId:m.masterId});
        busy=false;sheet.dataset.busy="0";payDialog=false;
        renderMaster();
        sheet.replaceChildren(el("h2","","Выплата записана"),el("p","","Получено: "+rub(value)+" · "+accountName(method)),
          el("p","mw-help",receipt.refreshError?"Запись сохранена, но обновление данных не удалось. Не проводи выплату повторно.":"Операция появилась в финансовой истории."),
          btn("Закрыть","mw-main-button",()=>originalClose()));
      }catch(e){
        busy=false;sheet.dataset.busy="0";error.textContent="Ответ не подтверждён: "+(e?.message||"ошибка")+
          ". Проверь историю выплат перед повторной попыткой, чтобы избежать двойного списания.";
        cancel.disabled=false;save.disabled=true;
      }
    });
  }
  function ownerPayments(panel){
    const loading=el("div","mw-owner-payments");panel.append(loading);
    loading.append(el("p","mw-help","Загружаю кассу и выплаты..."));
    api()?.cashbook().then(book=>{if(loading.isConnected)renderOwner(loading,book)}).catch(e=>{
      loading.replaceChildren(el("p","mw-error","Не удалось загрузить платежи: "+e.message));
    });
  }
  function renderOwner(root,book){
    const d=api().ownerSnapshot(),items=[],balance={cash:0,card:0},stat={income:0,expense:0,unknown:0};
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
    for(const c of d.collections)if(c.confirmed_at)
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
    const heading=box("mw-owner-heading",el("h2","","Платежи"),
      btn("Создать ▾","mw-owner-create",()=>{if(isPreview()){window.alert("В предпросмотре изменения отключены.");return}menu.hidden=!menu.hidden}));
    const menu=el("div","mw-create-menu");menu.hidden=true;
    for(const [type,label] of [["income","＋ Создать приход"],["expense","− Создать расход"],["transfer","⇄ Перевод между счетами"]])
      menu.append(btn(label,"mw-menu-action",()=>{menu.hidden=true;openOwnerEntry(type,root)}));
    root.append(heading,menu);
    if(d.error)root.append(el("p","mw-error","Финансовые данные могли устареть: "+d.error));
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
  function openOwnerEntry(kind,root){
    if(isPreview())return;
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
        const newBook=await api().cashbook();
        sheet.dataset.busy="0";close();renderOwner(root,newBook);
      }catch(e){
        busy=false;sheet.dataset.busy="0";
        error.textContent="Запись не подтверждена: "+(e.message||"ошибка связи")+
          ". Проверь историю перед повторной попыткой.";
        cancel.disabled=false;save.disabled=true;
      }
    });
  }
  window.__rdMasterOrdersRefresh=()=>{filterRows()};
  window.__rdMoneyAccess=()=>{
    const isMaster=api()?.snapshot()?.role==="master";
    if(isMaster){
      setupMaster();
      const nav=$("mwMasterNav");if(nav)nav.hidden=false;
      page="orders";step="menu";
      const reports=$("mwMasterReports"),payments=$("mwMasterPayments");
      if(reports)reports.hidden=true;if(payments)payments.hidden=true;
      const filters=$("mwMasterFilterbar");if(filters)filters.hidden=false;
      updateNav();filterRows();
    }else{
      const nav=$("mwMasterNav"),reports=$("mwMasterReports"),
        payments=$("mwMasterPayments");
      if(nav)nav.hidden=true;
      if(reports)reports.hidden=true;
      if(payments)payments.hidden=true;
    }
  };
  window.__rdMoneyUpdated=()=>{
    if(payDialog)return;
    const focus=document.activeElement;
    if(page==="reports"&&$("mwMasterReports")&&!focus?.closest?.("#mwMasterReports"))renderMaster();
    if(page==="payments"&&$("mwMasterPayments")&&!focus?.closest?.("#mwMasterPayments"))renderMasterPayments();
  };
  window.__rdPaymentsRender=ownerPayments;
})();