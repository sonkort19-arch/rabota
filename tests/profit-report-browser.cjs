"use strict";
const {chromium,webkit}=require("playwright");
const path=require("node:path");
const assert=require("node:assert/strict");
const reportJs=path.join(__dirname,"..","profit-report.js");
const reportCss=path.join(__dirname,"..","profit-report.css");
// Keep Chromium + WebKit coverage by default; allow one installed engine locally.
async function launch(browserType){
  const type=process.env.TEST_BROWSER==="chromium"?chromium:
    process.env.TEST_BROWSER==="webkit"?webkit:browserType;
  return type.launch({headless:true,
    executablePath:process.env.TEST_BROWSER_PATH||
      (type===chromium?process.env.CHROMIUM_PATH:undefined),
    args:type===chromium?["--no-sandbox"]:[]});
}
async function run(browserType,iphone){
  const browser=await launch(browserType);
  try{
    const context=await browser.newContext({
      viewport:iphone?{width:390,height:844}:{width:1200,height:800},
      acceptDownloads:true,isMobile:iphone,hasTouch:iphone,
      colorScheme:iphone?"dark":"light",serviceWorkers:"block"
    });
    await context.route("**/*",route=>route.abort());
    const page=await context.newPage();
    await page.setContent('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}#rdReports{padding:12px;box-sizing:border-box}</style></head><body class="rd"><section id="rdReports"><h1 class="rd-view-title">Отчёты</h1></section></body></html>');
    await page.addStyleTag({path:path.join(__dirname,"..","light-theme.css")});
    await page.addStyleTag({path:path.join(__dirname,"..","polished-v2.css")});
    await page.addStyleTag({path:reportCss});
    await page.addScriptTag({path:path.join(__dirname,"..","finance-model.js")});
    await page.addScriptTag({path:reportJs});
    await page.evaluate(()=>{
      const created=new Date().toISOString();
      window.syntheticOrders=[
        {id:"a",orderNumber:12,referenceCode:"№00012",createdAt:created,
          completedAt:created,date:"2026-11-19",name:"Анна",master:"Рауль",
          status:"Выполнен",price:10000,paid:true,paymentAmount:10000,
          address:"Владикавказ",clientSource:"Авито"},
        {id:"b",orderNumber:13,referenceCode:"№00013",createdAt:created,
          date:"2026-11-20",name:"Борис",master:"Рауль",
          status:"Записан",price:12000,paid:false},
        {id:"c",orderNumber:14,referenceCode:"№00014",createdAt:created,
          completedAt:created,date:"2026-11-19",name:"Вера",master:"Олег",
          status:"Выполнен",price:5000,paid:true,paymentAmount:5000}
      ];
      window.report=window.__rdCreateProfitReport(
        document.querySelector("#rdReports"),{getOrders:()=>window.syntheticOrders});
    });
    await page.locator(".pr-report-link").click();
    assert.equal((await page.locator(".pr-heading").innerText()).replace(/\s+/g," ").trim(), "Отчёты / Прибыль по заказам");
    assert.equal(await page.locator(".pr-heading .pr-back").count(),1);
    assert.equal(await page.locator("#rdReports > .rd-view-title").isVisible(),false,"No duplicate report title when viewing details");
    assert.equal(await page.locator('.pr-controls select[aria-label="Тип даты отчёта"]').inputValue(),"closed");
    // Default closing-date month excludes booked orders; "all" still shows every order.
    await page.locator('.pr-controls select[aria-label="Период отчёта"]').selectOption("all");
    const table=page.locator(".pr-table");
    const palette=await page.evaluate(()=>{
      const color=selector=>{
        const style=getComputedStyle(document.querySelector(selector));
        return {background:style.backgroundColor,text:style.color};
      };
      return {page:color("#rdReports"),table:color(".pr-table"),
        firstRow:color(".pr-table tbody .pr-total-row"),
        dataRow:color(".pr-table tbody tr:not(.pr-total-row) td"),
        input:color(".pr-controls input"),status:color(".pr-controls select")};
    });
    for(const field of ["table","dataRow","input","status"]){
      assert.equal(palette[field].background,"rgb(255, 255, 255)",
        "The report must match the light CRM in both OS themes: "+field+" "+JSON.stringify(palette));
    }
    assert.notEqual(palette.firstRow.background,"rgb(27, 37, 52)",
      "The totals row must not inherit the previous dark report theme");
    // Validate real text placement, not just that table cells line up.
    // This catches the visually displaced "Зарплата" and "Прибыль" shown on iPhone.
    async function checkAlignment(scrollToRight=false){
      return page.evaluate(move=>{
        const table=document.querySelector(".pr-table");
        const scroller=document.querySelector(".pr-scroll");
        if(move)scroller.scrollLeft=scroller.scrollWidth;
        const headers=[...table.querySelectorAll("thead th")];
        const total=[...table.querySelectorAll("tbody tr.pr-total-row > *")];
        const sample=[...table.querySelectorAll("tbody tr:not(.pr-total-row):not(.pr-expanded)")][0];
        const row=[...sample.children];
        const centerText=el=>{
          const textRange=document.createRange();
          textRange.selectNodeContents(el);
          const bounds=textRange.getBoundingClientRect();
          return (bounds.left+bounds.right)/2;
        };
        const errors=[];
        for(let i=0;i<8;i++){
          const headerRect=headers[i].getBoundingClientRect();
          const totalRect=total[i].getBoundingClientRect();
          const rowRect=row[i].getBoundingClientRect();
          if(Math.abs(headerRect.left-totalRect.left)>1||
             Math.abs(headerRect.right-totalRect.right)>1||
             Math.abs(headerRect.left-rowRect.left)>1||
             Math.abs(headerRect.right-rowRect.right)>1){
            errors.push("Column "+(i+1)+" has shifted boundaries");
          }
          if(i>=4){
            for(const cell of [headers[i],total[i],row[i]]){
              const rect=cell.getBoundingClientRect();
              if(Math.abs(centerText(cell)-(rect.left+rect.right)/2)>2.5){
                errors.push("Financial label or value is off-center in column "+(i+1));
              }
            }
          }
        }
        return {errors,widths:headers.map(h=>Math.round(h.getBoundingClientRect().width)),
          scrollLeft:scroller.scrollLeft};
      },scrollToRight);
    }
    const initialGrid=await checkAlignment();
    assert.deepEqual(initialGrid.errors,[],JSON.stringify(initialGrid));
    assert.equal(initialGrid.widths.length,8);
    const density=await page.evaluate(()=>{
      const height=selector=>document.querySelector(selector).getBoundingClientRect().height;
      return {
        filter:height('.pr-controls select'),
        row:height('.pr-table tbody tr:not(.pr-expanded):not(.pr-total-row)'),
        total:height('.pr-total-row'),
        csv:height('.pr-export'),
        width:document.querySelector('.pr-table').getBoundingClientRect().width
      };
    });
    assert.ok(density.filter<=39 && density.csv<=39,"Compact controls too tall: "+JSON.stringify(density));
    assert.ok(density.row<=44 && density.total<=48,"Compact table too tall: "+JSON.stringify(density));
    assert.ok(density.width<=820,"Table width must be compact: "+JSON.stringify(density));
    assert.equal(await table.locator("tbody>tr").count(),7);
    assert.equal(await page.locator(".pr-metrics").count(),0,"Old summary cards must be absent");
    assert.match(await table.locator("thead").innerText(),/Доля компании/);
    const firstTotal=(await table.locator("tbody>tr:first-child").innerText()).replace(/\s+/g," ");
    assert.match(firstTotal,/Итого/);
    assert.match(firstTotal,/27 000/);
    assert.match(firstTotal,/15 000/);
    assert.match(firstTotal,/6 500/);
    assert.match(firstTotal,/3 500/);
    assert.match(await page.locator(".pr-note").innerText(),/Без расчёта доли: 1/);
    await page.locator('.pr-controls select[aria-label="Статус заказов"]').selectOption("unpaid");
    assert.equal(await table.locator("tbody>tr").count(),3);
    const unpaidTotal=(await table.locator("tbody>tr:first-child").innerText()).replace(/\s+/g," ");
    assert.match(unpaidTotal,/12 000/);
    assert.match(unpaidTotal,/0 ₽/);
    assert.match(await page.locator(".pr-note").innerText(),/1 из 1/);
    const filteredGrid=await checkAlignment();
    assert.deepEqual(filteredGrid.errors,[],JSON.stringify(filteredGrid));
    assert.deepEqual(filteredGrid.widths,initialGrid.widths,
      "All table widths should remain fixed when order filters change");
    await page.locator('.pr-controls select[aria-label="Статус заказов"]').selectOption("");
    await page.locator(".pr-controls input[type=search]").fill("#00012");
    assert.equal(await table.locator("tbody>tr").count(),3);
    const searchedTotal=(await table.locator("tbody>tr:first-child").innerText()).replace(/\s+/g," ");
    assert.match(searchedTotal,/10 000/);
    await page.locator(".pr-row-open").click();
    assert.equal(await page.locator(".pr-expanded:not([hidden])").count(),1);
    const downloadPromise=page.waitForEvent("download");
    await page.locator(".pr-export").click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/rabota-profit-orders-.*\.csv/);
    await page.locator(".pr-heading .pr-back").click();
    assert.equal(await page.locator("#rdReports > .rd-view-title").isVisible(),true,"Main heading reappears in the reports menu");
    assert.equal(await page.locator(".pr-menu").isVisible(),true,"Back returns to the report list");
    await page.locator(".pr-menu .pr-report-link").click();
    assert.equal(await page.locator(".pr-detail").isVisible(),true,"Report can reopen after going back");
    if(iphone){
      const size=await page.evaluate(()=>({
        pageWidth:document.documentElement.scrollWidth,
        viewport:window.innerWidth,
        tableOverflow:document.querySelector(".pr-scroll").scrollWidth>
          document.querySelector(".pr-scroll").clientWidth
      }));
      assert.ok(size.pageWidth<=size.viewport+1,"Mobile page has horizontal overflow: "+JSON.stringify(size));
      assert.ok(size.tableOverflow,"Order table must scroll inside its own viewport");
      const rightGrid=await checkAlignment(true);
      assert.deepEqual(rightGrid.errors,[],JSON.stringify(rightGrid));
      assert.ok(rightGrid.scrollLeft>0,"The fixed-width grid should be horizontally scrollable");
    }
    await context.close();
  }finally{await browser.close()}
}
async function checkRaulPortal(name,shouldHaveProfit){
  const browser=await launch(webkit);
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:"dark",serviceWorkers:"block"});
    await context.route("**/*",route=>route.abort());
    const page=await context.newPage();
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.setContent('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="rd"><main id="appScreen"><h1 id="appTitle">Мои заказы</h1><section id="ordersArea"><nav class="tabs"><button class="tab" data-tab="calendar"></button><button class="tab" data-tab="all"></button></nav><div id="orders"></div><span id="orderCount"></span></section><section id="financePanel" hidden></section><button id="masterFinanceBack"></button></main></body></html>');
    await page.addStyleTag({path:path.join(__dirname,"..","light-theme.css")});
    await page.addStyleTag({path:path.join(__dirname,"..","money-workspace.css")});
    await page.addStyleTag({path:reportCss});
    await page.addScriptTag({path:path.join(__dirname,"..","finance-model.js")});
    await page.addScriptTag({path:reportJs});
    await page.evaluate(masterName=>{
      // The real index owns this state; the isolated portal must supply it too.
      window.currentTab="calendar";
      const now=new Date().toISOString();
      const orders=[
        {id:"raul",assignedUserId:"raul-uid",referenceCode:"№00012",name:"Мой клиент",
          master:"Рауль",status:"Выполнен",paid:true,price:10000,paymentAmount:10000,createdAt:now,completedAt:now},
        {id:"foreign",assignedUserId:"another-uid",referenceCode:"№99999",name:"Чужой клиент",
          master:"Олег",status:"Выполнен",paid:true,price:100000,paymentAmount:100000,createdAt:now,completedAt:now}
      ];
      window.__rdOrderReference={normalize:x=>String(x||"")};
      window.__rdMoneyUi={
        snapshot:()=>({role:"master",masterName,masterId:"raul-uid",due:0,accrued:0,paid:0,orders:[],payouts:[]}),
        masterReportOrders:()=>masterName==="Рауль"?orders.filter(o=>o.assignedUserId==="raul-uid"):[]
      };
    },name);
    await page.addScriptTag({path:path.join(__dirname,"..","money-workspace.js")});
    await page.evaluate(()=>window.__rdMoneyAccess());
    await page.locator('[data-mw-page="reports"]').click();
    const entry=page.locator('.mw-entry').filter({hasText:"Прибыль по заказам"});
    if(!shouldHaveProfit){
      assert.equal(await entry.count(),0,"A different master cannot see Raul's profit report");
      assert.deepEqual(errors,[],"Isolated master portal has no JavaScript errors");
      await context.close();return;
    }
    assert.equal(await entry.count(),1);
    await entry.click();
    assert.equal(await page.locator('.pr-total-row').count(),1);
    const orderText=await page.locator('#mwMasterReports .pr-table').innerText();
    assert.match(orderText,/№00012/);
    assert.doesNotMatch(orderText,/№99999|Чужой клиент|100 000/);
    const dimensions=await page.evaluate(()=>({
      width:document.documentElement.scrollWidth,
      viewport:window.innerWidth,
      cell:document.querySelector('.pr-table tbody tr:not(.pr-total-row)').getBoundingClientRect().height
    }));
    assert.ok(dimensions.width<=dimensions.viewport+1,"Raul's report causes page overflow: "+JSON.stringify(dimensions));
    assert.ok(dimensions.cell<=44,"Raul's report has oversized rows: "+JSON.stringify(dimensions));
    await page.locator('#mwMasterReports .pr-back').click();
    assert.equal(await entry.count(),1,"Back should return to Raul's Reports menu");
    assert.deepEqual(errors,[],"Isolated master portal has no JavaScript errors");
    await context.close();
  }finally{await browser.close()}
}
async function checkOwnerPayroll(browserType,iphone){
  const browser=await launch(browserType);
  try{
    const context=await browser.newContext({
      viewport:iphone?{width:390,height:844}:{width:1200,height:800},
      isMobile:iphone,hasTouch:iphone,colorScheme:iphone?"dark":"light",serviceWorkers:"block"
    });
    await context.route("**/*",route=>route.abort());
    const page=await context.newPage();
    await page.setContent('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="rd"><main id="appScreen"><section id="rdReports"><div id="rdSalaryReport"></div></section></main></body></html>');
    await page.addStyleTag({path:path.join(__dirname,"..","light-theme.css")});
    await page.addStyleTag({path:path.join(__dirname,"..","polished-v2.css")});
    await page.addStyleTag({path:path.join(__dirname,"..","finance-payroll.css")});
    await page.addScriptTag({path:path.join(__dirname,"..","finance-payroll.js")});
    await page.evaluate(()=>{
      const model={isOwner:true,raulAccrued:12000,raulPaid:5000,raulDue:7000,
        timurAccrued:3000,timurPaid:1500,timurDue:1500,
        companyEarned:10000,masterHeld:0,waitingOwner:0,
        orders:[{date:"2026-11-19",name:"Тестовый заказ",price:20000,raul:10000,timur:1500}],
        operations:[]};
      window.salaryBrowserFixture=window.__rdPayrollReport.mount(
        document.getElementById("rdSalaryReport"),
        {getSnapshot:()=>model,onBack:()=>{window.returnedToReports=true}}
      );
    });
    assert.equal(await page.locator("#rdSalaryReport .fp-person-row").count(),2);
    assert.equal(await page.locator("#rdSalaryReport .fp-metric").count(),3);
    const layout=await page.evaluate(()=>({
      pageWidth:document.documentElement.scrollWidth,
      viewport:window.innerWidth,
      background:getComputedStyle(document.querySelector("#rdSalaryReport .fp-section")).backgroundColor
    }));
    assert.equal(layout.background,"rgb(255, 255, 255)","Salary must match CRM light style");
    if(iphone)assert.ok(layout.pageWidth<=layout.viewport+1,
      "Owner salary report must not overflow iPhone: "+JSON.stringify(layout));
    await page.locator("#rdSalaryReport .fp-person-button").first().click();
    assert.equal(await page.locator("#rdSalaryReport .fp-balance-hero").count(),1);
    assert.match(await page.locator("#rdSalaryReport .fp-balance-hero").innerText(),/7[\s\u00a0\u202f]*000/);
    await page.locator("#rdSalaryReport .fp-person-heading .fp-link").click();
    assert.equal(await page.locator("#rdSalaryReport .fp-person-row").count(),2);
    await page.locator("#rdSalaryReport .fp-report-head .fp-link").click();
    assert.equal(await page.evaluate(()=>window.returnedToReports),true);
    await context.close();
  }finally{await browser.close()}
}
(async()=>{
  await run(chromium,false);
  await run(webkit,true);
  await checkRaulPortal("Рауль",true);
  await checkRaulPortal("Олег",false);
  await checkOwnerPayroll(chromium,false);
  await checkOwnerPayroll(webkit,true);
  process.stdout.write("Reports browser checks passed: orders, owner salary and Raul permissions\n");
})().catch(err=>{console.error(err);process.exitCode=1});
