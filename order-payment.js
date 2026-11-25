/* CRM «Работа»: компактное подтверждение оплаты без автоматической клавиатуры. */
"use strict";
(()=>{
  let active=false,cancelActive=null;
  const fmt=value=>Number(value).toLocaleString("ru-RU",{maximumFractionDigits:2})+" ₽";
  function promptPayment(order,{complete=true,canUnpaid=true,canPay=true}={}){
    if(active)return Promise.resolve(null);
    active=true;
    return new Promise(resolve=>{
      const previousFocus=document.activeElement;
      const overlay=document.createElement("div");
      overlay.className="rd-pay-overlay";
      overlay.innerHTML=
        '<section class="rd-pay-dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="rdPayTitle">'+
        ' <header class="rd-pay-head"><div><h2 id="rdPayTitle"></h2><p id="rdPayClient"></p></div>'+
        ' <button class="rd-pay-close" type="button" aria-label="Закрыть окно оплаты">×</button></header>'+
        ' <form id="rdPayForm">'+
        '  <div class="rd-pay-sum-card">'+
        '   <div class="rd-pay-sum-top"><span>Полная стоимость заказа</span></div>'+
        '   <div class="rd-pay-sum-view"><strong id="rdPaySumValue"></strong></div>'+
        '   <p class="rd-pay-breakdown" hidden></p>'+
        '  </div>'+
        '  <p class="rd-pay-adjust" id="rdPayAdjust"></p>'+
        '  <fieldset><legend>Способ оплаты</legend>'+
        '   <div class="rd-pay-methods">'+
        '    <label class="rd-pay-method"><input type="radio" name="rdPayMethod" value="cash" checked><span>Наличные</span></label>'+
        '    <label class="rd-pay-method"><input type="radio" name="rdPayMethod" value="card"><span>Карта / перевод</span></label>'+
        '   </div></fieldset>'+
        '  <div class="rd-pay-footer"><div class="rd-pay-error" role="alert" aria-live="polite"></div>'+
        '   <button class="rd-pay-confirm" type="submit">Подтвердить оплату</button>'+
        '   <button class="rd-pay-unpaid" type="button">Завершить без оплаты</button>'+
        '   <button class="rd-pay-cancel" type="button">Отмена</button></div>'+
        ' </form></section>';
      document.body.append(overlay);
      const $=selector=>overlay.querySelector(selector);
      const dialog=$(".rd-pay-dialog");
      const amount=window.__rdPayableOrderTotal(order);
      const travel=window.__rdTravelAmount(order.travelAmount);
      const error=$(".rd-pay-error");
      const confirm=$(".rd-pay-confirm");
      $("#rdPayTitle").textContent=complete?"Завершение заказа":"Получение оплаты";
      $("#rdPayClient").textContent=order.name||"Клиент";
      $("#rdPaySumValue").textContent=amount===null?"Сумма не указана":fmt(amount);
      if(amount!==null&&travel>0){
        const breakdown=$(".rd-pay-breakdown");
        breakdown.textContent="Промывка "+fmt(order.price)+" · Дорога "+fmt(travel);
        breakdown.hidden=false;
      }
      $("#rdPayAdjust").textContent=!canPay
        ?"Не удалось обновить данные платежей. Можно сохранить заказ без оплаты."
        :amount===null?"Укажите стоимость заказа перед приёмом оплаты."
        :"Подтвердите получение всей суммы. Чтобы изменить стоимость, сначала сохраните новую цену заказа.";
      confirm.textContent=amount===null?"Укажите сумму":"Получено "+fmt(amount);
      confirm.disabled=!canPay||amount===null;
      if(!complete||!canUnpaid)$(".rd-pay-unpaid").hidden=true;

      // iOS visual viewport shrinks when the numeric keyboard opens.
      // Keep the payment sheet and its confirmation inside the visible area.
      const viewport=window.visualViewport;
      const syncViewport=()=>{
        if(!viewport)return;
        overlay.style.setProperty("--rd-pay-top",viewport.offsetTop+"px");
        overlay.style.setProperty("--rd-pay-height",viewport.height+"px");
      };
      viewport?.addEventListener("resize",syncViewport);
      viewport?.addEventListener("scroll",syncViewport);
      syncViewport();

      let settled=false;
      const finish=value=>{
        if(settled)return;
        settled=true;active=false;cancelActive=null;
        document.removeEventListener("keydown",onKey,true);
        viewport?.removeEventListener("resize",syncViewport);
        viewport?.removeEventListener("scroll",syncViewport);
        overlay.remove();
        if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
        resolve(value);
      };
      cancelActive=()=>finish(null);
      const onKey=event=>{
        if(event.key==="Escape"){event.preventDefault();finish(null);return;}
        if(event.key!=="Tab")return;
        const items=Array.from(overlay.querySelectorAll("button, input"))
          .filter(node=>!node.disabled&&!node.closest("[hidden]"));
        const first=items[0],last=items[items.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      };
      document.addEventListener("keydown",onKey,true);
      overlay.addEventListener("click",event=>{if(event.target===overlay)finish(null);});
      $(".rd-pay-close").addEventListener("click",()=>finish(null));
      $(".rd-pay-cancel").addEventListener("click",()=>finish(null));
      $(".rd-pay-unpaid").addEventListener("click",()=>finish({kind:"unpaid"}));
      $("#rdPayForm").addEventListener("submit",event=>{
        event.preventDefault();
        if(!canPay||amount===null)return;
        const method=$('input[name="rdPayMethod"]:checked')?.value;
        if(method!=="cash"&&method!=="card"){error.textContent="Выберите способ оплаты.";return;}
        finish({kind:"paid",amount,method});
      });
      // Keep the mobile keyboard closed when the dialog opens.
      dialog.focus({preventScroll:true});
    });
  }
  window.__rdPaymentPrompt=promptPayment;
  window.__rdClosePaymentPrompt=()=>cancelActive?.();
})();
