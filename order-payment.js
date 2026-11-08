/* CRM «Работа»: компактное подтверждение оплаты без автоматической клавиатуры. */
"use strict";
(()=>{
  let active=false;
  const fmt=value=>Number(value).toLocaleString("ru-RU",{maximumFractionDigits:2})+" ₽";
  function promptPayment(order,{complete=true,canUnpaid=true,receiver="company"}={}){
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
        '   <div class="rd-pay-sum-top"><span id="rdPaySumLabel">К получению</span>'+
        '    <button class="rd-pay-change" type="button" aria-controls="rdPayAmount" aria-expanded="false">Изменить</button></div>'+
        '   <div class="rd-pay-sum-view" aria-live="polite"><strong id="rdPaySumValue"></strong></div>'+
        '   <div class="rd-pay-sum-edit" hidden><label class="rd-pay-sr-only" for="rdPayAmount">Сумма оплаты в рублях</label>'+
        '    <input id="rdPayAmount" type="number" inputmode="decimal" min="0.01" max="10000000" step="0.01" required>'+
        '    <span aria-hidden="true">₽</span><button class="rd-pay-edit-done" type="button">Готово</button></div>'+
        '  </div>'+
        '  <p class="rd-pay-adjust" id="rdPayAdjust" hidden>Новая сумма станет стоимостью заказа.</p>'+
        '  <fieldset><legend>Способ оплаты</legend>'+
        '   <div class="rd-pay-methods">'+
        '    <label class="rd-pay-method"><input type="radio" name="rdPayMethod" value="cash" checked><span>Наличные</span></label>'+
        '    <label class="rd-pay-method"><input type="radio" name="rdPayMethod" value="card"><span>Карта / перевод</span></label>'+
        '   </div></fieldset>'+
        '  <p class="rd-pay-receiver" id="rdPayReceiver"></p>'+
        '  <div class="rd-pay-footer"><div class="rd-pay-error" role="alert" aria-live="polite"></div>'+
        '   <button class="rd-pay-confirm" type="submit">Подтвердить оплату</button>'+
        '   <button class="rd-pay-unpaid" type="button">Завершить без оплаты</button>'+
        '   <button class="rd-pay-cancel" type="button">Отмена</button></div>'+
        ' </form></section>';
      document.body.append(overlay);
      const $=selector=>overlay.querySelector(selector);
      const dialog=$(".rd-pay-dialog");
      const input=$("#rdPayAmount");
      const total=Number(order.price);
      const originalAmount=Number.isFinite(total)&&total>0?total:null;
      const error=$(".rd-pay-error");
      const change=$(".rd-pay-change");
      const view=$(".rd-pay-sum-view");
      const editor=$(".rd-pay-sum-edit");
      const confirm=$(".rd-pay-confirm");
      $("#rdPayTitle").textContent=complete?"Завершение заказа":"Получение оплаты";
      $("#rdPayClient").textContent=order.name||"Клиент";
      input.value=originalAmount===null?"":String(originalAmount);
      $("#rdPayReceiver").textContent=receiver==="master"?
        "Деньги получает мастер. Передача доли компании учитывается отдельно.":
        "Оплата отмечается как поступившая компании.";
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

      const currentValue=()=>{
        if(!input.value.trim())return null;
        const amount=Number(input.value);
        return Number.isFinite(amount)&&amount>0&&amount<=10000000&&
          Math.round(amount*100)/100===amount?amount:null;
      };
      const updateSum=()=>{
        const amount=currentValue();
        $("#rdPaySumValue").textContent=amount===null?"Сумма не указана":fmt(amount);
        confirm.textContent=amount===null?"Укажите сумму":"Получено "+fmt(amount);
        confirm.disabled=amount===null;
        $("#rdPayAdjust").hidden=amount===null||originalAmount===null||amount===originalAmount;
        return amount;
      };
      const setEditing=editing=>{
        view.hidden=editing;
        editor.hidden=!editing;
        change.setAttribute("aria-expanded",String(editing));
        change.textContent=editing?"Редактирование":"Изменить";
        if(editing){
          input.focus({preventScroll:true});
          input.select?.();
        }else{
          input.blur();
          updateSum();
          change.focus({preventScroll:true});
        }
      };
      input.addEventListener("input",()=>{error.textContent="";updateSum();});
      change.addEventListener("click",()=>{if(editor.hidden)setEditing(true);else setEditing(false);});
      $(".rd-pay-edit-done").addEventListener("click",()=>{
        if(currentValue()===null){error.textContent="Введите сумму больше нуля.";input.focus();return;}
        setEditing(false);
      });
      updateSum();

      let settled=false;
      const finish=value=>{
        if(settled)return;
        settled=true;active=false;
        document.removeEventListener("keydown",onKey,true);
        viewport?.removeEventListener("resize",syncViewport);
        viewport?.removeEventListener("scroll",syncViewport);
        overlay.remove();
        if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
        resolve(value);
      };
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
        const amount=currentValue();
        if(amount===null){
          error.textContent="Проверьте сумму оплаты.";
          if(editor.hidden)setEditing(true);else input.focus();
          return;
        }
        const method=$('input[name="rdPayMethod"]:checked')?.value;
        if(method!=="cash"&&method!=="card"){error.textContent="Выберите способ оплаты.";return;}
        finish({kind:"paid",amount,method});
      });
      // Focus the dialog itself, not the numeric input: do not summon the iPhone keyboard.
      dialog.focus({preventScroll:true});
    });
  }
  window.__rdPaymentPrompt=promptPayment;
})();