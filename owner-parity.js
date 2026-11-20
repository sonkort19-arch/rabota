/* Owner mobile UI parity with Raul: presentation only.
   Existing order controls, filters, payment RPCs and role checks are reused. */
"use strict";
(()=>{
  const $=id=>document.getElementById(id);
  const owner=()=>!!$("appScreen")?.classList.contains("rd-owner");
  const statuses=[
    ["","Все",'M4 7h16M4 12h16M4 17h16'],
    ["Записан","Записаны",'M7 3v4M17 3v4M3 10h18M8 15l2 2 4-4'],
    ["В работе","В работе",'M14.7 6.3a6 6 0 0 0-8 8l-4 4a2 2 0 0 0 2.8 2.8l4-4a6 6 0 0 0 8-8l-3.2 3.2-3-3z'],
    ["Выполнен","Выполнены",'M7.5 12l3 3 6-6'],
    ["Отменён","Отменены",'M9 9l6 6m0-6l-6 6']
  ];
  let prepared=false,changing=false;
  function make(tag,className="",textValue){
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(textValue!==undefined)node.textContent=String(textValue);
    return node;
  }
  function ensure(){
    if(!owner()||prepared)return;
    const intro=$("rdOrdersIntro"),stats=$("rdOrderStats"),select=$("rdStatusFilter");
    if(!intro||!stats||!select)return;
    const filters=make("div","owner-status-filters");
    filters.id="ownerStatusFilters";
    filters.setAttribute("role","group");
    filters.setAttribute("aria-label","Быстрый фильтр статусов как у Рауля");
    for(const [value,label,path] of statuses){
      const button=make("button","owner-status-chip");
      button.type="button";button.dataset.status=value;
      button.title=label;button.setAttribute("aria-label","Статус: "+label);
      const span=make("span","owner-status-icon");
      span.setAttribute("aria-hidden","true");
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("viewBox","0 0 24 24");
      svg.setAttribute("width","24");svg.setAttribute("height","24");
      svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");
      svg.setAttribute("stroke-width","1.8");svg.setAttribute("stroke-linecap","round");
      svg.setAttribute("stroke-linejoin","round");
      const shape=document.createElementNS("http://www.w3.org/2000/svg","path");
      shape.setAttribute("d",path);svg.append(shape);span.append(svg);button.append(span);
      button.addEventListener("click",()=>{
        if(!owner())return;
        select.value=value;
        changing=true;
        select.dispatchEvent(new Event("change",{bubbles:true}));
        changing=false;
        sync();
      });
      filters.append(button);
    }
    const titlebar=intro.querySelector(".rd-orders-titlebar");
    if(titlebar)titlebar.insertAdjacentElement("afterend",filters);
    else intro.prepend(filters);
    const tools=make("details","owner-order-tools");
    tools.id="ownerOrderTools";
    const summary=make("summary","owner-order-tools-title","Инструменты и сводка");
    tools.append(summary);
    const slots=intro.querySelector(".rd-orders-quick-slots");
    const wa=intro.querySelector(".rd-raul-share-tools");
    if(slots)tools.append(slots);
    if(wa)tools.append(wa);
    tools.append(stats);intro.append(tools);
    prepared=true;
    syncFilters();
  }
  function syncFilters(){
    const value=$("rdStatusFilter")?.value||"";
    for(const button of $("ownerStatusFilters")?.querySelectorAll("button")||[]){
      const active=button.dataset.status===value;
      button.classList.toggle("active",active);
      button.setAttribute("aria-pressed",String(active));
    }
  }
  function formatDay(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return "Без даты";
    const d=new Date(value+"T12:00:00Z");
    if(!Number.isFinite(+d))return "Без даты";
    const day=new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",timeZone:"UTC"}).format(d);
    const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    return value===today?"Сегодня · "+day:day.charAt(0).toLocaleUpperCase("ru-RU")+day.slice(1);
  }
  function groupVisible(){
    const root=$("orders");
    if(!root||window.__rdCurrentPage!=="orders")return;
    root.querySelectorAll(":scope > .owner-day-heading").forEach(node=>node.remove());
    const rows=[...root.querySelectorAll(":scope > .rd-list-row")]
      .filter(card=>!card.hidden);
    const counts=new Map();
    for(const row of rows)counts.set(row.dataset.date||"", (counts.get(row.dataset.date||"")||0)+1);
    const seen=new Set();
    for(const row of rows){
      const key=row.dataset.date||"";
      if(seen.has(key))continue;
      seen.add(key);
      const group=make("div","owner-day-heading");
      const label=make("strong","owner-day-label",formatDay(key));
      const count=make("small","owner-day-count",counts.get(key)+" "+(counts.get(key)===1?"заказ":"заказов"));
      group.append(label,count);
      root.insertBefore(group,row);
    }
  }
  function sync(){
    if(!owner()||changing)return;
    ensure();
    if(window.__rdCurrentPage==="orders"){syncFilters();groupVisible();}
  }
  const decorate=window.__rdDecorateOrder;
  if(typeof decorate==="function"){
    window.__rdDecorateOrder=(card,order)=>{
      decorate(card,order);
      if(!owner())return;
      const toggle=card?.querySelector(".rd-list-toggle");
      if(!toggle)return;
      const fields=[];
      if(order.master)fields.push(String(order.master));
      if(order.radiators!==""&&order.radiators!==null&&order.radiators!==undefined)
        fields.push("Радиаторы: "+order.radiators);
      if(order.floorLoops!==""&&order.floorLoops!==null&&order.floorLoops!==undefined&&Number(order.floorLoops)>0)
        fields.push("Тёплый пол: "+order.floorLoops+" конт.");
      const work=make("span","owner-list-work",fields.join(" · ")||"Детали заказа");
      const before=toggle.querySelector(".rd-list-state");
      toggle.insertBefore(work,before);
    };
  }
  const refresh=window.__rdRefresh;
  window.__rdRefresh=(...args)=>{
    const result=typeof refresh==="function"?refresh(...args):undefined;
    sync();
    return result;
  };
  window.__rdOwnerParitySync=sync;
})();