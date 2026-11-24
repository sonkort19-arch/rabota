/* Работа — зарплата владельца теперь отображается в «Отчётах», данные из финансовой модели. */
"use strict";
(()=>{
 const ui={tab:"payments",person:null,view:"accruals",month:"all"};
 let financeView=null,resetPayoutDialog=null,localIntent=null;
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
 const isPreview=()=>/^rabota-(?:git-[a-z0-9-]+-|[a-z0-9]{7,}-)sonkort19-6069s-projects\.vercel\.app$/i.test(String(window.location?.hostname||""));
 const isReady=m=>m?.ready ?? Boolean(m&&!m.loading&&!m.error);
 const isStale=m=>Boolean(m?.stale||m?.refreshError);
 const canPayout=m=>isReady(m)&&!isStale(m);
 const payroll=()=>window.__rdMoneyUi?.payroll?.();
 const centsFromText=text=>{
   const raw=text.trim().replace(/[\s\u00a0\u202f]/g,"").replace(",",".");
   if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
   const cents=Math.round(Number(raw)*100);
   return Number.isSafeInteger(cents)?cents:null;
 };
 function payoutDialog(onClose){
   const backdrop=el("div","fp-backdrop"),modal=el("section","fp-modal");
   modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
   modal.setAttribute("aria-labelledby","fp-modal-title");modal.tabIndex=-1;
   const dialog={modal,busy:false,closed:false};
   const previous=document.activeElement;
   const viewport=window.visualViewport;
   const syncViewport=()=>{
     if(dialog.closed)return;
     backdrop.style.top=(viewport?.offsetTop||0)+"px";
     backdrop.style.height=(viewport?.height||window.innerHeight)+"px";
     backdrop.style.bottom="auto";
   };
   const close=force=>{
     if((dialog.busy&&force!==true)||dialog.closed)return;
     dialog.closed=true;
     if(modal.contains(document.activeElement))document.activeElement.blur?.();
     document.removeEventListener("keydown",onEscape);
     viewport?.removeEventListener("resize",syncViewport);
     viewport?.removeEventListener("scroll",syncViewport);
     backdrop.remove();
     if(force!==true&&previous?.isConnected)previous.focus({preventScroll:true});
     if(resetPayoutDialog===reset)resetPayoutDialog=null;
     if(force!==true)onClose?.();
   };
   const reset=()=>close(true);
   resetPayoutDialog=reset;
   const onEscape=event=>{if(event.key==="Escape")close()};
   document.addEventListener("keydown",onEscape);
   viewport?.addEventListener("resize",syncViewport);
   viewport?.addEventListener("scroll",syncViewport);
   backdrop.addEventListener("click",event=>{if(event.target===backdrop)close()});
   backdrop.append(modal);document.body.append(backdrop);
   syncViewport();
   dialog.close=close;
   return dialog;
 }
 function intentKey(snapshot){
   if(!snapshot?.actorId||!snapshot.employeeId)return "";
   return "rabota-payroll-v3."+encodeURIComponent(snapshot.actorId)+"."+encodeURIComponent(snapshot.employeeId);
 }
 function savedIntent(snapshot){
   const key=intentKey(snapshot);
   if(!key)return null;
   if(localIntent?.key===key)return localIntent.value;
   try{
     const value=JSON.parse(window.sessionStorage.getItem(key));
     if(value?.employeeId===snapshot.employeeId&&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.requestId)&&
        typeof value.amount==="number"&&Number.isSafeInteger(Math.round(value.amount*100))&&value.amount>0&&
        ["cash","card"].includes(value.method)&&typeof value.note==="string")return value;
   }catch{}
   return null;
 }
 function setIntent(snapshot,value){
   const key=intentKey(snapshot);
   if(!key)return;
   localIntent={key,value};
   try {
     if(value)window.sessionStorage.setItem(key,JSON.stringify(value));
     else window.sessionStorage.removeItem(key);
   }catch{}
 }
 function clearIntent(snapshot,intent){
   if(savedIntent(snapshot)?.requestId===intent.requestId)setIntent(snapshot,null);
 }
 function allowV3Payout(snapshot){
   return snapshot?.active&&snapshot.canPay!==false&&Boolean(intentKey(snapshot));
 }
 function canStartV3Payout(snapshot){
   return allowV3Payout(snapshot)&&canPayout(snapshot)&&snapshot.due>0;
 }
 function payoutV3(snapshot,full,onClose){
   const initial=savedIntent(snapshot);
   if(!allowV3Payout(snapshot)||!initial&&(!canPayout(snapshot)||!(snapshot.due>0)))return;
   const dialog=payoutDialog(onClose),{modal,close}=dialog;
   const name=snapshot.employeeName||"Рауль";
   const title=el("h2","","Выплата — "+name);title.id="fp-modal-title";
   const cancel=button("Отмена","fp-secondary",close);
   modal.append(div("fp-modal-heading",title,button("×","fp-close",close)));
   const balance=el("strong","",money(snapshot.due));
   modal.append(div("fp-modal-balance",el("span","","Доступно к выплате"),balance));
   const amountLabel=el("label","fp-label","Сумма выплаты, ₽");
   const amount=el("input","fp-input");amount.type="text";amount.inputMode="decimal";amount.autocomplete="off";
   amount.setAttribute("aria-label","Сумма выплаты в рублях");
   amount.value=initial?initial.amount.toFixed(2).replace(".",","):full?Number(snapshot.due).toFixed(2).replace(".",","):"";
   amountLabel.append(amount);
   const methodLabel=el("label","fp-label","Способ выплаты");
   const method=el("select","fp-input");
   for(const [value,label] of [["cash","Наличные"],["card","Карта"]]){
     const option=el("option","",label);option.value=value;method.append(option);
   }
   method.value=initial?.method??"cash";methodLabel.append(method);
   const noteLabel=el("label","fp-label","Комментарий");
   const note=el("textarea","fp-input");note.rows=1;note.maxLength=240;
   note.value=initial?.note??"Выплата зарплаты";noteLabel.append(note);
   const error=el("p","fp-error");error.setAttribute("role","status");
   const remainder=el("strong");
   let intent=initial,limit=Math.round(snapshot.due*100);
   const confirmButton=button("Подтвердить выплату","fp-primary",submit);
   function syncInputs(){
     amount.disabled=note.disabled=method.disabled=Boolean(intent)||dialog.busy;
     confirmButton.textContent=intent?"Повторить отправку":"Подтвердить выплату";
     cancel.disabled=dialog.busy;
     cancel.textContent=intent?"Закрыть":"Отмена";
     validate();
   }
   function validate(){
     const cents=centsFromText(amount.value),valueValid=cents!==null&&cents>0&&cents<=limit;
     remainder.textContent=valueValid&&!intent?money((limit-cents)/100):"—";
     confirmButton.disabled=dialog.busy||!intent&&(!valueValid||!note.value.trim());
     if(intent)return;
     error.textContent=cents!==null&&cents>limit?"Сумма больше остатка":
       !valueValid&&amount.value.trim()?"Укажите корректную сумму":
       valueValid&&!note.value.trim()?"Добавьте комментарий":"";
   }
   async function submit(){
     if(dialog.busy||confirmButton.disabled)return;
     const current=payroll();
     if(!allowV3Payout(current)||intentKey(current)!==intentKey(snapshot))return;
     if(isPreview()){error.textContent="Предпросмотр: выплата не записана в Supabase.";return;}
     if(!intent){
       if(!canPayout(current)){error.textContent="Обновите данные зарплаты перед выплатой.";return;}
       const cents=centsFromText(amount.value),latest=Math.round(current.due*100);
       if(latest!==limit){
         limit=latest;balance.textContent=money(current.due);
         if(full&&latest>0)amount.value=Number(current.due).toFixed(2).replace(".",",");
         validate();
         error.textContent="Остаток изменился. Проверьте сумму перед подтверждением.";
         return;
       }
       if(cents===null||cents<=0||cents>limit)return;
       if(typeof window.__rdMoneyUi?.payrollPayout!=="function")return;
       if(typeof window.crypto?.randomUUID!=="function"){
         error.textContent="Не удалось создать безопасный номер выплаты.";
         return;
       }
       intent={employeeId:current.employeeId,amount:cents/100,method:method.value,note:note.value.trim(),
         requestId:window.crypto.randomUUID()};
       setIntent(current,intent);
     }
     dialog.busy=true;syncInputs();
     confirmButton.textContent="Сохраняем…";
     error.textContent="";
     try{
       const result=await window.__rdMoneyUi.payrollPayout(intent);
       const receipt=result?.receipt??result;
       if(!receipt?.id||!Number.isFinite(Number(receipt.due)))throw Error("Нет подтверждения финансовой базы.");
       clearIntent(snapshot,intent);
       if(dialog.closed)return;
       dialog.busy=false;
       const heading=el("h2","","Выплата проведена");heading.id="fp-modal-title";
       const notice=div("fp-success",el("strong","fp-success-amount",money(receipt.amount)),
         el("span","",name+" · "+(intent.method==="cash"?"наличные":"карта")));
       const updated=div("fp-modal-balance",
         el("span","",result.refreshError?"Остаток по квитанции":"Осталось выплатить"),
         el("strong","",money(receipt.due)));
       modal.replaceChildren(div("fp-modal-heading",heading,button("×","fp-close",close)),notice,updated);
       if(result.refreshError)modal.append(el("p","fp-hint","Выплата записана. Обновите отчёт, чтобы сверить текущий остаток."));
       modal.append(div("fp-actions",button("Закрыть","fp-primary",close)));
       modal.scrollTop=0;
     }catch(failure){
       if(dialog.closed)return;
       dialog.busy=false;
       if(failure?.code==="23514"){
         clearIntent(snapshot,intent);intent=null;syncInputs();
         error.textContent=failure.message||"База отклонила выплату. Обновите остаток и проверьте сумму.";
         void window.__rdMoneyUi.reloadPayroll?.();
       }else{
         syncInputs();
         error.textContent="Подтверждение не получено. Повторная отправка проверит тот же запрос.";
       }
     }
   }
   amount.addEventListener("input",validate);note.addEventListener("input",validate);
   const done=button("Готово","fp-done",()=>{
     document.activeElement?.blur?.();
     confirmButton.focus({preventScroll:true});
   });
   modal.append(amountLabel,methodLabel,noteLabel,div("fp-keyboard-actions",done),
     div("fp-after",el("span","","Остаток после выплаты"),remainder),error,
     div("fp-actions",cancel,confirmButton));
   syncInputs();
   if(intent)error.textContent="Ожидается подтверждение выплаты. Можно повторить тот же запрос.";
   modal.focus({preventScroll:true});
 }
 function payout(m,p){
   if(!canPayout(m))return;
   if(!Number.isFinite(p.due)||p.due<=0){window.alert("Положительного остатка к выплате нет.");return}
   const dialog=payoutDialog(),{modal,close}=dialog;
   const title=el("h2","","Выплата — "+p.name);title.id="fp-modal-title";
   modal.append(div("fp-modal-heading",title,button("×","fp-close",close)));
   modal.append(div("fp-modal-balance",el("span","","Текущий баланс"),el("strong","",money(p.due))));
   const sumLabel=el("label","fp-label","Сумма выплаты, ₽");
   const sum=el("input","fp-input");
   sum.type="text";sum.inputMode="decimal";sum.autocomplete="off";
   sum.setAttribute("aria-label","Сумма выплаты в рублях");
   sum.value=Number(p.due).toFixed(2).replace(".",",");
   sumLabel.append(sum);
   const methodLabel=el("label","fp-label","Способ выплаты");
   const method=el("select","fp-input");
   for(const [value,label] of [["cash","Наличные"],["card","Карта"]]){
     const option=el("option","",label);option.value=value;method.append(option);
   }
   methodLabel.append(method);
   const noteLabel=el("label","fp-label","Комментарий");
   const note=el("textarea","fp-input");
   note.rows=2;note.maxLength=240;
   note.value="Выплата зарплаты "+(p.key==="raul"?"Раулю":"Тимуру");
   note.placeholder="Например: зарплата за неделю";noteLabel.append(note);
   const doneEditing=button("Готово","fp-done",()=>{
     document.activeElement?.blur?.();
     modal.scrollTo?.({top:modal.scrollHeight,behavior:"smooth"});
   });
   const remainder=el("strong",""),error=el("p","fp-error");
   error.setAttribute("role","alert");
   const confirmButton=button(isPreview()?"Проверить расчёт":"Подтвердить выплату","fp-primary",()=>{});
   const cancelButton=button("Отмена","fp-secondary",close);
   const valid=()=>{
     const cents=centsFromText(sum.value),limit=Math.round(Number(p.due)*100);
     const validAmount=cents!==null&&cents>0&&cents<=limit;
     remainder.textContent=validAmount?money((limit-cents)/100):"—";
     const message=!sum.value.trim()?"Укажите сумму":
       cents===null||cents<=0?"Некорректная сумма":
       cents>limit?"Сумма больше остатка":
       !note.value.trim()?"Добавьте комментарий":"";
     error.textContent=message;
     confirmButton.disabled=dialog.busy||!!message;
     return !message;
   };
   sum.addEventListener("input",valid);note.addEventListener("input",valid);
   confirmButton.addEventListener("click",async()=>{
     if(dialog.busy||!valid())return;
     if(isPreview()){error.textContent="Предпросмотр: выплата не записана в Supabase.";return}
     const latest=window.__rdOwnerPayrollSnapshot?.();
     if(latest&&!canPayout(latest)){
       error.textContent="Обновите данные зарплаты перед выплатой.";
       return;
     }
     const cents=centsFromText(sum.value),value=cents/100;
     if(!window.confirm("Провести РЕАЛЬНУЮ выплату "+p.name+" на "+money(value)+"?"))return;
     if(typeof window.__rdRecordPayrollPayout!=="function"){
       error.textContent="Связь с финансовым модулем недоступна. Обновите страницу.";
       return;
     }
     dialog.busy=true;confirmButton.disabled=true;cancelButton.disabled=true;
     sum.disabled=true;note.disabled=true;method.disabled=true;doneEditing.disabled=true;
     document.activeElement?.blur?.();
     error.classList.add("fp-progress");
     error.textContent="Сохраняю выплату в финансовой истории...";
     try{
       const result=await window.__rdRecordPayrollPayout({
         kind:p.kind,amount:value,method:method.value,note:note.value.trim()
       });
       if(dialog.closed)return;
       // The RPC has returned success. Show a receipt, never submit twice.
       dialog.busy=false;
       const updated=Number.isFinite(result.updatedDue)?result.updatedDue:
         Math.max(0,Math.round((p.due-value)*100)/100);
       const receiptTitle=el("h2","","Выплата проведена");receiptTitle.id="fp-modal-title";
       const header=div("fp-modal-heading",receiptTitle,button("×","fp-close",close));
       const receipt=div("fp-success",
         el("strong","fp-success-amount",money(value)),
         el("span","","Выплата — "+p.name+" · "+(method.value==="cash"?"наличные":"карта")),
         el("p","","Запись подтверждена финансовой базой."));
       const balance=div("fp-modal-balance",
         el("span","",result.refreshError?"Расчётный остаток":"Осталось выплатить"),
         el("strong","",money(updated)));
       const actions=div("fp-actions",button("Закрыть","fp-primary",close));
       modal.replaceChildren(header,receipt,balance);
       if(result.refreshError)modal.append(el("p","fp-hint",
         "Выплата сохранена, но обновить финансовый экран не удалось. Откройте финансы повторно; не проводите эту выплату ещё раз."));
       modal.append(actions);
       modal.scrollTop=0;
     }catch(failure){
       if(dialog.closed)return;
       // An interrupted network response may be ambiguous: block repeat submission.
       dialog.busy=false;error.classList.remove("fp-progress");
       error.textContent="Не удалось подтвердить запись: "+(failure?.message||"ошибка связи")+
         ". Проверьте финансовую историю перед новой попыткой, чтобы исключить двойную выплату.";
       cancelButton.disabled=false;doneEditing.disabled=false;
       confirmButton.disabled=true;sum.disabled=true;note.disabled=true;
     }
   });
   modal.append(sumLabel,methodLabel,noteLabel,div("fp-keyboard-actions",doneEditing),
     div("fp-after",el("span","","Останется выплатить"),remainder),error);
   if(isPreview())modal.append(el("p","fp-hint",
     "Тестовая версия: кнопка показывает результат, но реальные деньги не списывает."));
   modal.append(div("fp-actions",cancelButton,confirmButton));
   // Focus the dialog, not the amount field: do not force the iPhone keyboard open.
   modal.focus({preventScroll:true});
   valid();
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
     const pay=button("Выплата","fp-pay",()=>payout(m,p));pay.disabled=!canPayout(m);
     list.append(div("fp-person-row",open,el("span","fp-col-accrued",money(p.accrued)),
       el("span","fp-col-paid",money(p.paid)),el("strong","fp-due",money(p.due)),
       pay));
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
   payoutButton.disabled=!canPayout(m)||!Number.isFinite(p.due)||p.due<=0;
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
     :m.operations.filter(o=>!o.voided_at&&o.kind===p.kind).map(o=>({date:o.created_at,title:o.note||"Выплата",info:(o.order_id?"Автоматическое распределение":"Ручная выплата")+(o.payment_method?" · "+(o.payment_method==="cash"?"Наличные":"Карта"):" · способ не указан"),value:-Number(o.amount)}));
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
 const historyMonth=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit"});
 const monthLabel=new Intl.DateTimeFormat("ru-RU",{year:"numeric",month:"long",timeZone:"UTC"});
 function v3Payroll(m,owner,state,redraw){
   const wrap=el("section","fp-screen fp-v3-payroll");
   const name=m.employeeName||"Рауль";
   const hero=el("section","fp-balance-hero fp-v3-balance");
   hero.append(div("fp-balance-headline",
     el("h2","fp-balance-label",owner?name:"Моя зарплата"),
     el("span","fp-balance-eyebrow",owner?"Осталось выплатить":"Осталось получить"),
     el("strong","fp-balance-value",money(m.due))));
   if(owner&&m.employeeId){
     const pending=savedIntent(m);
     const actions=el("div","fp-v3-actions");
     if(pending){
       const resume=button("Продолжить выплату","fp-balance-payout",()=>payoutV3(payroll(),false,redraw));
       resume.disabled=!allowV3Payout(m);actions.append(resume);
     }else{
       const full=button("Выплатить всё","fp-balance-payout",()=>payoutV3(payroll(),true,redraw));
       const partial=button("Частичная выплата","secondary fp-v3-partial",()=>payoutV3(payroll(),false,redraw));
       full.disabled=partial.disabled=!canStartV3Payout(m);
       actions.append(full,partial);
     }
     hero.append(actions);
   }
   wrap.append(hero,div("fp-person-summary",
     div("fp-person-summary-item",el("span","","Начислено"),el("strong","",money(m.earned))),
     div("fp-person-summary-item",el("span","","Выплачено"),el("strong","",money(m.paid)))));
   const tabs=el("div","fp-subtabs");
   const views=[["accruals","Начисления"],["payments","Выплаты"]];
   if(m.refunds?.length)views.push(["refunds","Возвраты"]);
   else if(state.view==="refunds")state.view="accruals";
   for(const [key,label] of views){
     const active=state.view===key;
     const tab=button(label,"fp-subtab"+(active?" active":""),()=>{
       if(state.view===key)return;
       state.view=key;state.month="all";redraw();
     });
     tab.setAttribute("aria-pressed",String(active));tabs.append(tab);
   }
   wrap.append(tabs);
   const accruals=state.view==="accruals",refunds=state.view==="refunds";
   const orderTitle=item=>[item.reference,item.title].filter(Boolean).join(" · ")||"Заказ";
   const items=accruals?(m.accruals??[]).map(item=>({
     stamp:item.earnedAt,title:orderTitle(item),
     detail:"Оплачено клиентом "+money(item.actualPaid),amount:item.earned
   })):refunds?m.refunds.map(item=>({
     stamp:item.occurredAt,title:orderTitle(item),
     detail:"Возвращено клиенту "+money(item.amount)+(item.earnedAt?" · Начисление от "+localDate(item.earnedAt):""),
     amount:item.earnedReversed
   })):(m.payouts??[]).map(item=>{
     const method=item.method==="cash"?"Наличные":item.method==="card"?"Карта":"";
     const details=[item.kind==="legacy_on_behalf"?"Учтено по исторической сверке":"",method].filter(Boolean);
     return {stamp:item.occurredAt,title:item.note||"Выплата зарплаты",
       detail:details.join(" · ")||"Способ не указан",amount:item.amount};
   });
   const rows=items.map(item=>{
     const time=new Date(item.stamp??"");
     return {...item,month:Number.isFinite(+time)?historyMonth.format(time):""};
   });
   const months=[...new Set(rows.map(row=>row.month).filter(Boolean))].sort().reverse();
   if(state.month!=="all"&&!months.includes(state.month))state.month="all";
   const period=el("select","fp-period");period.setAttribute("aria-label","Период");
   for(const value of ["all",...months]){
     const label=value==="all"?"Все периоды":monthLabel.format(new Date(value+"-01T12:00:00Z"));
     const option=el("option","",label);option.value=value;period.append(option);
   }
   period.value=state.month;
   period.addEventListener("change",()=>{state.month=period.value;redraw();});
   const heading=accruals?"Начисления по заказам":refunds?"Возвраты и вычет начислений":"История выплат";
   wrap.append(div("fp-title-row",el("h3","",heading),period));
   const selected=rows.filter(row=>state.month==="all"||row.month===state.month)
     .sort((a,b)=>String(b.stamp??"").localeCompare(String(a.stamp??"")));
   if(!selected.length)wrap.append(el("p","fp-hint","Записей за выбранный период нет."));
   else {
     const ledger=el("div","fp-ledger");
     for(const row of selected){
       const amount=row.amount==null?"—":(Number(row.amount)===0?"":accruals?"+":"−")+money(row.amount);
       ledger.append(div("fp-ledger-row",el("span","fp-date",localDate(row.stamp)),
         div("fp-ledger-description",el("strong","",row.title),el("small","",row.detail)),
         el("strong",accruals?"fp-positive":"fp-negative",amount)));
     }
     wrap.append(ledger);
   }
   return wrap;
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
 // The existing salary screen now lives in owner Reports, with the same payout RPC.
 window.__rdPayrollReport={
   mount(root,{getSnapshot,onBack,master=false}){
     ui.person=null;ui.view="accruals";ui.month="all";
     const v3State={view:"accruals",month:"all"};
     const back=button("Отчёты","fp-link fp-crumb-back",()=>onBack?.());
     back.setAttribute("aria-label","Вернуться ко всем отчётам");
     const nav=div("fp-report-head",back,el("span","fp-crumb-sep","/"),
       el("h2","fp-report-title","Зарплата"));
     nav.setAttribute("aria-label","Отчёты / Зарплата");
     const status=el("p","fp-status-text"),content=el("div","");
     const retry=button("Повторить","secondary fp-retry",()=>{
       if(payroll()?.active)void window.__rdMoneyUi.reloadPayroll?.();
       else void window.__rdOwnerPayrollReload?.();
     });
     const state=div("fp-data-status",status,retry);
     root.replaceChildren(nav,state,content);
     let rendered=null;
     const redraw=()=>{
       const active=payroll();
       const v3=Boolean(active?.active);
       const m=v3?active:typeof getSnapshot==="function"?getSnapshot():null;
       const allowed=v3?Boolean(m.employeeId||m.loading||m.error):Boolean(!master&&m?.isOwner);
       const stale=isStale(m);
       const warning=m?.error||m?.refreshError;
       const message=!allowed?(master?"Данные зарплаты для этого мастера не подключены.":
         "Зарплата доступна только владельцу."):
         m.error?"Финансовые данные недоступны. "+m.error:
         !isReady(m)?"Загружаем данные зарплаты…":
         stale?"Показаны последние расчёты зарплаты. Обновите их перед выплатой."+ (warning?" "+warning:""):"";
       state.hidden=!message;retry.hidden=!(allowed&&(m.error||stale));
       if(status.textContent!==message)status.textContent=message;
       status.setAttribute("role",warning?"alert":"status");
       if(!allowed||!isReady(m)){
         if(content.firstChild)content.replaceChildren();
         rendered=null;
         return;
       }
       const version=m.revision??JSON.stringify(m);
       const pending=v3&&!master?savedIntent(m):null;
       const key=JSON.stringify(v3?[version,v3State.view,v3State.month,pending?.requestId]:
         [version,ui.person,ui.view,ui.month,stale]);
       if(rendered===key){
         if(v3&&!master){
           const disabled=pending?!allowV3Payout(m):!canStartV3Payout(m);
           for(const control of content.querySelectorAll?.(".fp-v3-actions button")??[])control.disabled=disabled;
         }
         return;
       }
       rendered=key;
       content.replaceChildren(v3?v3Payroll(m,!master,v3State,redraw):overview(m,redraw));
     };
     redraw();
     return {render:redraw};
   }
 };
 window.__rdFinancePaymentTabActive=()=>ui.tab==="payments";
 window.__rdFinanceEnhance=(m,legacyContent)=>{
   if(!m?.isOwner)return;
   const root=$("financeContent"),history=$("financeHistory"),entry=$("financeEntry");
   if(!root||!history||!entry)return;
   const first=!financeView||financeView.root!==root;
   if(first){
     const legacy=el("div","fp-original");
     if(!legacyContent)while(root.firstChild)legacy.append(root.firstChild);
     const tabs=el("div","fp-tabs"),panel=el("div","fp-panel");
     const payments=el("div","fp-payments-panel"),cash=el("div","fp-cash-panel");
     const operations=el("p","fp-hint",isPreview()?
       "Тестовая версия: просмотр истории без изменения реальных финансовых операций.":
       "История финансовых операций и управление записями доступны ниже.");
     const status=el("p","fp-status-text");
     const retry=button("Повторить","secondary fp-retry",()=>window.__rdMoneyUi?.refreshFinance?.());
     const dataStatus=div("fp-data-status",status,retry);
     const historyTitle=$("financePanel")?.querySelector(":scope > h2.finance-title");
     const view={root,legacy,tabs,payments,cash,operations,status,retry,dataStatus,historyTitle,model:null,cashRevision:null};
     financeView=view;
     panel.append(payments,dataStatus,cash,operations,legacy);
     root.replaceChildren(tabs,panel);
     for(const [value,label] of [["payments","Платежи"],["cash","Касса"],["operations","Операции"]]){
       const b=button(label,"fp-tab",()=>{
         if(ui.tab===value)return;
         ui.tab=value;
         updateFinanceTabs(view,history,entry,true);
       });
       b.setAttribute("data-finance-tab",value);
       tabs.append(b);
     }
   }
   financeView.model=m;
   if(legacyContent)financeView.legacy.replaceChildren(...legacyContent.children);
   if(isPreview()){
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
   updateFinanceTabs(financeView,history,entry,first);
 };
 function updateFinanceTabs(view,history,entry,activatePayments){
   const m=view.model,ready=isReady(m),stale=isStale(m);
   for(const b of view.tabs.children){
     const active=b.getAttribute("data-finance-tab")===ui.tab;
     b.className="fp-tab"+(active?" active":"");
     b.setAttribute("aria-pressed",String(active));
   }
   view.payments.hidden=ui.tab!=="payments";
   view.cash.hidden=view.legacy.hidden=ui.tab!=="cash"||!ready;
   view.operations.hidden=ui.tab!=="operations"||!ready;
   history.hidden=view.operations.hidden;
   entry.hidden=view.operations.hidden||stale;
   if(view.historyTitle)view.historyTitle.hidden=view.operations.hidden;
   if(!view.payments.hidden)window.__rdPaymentsRender?.(view.payments,activatePayments);
   const message=m.error?"Не удалось загрузить финансы. "+m.error:
     !ready?"Загружаем финансы…":
     stale?"Показаны последние финансовые расчёты. Обновите их перед операцией."+ (m.refreshError?" "+m.refreshError:""):"";
   view.dataStatus.hidden=ui.tab==="payments"||!message;
   view.retry.hidden=!(m.error||stale);
   if(view.status.textContent!==message)view.status.textContent=message;
   view.status.setAttribute("role",m.error||m.refreshError?"alert":"status");
   if(ready&&!view.cash.hidden){
     const version=m.revision??JSON.stringify([m.companyEarned,m.masterHeld,m.waitingOwner]);
     if(view.cashRevision!==version){
       view.cash.replaceChildren(cash(m));view.cashRevision=version;
     }
   }
   const locked=isPreview()||!ready||stale;
   for(const section of [view.legacy,history,entry]){
     for(const control of section.querySelectorAll?.("button")||[]){
       if(locked&&!control.disabled){
         control.disabled=true;control.dataset.financeReadLock="1";
       }else if(!locked&&control.dataset.financeReadLock==="1"){
         control.disabled=false;delete control.dataset.financeReadLock;
       }
     }
   }
 }
 window.__rdResetPayrollUi=()=>{
   resetPayoutDialog?.();
   localIntent=null;
   financeView?.root.replaceChildren();financeView=null;
   $("rdSalaryReport")?.replaceChildren();
   ui.tab="payments";ui.person=null;ui.view="accruals";ui.month="all";
 };
 // A saved session can finish restoring while this script is still downloading.
 if($("financePanel")?.hidden===false&&window.__rdMoneyUi?.snapshot?.()?.role==="owner"&&
   typeof renderFinance==="function")renderFinance();
})();
