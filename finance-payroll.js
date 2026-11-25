/* Работа — зарплата владельца теперь отображается в «Отчётах», данные из финансовой модели. */
"use strict";
(()=>{
 let resetPayoutDialog=null,localIntent=null;
 const $=id=>document.getElementById(id);
 const el=(tag,cls="",txt)=>{const n=document.createElement(tag);n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n};
 const div=(cls,...children)=>{const n=el("div",cls);n.append(...children);return n};
 const button=(label,cls,fn)=>{const n=el("button",cls,label);n.type="button";n.addEventListener("click",fn);return n};
 const money=n=>new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0)+" ₽";
 const localDate=s=>{if(!s)return "—";const d=new Date(String(s).length===10?s+"T12:00:00Z":s);
   return Number.isFinite(d.getTime())?new Intl.DateTimeFormat("ru-RU",{timeZone:String(s).length===10?"UTC":"Europe/Moscow",day:"2-digit",month:"2-digit",year:"numeric"}).format(d):String(s)};
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
       const overpaid=Math.max(0,Number(receipt.overpaid)||-Number(receipt.due));
       const updated=div("fp-modal-balance",
         el("span","",overpaid?"Переплата":result.refreshError?"Остаток по квитанции":"Осталось выплатить"),
         el("strong","",money(overpaid||Math.max(0,Number(receipt.due)))));
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
 const historyMonth=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit"});
 const monthLabel=new Intl.DateTimeFormat("ru-RU",{year:"numeric",month:"long",timeZone:"UTC"});
 function cutoverReview(holds){
   const review=el("details","fp-cutover-review");
   review.append(el("summary","","Архив сверки · "+holds.length+" заказов"),
     el("p","fp-hint","Здесь сохранены спорные операции прежней системы. Они не увеличивают доступный остаток зарплаты."));
   const list=el("ul","fp-cutover-list");
   for(const hold of holds){
     const title=hold.reference||(hold.orderNumber!=null?"№"+String(hold.orderNumber).padStart(5,"0"):"Заказ");
     const item=el("li","");
     item.append(el("strong","",title),el("span","",hold.reason));
     if(hold.payrollOnHold) item.append(el("small","","Начисление на сверке "+money(hold.earned)+
       (hold.credited?" · подтверждено выплат "+money(hold.credited):"")+
       (hold.linkedRecorded?" · в старом журнале по заказу "+money(hold.linkedRecorded):"")));
     if(hold.cashOnHold) item.append(el("small","","Получено от клиента "+money(hold.paymentAmount)+" · историческая запись на сверке"));
     list.append(item);
   }
   review.append(list);return review;
 }
 function v3Payroll(m,owner,state,redraw){
   const wrap=el("section","fp-screen fp-v3-payroll");
   const name=m.employeeName||"Рауль";
   const hero=el("section","fp-balance-hero fp-v3-balance");
   hero.append(div("fp-balance-headline",
     el("h2","fp-balance-label",owner?name:"Моя зарплата"),
     el("span","fp-balance-eyebrow",owner?"Осталось выплатить":"Осталось получить"),
     el("strong","fp-balance-value",money(m.due))));
   if(m.overpaid>0){
     const overpayment=el("p","fp-hint fp-travel-overpayment","Переплата "+money(m.overpaid)+
       ". Учтём в следующих начислениях.");
     hero.append(overpayment);
   }
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
   const summary=div("fp-person-summary",
     div("fp-person-summary-item",el("span","","Начислено"),el("strong","",money(m.earned))),
     div("fp-person-summary-item",el("span","","Выплачено"),el("strong","",money(m.paid))));
   if(m.travelHistory?.length){
     summary.append(
       div("fp-person-summary-item",el("span","","Начислено за промывку"),el("strong","",money(m.baseEarned))),
       div("fp-person-summary-item",el("span","","Начислено за дорогу"),el("strong","",money(m.travelEarned))));
   }
   wrap.append(hero,summary);
   if(owner&&m.holds?.length)wrap.append(cutoverReview(m.holds));
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
   const travelOrders=new Set((m.travelHistory??[]).map(item=>item.orderId));
   const items=accruals?(m.accruals??[]).map(item=>({
     stamp:item.earnedAt,title:orderTitle(item),
     detail:(travelOrders.has(item.orderId)?"Промывка оплачена клиентом ":"Оплачено клиентом ")+money(item.actualPaid),
     amount:item.earned
   })).concat((m.travelHistory??[]).map(item=>({
     stamp:item.occurredAt,title:"Дорога · "+(item.reference||window.__rdOrderReference?.code(item.orderNumber)||
       (item.orderNumber==null?"Заказ":"№"+String(item.orderNumber).padStart(5,"0"))),
     detail:item.delta<0?"Корректировка начисления за дорогу":"Доплата за дорогу",
     amount:item.delta,travel:true
   }))):refunds?m.refunds.map(item=>({
     stamp:item.occurredAt,title:orderTitle(item),
     detail:"Возвращено клиенту "+money(item.amount)+(item.earnedAt?" · Начисление от "+localDate(item.earnedAt):""),
     amount:item.earnedReversed
   })):(m.payouts??[]).map(item=>{
     const method=item.method==="cash"?"Наличные":item.method==="card"?"Карта":"";
     const details=[item.kind==="legacy_on_behalf"?"Учтено по исторической сверке":"",method,
       owner&&item.held>0?"Из исходной выплаты на сверке "+money(item.held):""].filter(Boolean);
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
       const positive=accruals&&row.amount>=0;
       const amount=row.amount==null?"—":(Number(row.amount)===0?"":positive?"+":"−")+money(Math.abs(row.amount));
       ledger.append(div("fp-ledger-row"+(row.travel?" fp-travel-row":""),el("span","fp-date",localDate(row.stamp)),
         div("fp-ledger-description",el("strong","",row.title),el("small","",row.detail)),
         el("strong",positive?"fp-positive":"fp-negative",amount)));
     }
     wrap.append(ledger);
   }
   return wrap;
 }
 window.__rdPayrollReport={
   mount(root,{onBack,master=false,embedded=false}){
     const v3State={view:"accruals",month:"all"};
     const status=el("p","fp-status-text"),content=el("div","");
     const retry=button("Повторить","secondary fp-retry",()=>void window.__rdMoneyUi?.reloadPayroll?.());
     const state=div("fp-data-status",status,retry);
     const children=[state,content];
     if(!embedded){
       const back=button("Назад","fp-link fp-report-back",()=>onBack?.());
       back.setAttribute("aria-label","Назад к отчётам");
       const heading=el("header","fp-report-head");
       heading.append(back,el("h2","fp-report-title","Зарплата"));
       children.unshift(heading);
     }
     root.replaceChildren(...children);
     let rendered=null;
     const redraw=()=>{
       const m=payroll();
       const allowed=Boolean(m&&(m.active&&m.employeeId||m.loading||m.error));
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
       const pending=!master?savedIntent(m):null;
       const key=JSON.stringify([version,v3State.view,v3State.month,pending?.requestId]);
       if(rendered===key){
         if(!master){
           const disabled=pending?!allowV3Payout(m):!canStartV3Payout(m);
           for(const control of content.querySelectorAll?.(".fp-v3-actions button")??[])control.disabled=disabled;
         }
         return;
       }
       rendered=key;
       content.replaceChildren(v3Payroll(m,!master,v3State,redraw));
     };
     redraw();
     return {render:redraw};
   }
 };
 window.__rdResetPayrollUi=()=>{
   resetPayoutDialog?.();
   localIntent=null;
   $("rdSalaryReport")?.replaceChildren();
 };
})();
