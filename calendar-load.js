/* CRM Работа: estimated calendar workload for the assigned master.
 * Display only. It never forbids early, late or additional bookings.
 * Moscow-local appointment times are already persisted as local HH:MM.
 */
"use strict";
(function(root){
  const PREFERRED_START=10*60, PREFERRED_END=18*60;
  const STANDARD_VISIT=5*20+30; // Typical five-radiator job plus one city trip.
  const RAD_MINUTES=20, LOOP_MINUTES=10, CITY_TRAVEL=30, FAR_TRAVEL=60;

  function quantity(value){
    if(value===null||value===undefined||String(value).trim()==="")return null;
    const result=Number(value);
    return Number.isInteger(result)&&result>=0&&result<=500?result:null;
  }
  function appointmentMinutes(value){
    const match=/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value||"").trim());
    return match?Number(match[1])*60+Number(match[2]):null;
  }
  function travelMinutes(address){
    const text=String(address||"").trim();
    // An explicitly out-of-town address is the only cue for the 60-minute estimate.
    // Don't treat street names like "Ардонская" as the city "Ардон".
    const distant=/(?:^|[\s,.;])(?:за\s+город(?:ом)?|вне\s+города|с(?:ело)?\.\s*\S+|село\s+|снт\s+|пос(?:елок|ёлок)?\.\s*\S+|пос[её]лок\s+|ст(?:аница)?\.\s*\S+|станица\s+|(?:верхний\s+)?фиагдон(?=$|[\s,.;])|гизель(?=$|[\s,.;])|беслан(?=$|[\s,.;])|ардон(?=$|[\s,.;])|чермен(?=$|[\s,.;]))/i;
    return distant.test(text)?FAR_TRAVEL:CITY_TRAVEL;
  }
  function minutesDescription(minutes){
    const h=Math.floor(minutes/60),m=minutes%60;
    return h?(h+" ч"+(m?" "+m+" мин":"")):(m+" мин");
  }
  function longestAvailableWindow(intervals){
    const sorted=intervals.map(([start,end])=>
      [Math.max(PREFERRED_START,start),Math.min(PREFERRED_END,end)])
      .filter(([start,end])=>end>start).sort((a,b)=>a[0]-b[0]);
    let cursor=PREFERRED_START,best=0;
    for(const [start,end] of sorted){
      best=Math.max(best,start-cursor);
      cursor=Math.max(cursor,end);
    }
    return Math.max(best,PREFERRED_END-cursor);
  }
  function estimateDay(orders,day){
    const list=Array.isArray(orders)?orders.filter(order=>
      order&&order.date===day&&order.status!=="Отменён"):[];
    if(!list.length)return {
      level:"free",count:0,minutes:0,workMinutes:0,travelMinutes:0,
      incomplete:false,percent:0,longestFreeMinutes:PREFERRED_END-PREFERRED_START,
      label:"Свободно: заказов нет"
    };
    let work=0,travel=0,missingWork=0,missingTime=0;
    const blocks=[];
    for(const order of list){
      const r=quantity(order.radiators),f=quantity(order.floorLoops);
      const jobMinutes=(r||0)*RAD_MINUTES+(f||0)*LOOP_MINUTES;
      const trip=travelMinutes(order.address);
      work+=jobMinutes;travel+=trip;
      if(!jobMinutes)missingWork++;
      const time=appointmentMinutes(order.time);
      if(time===null)missingTime++;
      else if(jobMinutes)blocks.push([time-trip,time+jobMinutes]);
    }
    const minutes=work+travel;
    const incomplete=missingWork>0||missingTime>0;
    const longestFreeMinutes=longestAvailableWindow(blocks);
    // Red also means no room for a typical service in the preferred 10-18 window.
    // Only use the fragmentation rule when all arrival times and durations are known.
    const noTypicalSlot=list.length>1&&!incomplete&&longestFreeMinutes<STANDARD_VISIT;
    const level=minutes>=(PREFERRED_END-PREFERRED_START)*.85||noTypicalSlot?"full":
      (minutes>=(PREFERRED_END-PREFERRED_START)*.35||list.length>=3)?"busy":"light";
    const names={light:"Небольшая загрузка",busy:"Средняя загрузка",full:"Высокая загрузка"};
    return {
      level,count:list.length,minutes,workMinutes:work,travelMinutes:travel,
      incomplete,percent:Math.min(100,Math.round(minutes/(PREFERRED_END-PREFERRED_START)*100)),
      longestFreeMinutes,
      label:names[level]+": "+list.length+" заказ(ов), примерно "+minutesDescription(minutes)+
        " работы и дороги"+(incomplete?". Оценка неполная — уточните время и объём работ.":"")+
        ". Можно записать по договорённости."
    };
  }
  const api={estimateDay,travelMinutes,quantity,appointmentMinutes,longestAvailableWindow};
  if(root)root.__rdCalendarLoad=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:null);
