/* Read-only payment history for the assigned master. No cashbook write privileges. */
"use strict";
(()=>{
  const el=(tag,cls="",value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n;};
  const rub=v=>Number.isFinite(Number(v))?new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2,minimumFractionDigits:2}).format(Number(v))+" ₽":"—";
  const when=v=>{
    if(!v)return "Дата неизвестна";
    const day=/^\d{4}-\d{2}-\d{2}$/.test(v);
    const d=new Date(day?v+"T12:00:00Z":v);
    if(!Number.isFinite(d.getTime()))return "Дата неизвестна";
    return new Intl.DateTimeFormat("ru-RU",{timeZone:day?"UTC":"Europe/Moscow",
      year:"numeric",month:"short",day:"numeric",
      ...(day?{}:{hour:"2-digit",minute:"2-digit"})}).format(d);
  };
  const account=m=>m==="cash"?"Наличные":m==="card"?"Карта":"Способ не указан";
  let filter="all";
  function render(root,m){
    if(!root)return;
    root.replaceChildren();
    if(m?.role!=="master")return;
    if(m.error)root.append(el("p","mw-error","Не удалось обновить финансовые данные: "+m.error));
    const title=el("h2","mw-payments-title","Мои платежи");
    root.append(title);
    const paid=(m.paymentOrders||[]).filter(o=>o.amount!==null&&o.amount!==undefined&&Number.isFinite(Number(o.amount)));
    const sum=xs=>xs.reduce((a,o)=>a+Math.round(Number(o.amount)*100),0)/100;
    const total=sum(paid),cash=sum(paid.filter(o=>o.method==="cash")),
      card=sum(paid.filter(o=>o.method==="card")),
      missing=paid.filter(o=>o.method!=="cash"&&o.method!=="card");
    const metrics=el("div","mw-payment-metrics");
    for(const [label,value] of [["Оплачено клиентами",total],["Наличные",cash],["Карта",card]]){
      const tile=el("div","mw-payment-metric");
      tile.append(el("span","",label),el("strong","",rub(value)));
      metrics.append(tile);
    }
    root.append(metrics);
    root.append(el("p","mw-payment-disclaimer","Суммы оплаты заказов, не банковский баланс. Передачи компании и выплаты зарплаты показаны отдельно и не прибавляются к этим суммам."));
    if(missing.length)root.append(el("p","mw-notice",
      "Оплаты без способа: "+rub(sum(missing))+". Они не включены в суммы «Наличные» и «Карта»."));
    const tabs=el("div","mw-payment-filters");
    for(const [key,label] of [["all","Все"],["cash","Наличные"],["card","Карта"],["unknown","Не указан"]]){
      if(key==="unknown"&&!missing.length&&!m.payouts?.some(p=>!p.payment_method))continue;
      const b=el("button","mw-payment-filter"+(filter===key?" is-active":""),label);
      b.type="button";b.setAttribute("aria-pressed",String(filter===key));
      b.addEventListener("click",()=>{filter=key;render(root,m)});
      tabs.append(b);
    }
    root.append(tabs);
    const rows=[];
    for(const o of paid)rows.push({
      kind:"income",method:o.method,amount:Number(o.amount),
      title:"Оплата заказа · "+(o.name||"Клиент"),at:o.paidAt||o.date,
      desc:(o.date?when(o.date)+" · ":"")+ (o.time||"")+ " · "+(o.status||""),
      orderId:o.id
    });
    for(const c of m.collections||[])rows.push({
      kind:"handover",method:"unknown",amount:Number(c.amount)||0,
      title:"Передача денег компании",at:c.confirmedAt||c.submittedAt||c.createdAt,
      desc:c.confirmedAt?"Подтверждена компанией":
        c.submittedAt?"Ожидает подтверждения":"Ожидает передачи",
      orderId:c.orderId
    });
    for(const p of m.payouts||[])rows.push({
      kind:"payout",method:p.payment_method,amount:Number(p.amount)||0,
      title:p.order_id?"Доля мастера по заказу":"Выплата зарплаты",at:p.created_at,
      desc:p.note||"Выплата по зарплате",orderId:p.order_id
    });
    rows.sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
    const list=el("div","mw-payment-list");
    const visible=rows.filter(o=>filter==="all"||
      (filter==="unknown"?!["cash","card"].includes(o.method):o.method===filter));
    if(!visible.length)list.append(el("p","mw-notice","Операций по этому фильтру нет."));
    for(const o of visible){
      const row=el("div","mw-payment-row");
      const left=el("div","mw-payment-row-main");
      left.append(el("strong","",o.title),el("small","",when(o.at)));
      if(o.desc)left.append(el("small","",o.desc));
      const right=el("div","mw-payment-row-side");
      right.append(el("strong",o.kind==="income"?"mw-plus":o.kind==="payout"?"mw-minus":"",
        (o.kind==="income"?"+":o.kind==="payout"?"−":"")+rub(o.amount)));
      right.append(el("small","",o.kind==="handover"?"Передача компании":account(o.method)));
      row.append(left,right);
      if(o.orderId&&typeof window.__rdOpenMasterDialog==="function"){
        const detail=el("button","mw-payment-order-link","Открыть заказ");
        detail.type="button";detail.addEventListener("click",()=>window.__rdOpenMasterDialog(o.orderId,detail));
        row.append(detail);
      }
      list.append(row);
    }
    root.append(list);
    root.append(el("p","mw-payment-disclaimer","Из этого раздела нельзя создавать произвольные кассовые операции. Оплата заказов и сдача денег оформляются в соответствующем заказе."));
  }
  window.__rdMasterPaymentsRender=render;
})();
