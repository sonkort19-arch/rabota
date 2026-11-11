/* Рабoта · компактные заказы. Только интерфейс: данные и обработчики остаются в index.html. */
"use strict";
(()=>{
  const originalDecorate=window.__rdDecorateOrder;
  const originalRefresh=window.__rdRefresh;
  if(typeof originalDecorate!=="function")return;

  // Keep the list static: a single dialog displays the selected live order.
  let activeId=null,activeDialog=null,oldBodyOverflow="",returnFocus=null;
  function visibleCards(){
    return Array.from(document.querySelectorAll("#orders > .rd-list-row"))
      .filter(node=>!node.hidden&&node.dataset.rdOrderId);
  }
  function orderCard(id){
    return visibleCards().find(node=>node.dataset.rdOrderId===id)||null;
  }
  function closeDialog({focus=true}={}){
    if(!activeDialog)return;
    const dialog=activeDialog;
    activeDialog=null;activeId=null;
    dialog.remove();
    document.body.style.overflow=oldBodyOverflow;
    document.removeEventListener("keydown",onDialogKey,true);
    if(focus){
      const row=returnFocus;
      if(row?.isConnected&&!row.closest("[hidden]"))row.focus({preventScroll:true});
    }
    returnFocus=null;
  }
  function onDialogKey(event){
    if(!activeDialog)return;
    if(document.querySelector(".rd-pay-overlay")||document.getElementById("orderOverlay")?.hidden===false)return;
    if(event.key==="Escape"){event.preventDefault();closeDialog();return;}
    if(event.key==="ArrowLeft"&&event.target?.tagName!=="SELECT"&&event.target?.tagName!=="INPUT"){
      event.preventDefault();moveDialog(-1);return;
    }
    if(event.key==="ArrowRight"&&event.target?.tagName!=="SELECT"&&event.target?.tagName!=="INPUT"){
      event.preventDefault();moveDialog(1);return;
    }
    if(event.key!=="Tab")return;
    const controls=Array.from(activeDialog.querySelectorAll("button,a,select,input,textarea,[tabindex]"))
      .filter(node=>!node.disabled&&!node.closest("[hidden]")&&node.tabIndex!==-1);
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  function moveDialog(delta){
    const rows=visibleCards();
    const current=rows.findIndex(n=>n.dataset.rdOrderId===activeId);
    const next=rows[current+delta];
    if(!next)return;
    activeId=next.dataset.rdOrderId;
    paintDialog(true);
  }
  function labeledRow(label,value,variant){
    if(value===null||value===undefined||value==="")return null;
    const row=text("div","","rd-order-detail");
    row.append(text("span",label,"rd-order-detail-label"),
      text("span",value,"rd-order-detail-value"+(variant?" "+variant:"")));
    return row;
  }
  function paymentCaption(order){
    if(order.status!=="Выполнен")return null;
    return text("span",order.paid?
      ("Оплачено"+(order.paymentMethod==="cash"?" · наличные":order.paymentMethod==="card"?" · карта":"")):
      "Ждём оплату",
      "rd-order-payment-state "+(order.paid?"is-paid":"is-unpaid"));
  }
  function paintDialog(resetScroll=false){
    if(!activeDialog||!activeId)return;
    const row=orderCard(activeId);
    if(!row){closeDialog();return;}
    const order=row.__rdOrder;
    const payload=row.__rdActions;
    const inside=activeDialog.querySelector(".rd-order-content");
    if(!order||!inside)return;
    inside.replaceChildren();
    const title=activeDialog.querySelector(".rd-order-title");
    title.textContent=order.name||"Без имени";
    activeDialog.querySelector(".rd-order-subtitle").textContent=
      (order.date?compactDate(order.date):"Без даты")+(order.time?" · "+order.time:"")+
      (order.master?" · "+order.master:"");
    const state=text("span",order.status||"Новый","rd-order-state "+(colorByStatus[order.status]||"s-new"));
    const price=text("strong",formatMoney(order.price),"rd-order-total");
    const heading=text("div","","rd-order-summary");
    heading.append(state,price);
    const payment=paymentCaption(order);
    if(payment)heading.append(payment);
    inside.append(heading);
    const entries=text("div","","rd-order-attributes");
    const radiator=(order.radiators!==""&&order.radiators!=null?order.radiators+" шт.":"")+
      (order.radiatorType?(order.radiators!==""&&order.radiators!=null?" · ":"")+order.radiatorType:"");
    const attrs=[
      labeledRow("Адрес",order.address),
      labeledRow("Радиаторы",radiator),
      labeledRow("Тёплый пол",order.floorLoops!==""&&order.floorLoops!=null?order.floorLoops+" контур(ов)":""),
      labeledRow("Мастер",order.master)
    ];
    attrs.filter(Boolean).forEach(item=>entries.append(item));
    inside.append(entries);
    const actions=text("div","","rd-order-actions");
    if(payload?.actions){
      payload.actions.classList.add("rd-order-actions-list");
      const edit=payload.actions.querySelector(".action.edit");
      if(edit)edit.addEventListener("click",()=>closeDialog({focus:false}),true);
      actions.append(payload.actions);
    }
    inside.append(actions);
    const visibleNote=window.__rdOrderNotes?.display(order.details,currentRole)||"";
    if(visibleNote){
      const comments=document.createElement("details");
      comments.className="rd-order-comment";
      const summary=text("summary","Комментарий к заказу","rd-order-comment-toggle");
      const note=text("p",visibleNote,"rd-order-comment-text");
      comments.append(summary,note);
      inside.append(comments);
    }
    if(payload?.controls){
      const manual=document.createElement("details");
      manual.className="rd-order-manual-status";
      manual.append(text("summary","Другой статус","rd-order-manual-label"));
      const controls=text("div","","rd-order-status-controls");
      controls.append(payload.controls);
      manual.append(controls);
      // Used by the compact footer shortcut. No second visible status selection.
      inside.append(manual);
    }
    const footer=activeDialog.querySelector(".rd-order-footer");
    footer.replaceChildren();
    const rows=visibleCards(),index=rows.findIndex(n=>n.dataset.rdOrderId===activeId);
    const prev=activeDialog.querySelector(".rd-order-prev");
    const next=activeDialog.querySelector(".rd-order-next");
    const position=activeDialog.querySelector(".rd-order-position");
    prev.disabled=index<=0;
    next.disabled=index<0||index===rows.length-1;
    position.textContent=(index+1)+"/"+rows.length;
    // Existing status control handlers remain active inside the collapsed editor.
    const select=payload?.controls?.querySelector("select.compact-select");
    let ctaLabel=null,newStatus=null,existingButton=null;
    if(order.status==="В работе"&&!order.paid){ctaLabel="Завершить заказ";newStatus="Выполнен";}
    else if(["Записан","Новый"].includes(order.status)){ctaLabel="Начать работу";newStatus="В работе";}
    else if(order.status==="Выполнен"&&!order.paid){
      ctaLabel="Принять оплату";
      existingButton=payload?.controls?.querySelector("button.payment");
    }
    if(ctaLabel){
      const cta=text("button",ctaLabel,"rd-order-primary");
      cta.type="button";
      cta.addEventListener("click",()=>{
        if(newStatus&&select&&!select.disabled){
          cta.disabled=true;
          select.value=newStatus;
          select.dispatchEvent(new Event("change",{bubbles:true}));
          // No optimistic success: persistOrder handles failures and rerenders on success.
          // Re-enable after the existing handler finishes or rolls back.
          cta.disabled=false;
        }else if(existingButton&&!existingButton.disabled)existingButton.click();
      });
      footer.append(cta);
    }
    if(payload?.controls){
      const manualLink=text("button","Другой статус","rd-order-manual-link");
      manualLink.type="button";
      manualLink.setAttribute("aria-label","Показать ручное изменение статуса заказа");
      manualLink.addEventListener("click",()=>{
        const manual=activeDialog?.querySelector(".rd-order-manual-status");
        if(!manual)return;
        manual.open=!manual.open;
        if(manual.open){
          manual.scrollIntoView({block:"nearest",behavior:"smooth"});
          const select=manual.querySelector("select.compact-select");
          if(select)select.focus({preventScroll:true});
        }else{
          manualLink.focus({preventScroll:true});
        }
      });
      footer.append(manualLink);
    }
    if(resetScroll){
      inside.scrollTop=0;
      activeDialog.querySelector(".rd-order-dialog").focus({preventScroll:true});
    }
  }
  function openDialog(id,trigger){
    if(!id)return;
    if(activeDialog){
      activeId=id;
      paintDialog(true);
      return;
    }
    if(!orderCard(id))return;
    returnFocus=trigger||document.activeElement;
    oldBodyOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const overlay=text("div","","rd-order-overlay");
    const dialog=text("section","","rd-order-dialog");
    dialog.setAttribute("role","dialog");
    dialog.setAttribute("aria-modal","true");
    dialog.setAttribute("aria-labelledby","rdOrderDialogTitle");
    dialog.tabIndex=-1;
    const head=text("div","","rd-order-head");
    const heading=text("div","","rd-order-heading");
    const title=text("h2","","rd-order-title");
    title.id="rdOrderDialogTitle";
    heading.append(title,text("p","","rd-order-subtitle"));
    const nav=text("div","","rd-order-navigation");
    const prev=text("button","‹","rd-order-prev");
    const next=text("button","›","rd-order-next");
    prev.type=next.type="button";
    prev.setAttribute("aria-label","Предыдущий заказ");
    next.setAttribute("aria-label","Следующий заказ");
    prev.addEventListener("click",()=>moveDialog(-1));
    next.addEventListener("click",()=>moveDialog(1));
    nav.append(prev,text("span","","rd-order-position"),next);
    const close=text("button","×","rd-order-close");
    close.type="button";close.setAttribute("aria-label","Закрыть заказ");
    close.addEventListener("click",()=>closeDialog());
    const headControls=text("div","","rd-order-head-controls");
    headControls.append(nav,close);
    head.append(heading,headControls);
    dialog.append(head,text("div","","rd-order-content"),text("div","","rd-order-footer"));
    overlay.append(dialog);
    overlay.addEventListener("click",event=>{if(event.target===overlay)closeDialog();});
    document.body.append(overlay);
    activeDialog=overlay;activeId=id;
    document.addEventListener("keydown",onDialogKey,true);
    paintDialog(true);
  }
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
  function compactDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return String(value||"Без даты");
    const date=new Date(value+"T12:00:00Z");
    if(!Number.isFinite(date.getTime()))return String(value);
    return new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"}).format(date);
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
    const name=String(order.name||"Без имени");
    const initial=Array.from(name)[0]?.toLocaleUpperCase("ru-RU")||"К";
    const person=cell("person",
      text("span",initial,"rd-list-avatar"),
      cell("identity",text("strong",name,"rd-list-name"),
        text("small",order.address||"Адрес не указан","rd-list-address")));
    const time=cell("when",
      text("strong",order.date?compactDate(order.date):"Без даты"),
      text("small",order.time||"Время не указано"));
    const master=cell("master",text("small","Мастер"),text("strong",order.master||"Не назначен"));
    const cost=cell("price",text("small","Стоимость"),text("strong",formatMoney(order.price)));
    const meta=cell("meta",
      text("span",(order.master||"Не назначен")+" · "+formatMoney(order.price),"rd-list-meta-text"));
    const state=cell("state",text("span",order.status||"Новый",
      "rd-list-status "+(colorByStatus[order.status]||"s-new")));
    const paymentLabel=order.status==="Выполнен"?
      (order.paid?"Оплачено":"Ждём оплату"):"";
    const paid=cell("paid",text("span",paymentLabel,
      "rd-list-pay "+(order.paid?"is-paid":"is-unpaid")));
    if(!paymentLabel)paid.setAttribute("aria-hidden","true");
    const arrow=cell("arrow",text("span","›","rd-list-chevron"));
    const toggle=text("button","","rd-list-toggle");
    toggle.type="button";
    toggle.setAttribute("aria-haspopup","dialog");
    toggle.append(person,time,master,cost,meta,state,paid,arrow);
    // The original controls are moved to the dialog, not cloned: their database handlers still work.
    const actions=Array.from(card.children).find(node=>node.classList.contains("actions"))||null;
    const controls=Array.from(card.children).find(node=>node.classList.contains("card-controls"))||null;
    card.__rdActions={actions,controls};
    card.__rdOrder=order;
    card.dataset.rdOrderId=id;
    toggle.setAttribute("aria-label","Открыть заказ: "+name);
    toggle.addEventListener("click",()=>openDialog(id,toggle));
    card.classList.add("rd-list-row");
    card.replaceChildren(toggle);
  };
  // Owner dashboard deep link: open the same compact dialog as tapping a list row.
  window.__rdOpenOrderDetail=(orderId)=>{
    if(window.__rdCurrentPage!=="orders"||currentRole==="master")return false;
    const id=String(orderId||"");
    const row=orderCard(id);
    if(!row)return false;
    const trigger=row.querySelector(".rd-list-toggle");
    openDialog(id,trigger);
    return true;
  };
  window.__rdRefresh=(...args)=>{
    if(typeof originalRefresh==="function")originalRefresh(...args);
    if(activeDialog){
      if(window.__rdCurrentPage!=="orders")closeDialog();
      else paintDialog();
    }
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
