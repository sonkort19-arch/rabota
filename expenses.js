"use strict";
(() => {
  const BASE="https://yedzfmibceboncrytbqz.supabase.co";
  const KEY="sb_publishable_tSqbw3aeAgxYuzHhQurCuw_yDze4ZNn";
  const STORAGE="rabota-auth-session-v1";
  const ZONE="Europe/Moscow";
  const CATEGORIES=["Запчасти","Расходники","Реклама","Оборудование","Транспорт","Прочее"];
  const $=id=>document.getElementById(id);
  let session=null,refreshPromise=null,ownerId=null,rows=[],busy=false,loading=false,month="";
  try{session=JSON.parse(localStorage.getItem(STORAGE)||"null")}catch(_){session=null}
  const money=n=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Number(n)||0)+" ₽";
  const el=(tag,className="",text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text);return n};
  const moscowMonth=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:ZONE,year:"numeric",month:"2-digit"}).format(new Date());
  const monthOf=stamp=>new Intl.DateTimeFormat("sv-SE",{timeZone:ZONE,year:"numeric",month:"2-digit"}).format(new Date(stamp));
  const fmtDate=stamp=>new Intl.DateTimeFormat("ru-RU",{timeZone:ZONE,day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(stamp));
  const monthTitle=iso=>{
    const d=new Date(iso+"-01T12:00:00Z");
    const text=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC",month:"short",year:"numeric"}).format(d);
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
  function saveSession(data){
    session={access_token:data.access_token,refresh_token:data.refresh_token,
      expires_at:Math.floor(Date.now()/1000)+Number(data.expires_in||3600)};
    localStorage.setItem(STORAGE,JSON.stringify(session));
  }
  async function ensureSession(){
    if(!session?.refresh_token)throw new Error("Сначала войдите в CRM «Работа».");
    if(Number(session.expires_at||0)>Math.floor(Date.now()/1000)+90)return;
    if(!refreshPromise)refreshPromise=(async()=>{
      const response=await fetch(BASE+"/auth/v1/token?grant_type=refresh_token",{
        method:"POST",headers:{apikey:KEY,"Content-Type":"application/json"},
        body:JSON.stringify({refresh_token:session.refresh_token})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.access_token)throw new Error("Сессия истекла. Зайдите в CRM заново.");
      saveSession(data);
    })().finally(()=>refreshPromise=null);
    await refreshPromise;
  }
  async function api(path,method="GET",payload){
    await ensureSession();
    const headers={apikey:KEY,Authorization:"Bearer "+session.access_token,Accept:"application/json"};
    if(payload!==undefined)headers["Content-Type"]="application/json";
    if(method!=="GET")headers.Prefer="return=representation";
    const response=await fetch(BASE+"/rest/v1/"+path,{
      method,headers,body:payload===undefined?undefined:JSON.stringify(payload)
    });
    const value=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(value?.message||"Ошибка сервера (HTTP "+response.status+").");
    return value;
  }
  async function verifyOwner(){
    await ensureSession();
    const response=await fetch(BASE+"/auth/v1/user",{
      headers:{apikey:KEY,Authorization:"Bearer "+session.access_token}
    });
    if(!response.ok)throw new Error("Нужно заново войти в приложение.");
    const user=await response.json();
    if(!user?.id)throw new Error("Не удалось проверить владельца.");
    const member=await api("rabota_members?select=user_id&user_id=eq."+
      encodeURIComponent(user.id)+"&role=eq.owner&active=is.true&limit=1");
    if(!Array.isArray(member)||member.length!==1)throw new Error("Раздел «Расходы» доступен только владельцу.");
    ownerId=user.id;
  }
  async function getExpenses(){
    const fetched=[],limit=500,max=10000;
    for(let offset=0;offset<max;offset+=limit){
      const part=await api("rabota_finance_operations?select=id,kind,amount,note,created_at,voided_at,order_id"+
        "&kind=eq.expense&order=created_at.desc,id.desc&limit="+limit+"&offset="+offset);
      if(!Array.isArray(part))throw new Error("Ошибка формата расходов.");
      fetched.push(...part);
      if(part.length<limit){rows=fetched;return}
    }
    throw new Error("История расходов слишком большая для просмотра. Обратитесь к администратору.");
  }
  function parseNote(value){
    const s=String(value||"").trim();
    const matched=s.match(/^\[([^\]]{1,25})\](?:\s+(.*))?$/s);
    if(matched&&CATEGORIES.includes(matched[1]))return {category:matched[1],details:matched[2]||""};
    return {category:"Прочее",details:s};
  }
  function draw(){
    const current=rows.filter(r=>!r.voided_at);
    const monthRows=current.filter(r=>monthOf(r.created_at)===month);
    $("exMonth").textContent=monthTitle(month);
    $("exMonthlyTotal").textContent=money(sum(monthRows));
    $("exCount").textContent=monthRows.length+" "+(monthRows.length===1?"запись":"записей");
    $("exAllTotal").textContent="Всего: "+money(sum(current));
    $("exHistoryCount").textContent=monthRows.length+" записей";
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
    $("exEmpty").hidden=monthRows.length>0;
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
  async function reload(){
    if(loading||!ownerId)return;
    loading=true;
    try{await getExpenses();draw()}catch(error){msg(error.message||"Не удалось загрузить расходы")}
    finally{loading=false}
  }
  async function voidExpense(row,button){
    if(busy)return;
    if(!confirm("Отменить расход "+money(row.amount)+"? Запись останется в истории финансов как отменённая."))return;
    busy=true;button.disabled=true;msg("");
    try{
      await api("rpc/rabota_finance_void","POST",{p_operation_id:row.id});
      await getExpenses();draw();msg("Расход отменён. Учёт кассы обновлён.",true);
    }catch(error){msg(error.message||"Не удалось отменить расход");button.disabled=false}
    finally{busy=false}
  }
  async function submit(event){
    event.preventDefault();
    if(busy)return;
    const amount=parseAmount($("exAmount").value);
    if(amount===null){msg("Укажи корректную сумму от 0,01 до 10 000 000 ₽.");return}
    const category=$("exCategory").value;
    if(!CATEGORIES.includes(category)){msg("Выбери категорию.");return}
    const detail=$("exDetail").value.trim().replace(/\s+/g," ");
    const order=$("exOrder").value.trim();
    if(order&&!/^\d{1,8}$/.test(order)){msg("Номер заказа должен содержать только цифры.");return}
    const note="["+category+"]"+(detail?" "+detail:"")+(order?" · Заказ №"+order:"");
    if(note.length>240){msg("Сократи описание расхода.");return}
    busy=true;$("exSave").disabled=true;msg("");
    try{
      await api("rpc/rabota_finance_record","POST",{
        p_kind:"expense",p_amount:amount,p_master_user_id:null,p_note:note
      });
      await getExpenses();
      month=moscowMonth();
      draw();
      $("exForm").reset();
      $("exAmount").focus({preventScroll:true});
      msg("Расход "+money(amount)+" сохранён в финансах.",true);
    }catch(error){msg(error.message||"Не удалось сохранить расход.")}
    finally{busy=false;$("exSave").disabled=false}
  }
  function setup(){
    month=moscowMonth();
    $("exPrev").addEventListener("click",()=>{month=shiftMonth(month,-1);draw()});
    $("exNext").addEventListener("click",()=>{month=shiftMonth(month,1);draw()});
    $("exForm").addEventListener("submit",event=>void submit(event));
    const btn=$("exMoreButton"),menu=$("exMore"),veil=$("exVeil");
    const close=()=>{menu.hidden=true;veil.hidden=true;btn.setAttribute("aria-expanded","false")};
    btn.addEventListener("click",()=>{
      const open=menu.hidden;menu.hidden=!open;veil.hidden=!open;
      btn.setAttribute("aria-expanded",String(open))
    });
    veil.addEventListener("click",close);
    document.addEventListener("keydown",event=>{if(event.key==="Escape")close()});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)void reload()});
  }
  async function init(){
    setup();
    try{
      await verifyOwner();
      await getExpenses();
      $("exGate").hidden=true;
      $("exMain").hidden=false;
      $("exBottom").hidden=false;
      draw();
    }catch(error){
      $("exGate").replaceChildren(el("div","",error.message||"Не удалось открыть расходы."));
      const link=el("a","","Открыть CRM «Работа»");
      link.href="/";$("exGate").append(link);
    }
  }
  void init();
})();