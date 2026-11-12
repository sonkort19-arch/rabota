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
'<main id="appScreen" class="rd-master master-mode"><header>',
'<div><h1>Мои заказы</h1><span class="muted" id="roleName">Рауль</span>',
'<button id="masterBalanceQuick" class="master-balance-quick"><span class="balance-label">К выплате</span><strong class="balance-amount">20 250 ₽</strong><span class="balance-arrow">›</span></button></div>',
'<div class="master-header-actions"><section id="masterPushPanel" class="push-panel push-compact">',
'<button class="push-bell" aria-label="Уведомления">☼</button></section><button class="secondary" id="logoutBtn">Выйти</button></div></header>',
'<div class="sync-note" id="syncStatus">Обновлено 17:33</div><div id="ordersArea">',
'<button class="primary new-order" id="newOrderBtn"><span class="plus">+</span>Новый заказ</button>',
'<nav class="tabs"><button class="tab">По дням</button><button class="tab active">Расписание</button><button class="tab">История</button></nav>',
'<section class="master-today-summary"><div class="master-today-top"><strong class="master-today-title">Сегодня · 12 нояб.</strong><span class="master-today-count">1 заказ</span></div>',
'<button class="master-next-jump"><span class="master-next-caption">Ближайший выезд</span><strong class="master-next-value">Сегодня · 18:00 · Давид</strong></button></section>',
'<div class="list-head"><h2>Моё расписание</h2><span class="count" id="orderCount">9 шт.</span></div><div id="orders">',
'<div class="master-day-heading"><h3>Сегодня · 12 нояб.</h3><span class="muted">1 заказ</span></div>',
'<article class="master-schedule-card is-next"><button class="master-schedule-toggle">',
'<span class="master-schedule-time">18:00</span><span class="master-schedule-main"><strong class="master-schedule-name">Давид</strong>',
'<span class="master-schedule-address">Сунжа набережная 26 квартира 55</span>',
'<span class="master-schedule-meta"><strong class="master-schedule-price">21 000 ₽</strong><span class="status-badge s-booked">Записан</span></span>',
'<span class="master-schedule-work">Радиаторы: 9 · Тёплый пол: 3 конт.</span></span><span class="master-schedule-chevron">›</span></button></article>',
'<div class="master-day-heading"><h3>Пятница, 13 ноября</h3><span class="muted">2 заказа</span></div>',
'<article class="master-schedule-card"><button class="master-schedule-toggle"><span class="master-schedule-time">10:00</span>',
'<span class="master-schedule-main"><strong class="master-schedule-name">Очень длинное имя клиента</strong>',
'<span class="master-schedule-address">Очень длинный адрес с названием улицы и номером дома, занимает несколько строк</span>',
'<span class="master-schedule-meta"><strong class="master-schedule-price">11 000 ₽</strong><span class="status-badge s-booked">Записан</span></span>',
'<span class="master-schedule-work">Радиаторы: 5</span></span><span class="master-schedule-chevron">›</span></button></article>',
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
    summary:dim(".master-today-summary"),card:dim(".master-schedule-toggle")};
  });
  assert.ok(result.scroll<=result.width+1,"horizontal overflow at "+width+" "+JSON.stringify(result));
  for(const key of ["newOrder","bell","logout","tab","next"])
   assert.ok(result[key].height>=43.5,key+" tap target at "+width+" height "+result[key].height);
  assert.ok(result.time.size<=19.1,"time font "+width);
  assert.ok(result.name.size<=15.1,"client font "+width);
  assert.ok(result.title.size<=21.1,"title font "+width);
  assert.ok(result.summary.height<=120,"today block height "+width+" "+result.summary.height);
  await page.close();
 }
 console.log("Master dense layout: PASS (WebKit, 320/350/375/390/430/768)");
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
