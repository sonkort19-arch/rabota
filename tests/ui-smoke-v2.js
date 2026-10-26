/* Standalone synthetic read-only UI smoke tests for the Rabota redesign.
   Run after cloning: node tests/ui-smoke-v2.js
   Never accesses Supabase, Vercel, a web browser or real client data. */
function runSmoke(source) {
  const syntheticOrders=[
    {id:"sample-1",name:"Сослан",phone:"79990000001",date:"2026-10-27",time:"10:00",status:"Записан",master:"Рауль",price:12000,paid:false,address:"Тестовый адрес 1",details:"Промывка",createdAt:"2026-10-20"},
    {id:"sample-2",name:"Анжела",phone:"79990000002",date:"2026-10-27",time:"15:00",status:"В работе",master:"Рауль",price:9000,paid:false,address:"Тестовый адрес 2",details:"Отопление",createdAt:"2026-10-20"},
    {id:"sample-3",name:"Алекс",phone:"79990000003",date:"2026-10-26",time:"11:00",status:"Выполнен",master:"Рауль",price:10000,paid:true,address:"Тестовый адрес 3",details:"",createdAt:"2026-10-17"},
    {id:"sample-4",name:"Анжела",phone:"79990000002",date:"2026-10-22",time:"16:00",status:"Отменён",master:"Рауль",price:9000,paid:false,address:"Тестовый адрес 4",details:"",createdAt:"2026-10-17"}
  ];
  function scenario(role){
    const registry=new Map(),all=[];
    class Element {
      constructor(tag){
        this.tagName=String(tag).toUpperCase();this.children=[];this.parentNode=null;
        this.attributes={};this.events={};this.style={};this.dataset={};
        this.hidden=false;this.value="";this._id="";this.className="";this.textContent="";this.innerHTML="";
        all.push(this);
        const el=this;
        this.classList={
          add(...tokens){
            for(const token of tokens){if(!token||/\s/.test(token))throw new Error("DOMTokenList.add invalid token: "+JSON.stringify(token))}
            const s=new Set(el.className.split(/\s+/).filter(Boolean));tokens.forEach(x=>s.add(x));el.className=[...s].join(" ")
          },
          remove(...tokens){const s=new Set(el.className.split(/\s+/).filter(Boolean));tokens.forEach(x=>s.delete(x));el.className=[...s].join(" ")},
          contains(token){return el.className.split(/\s+/).includes(token)},
          toggle(token,on){const add=on??!this.contains(token);add?this.add(token):this.remove(token)}
        };
      }
      get id(){return this._id}
      set id(id){if(this._id)registry.delete(this._id);this._id=id;registry.set(id,this)}
      get lastElementChild(){return this.children[this.children.length-1]||null}
      setAttribute(name,value){this.attributes[name]=String(value);if(name==="id")this.id=String(value);if(name==="class")this.className=String(value)}
      getAttribute(name){return this.attributes[name]??null}
      append(...nodes){for(const node of nodes){if(node.parentNode)node.remove();this.children.push(node);node.parentNode=this}}
      prepend(...nodes){for(const node of [...nodes].reverse()){if(node.parentNode)node.remove();this.children.unshift(node);node.parentNode=this}}
      insertBefore(node,ref){if(node.parentNode)node.remove();const index=this.children.indexOf(ref);this.children.splice(index<0?this.children.length:index,0,node);node.parentNode=this}
      remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null}}
      replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes)}
      addEventListener(type,fn){(this.events[type]??=[]).push(fn)}
      fire(type){for(const fn of this.events[type]||[])fn({target:this,preventDefault(){},key:"Enter"})}
      click(){this.fire("click")}
      querySelectorAll(selector){
        const direct=selector.startsWith(":scope > ");const token=selector.replace(/^:scope > /,"");
        const match=node=>token===".rd-more-item[data-page]"?
          node.classList.contains("rd-more-item")&&Boolean(node.dataset.page):
          token.startsWith("#")?node.id===token.slice(1):
          token.startsWith(".")?node.classList.contains(token.slice(1)):
          node.tagName===token.toUpperCase();
        const found=[],visit=(el,recurse)=>{for(const n of el.children){if(match(n))found.push(n);if(recurse)visit(n,recurse)}};
        visit(this,!direct);return found;
      }
      querySelector(selector){return this.querySelectorAll(selector)[0]||null}
    }
    const document={body:new Element("body"),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),
      getElementById:id=>registry.get(id)||null,querySelectorAll:selector=>document.body.querySelectorAll(selector),addEventListener(){}};
    const app=document.createElement("div");app.id="appScreen";document.body.append(app);
    const add=(id,tag="div",parent=app)=>{const e=document.createElement(tag);e.id=id;parent.append(e);return e};
    const orderArea=add("ordersArea"),finance=add("financePanel");
    add("teamPanel","section",orderArea);add("newOrderBtn","button",orderArea);
    const tabs=document.createElement("div");tabs.className="tabs";orderArea.append(tabs);
    const head=document.createElement("div");head.className="list-head";orderArea.append(head);
    add("orders","section",orderArea);add("orderCount","span",orderArea);add("calendarPanel","section",orderArea);
    for(const id of ["viewFinanceBtn","viewOrdersBtn","prevWeek","goToday","nextWeek","logoutBtn"])add(id,"button");
    const window={location:{assign(){}},scrollTo(){},reload(){}};
    const parseDate=day=>new Date(day+"T12:00:00");
    const addDays=(date,num)=>{const d=parseDate(date);d.setDate(d.getDate()+num);return d.toISOString().slice(0,10)};
    const render=()=>window.__rdRefresh?.();
    const openedForms=[];
    const init=new Function("document","window","currentRole","financeActive","currentTab","selectedDate","getOrders","normalizePhone","parseDate","addDays","render","openForm",source+"\nwindow.__testCurrentTab=()=>currentTab;");
    init(document,window,role,false,"all","2026-10-27",()=>syntheticOrders,x=>String(x||"").replace(/\D/g,"").slice(-10),parseDate,addDays,render,id=>openedForms.push(id));
    window.__rdAccess();
    const get=id=>document.getElementById(id),nav=key=>all.find(n=>n.classList.contains("rd-nav-btn")&&n.dataset.page===key);
    const expect=(result,description)=>{if(!result)throw Error(role+" / "+description)};
    expect(Boolean(get("rdHome")),"home created");
    expect(get("rdHome").children.length===8,"dashboard structure and content");
    window.__rdRefresh();
    expect(get("rdHome").children.length===8,"refresh keeps heading/subtitle");
    expect(get("rdHome").querySelectorAll(".rd-stat").length===4,"four KPI cards");
    expect(get("rdHome").querySelectorAll(".rd-svgicon").length>=7,"vector icons appear");
    expect(get("rdHome").querySelectorAll(".rd-chart-month").length===1,"real month label");
    expect(Boolean(nav("calendar")),"calendar menu");
    nav("calendar").click();
    expect(get("ordersArea").hidden===false,"calendar shares order shell");
    expect(get("rdCalendarIntro").hidden===false,"calendar heading shown");
    expect(get("rdCalendarBoard").hidden===false,"calendar board shown");
    expect(get("rdOrdersIntro").hidden===true,"order heading hidden on calendar");
    expect(get("rdOrderStats").hidden===true,"order summary hidden on calendar");
    expect(get("rdOrderToolbar").hidden===true,"order filters hidden on calendar");
    expect(get("orders").hidden===true,"order cards hidden on calendar");
    expect(tabs.hidden===true,"order tabs hidden on calendar");
    expect(nav("calendar").getAttribute("aria-current")==="page","only calendar is active");
    expect(window.__testCurrentTab()==="calendar","calendar view uses calendar tab");
    expect(window.__rdCurrentPage==="calendar","calendar view state matches navigation");
    expect(nav("orders").getAttribute("aria-current")!=="page","orders navigation is not active");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-calendar-day").length===7,"seven weekday panels");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-day-chip").length===7,"seven mobile date tabs");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===2,"two appointments on selected synthetic date");
    const event=get("rdCalendarBoard").querySelector(".rd-mobile-event");
    expect(event.querySelector(".rd-calendar-time").children[0].textContent==="10:00","appointment time not invented");
    expect(event.querySelector(".rd-calendar-badge").textContent==="Записан","appointment status reflects data");

    expect(get("rdCalendarBoard").querySelectorAll(".rd-calendar-mode").length===3,"week/day/list controls exist");
    expect(get("rdCalendarMaster").children.length===2,"master filter from real synthetic orders");
    expect(get("rdCalendarStatus").children.length>=4,"status filters available");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-cal-action").length>=3,"calendar details expose actions");
    const firstAction=get("rdCalendarBoard").querySelectorAll(".rd-cal-edit")[0];
    expect(Boolean(firstAction),"edit button available for owner/manager");
    firstAction.click();
    expect(openedForms[0]==="sample-1","edit opens existing order without saving");
    const modes=get("rdCalendarBoard").querySelectorAll(".rd-calendar-mode");
    modes[2].click();
    expect(get("rdCalendarBoard").dataset.calendarMode==="list","list mode is functional");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===3,"list mode shows all week bookings");
    modes[1].click();
    expect(get("rdCalendarBoard").dataset.calendarMode==="day","day mode is functional");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===2,"day mode shows selected date only");
    modes[0].click();
    expect(get("rdCalendarBoard").dataset.calendarMode==="week","week mode is functional");
    const statusFilter=get("rdCalendarStatus");
    statusFilter.value="В работе";statusFilter.fire("change");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===1,"status filter reduces day list");
    statusFilter.value="";statusFilter.fire("change");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===2,"status reset shows all");
    const date=get("rdCalendarDate");
    date.value="2026-10-26";date.fire("change");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===1,"date selector selects another day");
    const done=get("rdCalendarHideDone");
    done.checked=true;done.fire("change");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===0,"hide completed excludes done orders");
    done.checked=false;done.fire("change");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===1,"restoring completed shows done");
    date.value="2026-10-27";date.fire("change");
    expect(get("rdCalendarBoard").querySelectorAll(".rd-mobile-event").length===2,"restore baseline day");

    nav("orders").click();
    expect(get("rdOrdersIntro").hidden===false,"orders heading shown after calendar");
    expect(get("rdOrderStats").hidden===false,"order summary shown after calendar");
    expect(get("rdOrderToolbar").hidden===false,"order filters shown after calendar");
    expect(get("orders").hidden===false,"order cards shown after calendar");
    expect(tabs.hidden===false,"order tabs shown after calendar");
    expect(get("rdCalendarIntro").hidden===true,"calendar heading hidden in orders");
    expect(get("rdCalendarBoard").hidden===true,"calendar board hidden in orders");
    expect(nav("orders").getAttribute("aria-current")==="page","orders active");
    expect(window.__testCurrentTab()==="all","orders view defaults to all orders");
    expect(window.__rdCurrentPage==="orders","orders view state matches navigation");

    const kpis=get("rdOrderStats").querySelectorAll(".rd-stat");
    expect(kpis.length===4,"four order summary KPIs");
    expect(get("rdOrderStats").querySelectorAll(".rd-stat-icon").length===4,"each summary has a fixed icon");
    expect(get("rdOrderStats").querySelectorAll(".rd-stat-body").length===4,"each summary has one text column");
    expect(get("rdOrderStats").querySelectorAll(".rd-stat-clock").length===1,"new-orders icon class");
    expect(get("rdOrderStats").querySelectorAll(".rd-stat-progress").length===1,"in-progress icon class");
    expect(get("rdOrderStats").querySelectorAll(".rd-stat-wallet").length===1,"unpaid icon class");
    expect(kpis.every(x=>x.querySelector(".rd-stat-body").children.length===3),"metric label, value, hint grouped");
    const syntheticCard=document.createElement("article");syntheticCard.className="order-card";
    const top=document.createElement("div");top.className="card-top";
    const cardName=document.createElement("div");cardName.className="client";cardName.textContent="Тестовый клиент";
    const cardDate=document.createElement("span");cardDate.className="date-pill";cardDate.textContent="27 окт. · 10:00";
    top.append(cardName,cardDate);syntheticCard.append(top);
    for(const label of ["Адрес: Тестовый адрес","Мастер: Рауль","Стоимость: 12 000 ₽","Радиаторы: 5 шт."]){
      const line=document.createElement("div");line.className="info";line.textContent=label;syntheticCard.append(line);
    }
    const actions=document.createElement("div");actions.className="actions";
    for(const cls of ["action","action wa","action edit"]){
      const btn=document.createElement("button");btn.className=cls;btn.textContent="Пример";actions.append(btn);
    }
    syntheticCard.append(actions);
    window.__rdDecorateOrder(syntheticCard);
    expect(syntheticCard.querySelectorAll(".rd-info-row").length===4,"info row icons preserve four details");
    expect(actions.querySelectorAll(".rd-svgicon").length===3,"all real action variants get aligned icons");
    expect(cardDate.querySelectorAll(".rd-svgicon").length===1,"date icon inside date pill");
    expect(top.querySelectorAll(".rd-order-avatar").length===1,"order avatar preserved");

    expect(nav("calendar").getAttribute("aria-current")!=="page","calendar inactive");
    nav("calendar").click();
    expect(get("rdCalendarBoard").hidden===false&&get("orders").hidden===true,"second calendar transition");
    nav("orders").click();
    expect(get("orders").hidden===false&&get("rdCalendarBoard").hidden===true,"second orders transition");
    nav("clients").click();
    expect(get("rdClientsList").querySelectorAll(".rd-client").length===3,"three distinct customers");
    const search=get("rdTopSearch");search.value="Сослан";search.fire("input");
    expect(get("rdClientsList").querySelectorAll(".rd-client").length===1,"client search responsive");
    search.value="";search.fire("input");
    if(role==="owner"){
      nav("finance").click();expect(finance.hidden===false,"owner finance available");
      expect(Boolean(nav("ai")),"owner AI available");
    }else{
      expect(!nav("finance"),"manager finance protected");
      expect(!nav("ai"),"manager AI protected");
    }
    return {role,passed:true,checks:65};
  }
  return [scenario("owner"),scenario("manager")];
}
if(typeof module!=="undefined" && module.exports){
  module.exports={runSmoke};
  if(require.main===module){
    const fs=require("node:fs"),path=require("node:path");
    const src=fs.readFileSync(path.join(__dirname,"..","redesign.js"),"utf8");
    console.log(JSON.stringify(runSmoke(src),null,2));
  }
}
