"use strict";
window.__rdCreateExpenses = function createExpenses({root, dbRequest, loadExpenses, getExpensesSnapshot, onExpenseChanged}) {
  const ZONE="Europe/Moscow";
  const CATEGORIES=["Запчасти","Расходники","Реклама","Оборудование","Транспорт","Прочее"];
  const $=id=>root.querySelector("#"+id);
  const createButton=root.ownerDocument.getElementById("newExpenseBtn");
  const dialog=root.ownerDocument.getElementById("exDialog");
  const editor=id=>dialog.querySelector("#"+id);
  const form=editor("exForm");
  const viewport=window.visualViewport;
  const writeIntents=window.__rdCreateWriteIntents("expense");
  const receiptId=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  let ownerId=null,rows=null,read=null,busy=false,generation=0,choice=null;
  const currencyFormat=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2});
  const countRules=new Intl.PluralRules("ru-RU");
  const countLabels={one:"запись",few:"записи",many:"записей"};
  const monthFormat=new Intl.DateTimeFormat("sv-SE",{timeZone:ZONE,year:"numeric",month:"2-digit"});
  const dateFormat=new Intl.DateTimeFormat("ru-RU",{timeZone:ZONE,day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  const titleFormat=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",month:"short",year:"numeric"});
  const money=n=>currencyFormat.format(Number(n)||0)+" ₽";
  const el=(tag,className="",text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text);return n};
  const retryButton=el("button","ex-save primary","Проверить и повторить предыдущий расход");
  const newButton=el("button","ex-save secondary","Создать отдельный расход");
  retryButton.type=newButton.type="button";
  retryButton.hidden=newButton.hidden=true;
  form.append(retryButton,newButton);
  const moscowMonth=()=>monthFormat.format(new Date());
  let selectedMonth=null, renderedMonth=null;
  const monthOf=stamp=>monthFormat.format(new Date(stamp));
  const fmtDate=stamp=>dateFormat.format(new Date(stamp));
  const monthTitle=iso=>{
    const d=new Date(iso+"-01T12:00:00Z");
    const text=titleFormat.format(d);
    return text.charAt(0).toUpperCase()+text.slice(1);
  };
  const shiftMonth=(iso,delta)=>{
    const d=new Date(iso+"-01T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth()+delta);
    return d.toISOString().slice(0,7);
  };
  const sum=a=>Math.round(a.reduce((acc,x)=>acc+Number(x.amount||0),0)*100)/100;
  function setStatus(text,success=false){
    const status=$("exStatus");
    status.textContent=text;
    status.classList.toggle("is-success",success);
  }
  function setEditorStatus(text,decision=null){
    choice=decision;
    editor("exMessage").textContent=text;
    setSaving(busy);
  }
  function syncDialogViewport(){
    if(!viewport)return;
    dialog.style.setProperty("--ex-viewport-top",viewport.offsetTop+"px");
    dialog.style.setProperty("--ex-viewport-height",viewport.height+"px");
  }
  function openEditor(){
    if(!ownerId||root.hidden||createButton.hidden||busy||dialog.open)return;
    syncDialogViewport();
    dialog.showModal();
    viewport?.addEventListener("resize",syncDialogViewport);
    viewport?.addEventListener("scroll",syncDialogViewport);
    setStatus("");
  }
  function closeEditor(){
    if(dialog.open)dialog.close();
    viewport?.removeEventListener("resize",syncDialogViewport);
    viewport?.removeEventListener("scroll",syncDialogViewport);
    form.reset();
    setEditorStatus("");
  }
  function close(){
    if(dialog.open)closeEditor();
  }
  function setSaving(saving){
    editor("exFields").disabled=saving||Boolean(choice);
    editor("exClose").disabled=saving;
    const save=editor("exSave");
    save.disabled=saving;
    save.hidden=Boolean(choice);
    save.textContent=saving?"Сохраняем…":"Сохранить расход";
    retryButton.hidden=newButton.hidden=!choice;
    retryButton.disabled=newButton.disabled=saving;
    retryButton.textContent=choice?.receipt?"Закрыть без новой записи":"Проверить и повторить предыдущий расход";
  }
  const parseAmount=value=>{
    const cleaned=String(value||"").replace(/[\s\u00a0\u202f]/g,"").replace(",",".");
    if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(cleaned))return null;
    const n=Number(cleaned);
    return Number.isSafeInteger(Math.round(n*100))&&n>0&&n<=10000000?Math.round(n*100)/100:null;
  };
  function setLoadStatus(text, error=false){
    $("exLoadStatus").textContent=text;
    $("exRetry").hidden=!error;
    $("exLoad").hidden=!text;
  }
  function useOperations(operations){
    const expenses=operations.filter(row=>row.kind==="expense");
    if(JSON.stringify(rows)===JSON.stringify(expenses))return;
    rows=expenses;
    draw();
  }
  function parseNote(value){
    const s=String(value||"").trim();
    const matched=s.match(/^\[([^\]]{1,25})\](?:\s+(.*))?$/s);
    if(matched&&CATEGORIES.includes(matched[1]))return {category:matched[1],details:matched[2]||""};
    return {category:"Прочее",details:s};
  }
  function draw(){
    const month=selectedMonth||moscowMonth();
    renderedMonth=month;
    const current=rows?.filter(row=>!row.voided_at) ?? [];
    const monthRows=current.filter(row=>monthOf(row.created_at)===month);
    $("exMonth").textContent=monthTitle(month);
    $("exMonthlyTotal").textContent=rows ? money(sum(monthRows)) : "—";
    const count=monthRows.length;
    $("exCount").textContent=rows ? count+" "+countLabels[countRules.select(count)] : "—";
    $("exAllTotal").textContent="Всего: "+(rows ? money(sum(current)) : "—");
    const totals=new Map();
    for(const row of monthRows){
      const name=parseNote(row.note).category;
      totals.set(name,(totals.get(name)||0)+Number(row.amount||0));
    }
    const breakdown=$("exCategoryTotals");
    breakdown.replaceChildren();
    for(const [category,total] of [...totals].sort((a,b)=>b[1]-a[1]))
      breakdown.append(el("span","ex-category",category+" · "+money(total)));
    breakdown.hidden=totals.size===0;
    const list=$("exList");
    list.replaceChildren();
    $("exEmpty").hidden=!rows||monthRows.length>0;
    monthRows.forEach(row=>{
      const note=parseNote(row.note),item=el("article","ex-item");
      const head=el("div","ex-item-head"),left=el("div","ex-item-title");
      left.append(el("strong","",note.category));
      if(note.details)left.append(el("p","",note.details));
      head.append(left,el("span","ex-item-amount",money(row.amount)));
      const foot=el("div","ex-item-foot");
      foot.append(el("span","",fmtDate(row.created_at)));
      if(row.order_id===null){
        const cancel=el("button","ex-cancel","Отменить");
        cancel.type="button";
        cancel.setAttribute("aria-label","Отменить расход "+money(row.amount));
        cancel.addEventListener("click",()=>void voidExpense(row,cancel));
        foot.append(cancel);
      }
      item.append(head,foot);
      list.append(item);
    });
  }
  function refresh(ledger=null){
    if(!ownerId)return;
    if(!selectedMonth&&renderedMonth!==moscowMonth())draw();
    if(read&&!ledger)return read;
    setLoadStatus(ledger?"Проверяем итоги после операции…":rows?"":"Загружаем историю расходов…");
    const pending=(ledger||loadExpenses()).then(operations=>{
      if(read!==pending)return;
      useOperations(operations);
      setLoadStatus("");
    }).catch(error=>{
      if(read!==pending)return;
      if(error?.status===401||error?.status===403||error?.code==="42501"){
        rows=null;
        draw();
      }
      const message=error instanceof TypeError ? "Проверьте подключение к интернету." : error?.message;
      setLoadStatus((rows?"Показан последний загруженный итог. ":"")+"Не удалось обновить расходы. "+(message||""),true);
    }).finally(()=>{
      if(read===pending)read=null;
    });
    read=pending;
    return pending;
  }
  function refreshAfterWrite(){
    // Both views need the same operation history after the write.
    return refresh(onExpenseChanged());
  }
  function uncertainWrite(error){return error instanceof TypeError||Number(error?.status)>=500}
  function denied(error){return [401,403].includes(Number(error?.status))||error?.code==="42501"}
  async function expenseReceipt(actor,payload,intent){
    let records;
    try{
      records=await dbRequest("rabota_finance_operations?select=id,kind,amount,note,request_id,created_by&request_id=eq."+
        encodeURIComponent(intent.requestId)+"&limit=1","GET");
    }catch(error){
      if(denied(error))throw error;
      return null;
    }
    const entry=Array.isArray(records)?records.find(row=>row?.request_id===intent.requestId):null;
    if(!entry)return null;
    if(typeof entry.id!=="string"||!receiptId.test(entry.id)||entry.created_by!==actor||entry.kind!=="expense"||
      Number(entry.amount)!==payload.p_amount||entry.note!==payload.p_note)
      throw Error("Реквизиты сохранённой операции расходятся. Проверьте историю расходов.");
    return entry.id;
  }
  async function finishIntent(intent){
    try{await writeIntents.finish(intent)}catch(error){console.warn("Не удалось очистить номер подтверждённого расхода.",error);}
  }
  async function saveExpense(payload,{retry=null,confirmedReceipt=null,independent=false,acknowledged=null}={}){
    const account=generation,actor=ownerId;
    busy=true;
    setEditorStatus("Проверяем запись…");
    let intent=retry,submitted=false;
    try{
      let receipt=null;
      if(retry){
        receipt=confirmedReceipt??await expenseReceipt(actor,payload,retry);
        if(!receipt&&account===generation){
          const persisted=await writeIntents.find(actor,payload);
          if(!persisted.some(candidate=>candidate.requestId===retry.requestId))
            throw Object.assign(Error("Запись не отправлена. Номер предыдущего расхода не найден в этой вкладке."),
              {code:"WRITE_INTENT_STORAGE"});
        }
      }
      else{
        if(!independent){
          const previous=await writeIntents.find(actor,payload);
          const candidate=previous.at(-1);
          if(candidate&&account===generation){
            const known=await expenseReceipt(actor,payload,candidate);
            if(account===generation&&dialog.open)
              setEditorStatus(known?"Предыдущий расход уже сохранён.":"Предыдущий расход с такими данными не подтверждён.",
                {payload,intent:candidate,receipt:known});
            return;
          }
        }
        if(account!==generation)return;
        if(acknowledged)await finishIntent(acknowledged);
        if(account!==generation)return;
        intent=await writeIntents.begin(actor,payload);
      }
      if(account!==generation){
        if(!retry&&intent)await finishIntent(intent);
        return;
      }
      if(!receipt){
        editor("exMessage").textContent="Сохраняем…";
        submitted=true;
        receipt=await dbRequest("rpc/rabota_record_expense_v1","POST",{...payload,p_request_id:intent.requestId});
        if(typeof receipt!=="string"||!receiptId.test(receipt))
          throw Error("Не удалось получить подтверждение расхода.");
      }
      await finishIntent(intent);
    }catch(error){
      if(account!==generation)return;
      const status=Number(error?.status);
      const definite=status>=400&&status<500&&status!==408&&error?.code!=="23505";
      if(submitted&&definite&&!retry)await finishIntent(intent);
      if(account!==generation)return;
      const pending=intent&&(retry||submitted&&!definite);
      const message=pending&&error?.code!=="WRITE_INTENT_STORAGE"
        ?"Не удалось подтвердить запись. Проверьте предыдущий расход или создайте отдельный."
        :error?.message||"Не удалось сохранить расход.";
      if(dialog.open)setEditorStatus(message,pending?{payload,intent}:null);
      else setStatus(message);
      if(submitted&&!definite){
        selectedMonth=null;
        draw();
        void refreshAfterWrite();
      }
      return;
    }finally{
      if(account===generation){
        busy=false;
        setSaving(false);
        if(choice&&dialog.open)retryButton.focus({preventScroll:true});
      }
    }
    if(account!==generation)return;
    selectedMonth=null;
    draw();
    closeEditor();
    setStatus("Расход "+money(payload.p_amount)+" сохранён.",true);
    void refreshAfterWrite();
  }
  async function voidExpense(row,button){
    if(!ownerId||busy)return;
    if(!confirm("Отменить расход "+money(row.amount)+"? Запись останется в истории финансов как отменённая."))return;
    const account=generation;
    busy=true;
    button.disabled=true;
    setStatus("");
    try{
      await dbRequest("rpc/rabota_finance_void","POST",{p_operation_id:row.id});
    }catch(error){
      if(account!==generation)return;
      if(uncertainWrite(error)){
        setStatus("Не удалось подтвердить отмену. Проверьте историю расходов.");
        void refreshAfterWrite();
      }else setStatus(error?.message||"Не удалось отменить расход");
      button.disabled=false;
      return;
    }finally{
      if(account===generation)busy=false;
    }
    if(account!==generation)return;
    rows=rows?.filter(item=>item.id!==row.id) ?? null;
    draw();
    setStatus("Расход отменён.",true);
    void refreshAfterWrite();
  }
  async function submit(event){
    event.preventDefault();
    if(!ownerId||busy||choice||!dialog.open||root.hidden)return;
    const amount=parseAmount(editor("exAmount").value);
    if(amount===null){setEditorStatus("Укажите сумму от 0,01 до 10 000 000 ₽.");return}
    const category=editor("exCategory").value;
    if(!CATEGORIES.includes(category)){setEditorStatus("Выберите категорию.");return}
    const detail=editor("exDetail").value.trim().replace(/\s+/g," ");
    const order=editor("exOrder").value.trim();
    if(order&&!/^\d{1,8}$/.test(order)){setEditorStatus("Номер заказа должен содержать только цифры.");return}
    const note="["+category+"]"+(detail?" "+detail:"")+(order?" · Заказ №"+order:"");
    if(note.length>240){setEditorStatus("Сократите описание расхода.");return}
    await saveExpense({p_amount:amount,p_note:note});
  }
  function reset(){
    generation++;
    ownerId=null;
    rows=null;
    read=null;
    busy=false;
    selectedMonth=null;
    closeEditor();
    setSaving(false);
    setStatus("");
    setLoadStatus("");
    draw();
  }
  function open(userId){
    if(!userId)return;
    if(ownerId!==userId){
      reset();
      ownerId=userId;
      const operations=getExpensesSnapshot?.();
      if(operations)useOperations(operations);
    }
    return refresh();
  }
  function changeMonth(offset){
    selectedMonth=shiftMonth(renderedMonth||moscowMonth(),offset);
    draw();
  }
  $("exPrev").addEventListener("click",()=>changeMonth(-1));
  $("exNext").addEventListener("click",()=>changeMonth(1));
  createButton.addEventListener("click",openEditor);
  editor("exClose").addEventListener("click",()=>{if(!busy)close()});
  dialog.addEventListener("cancel",event=>{
    event.preventDefault();
    if(!busy)close();
  });
  form.addEventListener("submit",event=>void submit(event));
  retryButton.addEventListener("click",()=>{
    if(ownerId&&!busy&&choice&&dialog.open&&!root.hidden)
      void saveExpense(choice.payload,{retry:choice.intent,confirmedReceipt:choice.receipt});
  });
  newButton.addEventListener("click",()=>{
    if(ownerId&&!busy&&choice&&dialog.open&&!root.hidden)
      void saveExpense(choice.payload,{independent:true,acknowledged:choice.receipt?choice.intent:null});
  });
  $("exRetry").addEventListener("click",()=>void refresh());
  return {open,refresh,reset,close};
};
