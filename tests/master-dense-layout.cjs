/* Synthetic CSS-only check; defaults to WebKit for CI.
 * TEST_BROWSER / TEST_BROWSER_PATH allow a local browser without network access.
 * Never accesses production or Supabase.
 */
"use strict";
const {webkit,chromium}=require("playwright"),fs=require("node:fs"),path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const inline=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert.ok(inline,"base inline style");
const links=[...html.matchAll(/<link rel="stylesheet" href="\/([^"?]+)(?:\?[^"]*)?">/g)].map(m=>m[1]);
assert.ok(links.includes("money-workspace.css"),"master UI stylesheet loaded");
assert.ok(links.indexOf("money-workspace.css")>links.indexOf("master-dense-enhancements.css"),"master patches load after base styles");
assert.ok(links.indexOf("app-shell.css")>links.indexOf("money-workspace.css"),"flow title and fixed profile load after master styles");
const i=links.indexOf("master-dense.css");
assert.deepEqual(links.slice(i,i+2),["master-dense.css","master-dense-enhancements.css"]);
const styles=[inline,...links.map(file=>fs.readFileSync(path.join(root,file),"utf8"))].join("\n");
const fixture=[
'<header id="rdScreenHeader"><div class="rd-screen-heading"><button id="rdScreenBack" hidden aria-label="Назад к отчётам">‹</button><h1 id="appTitle">Заказы</h1></div>',
'<div id="rdProfile" class="rd-profile"><button id="rdProfileTrigger" type="button" aria-label="Открыть меню профиля" aria-controls="rdProfileMenu">Р</button>',
'<div id="rdProfileMenu" class="rd-profile-menu" hidden><div class="rd-profile-identity"><span class="rd-profile-initial">Р</span><span class="rd-profile-text"><strong>Рауль</strong><small>Мастер</small></span></div>',
'<section id="masterPushPanel" class="push-panel push-compact"><button id="pushBellBtn" class="push-bell" type="button">Уведомления</button>',
'<div id="pushPopover" class="push-popover" hidden><strong>Новые заявки</strong></div></section><button id="logoutBtn" type="button">Выйти</button></div></div>',
'</header><main id="appScreen" class="rd-master master-mode" aria-labelledby="appTitle">',
'<div class="sync-note" id="syncStatus" hidden></div><div id="ordersArea">',
'<section id="mwMasterFilterbar" class="mw-master-filterbar"><input class="mw-filter-search" placeholder="Поиск по заказам"><div class="mw-status-filters">',
...["Все","Записаны","В работе","Выполнены","Отменены"].map(label=>'<button type="button" class="mw-filter-chip" aria-label="Фильтр: '+label+'"><span class="mw-filter-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9"></circle></svg></span></button>'),
'</div></section>',
'<nav class="tabs"><button class="tab">По дням</button><button class="tab active">Расписание</button><button class="tab">История</button></nav>',
'<section class="panel" id="calendarPanel"><div class="panel-top"><h2>Календарь</h2><div class="nav"><button class="secondary" id="prevWeek">‹</button><button class="secondary" id="goToday">Сегодня</button><button class="secondary" id="nextWeek">›</button></div></div>',
'<input class="calendar-date" id="calendarDate" type="date" value="2026-11-12"><div class="week" id="weekDays">',
...Array.from({length:7},(_,i)=>'<button class="day'+(i===3?' active':i===4?' has-orders':'')+'" type="button"><span class="weekday">'+['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][i]+'</span><strong>'+(i+9)+'</strong></button>'),'</div></section>',
'<section class="master-today-summary"><div class="master-today-top"><strong class="master-today-title">Сегодня · 12 нояб.</strong><span class="master-today-count">1 заказ</span></div>',
'<button class="master-next-jump"><span class="master-next-caption">Ближайший выезд</span><strong class="master-next-value">Сегодня · 18:00 · Давид</strong></button></section>',
'<div class="list-head"><h2 id="listTitle">Моё расписание</h2><span class="count" id="orderCount">9 шт.</span></div><div id="orders">',
'<div class="master-day-heading"><h3>Сегодня · 12 нояб.</h3><span class="muted">1 заказ</span></div>',
'<article class="master-schedule-card is-next"><button class="master-schedule-toggle">',
'<span class="master-schedule-main"><span class="master-schedule-avatar">Д</span><span class="master-schedule-identity">',
'<strong class="master-schedule-name">Давид</strong><span class="master-schedule-address">Сунжа набережная 26 квартира 55</span></span></span>',
'<span class="master-schedule-time">18:00</span><span class="master-schedule-chevron">›</span>',
'<span class="master-schedule-work">Радиаторы: 9 · Тёплый пол: 3 конт.</span>',
'<span class="master-schedule-meta"><span class="status-badge s-booked">Записан</span></span>',
'<strong class="master-schedule-price">21 000 ₽</strong></button></article>',
'<div class="master-day-heading"><h3>Пятница, 13 ноября</h3><span class="muted">2 заказа</span></div>',
'<article class="master-schedule-card"><button class="master-schedule-toggle">',
'<span class="master-schedule-main"><span class="master-schedule-avatar">О</span><span class="master-schedule-identity">',
'<strong class="master-schedule-name">Очень длинное имя клиента с фамилией</strong>',
'<span class="master-schedule-address">Очень длинный адрес с названием улицы и номером дома, занимает несколько строк</span></span></span>',
'<span class="master-schedule-time">10:00</span><span class="master-schedule-chevron">›</span>',
'<span class="master-schedule-work">Радиаторы: 5</span>',
'<span class="master-schedule-meta"><span class="status-badge s-booked">Записан</span></span>',
'<strong class="master-schedule-price">11 000 ₽</strong></button></article>',
'</div></div></main>',
'<button class="primary new-order" id="newOrderBtn"><span class="plus">+</span>Новый заказ</button>',
'<nav id="mwMasterNav" class="mw-bottom-nav"><button class="mw-nav-btn is-active"><span class="mw-icon">▣</span>Заказы</button><button class="mw-nav-btn">Платежи</button><button class="mw-nav-btn">Отчёты</button><button class="mw-nav-btn">Настройки</button></nav>'
].join("");
(async()=>{
const browserName=process.env.TEST_BROWSER||"webkit";
assert.ok(["webkit","chromium"].includes(browserName),"TEST_BROWSER must be webkit or chromium");
const browser=await ({webkit,chromium})[browserName].launch({
  headless:true,
  executablePath:process.env.TEST_BROWSER_PATH||(browserName==="chromium"?process.env.CHROMIUM_PATH:undefined),
  args:browserName==="chromium"?["--no-sandbox"]:[]
});
try{
 for(const width of [320,350,375,390,430,768]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
  await page.setContent('<!DOCTYPE html><html class="rd-app-open"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>'+styles+'</style></head><body class="rd" data-rd-role="master">'+fixture+'</body></html>');
  const result=await page.evaluate(()=>{
   const dim=sel=>{const node=document.querySelector(sel),r=node.getBoundingClientRect();return {height:r.height,size:parseFloat(getComputedStyle(node).fontSize)}};
   const workspace=document.getElementById("appScreen");
   return {scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth,
    workspaceOverflow:workspace.scrollWidth-workspace.clientWidth,
    title:dim("#appTitle"),newOrder:dim("#newOrderBtn"),profile:dim("#rdProfileTrigger"),
    tab:dim(".mw-bottom-nav .mw-nav-btn"),next:dim(".master-next-jump"),
    time:dim(".master-schedule-time"),name:dim(".master-schedule-name"),
    summary:dim(".master-today-summary"),card:dim(".master-schedule-toggle"),avatar:dim(".master-schedule-avatar"),
    calendar:dim("#calendarPanel"),calendarDate:dim("#calendarDate"),
    calendarHeader:dim("#calendarPanel .panel-top"),calendarNav:dim("#calendarPanel .nav"),
    calendarWeek:dim("#weekDays"),
    calendarComputed:(()=>{
      const selectors=["#calendarPanel","#calendarPanel .panel-top","#calendarPanel .nav","#calendarDate","#weekDays","#weekDays .day"];
      return selectors.map(selector=>{
        const e=document.querySelector(selector),s=getComputedStyle(e),r=e.getBoundingClientRect();
        return {selector,height:r.height,width:r.width,padding:s.padding,margin:s.margin,display:s.display,flexWrap:s.flexWrap,minHeight:s.minHeight,maxHeight:s.maxHeight};
      });
    })(),
    calendarDay:dim("#weekDays .day"),calendarToday:dim("#goToday"),
    calendarPrevious:dim("#prevWeek"),calendarNext:dim("#nextWeek"),
    filterLayout:(()=>{
      const parent=document.querySelector(".mw-status-filters");
      const buttons=[...parent.querySelectorAll(".mw-filter-chip")];
      const r=parent.getBoundingClientRect();
      const boxes=buttons.map(button=>button.getBoundingClientRect());
      return {parentWidth:r.width,buttonWidths:boxes.map(b=>b.width),
        firstLeft:boxes[0].left,lastRight:boxes.at(-1).right,right:r.right,left:r.left,
        gap:parseFloat(getComputedStyle(parent).gap),overflow:parent.scrollWidth>parent.clientWidth};
    })()};
  });
  assert.ok(result.scroll<=result.width+1,"horizontal document overflow at "+width+" "+JSON.stringify(result));
  assert.ok(result.workspaceOverflow<=1,"horizontal workspace overflow at "+width+" "+JSON.stringify(result));
  const filters=result.filterLayout;
  assert.equal(filters.buttonWidths.length,5,"all status filters render at "+width);
  assert.ok(filters.buttonWidths.every(w=>Math.abs(w-filters.buttonWidths[0])<1),
    "filter buttons have equal width at "+width+": "+JSON.stringify(filters));
  assert.ok(Math.abs(filters.firstLeft-filters.left)<1.5&&Math.abs(filters.lastRight-filters.right)<1.5,
    "filter row fills available width at "+width+": "+JSON.stringify(filters));
  assert.equal(filters.overflow,false,"filter bar does not scroll sideways at "+width);
  assert.ok(filters.buttonWidths[0]>=40,"status filter remains tappable at "+width);
  for(const key of ["newOrder","profile","tab","next"])
   assert.ok(result[key].height>=43.5,key+" tap target at "+width+" height "+result[key].height);
  assert.ok(result.time.size<=19.1,"time font "+width);
  assert.ok(result.name.size<=15.1,"client font "+width);
  assert.ok(result.title.size>=19&&result.title.size<=26.1,"compact title font "+width);
  assert.ok(result.summary.height<=120,"today block height "+width+" "+result.summary.height);
  assert.ok(result.card.height<=88,"compact card at "+width+": "+result.card.height);
  assert.ok(result.card.height>=62,"compact card remains tappable at "+width);
  assert.ok(result.avatar.height>=26.5&&result.avatar.height<=29.5,"compact avatar geometry at "+width);
  assert.ok(result.calendar.height<=205,"calendar must be compact at "+width+": "+result.calendar.height);
  assert.ok(result.calendar.height>=146,"calendar remains usable at "+width);
  assert.ok(result.calendarWeek.height<=55,"week row must remain one row at "+width+": "+result.calendarWeek.height);
  for(const key of ["calendarDate","calendarDay","calendarToday","calendarPrevious","calendarNext"])
    assert.ok(result[key].height>=43.5,key+" usable touch target at "+width+": "+result[key].height);

  const shell=await page.evaluate(()=>{
    const r=selector=>document.querySelector(selector).getBoundingClientRect();
    const profile=document.querySelector("#rdProfile"),menu=document.querySelector("#rdProfileMenu");
    const header=document.querySelector("#rdScreenHeader"),app=document.querySelector("#appScreen");
    const heading=r(".rd-screen-heading"),title=r("#appTitle"),trigger=r("#rdProfileTrigger");
    const search=r(".mw-filter-search"),chips=r(".mw-status-filters");
    const initiallyClosed=menu.getClientRects().length===0;
    menu.hidden=false;
    const bell=r("#pushBellBtn"),logout=r("#logoutBtn"),panel=r("#rdProfileMenu");
    document.querySelector("#pushPopover").hidden=false;
    const notices=r("#pushPopover");
    return {initiallyClosed,sharedProfile:header.contains(profile),sibling:header.parentElement===app.parentElement,
      workspaceScroll:getComputedStyle(app).overflowY,headerBottom:r("#rdScreenHeader").bottom,
      workspaceTop:r("#appScreen").top,menuBottom:panel.bottom,dockTop:r("#mwMasterNav").top,
      headingHeight:heading.height,headingCenter:(heading.top+heading.bottom)/2,headingBottom:heading.bottom,
      titleRight:title.right,profileLeft:trigger.left,profileCenter:(trigger.top+trigger.bottom)/2,
      searchTop:search.top,searchAfterMenu:r(".mw-filter-search").top,
      searchBottom:search.bottom,statusTop:chips.top,
      menuLeft:panel.left,menuRight:panel.right,noticeLeft:notices.left,noticeRight:notices.right,
      bell:bell.height,logout:logout.height,viewportWidth:document.documentElement.clientWidth};
  });
  const detail=width+": "+JSON.stringify(shell);
  assert.ok(shell.sharedProfile&&shell.sibling&&shell.initiallyClosed,"header profile starts closed outside the workspace at "+detail);
  assert.match(shell.workspaceScroll,/^(auto|scroll)$/);
  assert.ok(shell.workspaceTop>=shell.headerBottom-1,"workspace starts below shared header at "+detail);
  assert.ok(shell.menuBottom<=shell.dockTop+1,"profile menu stays above the dock at "+detail);
  assert.ok(shell.headingHeight<=45&&Math.abs(shell.headingCenter-shell.profileCenter)<2,"title fits the profile row at "+detail);
  assert.ok(shell.titleRight<=shell.profileLeft-5,"title leaves room for profile at "+detail);
  assert.ok(shell.searchTop>=shell.headingBottom-1&&shell.searchAfterMenu===shell.searchTop,"profile leaves the local search in flow at "+detail);
  assert.ok(shell.statusTop>=shell.searchBottom-2&&shell.statusTop-shell.searchBottom<28,"status icons follow search at "+detail);
  assert.ok(shell.menuLeft>=0&&shell.menuRight<=shell.viewportWidth+1,"profile stays within the viewport at "+detail);
  assert.ok(shell.noticeLeft>=shell.menuLeft&&shell.noticeRight<=shell.menuRight+1,"notifications stay within the profile at "+detail);
  assert.ok(shell.bell>=43.5&&shell.logout>=43.5,"alerts and sign-out remain tappable at "+detail);

  await page.close();
 }
 console.log("Master dense layout: PASS ("+browserName+", 320/350/375/390/430/768)");
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
