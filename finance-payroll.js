/* Работа — оформление зарплаты владельца; расчёты передаются из действующего renderFinance. */
"use strict";
(()=>{
 const ui={tab:"salary",person:null,view:"accruals",month:"all"};
 const $=id=>document.getElementById(id);
 const el=(tag,cls="",txt)=>{const n=document.createElement(tag);n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n};
 const div=(cls,...children)=>{const n=el("div",cls);n.append(...children);return n};
 const button=(label,cls,fn)=>{const n=el("button",cls,label);n.type="button";n.addEventListener("click",fn);return n};
 const money=n=>new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0)+" ₽";
 const localDate=s=>{if(!s)return "—";const d=new Date(String(s).length===10?s+"T12:00:00Z":s);
   return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("ru-RU",{timeZone:String(s).length===10?"UTC":"Europe/Moscow",day:"2-digit",month:"2-digit",year:"numeric"}).format(d):String(s)};
 const who=(m,key)=>key==="raul"?{key,name:"Рауль",role:"Мастер",accrued:m.raulAccrued,paid:m.raulPaid,due:m.raulDue,kind:"raul_payout"}:
   {key,name:"Тимур",role:"Помощник",accrued:m.timurAccrued,paid:m.timurPaid,due:m.timurDue,kind:"timur_payout"};
 const metric=(label,sum,hint,kind)=>div("fp-metric fp-"+kind,el("small","",label),el("strong","",money(sum)),el("span","",hint));
 const isPreview=()=>/^rabota-[a-z0-9]{7,}-sonkort19-6069s-projects\.vercel\.app$/i.test(String(window.location?.hostname||""));
 function payout(m,p){
   if(!Number.isFinite(p.due)||p.due<=0){window.alert("Положительного остатка к выплате нет.");return}
   const backdrop=el("div","fp-backdrop"),modal=el("section","fp-modal");
   modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.setAttribute("aria-labelledby","fp-modal-title");
   const title=el("h2","","Выплата — "+p.name);title.id="fp-modal-title";
   const close=()=>{document.removeEventListener("keydown",onEscape);backdrop.remove()};
   const onEscape=e=>{if(e.key==="Escape")close()};
   document.addEventListener("keydown",onEscape);
   backdrop.addEventListener("click",e=>{if(e.target===backdrop)close()});
   modal.append(div("fp-modal-heading",title,button("×","fp-close",close)));
   modal.append(div("fp-modal-balance",el("span","","Текущий баланс"),el("strong","",money(p.due))));
   const sumLabel=el("label","fp-label","Сумма выплаты, ₽"),sum=el("input","fp-input");
   sum.type="number";sum.step="0.01";sum.min="0.01";sum.max=String(p.due);sum.value=Number(p.due).toFixed(2);sumLabel.append(sum);
   const noteLabel=el("label","fp-label","Комментарий"),note=el("textarea","fp-input");
   note.rows=2;note.maxLength=240;note.placeholder="Например: зарплата за неделю";noteLabel.append(note);
   const remainder=el("strong",""),error=el("p","fp-error");error.setAttribute("role","alert");
   const confirmButton=button(isPreview()?"Проверить расчёт":"Подтвердить выплату","fp-primary",()=>{});
   const valid=()=>{
     const raw=sum.value.trim(),cents=Math.round(Number(raw)*100),limit=Math.round(Number(p.due)*100);
     const allowed=!!raw&&Number.isSafeInteger(cents)&&cents>0&&cents<=limit&&!!note.value.trim();
     remainder.textContent=allowed?money((limit-cents)/100):"—";
     error.textContent=!raw?"Укажите сумму":!Number.isSafeInteger(cents)||cents<=0?"Некорректная сумма":cents>limit?"Сумма больше остатка":!note.value.trim()?"Добавьте комментарий":"";
     confirmButton.disabled=!allowed;return allowed
   };
   sum.addEventListener("input",valid);note.addEventListener("input",valid);
   confirmButton.addEventListener("click",()=>{
     if(!valid())return;
     if(isPreview()){error.textContent="Предпросмотр: выплата не записана в Supabase.";return}
     const value=(Math.round(Number(sum.value)*100)/100);
     if(!window.confirm("Провести РЕАЛЬНУЮ выплату "+p.name+" на "+money(value)+"?"))return;
     const form=$("financeForm"),kind=$("financeType"),amount=$("financeAmount"),memo=$("financeNote");
     if(!form||!kind||!amount||!memo){error.textContent="Форма финансов недоступна";return}
     kind.value=p.kind;amount.value=value.toFixed(2);memo.value=note.value.trim();
     close();form.requestSubmit();
   });
   modal.append(sumLabel,noteLabel,div("fp-after",el("span","","Останется выплатить"),remainder),error);
   if(isPreview())modal.append(el("p","fp-hint","Тестовая версия: кнопка показывает результат, но реальные деньги не списывает."));
   modal.append(div("fp-actions",button("Отмена","fp-secondary",close),confirmButton));
   backdrop.append(modal);document.body.append(backdrop);sum.focus();valid();
 }
 function employeeList(m,redraw){
   const section=el("section","fp-section");
   section.append(div("fp-title-row",el("h2","","Сотрудники"),el("small","","Баланс за всё время")));
   const list=el("div","fp-people");
   list.append(div("fp-people-head",...["Сотрудник","Начислено","Выдано","Остаток",""].map(x=>el("span","",x))));
   for(const key of ["raul","timur"]){
     const p=who(m,key),open=button("","fp-person-button",()=>{ui.person=key;ui.view="accruals";ui.month="all";redraw()});
     open.append(el("span","fp-avatar",p.name[0]),div("fp-name",el("strong","",p.name),el("small","",p.role)));
     open.setAttribute("aria-label","Открыть историю: "+p.name);
     list.append(div("fp-person-row",open,el("span","fp-col-accrued",money(p.accrued)),
       el("span","fp-col-paid",money(p.paid)),el("strong","fp-due",money(p.due)),
       button("Выплата","fp-pay",()=>payout(m,p))));
   }
   section.append(list,el("p","fp-hint","Начисления считаются только по выполненным и оплаченным заказам. Выплаты берутся из финансовой истории."));
   return section;
 }
 function employeeDetail(m,redraw){
   const p=who(m,ui.person),wrap=el("section","fp-person-detail");
   const possessive=p.key==="raul"?"Рауля":"Тимура";
   wrap.append(div("fp-person-heading",
     button("← К сотрудникам","fp-link",()=>{ui.person=null;redraw()}),
     el("span","fp-person-role",p.role)));
   const hero=el("section","fp-balance-hero");
   hero.setAttribute("aria-label","Баланс сотрудника "+p.name);
   const headline=div("fp-balance-headline",
     el("span","fp-balance-eyebrow","Зарплата · "+p.name),
     el("h2","fp-balance-label","Баланс "+possessive),
     el("strong","fp-balance-value",money(p.due)),
     el("p","fp-balance-description",p.due>0?"Осталось выплатить сотруднику":"Задолженности по зарплате нет"));
   const payoutButton=button("Выплатить","fp-balance-payout",()=>payout(m,p));
   payoutButton.disabled=!Number.isFinite(p.due)||p.due<=0;
   payoutButton.setAttribute("aria-label","Выплатить зарплату: "+p.name);
   hero.append(headline,payoutButton);
   wrap.append(hero);
   wrap.append(div("fp-person-summary",
     div("fp-person-summary-item",
       el("span","","Начислено за всё время"),
       el("strong","",money(p.accrued))),
     div("fp-person-summary-item",
       el("span","","Уже выплачено"),
       el("strong","",money(p.paid)))));
   const tabs=el("div","fp-subtabs");
   for(const [key,label] of [["accruals","Начисления"],["payments","Выплаты"]]){
     const b=button(label,"fp-subtab"+(ui.view===key?" active":""),()=>{ui.view=key;ui.month="all";redraw()});
     b.setAttribute("aria-pressed",String(ui.view===key));tabs.append(b)
   }
   wrap.append(tabs);
   const items=ui.view==="accruals"?m.orders.map(o=>({date:o.date,title:o.name||"Заказ",info:"Заказ на "+money(o.price),value:ui.person==="raul"?o.raul:o.timur}))
     :m.operations.filter(o=>!o.voided_at&&o.kind===p.kind).map(o=>({date:o.created_at,title:o.note||"Выплата",info:o.order_id?"Автоматическое распределение":"Ручная выплата",value:-Number(o.amount)}));
   const months=[...new Set(items.map(i=>String(i.date||"").slice(0,7)).filter(x=>/^\d{4}-\d{2}$/.test(x)))].sort().reverse();
   const period=el("select","fp-period");period.setAttribute("aria-label","Период");
   for(const [v,name] of [["all","Все периоды"],...months.map(v=>[v,new Intl.DateTimeFormat("ru-RU",{year:"numeric",month:"long",timeZone:"UTC"}).format(new Date(v+"-01T12:00:00Z"))])]){
     const o=el("option","",name);o.value=v;period.append(o)
   }
   period.value=ui.month;period.addEventListener("change",()=>{ui.month=period.value;redraw()});
   wrap.append(div("fp-title-row",el("h3","",ui.view==="accruals"?"Начисления по заказам":"История выплат"),period));
   const selected=items.filter(o=>ui.month==="all"||String(o.date||"").startsWith(ui.month)).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
   const total=selected.reduce((s,i)=>s+Number(i.value||0),0);
   wrap.append(div("fp-total",el("span","","Сумма за выбранный период"),el("strong","",money(total))));
   if(!selected.length)wrap.append(el("p","fp-hint","Записей за выбранный период нет."));
   const ledger=el("div","fp-ledger");
   for(const item of selected){
     ledger.append(div("fp-ledger-row",el("span","fp-date",localDate(item.date)),
       div("fp-ledger-description",el("strong","",item.title),el("small","",item.info)),
       el("strong",item.value<0?"fp-negative":"fp-positive",(item.value<0?"−":"+")+money(Math.abs(item.value)))));
   }
   wrap.append(ledger);
   if(ui.view==="accruals")wrap.append(el("p","fp-hint","Показана дата визита, а не дата оплаты. Начисления вычисляются по текущим данным заказов."));
   return wrap;
 }
 function overview(m,redraw){
   const wrap=el("div","fp-screen");
   // Show company-wide payroll totals on the employee list only. When drilling
   // into one employee, their balance must be the first, primary number.
   if(ui.person){wrap.append(employeeDetail(m,redraw));return wrap;}
   wrap.append(div("fp-metrics",
     metric("К выплате сотрудникам",m.raulDue+m.timurDue,"Рауль и Тимур","blue"),
     metric("Всего начислено",m.raulAccrued+m.timurAccrued,"По выполненным и оплаченным заказам","green"),
     metric("Всего выдано",m.raulPaid+m.timurPaid,"По истории операций","purple")));
   wrap.append(employeeList(m,redraw));return wrap
 }
 function cash(m){
   const wrap=el("div","fp-screen");
   wrap.append(div("fp-metrics",
     metric("Доля компании",m.companyEarned,"До прочих расходов","blue"),
     metric("Осталось передать",m.masterHeld,"Деньги у мастера","orange"),
     metric("Ожидает подтверждения",m.waitingOwner,"Передача отмечена","green")));
   wrap.append(el("p","fp-hint","Это расчётная доля компании, не наличные в кассе. Ниже сохранён полный действующий финансовый отчёт и подтверждение поступлений."));
   return wrap
 }
 window.__rdFinanceEnhance=m=>{
   if(!m?.isOwner)return;
   const root=$("financeContent"),history=$("financeHistory"),entry=$("financeEntry");
   if(!root||!history||!entry)return;
   const legacy=el("div","fp-original");
   while(root.firstChild)legacy.append(root.firstChild);
   // Preview currently shares Production Supabase. Keep all old accounting controls
   // visible, but disable their mutations in Preview. Production stays unchanged.
   if(isPreview()){
     for(const section of [legacy,history]){
       for(const control of section.querySelectorAll?.("button")||[]){
         control.disabled=true;
         control.title="Только просмотр: финансовые изменения в Preview отключены";
       }
     }
     const save=$("financeSaveBtn"),form=$("financeForm");
     if(save)save.disabled=true;
     if(form&&!form.dataset?.financePreviewLock){
       form.dataset.financePreviewLock="1";
       form.addEventListener("submit",event=>{
         event.preventDefault();
         event.stopImmediatePropagation();
       },true);
     }
   }
   const tabs=el("div","fp-tabs"),panel=el("div","fp-panel");
   root.append(tabs,panel,legacy);
   const historyTitle=$("financePanel")?.querySelector(":scope > h2.finance-title");
   // Build navigation only once per financial snapshot. Replacing the clicked
   // button on every switch loses keyboard focus and can cause visual flicker.
   const redraw=()=>{
     panel.replaceChildren();
     for(const b of tabs.children){
       const active=b.getAttribute("data-finance-tab")===ui.tab;
       b.className="fp-tab"+(active?" active":"");
       b.setAttribute("aria-pressed",String(active));
     }
     legacy.hidden=ui.tab!=="cash";history.hidden=ui.tab!=="operations";entry.hidden=ui.tab!=="operations";
     if(historyTitle)historyTitle.hidden=ui.tab!=="operations";
     if(ui.tab==="salary")panel.append(overview(m,redraw));
     else if(ui.tab==="cash")panel.append(cash(m));
     else panel.append(el("p","fp-hint","Здесь сохранены прежние формы ручных операций, история и возможность отмены записей. В этой тестовой версии запись и отмена финансовых операций отключены. Реальные данные не изменяются."));
   };
   for(const [value,label] of [["salary","Зарплата"],["cash","Касса компании"],["operations","Операции"]]){
     const b=button(label,"fp-tab",()=>{
       if(ui.tab===value)return;
       ui.tab=value;ui.person=null;ui.month="all";
       redraw();
     });
     b.setAttribute("data-finance-tab",value);
     tabs.append(b);
   }
   redraw();
 };
})();