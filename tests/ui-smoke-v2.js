/* Chromium smoke against the real CRM on synthetic, read-only fixtures.
 * Run: node tests/ui-smoke-v2.js. No requests reach a live database.
 */
"use strict";
const assert = require("node:assert/strict");
const {existsSync} = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");
const {fixture,go} = require("./module-navigation-browser.cjs");

const root = path.resolve(__dirname,"..");

async function check(browser,role){
  const session = await fixture(browser,root,390,role);
  const {page,documents,writes} = session;
  try {
    await page.goto("https://crm.test/");
    await go(page,"home");
    const home = page.locator("#rdHome");
    await home.waitFor();
    assert.equal(await home.locator(".rd-home-metrics button").count(),3);
    assert.equal(await home.locator(".rd-home-actions .rd-svgicon").count(),3);
    assert.equal(await page.locator("#rdTopSearch").isVisible(),false);
    await home.locator("summary").click();
    await home.getByRole("heading",{name:"Динамика заказов"}).waitFor();
    assert.equal(await home.locator(".rd-chart-month").count(),1);
    await page.evaluate(()=>window.__rdRefresh());
    assert.equal(await home.locator(".rd-chart-month").count(),1,"refresh retains one chart");

    await home.getByRole("button",{name:"Календарь",exact:true}).click();
    const calendar = page.locator("#calendarPanel");
    await calendar.waitFor();
    assert.equal(await calendar.locator("#weekDays .day").count(),7);
    assert.equal(await page.locator('#rdMobileNav [data-page="orders"]').getAttribute("aria-current"),"page");
    assert.equal(await page.locator("#orders .rd-list-row").count(),18);
    const view = page.locator("#owViewSwitch");
    await view.locator('[data-ow-mode="all"]').click();
    assert.equal(await calendar.isVisible(),false);
    assert.equal(await view.locator('[data-ow-mode="all"]').getAttribute("aria-selected"),"true");
    await page.locator("#owFilterToggle").click();
    await page.locator("#owFilterStatus").selectOption("В работе");
    await page.locator("#owFilterApply").click();
    assert.equal(await page.locator("#orders .rd-list-row").count(),0);
    await page.locator("#owFilterSummary").getByRole("button",{name:"Сбросить"}).click();
    assert.equal(await page.locator("#orders .rd-list-row").count(),18);
    const order = page.locator("#orders .rd-list-row").filter({hasText:"Тестовый заказ 17"});
    await order.locator(".rd-list-toggle").click();
    const detail = page.locator(".rd-order-dialog");
    await detail.waitFor();
    assert.match(await detail.innerText(),/Тестовый заказ 17/);
    await detail.getByRole("button",{name:"Закрыть заказ"}).click();

    await go(page,"clients");
    const clients = page.locator("#rdClientsList .rd-client");
    assert.equal(await clients.count(),18);
    await page.locator("#rdClientSearch").fill("Тестовый заказ 17");
    assert.equal(await clients.count(),1);
    await clients.getByRole("button",{name:"Вся история клиента"}).click();
    const history = page.locator("#rdClientHistory");
    await history.getByRole("heading",{name:"Тестовый заказ 17"}).waitFor();
    await history.getByRole("button",{name:"Открыть заявку"}).click();
    await page.locator("#orderOverlay").waitFor();
    assert.equal(await page.locator("#clientName").inputValue(),"Тестовый заказ 17");
    await page.locator("#closeOrderBtn").click();
    await history.getByRole("button",{name:"Все клиенты"}).click();
    assert.equal(await clients.count(),1,"returning keeps the client search");
    await go(page,"leads");
    const leadSearch=page.locator("#rdLeads #rdLeadSearch");
    const leads=page.locator("#laLeadList .la-lead");
    await leads.first().waitFor();
    assert.equal(await leads.count(),2);
    await leadSearch.fill("8 (913) 444-55-66");
    assert.equal(await leads.count(),1);
    assert.match(await leads.innerText(),/Олег тестовый лид/);
    await go(page,"clients");
    assert.equal(await page.locator("#rdClientSearch").inputValue(),"Тестовый заказ 17");
    assert.equal(await clients.count(),1);
    await go(page,"leads");
    assert.equal(await leadSearch.inputValue(),"8 (913) 444-55-66");
    assert.equal(await leads.count(),1);
    if(role==="owner"){
      await go(page,"finance");
      const finance=page.locator("#financePanel");
      await finance.waitFor();
      const create=finance.locator(".mw-owner-create");
      await create.click();
      await finance.getByRole("button",{name:/Создать приход/}).waitFor();
      await finance.getByRole("button",{name:/Создать расход/}).waitFor();
      assert.equal(await finance.getByRole("button",{name:/Сдать наличные|Подтвердить передачу/}).count(),0);
      await create.click();
      await go(page,"reports");
      await page.locator("#rdReports .rd-salary-entry").waitFor();
      await page.locator("#rdReports").getByRole("button",{name:/^Прибыль по заказам/}).waitFor();
    }else{
      assert.equal(await page.locator('[data-page="finance"], [data-page="reports"], [data-page="ai"]').count(),0);
      await page.evaluate(()=>window.__rdNavigate("finance"));
      assert.equal(await page.locator("#financePanel").isVisible(),false);
    }
    await go(page,"settings");
    assert.equal(await page.locator("#rdTopSearch").isVisible(),false);
    assert.equal(documents.length,1,"the shell navigates without reloading");
    assert.deepEqual(writes,[]);
    console.log("PASS UI",role,"dashboard, calendar, filters, orders, customer search, roles");
  }finally{
    await session.close();
  }
}

async function runSmoke(){
  const browser = await chromium.launch({
    executablePath:process.env.CHROMIUM_PATH||(existsSync("/usr/bin/chromium")?"/usr/bin/chromium":undefined),
    args:["--no-sandbox"]
  });
  try{
    await check(browser,"owner");
    await check(browser,"manager");
  }finally{await browser.close();}
}

module.exports = {runSmoke};
if(require.main===module)runSmoke().catch(error=>{console.error(error);process.exitCode=1;});
