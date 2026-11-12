/* Master order details. Read-only wrapper around existing authorised order actions. */
"use strict";
(()=>{
  const getApi=()=>window.__rdMasterDialogApi;
  const money=value=>value===null||value===undefined||value===""?"Цена не указана":
    Number(value).toLocaleString("ru-RU",{maximumFractionDigits:2})+" ₽";
  const labelDate=value=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return "Дата не указана";
    const d=new Date(value+"T12:00:00Z");
    return new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}).format(d);
  };
  const el=(tag,cls,value)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(value!==undefined)n.textContent=String(value);
    return n;
  };
  let state=null;
  function close(restore=true){
    if(!state)return;
    const previous=state;
    state=null;
    document.removeEventListener("keydown",previous.keydown,true);
    previous.overlay.remove();
    document.body.style.overflow=previous.prevOverflow;
    if(restore){
      const trigger=previous.trigger?.isConnected?previous.trigger:
        [...document.querySelectorAll("#orders .master-schedule-card,#masterSettlementRows .master-schedule-card")]
          .find(row=>row.dataset.orderId===previous.id)?.querySelector(".master-schedule-toggle");
      trigger?.focus({preventScroll:true});
    }
  }
  function refresh(){
    if(!state)return;
    const order=getApi()?.order(state.id);
    if(!order){close(false);return;}
    const collection=getApi()?.collection(state.id);
    const signature=JSON.stringify([order,collection]);
    if(signature===state.signature)return;
    state.signature=signature;
    state.title.textContent=order.name||"Без имени";
    state.sub.textContent=labelDate(order.date)+" · "+(order.time||"Время не указано");
    state.status.textContent=order.status||"Новый";
    state.status.className="status-badge "+({
      "Новый":"s-new","Записан":"s-booked","В работе":"s-progress",
      "Выполнен":"s-done","Отменён":"s-cancelled"
    }[order.status]||"s-new");
    state.price.textContent=money(order.price);
    const card=getApi()?.card(order);
    state.body.replaceChildren();
    if(card)state.body.append(card);
    if(order.status==="Выполнен"){
      const payment=el("p","rd-master-order-payment",
        order.paid?"Оплачено"+(order.paymentMethod==="cash"?" · наличные":order.paymentMethod==="card"?" · карта":" · способ не указан"):"Ожидает оплаты");
      state.body.prepend(payment);
    }
  }
  function onKeydown(e){
    if(!state)return;
    if(e.key==="Escape"){e.preventDefault();close();return;}
    if(e.key!=="Tab")return;
    const dialog=state.dialog;
    const nodes=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')]
      .filter(n=>n.getClientRects().length>0);
    if(!nodes.length){e.preventDefault();dialog.focus();return;}
    const first=nodes[0],last=nodes[nodes.length-1];
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){
      e.preventDefault();last.focus();
    }else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog)){
      e.preventDefault();first.focus();
    }
  }
  function open(id,trigger){
    const order=getApi()?.order(String(id));
    if(!order)return false;
    close(false);
    const overlay=el("div","rd-master-order-backdrop");
    const dialog=el("section","rd-master-order-modal");
    dialog.tabIndex=-1;dialog.setAttribute("role","dialog");
    dialog.setAttribute("aria-modal","true");
    dialog.setAttribute("aria-labelledby","rdMasterOrderTitle");
    const head=el("div","rd-master-order-head");
    const headText=el("div","rd-master-order-heading");
    const title=el("h2","",order.name||"Заказ");
    title.id="rdMasterOrderTitle";
    const sub=el("p","rd-master-order-sub");
    headText.append(title,sub);
    const closeBtn=el("button","rd-master-order-close","×");
    closeBtn.type="button";closeBtn.setAttribute("aria-label","Закрыть заказ");
    closeBtn.addEventListener("click",()=>close());
    head.append(headText,closeBtn);
    const stats=el("div","rd-master-order-summary");
    const status=el("span","status-badge");
    const price=el("strong","rd-master-order-price");
    stats.append(status,price);
    const body=el("div","rd-master-order-body");
    dialog.append(head,stats,body);
    overlay.append(dialog);
    const prevOverflow=document.body.style.overflow;
    state={id:String(id),overlay,dialog,title,sub,status,price,body,trigger,
      prevOverflow,keydown:onKeydown,signature:null};
    document.body.append(overlay);
    document.body.style.overflow="hidden";
    overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
    document.addEventListener("keydown",onKeydown,true);
    refresh();
    closeBtn.focus({preventScroll:true});
    return true;
  }
  window.__rdOpenMasterDialog=open;
  window.__rdRefreshMasterDialog=refresh;
  window.__rdMasterCloseOrder=()=>close(false);
})();
