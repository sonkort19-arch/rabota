/* Synthetic CSS-only WebKit check; never accesses production or Supabase. */
"use strict";
const {webkit}=require("playwright"),fs=require("node:fs"),path=require("node:path");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const inline=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert.ok(inline,"base inline style");
const links=[...html.matchAll(/<link rel="stylesheet" href="\/([^"?]+)(?:\?[^"]*)?">/g)].map(m=>m[1]);
assert.equal(links.at(-1),"master-dense.css");
const styles=[inline,...links.map(file=>fs.readFileSync(path.join(root,file),"utf8"))].join("\n");
const fixture=[
'<main id="appScreen" class="rd-master master-mode">',
'<div class="master-brand"><svg class="master-brand-icon" width="38" height="38" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#5367e8"/></svg><div class="master-brand-text"><strong>Работа</strong><span>Сервис промывки отопления</span></div></div>',
'<header><div class="master-header-info"><h1>Мои заказы</h1><div class="master-header-meta"><span class="muted" id="roleName">Рауль</span>',
'<button id="masterBalanceQuick" class="master-balance-quick"><span class="balance-label">К выплате</span><strong class="balance-amount">20 250 ₽</strong><span class="balance-arrow">›</span></button></div></div>',
'<div class="master-header-actions"><section id="masterPushPanel" class="push-panel push-compact">',
'<button class="push-bell" aria-label="Уведомления">☼</button></section><button class="secondary" id="logoutBtn">Выйти</button></div></header>',
'<div class="sync-note" id="syncStatus">Обновлено 17:33</div><div id="ordersArea">',
'<button class="primary new-order" id="newOrderBtn"><span class="plus">+</span>Новый заказ</button>',
'<nav class="tabs"><button class="tab">По дням</button><button class="tab active">Расписание</button><button class="tab">История</button></nav>',
'<section class="panel" id="calendarPanel"><div class="panel-top"><h2>Календарь</h2><div class="nav"><button class="secondary" id="prevWeek">‹</button><button class="secondary" id="goToday">Сегодня</button><button class="secondary" id="nextWeek">›</button></div></div>',
'<input class="calendar-date" id="calendarDate" type="date" value="2026-11-12"><div class="week" id="weekDays">',
...Array.from({length:7},(_,i)=>'<button class="day'+(i===3?' active':i===4?' has-orders':'')+'" type="button"><span class="weekday">'+['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][i]+'</span><strong>'+(i+9)+'</strong></button>').map(s=>"'"+s+"'"),'</div></section>',
'<section class="master-today-summary"><div class="master-today-top"><strong class="master-today-title">Сегодня · 12 нояб.</strong><span class="master-today-count">1 заказ</span></div>',
'<button class="master-next-jump"><span class="master-next-caption">Ближайший выезд</span><strong class="master-next-value">Сегодня · 18:00 · Давид</strong></button></section>',
'<div class="list-head"><h2>Моё расписание</h2><span class="count" id="orderCount">9 шт.</span></div><div id="orders">',
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
'</div></div></main>'
].join("");
(async()=>{
const browser=await webkit.launch({headless:true});
try{
 for(const width of [320,350,375,390,430,768]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
  await page.setContent('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>'+styles+'</style></head><body class="rd">'+fixture+'</body></html>');
  const result=await page.evaluate(()=>{
   const dim=sel=>{const node=document.querySelector(sel),r=node.getBoundingClientRect();return {height:r.height,size:parseFloat(getComputedStyle(node).fontSize)}};
   return {scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth,
    title:dim("#appScreen header h1"),newOrder:dim("#newOrderBtn"),bell:dim(".push-bell"),
    logout:dim("#logoutBtn"),tab:dim(".tabs .tab"),next:dim(".master-next-jump"),
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
    logo:dim(".master-brand-icon"),
    headerOverlap:(()=>{
      const a=document.querySelector(".master-balance-quick").getBoundingClientRect();
      const b=document.querySelector(".push-bell").getBoundingClientRect();
      const c=document.querySelector("#logoutBtn").getBoundingClientRect();
      const overlaps=(x,y)=>x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top;
      return overlaps(a,b)||overlaps(a,c);
    })()};
  });
  assert.ok(result.scroll<=result.width+1,"horizontal overflow at "+width+" "+JSON.stringify(result));
  for(const key of ["newOrder","bell","logout","tab","next"])
   assert.ok(result[key].height>=43.5,key+" tap target at "+width+" height "+result[key].height);
  assert.ok(result.time.size<=19.1,"time font "+width);
  assert.ok(result.name.size<=15.1,"client font "+width);
  assert.ok(result.title.size<=21.1,"title font "+width);
  assert.ok(result.summary.height<=120,"today block height "+width+" "+result.summary.height);
  assert.ok(result.card.height<=88,"compact card at "+width+": "+result.card.height);
  assert.ok(result.card.height>=62,"compact card remains tappable at "+width);
  assert.ok(result.avatar.height>=26.5&&result.avatar.height<=29.5,"compact avatar geometry at "+width);
  assert.equal(result.headerOverlap,false,"balance must not overlap notifications/logout at "+width);
  assert.ok(result.logo.height>=33.5,"compact master brand logo visible at "+width);
  if(width===320)console.log("CALENDAR_DIAGNOSTICS",JSON.stringify(result.calendarComputed));
  assert.ok(result.calendar.height<=205,"calendar must be compact at "+width+": "+result.calendar.height);
  assert.ok(result.calendar.height>=146,"calendar remains usable at "+width);
  for(const key of ["calendarDate","calendarDay","calendarToday","calendarPrevious","calendarNext"])
    assert.ok(result[key].height>=43.5,key+" usable touch target at "+width+": "+result[key].height);

  await page.close();
 }
 console.log("Master dense layout: PASS (WebKit, 320/350/375/390/430/768)");
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
