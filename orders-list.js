/* Рабoта · компактные заказы. Только интерфейс: данные и обработчики остаются в index.html. */
"use strict";
(()=>{
  const originalDecorate=window.__rdDecorateOrder;
  const originalRefresh=window.__rdRefresh;
  if(typeof originalDecorate!=="function")return;
  const expanded=new Set();
  const text=(tag,value,cls)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    el.textContent=String(value==null?"":value);
    return el;
  };
  function cell(cls,...children){
    const node=text("span","","rd-list-"+cls);
    node.append(...children);
    return node;
  }
  function formatMoney(value){
    if(value===null||value===undefined||value==="")return "Не указана";
    const number=Number(value);
    return Number.isFinite(number)?number.toLocaleString("ru-RU",{maximumFractionDigits:2})+" ₽":"Не указана";
  }
  const colorByStatus={
    "Новый":"s-new","Записан":"s-booked","В работе":"s-progress",
    "Выполнен":"s-done","Отменён":"s-cancelled"
  };
  window.__rdDecorateOrder=(card,order)=>{
    if(!card||!order||currentRole==="master"){
      originalDecorate(card);
      return;
    }
    const id=String(order.id||"");
    const domId="rd-compact-order-"+id.replace(/[^a-zA-Z0-9_-]/g,"");
    const name=String(order.name||"Без имени");
    const initial=Array.from(name)[0]?.toLocaleUpperCase("ru-RU")||"К";
    const person=cell("person",
      text("span",initial,"rd-list-avatar"),
      cell("identity",text("strong",name,"rd-list-name"),
        text("small",order.address||"Адрес не указан","rd-list-address")));
    const time=cell("when",
      text("strong",order.date?dateLong(order.date):"Без даты"),
      text("small",order.time||"Время не указано"));
    const master=cell("master",text("small","Мастер"),text("strong",order.master||"Не назначен"));
    const cost=cell("price",text("small","Стоимость"),text("strong",formatMoney(order.price)));
    const state=cell("state",text("span",order.status||"Новый",
      "rd-list-status "+(colorByStatus[order.status]||"s-new")));
    const paid=cell("paid",text("span",order.paid?"Оплачено":"Не оплачено",
      "rd-list-pay "+(order.paid?"is-paid":"is-unpaid")));
    const arrow=cell("arrow",text("span","⌄","rd-list-chevron"));
    const toggle=text("button","","rd-list-toggle");
    toggle.type="button";
    toggle.setAttribute("aria-controls",domId);
    toggle.append(person,time,master,cost,state,paid,arrow);
    const details=text("div","","rd-list-details");
    details.id=domId;
    details.prepend(text("div","Детали заявки и действия","rd-list-details-title"));
    for(const child of Array.from(card.children))details.appendChild(child);
    for(const line of details.querySelectorAll(":scope > .info")){
      line.classList.add("rd-list-info");
    }
    const isOpen=()=>expanded.has(id);
    function sync(){
      const open=isOpen();
      details.hidden=!open;
      card.classList.toggle("is-open",open);
      toggle.setAttribute("aria-expanded",String(open));
      toggle.setAttribute("aria-label",(open?"Скрыть":"Открыть")+" детали заказа: "+name);
    }
    toggle.addEventListener("click",()=>{
      if(isOpen())expanded.delete(id);else expanded.add(id);
      sync();
    });
    card.classList.add("rd-list-row");
    card.replaceChildren(toggle,details);
    sync();
  };
  window.__rdRefresh=(...args)=>{
    if(typeof originalRefresh==="function")originalRefresh(...args);
    const root=document.getElementById("orders");
    if(!root||currentRole==="master"||window.__rdCurrentPage!=="orders"||
       !root.querySelector(".rd-list-row")||root.querySelector(".rd-list-columns"))return;
    const header=text("div","","rd-list-columns");
    header.setAttribute("aria-hidden","true");
    ["Клиент и адрес","Дата и время","Мастер","Стоимость","Статус","Оплата",""].forEach(label=>
      header.appendChild(text("span",label)));
    root.insertBefore(header,root.firstChild);
  };
})();
