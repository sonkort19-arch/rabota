"use strict";
(function(root){
  const profit=root?.__rdProfitReportModel??
    (typeof module==="object"&&module.exports?require("./profit-report.js"):null);
  const sources=root?.__rdClientWhatsApp??
    (typeof module==="object"&&module.exports?require("./whatsapp-client.js"):null);
  const defaultSourceLabel=sources?.sourceLabel??(()=>null);
  const legacySources=new Map((sources?.CLIENT_SOURCES??[]).map(({value,label})=>
    [label.toLocaleLowerCase("ru-RU"),value]));
  const PERIODS=[
    ["today","Сегодня"],["yesterday","Вчера"],["week","Текущая неделя"],["month","Текущий месяц"],
    ["previous","Прошлый месяц"],["all","За всё время"],["custom","Произвольный период"]
  ];
  const COLUMNS=[
    ["label","Источник клиента"],["count","Количество заказов"],["percent","Процент от общего количества"],
    ["revenue","Выручка"],["salary","Начисленная зарплата"],["expenses","Дополнительные расходы"],
    ["profit","Прибыль по заказам"],["average","Средний чек"]
  ];
  const collator=new Intl.Collator("ru-RU",{numeric:true});
  const grouping=new Map([["clientSource",{
    label:"Откуда узнали",
    read(row,sourceLabel){
      const value=String(row.clientSource??"").trim();
      if(!value)return {key:"",label:"Не указан"};
      const normalized=value.toLocaleLowerCase("ru-RU");
      const code=legacySources.get(normalized)??normalized;
      const known=sourceLabel(code);
      return {key:known?code:value,label:known||value};
    }
  }]]);
  const FIELDS=[...grouping].map(([key,field])=>[key,field.label]);

  function build(orders,{field="clientSource",sourceLabel=defaultSourceLabel,...options}={}){
    const definition=grouping.get(field);
    if(!definition)throw Error("Поле для отчёта недоступно.");
    const rows=profit.filterRows(orders,options);
    const buckets=new Map();
    for(const row of rows){
      const {key,label}=definition.read(row,sourceLabel);
      if(!buckets.has(key))buckets.set(key,{key,label,rows:[]});
      buckets.get(key).rows.push(row);
    }
    const groups=[...buckets.values()].map(group=>({
      ...group,...profit.financialSummary(group.rows),
      percent:Math.round(group.rows.length*10000/rows.length)/100
    }));
    const totals={
      key:null,label:"Итого",rows,...profit.financialSummary(rows),percent:rows.length?100:0
    };
    return {rows,groups,totals};
  }
  function sortGroups(groups,key="count",direction="desc"){
    const column=COLUMNS.some(([value])=>value===key)?key:"count";
    const sign=direction==="asc"?1:-1;
    return [...groups].sort((a,b)=>{
      const primary=column==="label"?collator.compare(a.label,b.label):a[column]-b[column];
      return sign*primary||collator.compare(a.label,b.label);
    });
  }
  function isKnownSource(group){
    return Boolean(group.key)&&group.key!=="unknown";
  }
  function profitLeaders({groups,totals}){
    if(totals.unverified)return [];
    const profitable=groups.filter(group=>isKnownSource(group)&&group.profit>0);
    const top=profitable.reduce((best,group)=>Math.max(best,group.profit),0);
    return profitable.filter(group=>group.profit===top);
  }
  function csvFor(report,groups=report.groups){
    const header=COLUMNS.map(([,label])=>label);
    const data=[report.totals,...groups].map(group=>COLUMNS.map(([key])=>group[key]));
    return "\uFEFF"+[header,...data].map(row=>row.map(profit.quoteCsv).join(";")).join("\r\n");
  }
  const model={FIELDS,PERIODS,COLUMNS,build,sortGroups,isKnownSource,profitLeaders,csvFor,
    moscowDay:profit.moscowDay,bounds:profit.bounds};
  if(root)root.__rdOrderFieldReportModel=model;
  if(typeof module==="object"&&module.exports)module.exports=model;
})(typeof window!=="undefined"?window:null);
