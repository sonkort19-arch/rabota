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
      acceptDownloads:true,isMobile:iphone,hasTouch:iphone,
      colorScheme:iphone?"dark":"light"
    });
    const page=await context.newPage();
    await page.setContent('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}#rdReports{padding:12px;box-sizing:border-box}</style></head><body class="rd"><section id="rdReports"></section></body></html>');
    await page.addStyleTag({path:path.join(__dirname,"..","light-theme.css")});
    await page.addStyleTag({path:path.join(__dirname,"..","polished-v2.css")});
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
    assert.equal(await table.locator("tbody>tr").count(),7);
    assert.equal(await page.locator(".pr-metrics").count(),0,"Old summary cards must be absent");
    const firstTotal=(await table.locator("tbody>tr:first-child").innerText()).replace(/\s+/g," ");
    assert.match(firstTotal,/Итого/);
    assert.match(firstTotal,/27 000/);
    assert.match(firstTotal,/15 000/);
    assert.match(firstTotal,/6 500/);
    assert.match(firstTotal,/3 500/);
    assert.match(await page.locator(".pr-note").innerText(),/Без расчёта прибыли: 1/);
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
(async()=>{
  await run(chromium,false);
  await run(webkit,true);
  process.stdout.write("Profit report browser checks passed in Chromium and mobile WebKit\n");
})().catch(err=>{console.error(err);process.exitCode=1});
