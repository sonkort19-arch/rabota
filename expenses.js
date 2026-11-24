"use strict";
window.__rdCreateExpenses = function createExpenses({root, dbRequest, loadExpenses, getExpensesSnapshot, onExpenseChanged}) {
  const ZONE="Europe/Moscow";
  const CATEGORIES=["Запчасти","Расходники","Реклама","Оборудование","Транспорт","Прочее"];
  const $=id=>root.querySelector("#"+id);
  let ownerId=null, rows=null, read=null, busy=false, generation=0;
  const unconfirmed=new Map();
  const currencyFormat=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2});
  const monthFormat=new Intl.DateTimeFormat("sv-SE",{timeZone:ZONE,year:"numeric",month:"2-digit"});
  const dateFormat=new Intl.DateTimeFormat("ru-RU",{timeZone:ZONE,day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  const titleFormat=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",month:"short",year:"numeric"});
  const money=n=>currencyFormat.format(Number(n)||0)+" ₽";
  const el=(tag,className="",text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text);return n};
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
  const msg=(text,success=false)=>{const n=$("exMessage");n.textContent=text||"";n.classList.toggle("is-success",success)};
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
    $("exCount").textContent=rows ? monthRows.length+" "+(monthRows.length===1?"запись":"записей") : "—";
    $("exAllTotal").textContent="Всего: "+(rows ? money(sum(current)) : "—");
    $("exHistoryCount").textContent=rows ? monthRows.length+" записей" : "";
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
      for(const expense of unconfirmed.values())expense.historyLoaded=true;
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
  async function voidExpense(row,button){
    if(!ownerId||busy)return;
    if(!confirm("Отменить расход "+money(row.amount)+"? Запись останется в истории финансов как отменённая."))return;
    const account=generation;
    busy=true;
    button.disabled=true;
    msg("");
    try{
      await dbRequest("rpc/rabota_finance_void","POST",{p_operation_id:row.id});
    }catch(error){
      if(account!==generation)return;
      if(uncertainWrite(error)){
        msg("Не удалось подтвердить отмену. Проверьте историю расходов.");
        void refreshAfterWrite();
      }else msg(error?.message||"Не удалось отменить расход");
      button.disabled=false;
      return;
    }finally{
      if(account===generation)busy=false;
    }
    if(account!==generation)return;
    rows=rows?.filter(item=>item.id!==row.id) ?? null;
    draw();
    msg("Расход отменён. Учёт кассы обновлён.",true);
    void refreshAfterWrite();
  }
  async function submit(event){
    event.preventDefault();
    if(!ownerId||busy)return;
    const amount=parseAmount($("exAmount").value);
    if(amount===null){msg("Укажи корректную сумму от 0,01 до 10 000 000 ₽.");return}
    const category=$("exCategory").value;
    if(!CATEGORIES.includes(category)){msg("Выбери категорию.");return}
    const detail=$("exDetail").value.trim().replace(/\s+/g," ");
    const order=$("exOrder").value.trim();
    if(order&&!/^\d{1,8}$/.test(order)){msg("Номер заказа должен содержать только цифры.");return}
    const note="["+category+"]"+(detail?" "+detail:"")+(order?" · Заказ №"+order:"");
    if(note.length>240){msg("Сократи описание расхода.");return}
    const intent=JSON.stringify([amount,note]);
    const previous=unconfirmed.get(intent);
    if(previous){
      if(!previous.historyLoaded){msg("Обновите историю и проверьте, появился ли расход.");return}
      if(!confirm("Проверьте историю. Подтвердите, что предыдущая запись не появилась и расход нужно сохранить."))return;
    }
    const account=generation;
    busy=true;
    $("exSave").disabled=true;
    msg("");
    try{
      await dbRequest("rpc/rabota_finance_record","POST",{
        p_kind:"expense",p_amount:amount,p_master_user_id:null,p_note:note
      });
    }catch(error){
      if(account===generation){
        if(uncertainWrite(error)){
          unconfirmed.set(intent,{historyLoaded:false});
          selectedMonth=null;
          draw();
          msg("Не удалось подтвердить запись. Проверьте историю расходов перед повтором.");
          void refreshAfterWrite();
        }else msg(error?.message||"Не удалось сохранить расход.");
      }
      return;
    }finally{
      if(account===generation){
        busy=false;
        $("exSave").disabled=false;
      }
    }
    if(account!==generation)return;
    unconfirmed.delete(intent);
    selectedMonth=null;
    draw();
    $("exForm").reset();
    if(root.getClientRects().length)$("exAmount").focus({preventScroll:true});
    msg("Расход "+money(amount)+" сохранён в финансах.",true);
    void refreshAfterWrite();
  }
  function reset(){
    generation++;
    ownerId=null;
    rows=null;
    read=null;
    busy=false;
    selectedMonth=null;
    unconfirmed.clear();
    $("exForm").reset();
    $("exSave").disabled=false;
    msg("");
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
  $("exForm").addEventListener("submit",event=>void submit(event));
  $("exRetry").addEventListener("click",()=>void refresh());
  return {open,refresh,reset};
};
