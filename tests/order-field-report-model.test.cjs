"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {FIELDS,PERIODS,build,sortGroups,profitLeaders,csvFor,moscowDay}=require("../order-field-report-model.js");
const {bounds,financialSummary,filterRows}=require("../profit-report.js");

test("profit leaders require a positive verified result from an identified source",()=>{
  const groups=[
    {key:"",profit:4000},{key:"unknown",profit:3500},
    {key:"avito",profit:2000},{key:"vk",profit:2000},
    {key:"2gis",profit:0},{key:"instagram",profit:-200}
  ];
  const report={groups,totals:{unverified:0}};
  assert.deepEqual(profitLeaders(report).map(group=>group.key),["avito","vk"]);
  assert.deepEqual(profitLeaders({...report,totals:{unverified:1}}),[]);
  assert.deepEqual(profitLeaders({...report,groups:groups.filter(group=>!["avito","vk"].includes(group.key))}),[]);
});

function order(id,orderNumber,clientSource,extra={}){
  return {id,orderNumber,clientSource,status:"Выполнен",paid:true,price:10000,paymentAmount:10000,
    completedAt:"2026-11-22T20:00:00Z",createdAt:"2026-11-01T07:00:00Z",...extra};
}
function expense(id,amount,extra={}){
  return {id,kind:"expense",amount,order_id:null,voided_at:null,...extra};
}
function fixture(){
  return {
    orders:[
      order("a",12,"avito",{paymentAmount:11000,travelAmount:1000}),
      order("b",13," Авито ",{price:4000,paymentAmount:4500,travelAmount:500}),
      order("c",14,undefined,{paymentAmount:10800,travelAmount:800}),
      order("d",15," ",{paid:false,paymentAmount:null}),
      order("held",16,"vk",{paymentAmount:null}),
      order("booked",17,"website",{status:"Записан",paid:false,paymentAmount:null,completedAt:null})
    ],
    options:{period:"month",today:"2026-11-23",payroll:{
      state:"active",masterId:"raul",orders:[{orderId:"a",actualPaid:10000,companyShare:3500}],
      holds:[{orderId:"held",payrollOnHold:true}],
      accounting:{
        receipts:[
          {orderId:"a",amount:11000,travelAmount:1000,masterId:"raul"},
          {orderId:"b",amount:4500,travelAmount:500,masterId:"second-master"},
          {orderId:"c",amount:10800,travelAmount:800,masterId:"raul"},
          {orderId:"held",amount:10000,masterId:"raul"}
        ],
        refunds:[{orderId:"c",amount:10800,travelAmount:800}]
      },
      travelHistory:[
        {orderId:"a",delta:1200},{orderId:"a",delta:-200},{orderId:"b",delta:350},
        {orderId:"c",delta:800},{orderId:"booked",delta:900}
      ]
    },operations:[
      expense("fk",300.25,{order_id:"a",note:"[Транспорт] · Заказ №00013"}),
      expense("canonical",19.6,{note:"[Расходники] материал · Заказ №00012"}),
      expense("b-expense","100.05",{note:"[Расходники] · Заказ №13"}),
      expense("b-expense","100.05",{note:"[Расходники] · Заказ №13"}),
      expense("c-expense",40,{order_id:"c"}),
      expense("d-expense",18.22,{order_id:"d"}),
      expense("void",100,{order_id:"a",voided_at:"2026-11-01T00:00:00Z"}),
      expense("different-kind",500,{kind:"raul_payout",order_id:"a"}),
      expense("general",1000,{note:"[Реклама] Сумма за месяц"}),
      expense("general-reference",1000,{note:"[Реклама] Заказ №00012 ещё обсуждается"}),
      expense("wrong-link",1000,{order_id:"elsewhere",note:"[Расходники] · Заказ №00012"})
    ]}
  };
}

test("grouped financial metrics share the profit report's closing-date rows and cent-safe totals",()=>{
  const {orders,options}=fixture();
  const report=build(orders,options);
  const {groups,totals}=report;
  const avito=groups.find(row=>row.key==="avito");
  const missing=groups.find(row=>row.key==="");
  assert.equal(avito.label,"Авито");
  assert.deepEqual(avito.rows.map(row=>row.id),["a","b"]);
  assert.equal(avito.count,2);
  assert.equal(avito.percent,40);
  assert.equal(avito.revenue,15500);
  assert.equal(avito.salary,7850);
  assert.equal(avito.expenses,419.90);
  assert.equal(avito.profit,7080.10,"unearned surplus earmarked for travel is not credited to company profit");
  assert.equal(avito.average,7750);
  assert.equal(missing.label,"Не указан");
  assert.equal(missing.revenue,0,"a confirmed refund is excluded from net receipts");
  assert.equal(missing.salary,800,"travel already earned is kept after refund");
  assert.equal(missing.expenses,58.22);
  assert.equal(missing.profit,-858.22);
  assert.equal(missing.count,2,"the refunded and unpaid closed orders still occur in the filtered order count");
  const {key,label,rows,percent,...finance}=totals;
  assert.deepEqual(finance,financialSummary(filterRows(orders,options)));
  assert.deepEqual(finance,{
    count:5,revenue:25500,salary:8650,expenses:478.12,profit:6221.88,average:8500,paid:3,unverified:1
  });
  assert.equal(percent,100);
  assert.equal(rows.map(row=>row.id).includes("booked"),false);
  assert.equal(build(orders,{...options,period:"all"}).totals.profit,5321.88);
});

test("expense attribution requires an existing linked id or an unambiguous saved order-number suffix",()=>{
  const orders=[order("first",7,"avito"),order("second",7,"vk"),order("third",8,"unknown")];
  const operations=[
    expense("ambiguous",100,{note:"[Расходники] · Заказ №00007"}),
    expense("canonical",20.20,{note:"[Расходники] · Заказ №00008"}),
    expense("without-marker",300,{note:"Заказ №00008"}),
    expense("other-fk",400,{order_id:"missing",note:"[Расходники] · Заказ №00008"}),
    expense("void",500,{order_id:"third"}),
    expense("void",500,{order_id:"third",voided_at:"2026-11-04T21:00:00Z"}),
    expense("linked",10.01,{order_id:"first",note:"[Расходники] · Заказ №00008"})
  ];
  const report=build(orders,{operations});
  assert.equal(report.totals.expenses,30.21);
  assert.equal(report.groups.find(row=>row.key==="unknown").label,"Неизвестно");
  assert.equal(report.groups.find(row=>row.key==="vk").expenses,0);
  assert.equal(report.groups.find(row=>row.key==="avito").expenses,10.01);
});

test("canonical source names group with codes while distinct legacy labels keep their identity",()=>{
  const {groups}=build(["avito","Авито"," AVITO ","Авито (другое объявление)","Неизвестно","unknown",""]
    .map((source,index)=>order(String(index),index+1,source)));
  assert.deepEqual(groups.map(({key,label,count})=>[key,label,count]),[
    ["avito","Авито",3],["Авито (другое объявление)","Авито (другое объявление)",1],
    ["unknown","Неизвестно",2],["","Не указан",1]
  ]);
});

test("every date preset uses the existing report's Moscow dates including month and year rollover",()=>{
  assert.deepEqual(FIELDS,[["clientSource","Откуда узнали"]]);
  assert.deepEqual(PERIODS.map(([key])=>key),["today","yesterday","week","month","previous","all","custom"]);
  const today=moscowDay("2025-12-31T21:05:00Z");
  const orders=[
    order("today",1,"avito",{completedAt:"2025-12-31T21:00:00Z"}),
    order("yesterday",2,"avito",{completedAt:"2025-12-31T20:59:59Z"}),
    order("monday",3,"vk",{completedAt:"2025-12-29T09:00:00Z"}),
    order("sunday",4,"vk",{completedAt:"2025-12-28T09:00:00Z"}),
    order("before",5,"website",{completedAt:"2025-11-30T16:00:00Z"}),
    order("future",6,"website",{completedAt:"2026-01-02T18:00:00Z"})
  ];
  assert.equal(today,"2026-01-01");
  const cases=[
    ["today",["today"]],["yesterday",["yesterday"]],["week",["monday","today","yesterday"]],
    ["month",["today"]],["previous",["monday","sunday","yesterday"]],
    ["all",["before","future","monday","sunday","today","yesterday"]],["custom",["monday","sunday"]]
  ];
  const options={today,from:"2025-12-28",to:"2025-12-29"};
  for(const [period,ids] of cases){
    const input={...options,period};
    assert.deepEqual(build(orders,input).rows.map(row=>row.id).sort(),ids,period);
    assert.deepEqual(build(orders,input).rows,filterRows(orders,input));
  }
  assert.deepEqual(bounds("previous",today),["2025-12-01","2025-12-31"]);
  assert.deepEqual(bounds("yesterday",today),["2025-12-31","2025-12-31"]);
  assert.equal(build(orders,{...options,period:"custom",from:"2025-12-30"}).totals.percent,0);
});

test("sorting preserves groups and CSV keeps totals first, with safe formulas and signed numeric money",()=>{
  const orders=[order("a",1,"=2+2"),order("b",2,"vk")];
  const report=build(orders,{
    operations:[expense("first",5.21,{order_id:"a"}),expense("second",0.01,{order_id:"b"})]
  });
  for(const key of ["count","percent","revenue","salary","expenses","profit","average","label"]){
    for(const direction of ["asc","desc"]){
      assert.equal(sortGroups(report.groups,key,direction).length,2);
    }
  }
  const sorted=sortGroups(report.groups,"profit","asc");
  assert.deepEqual(sorted.map(group=>group.key),["=2+2","vk"]);
  assert.deepEqual(sortGroups(report.groups,"expenses","asc").map(group=>group.key),["vk","=2+2"]);
  const [head,total,formula,safe]=csvFor(report,sorted).split("\r\n");
  assert.match(head,/^\uFEFF"Источник клиента";.*"Средний чек"$/);
  assert.equal(total,'"Итого";2;100;0;0;5.22;-5.22;0');
  assert.equal(formula,`"'=2+2";1;50;0;0;5.21;-5.21;0`);
  assert.equal(safe,'"ВКонтакте";1;50;0;0;0.01;-0.01;0');
});
