/* Оплата заказа: окно подтверждения без изменения данных до явного действия. */
"use strict";
(()=>{
  let active=false;
  const fmt=amount=>Number(amount).toLocaleString("ru-RU",{maximumFractionDigits:2})+" ₽";
  function promptPayment(order,{complete=true,canUnpaid=true,receiver="company"}={}){
    if(active)return Promise.resolve(null);
    active=true;
    return new Promise(resolve=>{
      const oldFocus=document.activeElement;
      const overlay=document.createElement("div");
      overlay.className="rd-pay-overlay";
      overlay.innerHTML=
        '<section class="rd-pay-dialog" role="dialog" aria-modal="true" aria-labelledby="rdPayTitle">'+
        ' <header class="rd-pay-head"><div><h2 id="rdPayTitle"></h2><p id="rdPayClient"></p></div>'+
        ' <button class="rd-pay-close" type="button" aria-label="Закрыть окно оплаты">×</button></header>'+
        ' <form id="rdPayForm"><label for="rdPayAmount">Сумма к получению</label>'+
        ' <div class="rd-pay-amount"><input id="rdPayAmount" type="number" inputmode="decimal" min="0.01" max="10000000" step="0.01" required><span>₽</span></div>'+
        ' <p class="rd-pay-adjust" id="rdPayAdjust" hidden>Эта сумма станет итоговой стоимостью заказа.</p>'+
        ' <fieldset><legend>Как клиент оплатил?</legend>'+
        '  <div class="rd-pay-methods">'+
        '   <label class="rd-pay-method"><input type="radio" name="rdPayMethod" value="cash" checked><span>Наличными</span></label>'+
        '   <label class="rd-pay-method"><input type="radio" name="rdPayMethod" value="card"><span>Картой / переводом</span></label>'+
        '  </div></fieldset>'+
        ' <p class="rd-pay-receiver" id="rdPayReceiver"></p>'+
        ' <div class="rd-pay-error" role="alert" aria-live="polite"></div>'+
        ' <button class="rd-pay-confirm" type="submit">Подтвердить оплату</button>'+
        ' <button class="rd-pay-unpaid" type="button">Завершить без оплаты</button>'+
        ' <button class="rd-pay-cancel" type="button">Отмена</button>'+
        ' </form></section>';
      document.body.append(overlay);
      const $=sel=>overlay.querySelector(sel);
      const total=Number(order.price);
      const amount=$("#rdPayAmount"),error=$(".rd-pay-error");
      $("#rdPayTitle").textContent=complete?"Завершение заказа":"Получение оплаты";
      $("#rdPayClient").textContent=(order.name||"Клиент")+(Number.isFinite(total)&&total>0?" · "+fmt(total):"");
      amount.value=Number.isFinite(total)&&total>0?String(total):"";
      $("#rdPayReceiver").textContent=receiver==="master"?
        "Оплата отмечается как полученная мастером. Передачу денег компании фиксируем отдельно.":
        "Оплата будет отмечена как поступившая компании.";
      if(!complete||!canUnpaid)$(".rd-pay-unpaid").hidden=true;
      const updateAmount=()=>{
        $("#rdPayAdjust").hidden=!(Number.isFinite(total)&&total>0&&Number(amount.value)!==total);
      };
      amount.addEventListener("input",updateAmount);
      let settled=false;
      const onKey=e=>{
        if(e.key==="Escape"){e.preventDefault();finish(null);}
        if(e.key==="Tab"){
          const items=Array.from(overlay.querySelectorAll("button:not([hidden]),input:not([disabled])")).filter(node=>!node.closest("[hidden]"));
          const first=items[0],last=items[items.length-1];
          if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
          else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
        }
      };
      const finish=value=>{
        if(settled)return;
        settled=true;active=false;
        document.removeEventListener("keydown",onKey,true);
        overlay.remove();
        if(oldFocus?.isConnected)oldFocus.focus({preventScroll:true});
        resolve(value);
      };
      document.addEventListener("keydown",onKey,true);
      overlay.addEventListener("click",e=>{if(e.target===overlay)finish(null);});
      $(".rd-pay-close").addEventListener("click",()=>finish(null));
      $(".rd-pay-cancel").addEventListener("click",()=>finish(null));
      $(".rd-pay-unpaid").addEventListener("click",()=>finish({kind:"unpaid"}));
      $("#rdPayForm").addEventListener("submit",e=>{
        e.preventDefault();
        const value=Number(amount.value);
        const method=$('input[name="rdPayMethod"]:checked')?.value;
        if(!Number.isFinite(value)||value<=0||value>10000000||Math.round(value*100)/100!==value){
          error.textContent="Проверьте сумму оплаты.";amount.focus();return;
        }
        if(method!=="cash"&&method!=="card"){error.textContent="Выберите способ оплаты.";return;}
        finish({kind:"paid",amount:value,method});
      });
      amount.focus({preventScroll:true});
    });
  }
  window.__rdPaymentPrompt=promptPayment;
})();