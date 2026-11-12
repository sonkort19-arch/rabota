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
  const accountName=m=>m==="cash"?"Наличные":m==="card"?"Карта":"Не указан";
  const validMethod=m=>m==="cash"||m==="card";
  const api=()=>window.__rdMoneyUi;
  const token=()=>{if(typeof window.crypto?.randomUUID!=="function")throw Error("Браузер не поддерживает безопасный идентификатор операции");return window.crypto.randomUUID()};
  const isPreview=()=>/^rabota-[a-z0-9]{7,}-sonkort19-6069s-projects\.vercel\.app$/i.test(String(window.location?.hostname||""));
  let page="schedule",step="menu",salaryTab="accruals",payDialog=false,masterReady=false;
  function navIcon(name){
    const span=el("span","mw-icon");
    const shapes={
      day:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
      schedule:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
      reports:'<path d="M4 20V11M10 20V4M16 20v-9M22 20V7M2 21h21"/>'
    };
    span.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+shapes[name]+'</svg>';
    return span;
  }
  function setupMaster(){
    if(masterReady||api()?.snapshot()?.role!=="master")return;
    const app=$("appScreen"),orders=$("ordersArea"),finance=$("financePanel");
    if(!app||!orders||!finance)return;
    const panel=el("section","mw-master-reports");panel.id="mwMasterReports";panel.hidden=true;
    panel.setAttribute("aria-label","Отчёты мастера");
    const nav=el("nav","mw-bottom-nav");nav.id="mwMasterNav";
    nav.setAttribute("aria-label","Главные разделы мастера");
    for(const [key,label,icon] of [["day","По дням","day"],["schedule","Расписание","schedule"],["reports","Отчёты","reports"]]){
      const item=btn("","mw-nav-btn",()=>switchPage(key));
      item.dataset.mwPage=key;item.append(navIcon(icon),el("span","",label));nav.append(item);
    }
    app.insertBefore(panel,finance);
    app.append(nav);masterReady=true;
    updateNav();
  }
  function updateNav(){
    const nav=$("mwMasterNav");if(!nav)return;
    for(const b of nav.querySelectorAll("button")){const active=b.dataset.mwPage===page;b.classList.toggle("is-active",active);b.setAttribute("aria-current",active?"page":"false");}
  }
  function switchPage(which){
    if(api()?.snapshot()?.role!=="master")return;
    const reports=$("mwMasterReports"),orders=$("ordersArea"),finance=$("financePanel");
    if(!reports||!orders||!finance)return;
    page=which;reports.hidden=which!=="reports";
    const title=$("appTitle");
    if(which==="reports"){
      orders.hidden=true;finance.hidden=true;
      if(title)title.textContent="Отчёты";
      renderMaster();
    }else{
      if(title)title.textContent="Мои заказы";
      // Legacy finance state remains unchanged and its back handler restores orders.
      if(!finance.hidden)$("masterFinanceBack")?.click();
      orders.hidden=false;finance.hidden=true;
      const tab=orders.querySelector('.tab[data-tab="'+(which==="day"?"calendar":"all")+'"]');
      tab?.click();
    }
    updateNav();window.scrollTo({top:0,behavior:"instant"});
  }
  function renderMaster(){
    const root=$("mwMasterReports");if(!root||root.hidden)return;
    const m=api()?.snapshot();root.replaceChildren();
    if(!m||m.role!=="master")return;
    const back=(label,fn)=>btn("‹ "+label,"mw-back",fn);
    if(step==="menu"){
      root.append(el("h2","mw-heading","Отчёты"));
      const entry=btn("","mw-entry",()=>{step="people";renderMaster()});
      entry.append(el("span","mw-entry-icon","▤"),box("mw-entry-copy",el("strong","","Зарплата"),el("small","","Начисления и выплаты")),el("span","mw-chevron","›"));
      root.append(entry);
      return;
    }
    if(step==="people"){
      root.append(back("Отчёты",()=>{step="menu";renderMaster()}),el("h2","mw-heading","Зарплата"));
      if(m.masterName.trim().toLowerCase()!=="рауль"){
        root.append(el("p","mw-notice","Зарплатный отчёт сейчас доступен только Раулю."));return;
      }
      const entry=btn("","mw-person",()=>{step="detail";salaryTab="accruals";renderMaster()});
      entry.append(el("span","mw-avatar","Р"),box("mw-person-info",el("strong","","Рауль"),el("small","","Мастер • баланс: "+rub(m.due))),el("span","mw-chevron","›"));
      root.append(entry);return;
    }
    root.append(back("Сотрудники",()=>{step="people";renderMaster()}));
    root.append(el("h2","mw-heading","Зарплата · Рауль"));
    if(m.error)root.append(el("p","mw-error","Финансовые данные не обновились: "+m.error));
    const hero=box("mw-salary-hero",
      el("span","mw-small","Баланс к выплате"),
      el("strong","mw-big",m.error?"—":rub(m.due)),
      box("mw-numbers",
        box("",el("small","","Начислено"),el("strong","",rub(m.accrued))),
        box("",el("small","","Выплачено"),el("strong","",rub(m.paid)))
      )
    );root.append(hero);
    const payout=btn("Оформить выплату","mw-main-button",()=>openMasterPayout(m));
    payout.disabled=!!m.error||!m.masterId||m.due<=0;
    root.append(payout);
    if(m.due<=0)root.append(el("p","mw-help","Доступной суммы к выплате нет. Проверь начисления и уже проведённые выплаты."));
    const tabs=el("div","mw-tabs");
    for(const [key,label] of [["accruals","Начисления"],["payments","Выплаты"]]){
      const b=btn(label,"mw-tab"+(salaryTab===key?" active":""),()=>{salaryTab=key;renderMaster()});
      b.setAttribute("aria-pressed",String(salaryTab===key));tabs.append(b);
    }
    root.append(tabs);
    const list=el("div","mw-history");
    const items=salaryTab==="accruals"
      ?m.orders.map(o=>({at:o.date+"T12:00:00Z",label:"Заказ · "+(o.name||"Клиент"),sub:"Начисление за выполненный и оплаченный заказ",amount:o.amount}))
      :m.payouts.map(o=>({at:o.created_at,label:o.order_id?"Доля по заказу":"Выплата зарплаты",
        sub:(o.note||"")+(o.payment_method?" · "+accountName(o.payment_method):" · способ не указан"),amount:-o.amount}));
    items.sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
    if(!items.length)list.append(el("p","mw-notice","Записей пока нет."));
    for(const item of items){
      list.append(box("mw-history-row",box("mw-history-main",
        el("strong","",item.label),el("small","",date(item.at)),el("small","",item.sub)),
        el("strong",item.amount<0?"mw-minus":"mw-plus",(item.amount<0?"−":"+")+rub(Math.abs(item.amount)))));
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
    const save=btn("Сохранить выплату","mw-main-button",()=>{});
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
      methods=radioSet("mw-owner-account",kind==="income"?"cash":"cash");
      sheet.append(field(kind==="income"?"Куда поступили деньги":"Откуда списать",methods.node));
    }
    sheet.append(field("Комментарий",note));
    const error=el("p","mw-error");error.setAttribute("role","alert");
    const save=btn("Сохранить","mw-main-button",()=>{}),cancel=btn("Отмена","mw-minor",close);
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
  window.__rdOpenMasterReports=target=>{setupMaster();step=target==="detail"?"detail":"menu";switchPage("reports")};
  window.__rdMoneyAccess=()=>{
    const isMaster=api()?.snapshot()?.role==="master";
    if(isMaster){
      setupMaster();
      const nav=$("mwMasterNav");if(nav)nav.hidden=false;
      page="schedule";step="menu";
      const reports=$("mwMasterReports");if(reports)reports.hidden=true;
      updateNav();
    }else{
      const nav=$("mwMasterNav"),reports=$("mwMasterReports");
      if(nav)nav.hidden=true;if(reports)reports.hidden=true;
    }
  };
  window.__rdMoneyUpdated=()=>{
    if(page!=="reports"||!$("mwMasterReports")||payDialog)return;
    const focus=document.activeElement;
    if(focus?.closest?.("#mwMasterReports"))return; // don't interrupt a tap or focused control
    renderMaster();
  };
  window.__rdPaymentsRender=ownerPayments;
})();