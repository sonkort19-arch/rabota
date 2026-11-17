"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {localDate,parseDate,addDays,formatDate,weekDates,canPrefillSlot,createCalendarModule}=require("../calendar-model.js");

class Node {
  constructor(tag="",className="",content=null) {
    this.tag=tag;this.className=className;this.children=[];
    this.textContent=content==null?"":String(content);
    this.attrs={};this.listeners={};this.value="";this.type="";
  }
  replaceChildren(){this.children=[];}
  append(...children){this.children.push(...children);}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,fn){this.listeners[k]=fn;}
  fire(k){assert.equal(typeof this.listeners[k],"function");this.listeners[k]();}
}
function build({date="2026-11-13",role="owner",orders=[]}={}){
  const elements={
    calendarDate:new Node(),
    weekDays:new Node(),
    ordersWeekDays:new Node(),
    ordersDayDateLabel:new Node()
  };
  const buttons=Object.fromEntries([
    "prevWeek","nextWeek","goToday","rdOrdersPrevWeek","rdOrdersNextWeek","rdOrdersToday"
  ].map(id=>[id,new Node()]));
  let selectedDate=date,currentTab="calendar",currentRole=role,renderCount=0;
  let scroll=380;const restores=[];let queued=[];
  const module=createCalendarModule({
    elements,
    make:(tag,css,text)=>new Node(tag,css,text),
    getOrders:()=>orders,
    getSelectedDate:()=>selectedDate,
    setSelectedDate:date=>{selectedDate=date;},
    getCurrentRole:()=>currentRole,getCurrentTab:()=>currentTab,
    estimateDayLoad:(rows,day)=>require("../calendar-load.js").estimateDay(rows,day),
    setCurrentTab:tab=>{currentTab=tab;},
    render:()=>{renderCount++;},
    verticalScrollPosition:()=>scroll,
    restoreVerticalScroll:y=>{restores.push(y);},
    requestAnimationFrame:fn=>{queued.push(fn);},
    getElement:id=>buttons[id],
    masterClock:()=>({date:"2026-11-14"})
  });
  return {
    module,elements,buttons,restores,
    getSelected:()=>selectedDate,getTab:()=>currentTab,getRenders:()=>renderCount,
    setRole:x=>{currentRole=x;},runFrames:()=>{queued.splice(0).forEach(fn=>fn());}
  };
}
test("Monday-first weeks include all seven dates at boundaries",()=>{
  assert.deepEqual(weekDates("2026-11-13").days,[
    "2026-11-09","2026-11-10","2026-11-11","2026-11-12",
    "2026-11-13","2026-11-14","2026-11-15"
  ]);
  assert.equal(weekDates("2026-12-31").sunday,"2027-01-03");
  assert.equal(weekDates("2026-01-01").monday,"2025-12-29");
});
test("date helpers handle leap days, week jumps and invalid labels",()=>{
  assert.equal(addDays("2024-02-28",1),"2024-02-29");
  assert.equal(addDays("2024-02-29",1),"2024-03-01");
  assert.equal(addDays("2026-01-01",-7),"2025-12-25");
  assert.equal(formatDate(""),"Дата не указана");
  assert.equal(localDate(parseDate("2026-11-13")),"2026-11-13");
});
test("calendar renders seven original and compact day selectors",()=>{
  const app=build();app.module.renderCalendar();
  assert.equal(app.elements.weekDays.children.length,7);
  assert.equal(app.elements.ordersWeekDays.children.length,7);
  assert.equal(app.elements.calendarDate.value,"2026-11-13");
  assert.equal(app.elements.weekDays.children[4].attrs["aria-pressed"],"true");
  assert.ok(app.elements.ordersWeekDays.children[4].className.includes("is-selected"));
});
test("active orders mark days; cancelled orders do not",()=>{
  const app=build({orders:[
    {date:"2026-11-11",status:"Отменён"},
    {date:"2026-11-12",status:"Записан"},
    {date:"2026-11-15",status:"Выполнен"}
  ]});
  app.module.renderCalendar();
  assert.ok(!app.elements.weekDays.children[2].className.includes("has-orders"));
  assert.ok(app.elements.weekDays.children[3].className.includes("has-orders"));
  assert.ok(app.elements.ordersWeekDays.children[6].className.includes("has-orders"));
});
test("Raul's existing date tiles are colored, selected and accessible without new UI",()=>{
  const app=build({role:"master",orders:[
    {date:"2026-11-09",status:"Отменён",radiators:25,time:"10:00"},
    {date:"2026-11-10",status:"Записан",radiators:5,time:"10:00",address:"Владикавказ"},
    {date:"2026-11-11",status:"Записан",radiators:4,time:"10:00"},
    {date:"2026-11-11",status:"Записан",radiators:4,time:"13:00"},
    {date:"2026-11-13",status:"Записан",radiators:25,time:"10:00"}
  ]});
  app.module.renderCalendar();
  const cells=app.elements.weekDays.children;
  assert.equal(cells.length,7);
  assert.ok(cells[0].className.includes("workload-free"),"cancelled is not load");
  assert.ok(cells[1].className.includes("workload-light"));
  assert.ok(cells[2].className.includes("workload-busy"));
  assert.ok(cells[4].className.includes("workload-full"));
  assert.ok(cells[4].className.includes("active"),"the selected day is still selected");
  assert.match(cells[4].attrs["aria-label"],/Высокая загрузка/);
  assert.ok(cells[4].attrs.title,"tooltip describes load for non-color accessibility");
  assert.equal(cells[4].children.length,2,"no extra badge or legend");
});
test("owner calendar keeps its original date classes and labels",()=>{
  const app=build({role:"owner",orders:[{date:"2026-11-13",status:"Записан",radiators:22}]});
  app.module.renderCalendar();
  const day=app.elements.weekDays.children[4];
  assert.ok(day.className.includes("has-orders"));
  assert.ok(!day.className.includes("workload-"));
  assert.doesNotMatch(day.attrs["aria-label"],/Загрузка|загрузка/);
});

test("owner changing day updates date and redraws once",()=>{
  const app=build();app.module.renderCalendar();
  app.elements.weekDays.children[1].fire("click");
  assert.equal(app.getSelected(),"2026-11-10");
  assert.equal(app.getTab(),"calendar");
  assert.equal(app.getRenders(),1);
  assert.equal(app.restores.length,0);
});
test("master day switch preserves mobile scroll after animation frame",()=>{
  const app=build({role:"master"});app.module.renderCalendar();
  app.elements.weekDays.children[5].fire("click");
  assert.equal(app.getSelected(),"2026-11-14");
  assert.deepEqual(app.restores,[380]);
  app.runFrames();assert.deepEqual(app.restores,[380,380]);
});
test("compact day selector does not force scroll restoration",()=>{
  const app=build({role:"master"});app.module.renderCalendar();
  app.elements.ordersWeekDays.children[0].fire("click");
  app.runFrames();
  assert.equal(app.getSelected(),"2026-11-09");
  assert.equal(app.restores.length,0);
});
test("both week-navigation toolbars move exactly seven days",()=>{
  const app=build();app.module.bindNavigation();
  app.buttons.prevWeek.fire("click");assert.equal(app.getSelected(),"2026-11-06");
  app.buttons.rdOrdersNextWeek.fire("click");assert.equal(app.getSelected(),"2026-11-13");
  app.buttons.nextWeek.fire("click");assert.equal(app.getSelected(),"2026-11-20");
  app.buttons.rdOrdersPrevWeek.fire("click");assert.equal(app.getSelected(),"2026-11-13");
  assert.equal(app.getRenders(),4);
});
test("today button respects Moscow date for the master",()=>{
  const app=build({role:"master"});app.module.bindNavigation();
  app.buttons.goToday.fire("click");
  assert.equal(app.getSelected(),"2026-11-14");
  app.buttons.rdOrdersToday.fire("click");
  assert.equal(app.getSelected(),"2026-11-14");
});
test("manual date changes remain supported",()=>{
  const app=build();app.module.bindNavigation();
  app.elements.calendarDate.value="2026-11-21";
  app.elements.calendarDate.fire("change");
  assert.equal(app.getSelected(),"2026-11-21");
  assert.equal(app.getRenders(),1);
});
test("quick-slot validation rejects invalid roles, times, and unavailable slots",()=>{
  const slot={role:"owner",date:"2026-11-15",time:"13:30",master:"Рауль"};
  assert.equal(canPrefillSlot(slot,()=>"available"),true);
  assert.equal(canPrefillSlot({...slot,role:"manager"},()=>"tight"),true);
  assert.equal(canPrefillSlot({...slot,role:"master"},()=>"available"),false);
  assert.equal(canPrefillSlot({...slot,time:"24:00"},()=>"available"),false);
  assert.equal(canPrefillSlot({...slot,date:"November 15"},()=>"available"),false);
  assert.equal(canPrefillSlot({...slot,master:"  "},()=>"available"),false);
  assert.equal(canPrefillSlot(slot,()=>"busy"),false);
  assert.equal(canPrefillSlot(slot,()=>undefined),false);
});
test("app loads calendar before use while preserving availability scripts",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  assert.match(html,/src="\/calendar-model\.js\?v=20261117-master-swipe-v1"/);
  assert.match(html,/src="\/order-availability\.js(?:\?[^"]*)?"/);
  assert.match(html,/src="\/quick-slots\.js"/);
  assert.match(html,/calendarModule\.renderCalendar\(\)/);
  assert.match(html,/calendarModule\.bindNavigation\(\)/);
  assert.match(html,/__rdCalendarUtils\.canPrefillSlot/);
  assert.ok(html.indexOf('src="/calendar-model.js?v=20261117-master-swipe-v1"')<
    html.indexOf("const calendarModule=window.__rdCreateCalendarModule"));
  const inline=html.split("<script>\n").at(-1).split("</script>")[0];
  assert.doesNotThrow(()=>new Function(inline));
});


test("master calendar title stays the Today action without a separate row",()=>{
  const html=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  const start=html.indexOf('<section class="panel master-calendar-compact" id="calendarPanel">');
  const end=html.indexOf('<div class="week" id="weekDays">',start);
  assert.ok(start>=0&&end>start,"compact master calendar exists");
  const section=html.slice(start,end);
  assert.match(section,/<h2><button id="goToday"[^>]+aria-label="Календарь — вернуться к сегодняшнему дню"/);
  assert.ok(!section.includes("masterCalendarTodayRow"),"no separate Today container");
  assert.ok(!section.includes(">Сегодня</button>"),"no separate Today button");
  assert.equal((section.match(/id="goToday"/g)||[]).length,1);
  assert.match(section,/id="calendarDate"/);
  assert.match(section,/id="prevWeek"/);
  assert.match(section,/id="nextWeek"/);
  const app=build({role:"master",date:"2026-11-20"});
  app.module.bindNavigation();
  app.buttons.goToday.fire("click");
  assert.equal(app.getSelected(),"2026-11-14");
  assert.equal(app.getRenders(),1);
});

test("master can swipe the colored week without affecting vertical scrolling or tapping",()=>{
  const app=build({role:"master",date:"2026-11-17"});
  app.module.bindNavigation();
  const strip=app.elements.weekDays;
  const start=(x,y)=>strip.listeners.touchstart({touches:[{clientX:x,clientY:y}]});
  const end=(x,y)=>{
    let cancelled=false;
    strip.listeners.touchend({changedTouches:[{clientX:x,clientY:y}],
      cancelable:true,preventDefault(){cancelled=true;}});
    return cancelled;
  };
  start(240,300);
  assert.equal(end(130,305),true,"left swipe must suppress generated click");
  assert.equal(app.getSelected(),"2026-11-24","left advances one week");
  assert.deepEqual(app.restores,[380],"master scroll preserved");
  app.runFrames();
  assert.deepEqual(app.restores,[380,380]);
  start(120,300);
  assert.equal(end(240,305),true);
  assert.equal(app.getSelected(),"2026-11-17","right returns one week");
  start(230,300);
  assert.equal(end(205,300),false,"short movements do not turn the week");
  start(230,300);
  assert.equal(end(140,470),false,"vertical scrolling does not turn the week");
  assert.equal(app.getSelected(),"2026-11-17");
  start(230,300);
  strip.listeners.touchcancel();
  assert.equal(end(90,302),false,"cancelled gestures do nothing");
  assert.equal(app.getSelected(),"2026-11-17");
  assert.equal(app.getRenders(),2,"only two valid swipes trigger rerenders");
});
test("week swipe is disabled outside the master's calendar and works across a year boundary",()=>{
  const app=build({role:"master",date:"2026-12-31"});
  app.module.bindNavigation();
  const strip=app.elements.weekDays;
  const swipe=()=>{
    strip.listeners.touchstart({touches:[{clientX:220,clientY:100}]});
    strip.listeners.touchend({changedTouches:[{clientX:100,clientY:100}],
      cancelable:true,preventDefault(){}});
  };
  swipe();assert.equal(app.getSelected(),"2027-01-07");
  app.setRole("owner");
  swipe();assert.equal(app.getSelected(),"2027-01-07");
});
