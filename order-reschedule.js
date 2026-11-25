(function(root){
  "use strict";
  const moveStates=new Set(["saved","occupied","stale","unavailable","invalid_time"]);
  const timeFormat=new Intl.DateTimeFormat("ru-RU",{
    dateStyle:"short",timeStyle:"short",timeZone:"Europe/Moscow"
  });
  const hhmm=value=>String(value??"").slice(0,5);
  function describeSlot(date,time){
    const day=String(date??"").split("-").reverse().join(".");
    return day&&time?day+" в "+hhmm(time):"Время не указано";
  }
  function canMove(order){
    return Boolean(order?.id&&order.assignedUserId&&
      (order.status==="Записан"||order.status==="В работе")&&!order.paid&&order.paymentAmount==null&&
      !order.paidAt&&!order.paidBy&&!order.paymentMethod&&!order.paymentReceivedBy);
  }
  function createRescheduleModel({request,writeIntents,getActor,getScope=()=>null}){
    async function move(payload){
      const actor=getActor(),scope=getScope();
      if(!actor)throw Error("Войдите в CRM перед переносом заказа.");
      const intent=await writeIntents.get(actor,payload);
      if(actor!==getActor()||scope!==getScope())throw Error("Сеанс изменился. Откройте заказ снова.");
      let result;
      try{
        result=await request("rpc/rabota_reschedule_order","POST",{
          ...payload,p_request_id:intent.requestId
        });
        if(!moveStates.has(result?.state)||
          result.state==="saved"&&(!result.event?.new_date||!result.event?.new_time))
          throw Error("Сервер не подтвердил перенос.");
      }catch(cause){
        if(!cause.status||cause.status>=500||["55P03","57014","40001","40P01"].includes(cause.code)){
          const error=Error("Подтверждение пока не пришло. Нажмите «Проверить перенос».");
          error.uncertain=true;
          throw error;
        }
        await writeIntents.finish(intent).catch(()=>{});
        throw cause;
      }
      await writeIntents.finish(intent).catch(()=>{});
      return result;
    }
    async function history(orderId){
      const rows=await request("rpc/rabota_order_reschedule_history","POST",{p_order_id:orderId});
      if(!Array.isArray(rows))throw Error("Сервер не вернул историю переносов.");
      return rows;
    }
    return {move,history};
  }
  function createReschedule({request,getActor,getScope,getOrders,reloadOrders,focusModal,writeIntents}){
    const model=createRescheduleModel({request,getActor,getScope,writeIntents});
    const historyCache=new Map();
    let active=null;
    function node(tag,cls,value){
      const element=root.document.createElement(tag);
      if(cls)element.className=cls;
      if(value)element.textContent=value;
      return element;
    }
    function button(label,cls,action){
      const control=node("button",cls,label);
      control.type="button";
      control.addEventListener("click",action);
      return control;
    }
    function close(restoreFocus=true){
      if(!active)return;
      const {overlay,release,opener}=active;
      active=null;
      overlay.remove();
      release(restoreFocus);
      if(restoreFocus&&!opener?.isConnected)
        root.document.querySelector(".rd-order-dialog .rd-order-move, .rd-order-dialog .rd-order-close")?.focus({preventScroll:true});
    }
    function createHistory(order,{opened=false}={}){
      const details=node("details","rd-reschedule-history");
      const content=node("div","rd-reschedule-history-content");
      details.append(node("summary","","История переносов"),content);
      let complete=false,loading=false;
      async function load(){
        if(complete||loading)return;
        loading=true;
        content.textContent="Загружаем историю…";
        try{
          const key=String(order.id);
          let entry=historyCache.get(key);
          if(!entry||entry.revision!==order.updatedAt){
            entry={revision:order.updatedAt,rows:model.history(key)};
            historyCache.set(key,entry);
          }
          const rows=await entry.rows;
          complete=true;
          content.replaceChildren();
          if(!rows.length){content.textContent="Переносов пока не было.";return;}
          const list=node("ul","rd-reschedule-history-list");
          for(const event of rows){
            const item=node("li");
            const stamp=new Date(event.moved_at);
            item.append(node("strong","",describeSlot(event.previous_date,event.previous_time)+
              " → "+describeSlot(event.new_date,event.new_time)),
              node("span","",[event.actor_name,Number.isFinite(stamp.getTime())?timeFormat.format(stamp):""]
                .filter(Boolean).join(" · ")));
            list.append(item);
          }
          content.append(list);
        }catch(_){
          historyCache.delete(String(order.id));
          content.textContent="Не удалось загрузить историю. ";
          content.append(button("Повторить","secondary",load));
        }finally{loading=false;}
      }
      details.addEventListener("toggle",()=>{if(details.open)void load();});
      details.open=opened;
      return details;
    }
    function open(order,opener){
      const core=root.__rdQuickSlots?.core;
      if(active||!core||!canMove(order))return;
      let current=order,selection=null,pending=null,busy=false,needsRefresh=false;
      const unavailable=[];
      const overlay=node("div","rd-reschedule");
      const dialog=node("section","rd-reschedule-dialog");
      const title=node("h2","","Перенести заказ");
      title.id="rdRescheduleTitle";
      dialog.setAttribute("role","dialog");
      dialog.setAttribute("aria-modal","true");
      dialog.setAttribute("aria-labelledby",title.id);
      dialog.tabIndex=-1;
      const dismiss=()=>{if(!busy&&active?.overlay===overlay)close();};
      const exit=button("×","rd-reschedule-close",dismiss);
      exit.setAttribute("aria-label","Закрыть перенос");
      const name=node("p","rd-reschedule-customer",
        [order.name||"Без имени",order.referenceCode||(order.orderNumber?"№ "+order.orderNumber:"")]
          .filter(Boolean).join(" · "));
      const oldSlot=node("p","rd-reschedule-current");
      const master=node("p","rd-reschedule-master");
      const slots=node("div","rd-reschedule-slots");
      const date=node("input"),time=node("input");
      date.id="rdRescheduleDate";date.type="date";
      time.id="rdRescheduleTime";time.type="time";
      const manual=node("div","rd-reschedule-manual");
      manual.hidden=true;
      for(const [input,label] of [[date,"Новая дата"],[time,"Новое время"]]){
        const group=node("label","rd-reschedule-field",label);
        group.htmlFor=input.id;
        group.append(input);
        manual.append(group);
      }
      const other=button("Выбрать другую дату","secondary",()=>{
        manual.hidden=!manual.hidden;
        other.setAttribute("aria-expanded",String(!manual.hidden));
        selection=null;time.value="";
        if(!manual.hidden){
          date.value=date.min;
          date.focus({preventScroll:true});
        }
        status.textContent="";
        showSlots();
      });
      other.setAttribute("aria-expanded","false");
      const status=node("p","rd-reschedule-status");
      status.setAttribute("role","status");
      const confirm=button("Подтвердить перенос","primary",submit);
      const choices=node("div","rd-reschedule-choices");
      choices.append(slots,other,manual);
      dialog.append(exit,title,name,oldSlot,master,choices,status,confirm);
      overlay.append(dialog);
      overlay.addEventListener("click",event=>{if(event.target===overlay)dismiss();});
      date.addEventListener("change",()=>{
        selection=null;time.value="";
        status.textContent="";
        showSlots();
      });
      time.addEventListener("change",()=>{
        selection=null;
        const option={date:date.value,time:time.value};
        if(date.value&&time.value){
          const result=core.rescheduleTimeState({...slotInput(),...option});
          if(result==="available")selection=option;
          status.textContent={
            busy:"Это время занято. Выберите другое.",same:"Заказ уже записан на это время.",
            past:"Выберите время в будущем с запасом не менее 20 минут.",
            unknown:"Проверьте дату, время и доступность мастера."
          }[result]||"";
        }
        syncControls();
      });
      function isCurrent(){return active?.overlay===overlay;}
      function slotInput(){return {order:current,orders:getOrders(),unavailable};}
      function renderOrder(){
        oldSlot.textContent="Сейчас · "+describeSlot(current.date,current.time);
        master.textContent=current.master||"";
        master.hidden=!current.master;
        date.min=core.moscowClock(new Date()).today;
      }
      function showSlots(){
        const options=canMove(current)?core.rescheduleSlots({...slotInput(),
          date:manual.hidden?undefined:date.value}):[];
        slots.replaceChildren();
        for(const option of options){
          const optionButton=button(describeSlot(option.date,option.time),"secondary rd-reschedule-slot",()=>{
            selection=option;
            if(!manual.hidden)time.value=option.time;
            status.textContent="";
            syncControls();
          });
          optionButton.dataset.rescheduleSlot="";
          optionButton.dataset.date=option.date;
          optionButton.dataset.time=option.time;
          if(option.recommended)optionButton.append(node("small","","Рекомендуем"));
          slots.append(optionButton);
        }
        if(!options.length)slots.append(node("p","rd-reschedule-empty","Свободных окон для подбора пока нет."));
        syncControls();
      }
      function syncControls(){
        const locked=busy||Boolean(pending)||needsRefresh||!canMove(current);
        for(const option of slots.querySelectorAll("button")){
          option.disabled=locked;
          option.setAttribute("aria-pressed",String(selection?.date===option.dataset.date&&selection?.time===option.dataset.time));
        }
        other.disabled=date.disabled=time.disabled=locked;
        exit.disabled=busy;
        confirm.disabled=busy||!selection&&!pending&&!needsRefresh||!canMove(current)&&!needsRefresh&&!pending;
        confirm.textContent=busy?"Подождите…":pending?"Проверить перенос":
          needsRefresh?"Обновить расписание":"Подтвердить перенос";
      }
      async function updateOptions(message){
        selection=null;
        needsRefresh=true;
        status.textContent=message;
        try{
          await reloadOrders();
          if(!isCurrent())return;
          current=getOrders().find(item=>String(item.id)===String(order.id))??null;
          needsRefresh=false;
          if(current)renderOrder();
          if(!canMove(current))status.textContent="Этот заказ сейчас нельзя перенести.";
          time.value="";
          showSlots();
        }catch(_){
          if(isCurrent())status.textContent=message+" Не удалось обновить расписание. Повторите проверку.";
        }
      }
      function showSuccess(event,isLatest){
        historyCache.delete(String(order.id));
        const moved={...order,date:event.new_date,time:hhmm(event.new_time)};
        title.textContent="Заказ перенесён";
        oldSlot.textContent="Новая запись · "+describeSlot(moved.date,moved.time);
        status.textContent=isLatest?"":"Перенос был записан. С тех пор время заказа изменилось.";
        const done=button("Готово","primary",dismiss);
        choices.replaceChildren();
        confirm.replaceWith(done);
        exit.disabled=false;
        done.focus({preventScroll:true});
        async function refreshSaved(){
          choices.replaceChildren();
          try{
            await reloadOrders();
            if(!isCurrent()||!isLatest)return;
            const latest=getOrders().find(item=>String(item.id)===String(order.id));
            if(latest?.date!==moved.date||latest?.time!==moved.time||
              !["Записан","В работе"].includes(latest.status)){
              status.textContent="Перенос был записан. С тех пор заказ изменился.";
              return;
            }
            status.textContent="";
            const whatsapp=root.__rdClientWhatsApp;
            if(!whatsapp?.normalizePhone(latest.phone))return;
            const link=node("a","secondary rd-reschedule-whatsapp","Открыть WhatsApp");
            link.href=whatsapp.rescheduleLink(latest);
            link.target="_blank";
            link.rel="noopener noreferrer";
            choices.append(node("p","","Отправить клиенту сообщение о переносе?"),link);
          }catch(_){
            if(!isCurrent())return;
            status.textContent="Заказ перенесён. Список пока не обновился.";
            choices.append(button("Обновить расписание","secondary",refreshSaved));
          }
        }
        void refreshSaved();
      }
      async function submit(){
        if(busy||!isCurrent()||(!selection&&!pending&&!needsRefresh))return;
        busy=true;
        syncControls();
        try{
          if(needsRefresh){await updateOptions("Выберите время после обновления расписания.");return;}
          pending??={
            p_order_id:String(current.id),p_expected_updated_at:current.updatedAt??null,
            p_appointment_date:selection.date,p_appointment_time:selection.time
          };
          const result=await model.move(pending);
          if(!isCurrent())return;
          const attempt=pending;
          pending=null;
          if(result.state==="saved"){
            busy=false;
            showSuccess(result.event,result.current!==false);
          }else if(result.state==="occupied"){
            unavailable.push({date:attempt.p_appointment_date,time:attempt.p_appointment_time});
            await updateOptions("Это время уже занято. Выберите другое окно.");
          }else if(result.state==="stale"){
            await updateOptions("Заказ изменился. Проверьте актуальное время и выберите новое окно.");
          }else{
            selection=null;time.value="";
            status.textContent=result.state==="invalid_time"?"Выберите другое время для переноса.":
              "Этот заказ сейчас нельзя перенести.";
            if(result.state==="unavailable")current=null;
            showSlots();
          }
        }catch(error){
          if(!isCurrent())return;
          if(!error.uncertain)pending=null;
          status.textContent=error.message||"Не удалось сохранить перенос.";
        }finally{
          if(isCurrent()){busy=false;syncControls();}
        }
      }
      root.document.body.append(overlay);
      active={overlay,opener,release:focusModal(overlay,dialog,dismiss,{opener,initial:dialog})};
      renderOrder();
      showSlots();
    }
    return {open,close,createHistory,isOpen:()=>Boolean(active),
      reset:()=>{close(false);historyCache.clear();}};
  }
  if(root)root.__rdCreateReschedule=createReschedule;
  if(typeof module!=="undefined"&&module.exports)module.exports={createRescheduleModel,canMove};
  if(root)root.__rdCanReschedule=canMove;
})(typeof window!=="undefined"?window:null);
