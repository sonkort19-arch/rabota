"use strict";
const {chromium,webkit}=require("playwright");
const path=require("node:path");
const assert=require("node:assert/strict");
const reportJs=path.join(__dirname,"..","profit-report.js");
const reportCss=path.join(__dirname,"..","profit-report.css");
async function run(browserType,iphone){
  const browser=await browserType.launch({headless:true});
  try{
    const context=await browser.newContext({
      viewport:iphone?{width:390,height:844}:{width:1200,height:800},
      acceptDownloads:true,isMobile:iphone,hasTouch:iphone
    });
    const page=await context.newPage();
    await page.setContent('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}#rdReports{padding:12px;box-sizing:border-box}</style></head><body class="rd"><section id="rdReports"></section></body></html>');
    await page.addStyleTag({path:reportCss});
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
    const table=page.locator(".pr-table");
    assert.equal(await table.locator("tbody>tr").count(),6);
    assert.match(await page.locator(".pr-metrics").innerText(),/3 500/);
    assert.match(await page.locator(".pr-note").innerText(),/Без расчёта прибыли: 1/);
    await page.locator('.pr-controls select[aria-label="Статус заказов"]').selectOption("unpaid");
    assert.equal(await table.locator("tbody>tr").count(),2);
    assert.match(await page.locator(".pr-note").innerText(),/1 из 1/);
    await page.locator('.pr-controls select[aria-label="Статус заказов"]').selectOption("");
    await page.locator(".pr-controls input[type=search]").fill("#00012");
    assert.equal(await table.locator("tbody>tr").count(),2);
    await page.locator(".pr-row-open").click();
    assert.equal(await page.locator(".pr-expanded:not([hidden])").count(),1);
    const downloadPromise=page.waitForEvent("download");
    await page.locator(".pr-export").click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/rabota-profit-orders-.*\.csv/);
    if(iphone){
      const size=await page.evaluate(()=>({
        pageWidth:document.documentElement.scrollWidth,
        viewport:window.innerWidth,
        tableOverflow:document.querySelector(".pr-scroll").scrollWidth>
          document.querySelector(".pr-scroll").clientWidth
      }));
      assert.ok(size.pageWidth<=size.viewport+1,"Mobile page has horizontal overflow: "+JSON.stringify(size));
      assert.ok(size.tableOverflow,"Order table must scroll inside its own viewport");
    }
    await context.close();
  }finally{await browser.close()}
}
(async()=>{
  await run(chromium,false);
  await run(webkit,true);
  process.stdout.write("Profit report browser checks passed in Chromium and mobile WebKit\n");
})().catch(err=>{console.error(err);process.exitCode=1});
