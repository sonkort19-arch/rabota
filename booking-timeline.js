/* Estimated booking time ranges for Raul's visual calendar.
 * These ranges are planning hints, NOT measured finish times or server locks.
 * The existing RPC/duplicate-start checks remain authoritative. */
"use strict";
(function(root){
  const MINUTES_PER_DAY=24*60;
  function dayNumber(date){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))return NaN;
    return Date.parse(date+"T00:00:00Z")/86400000;
  }
  function minute(value){
    const m=/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value||""));
    return m?Number(m[1])*60+Number(m[2]):null;
  }
  function quantity(value){
    if(value===null||value===undefined||String(value).trim()==="")return null;
    const n=Number(value);
    return Number.isInteger(n)&&n>=0&&n<=500?n:null;
  }
  function format(mins){
    if(!Number.isFinite(mins)||mins<0)return "—";
    const days=Math.floor(mins/MINUTES_PER_DAY),within=mins%MINUTES_PER_DAY;
    const value=String(Math.floor(within/60)).padStart(2,"0")+":"+
      String(within%60).padStart(2,"0");
    return days?value+" (+"+days+" дн.)":value;
  }
  function workMinutes(order){
    return (quantity(order.radiators)||0)*20+(quantity(order.floorLoops)||0)*10;
  }
  function estimate(order,travelFn){
    if(!order||order.status==="Отменён"||order.status==="Выполнен")return null;
    const start=minute(order.time);
    if(start===null)return null;
    const work=workMinutes(order);
    const travel=typeof travelFn==="function"?travelFn(order.address):30;
    const end=work>0&&Number.isFinite(travel)?start+work+travel:null;
    return {id:order.id,start,end,estimated:end!==null,time:order.time,
      name:String(order.name||"Клиент")};
  }
  function forDay(orders,date,master,excludeId,travelFn){
    const masterKey=String(master||"").trim().toLocaleLowerCase("ru-RU");
    const selectedDay=dayNumber(date);
    if(!masterKey||!Number.isFinite(selectedDay)||!Array.isArray(orders))return [];
    const blocks=[];
    for(const order of orders){
      if(!order?.date||order.date>date||
        String(order.master||"").trim().toLocaleLowerCase("ru-RU")!==masterKey||
        (excludeId!=null&&String(order.id)===String(excludeId)))continue;
      const offsetMinutes=(dayNumber(order.date)-selectedDay)*MINUTES_PER_DAY;
      if(!Number.isFinite(offsetMinutes))continue;
      const block=estimate(order,travelFn);
      if(block&&(offsetMinutes===0||(block.end!==null&&block.end+offsetMinutes>0)))
        blocks.push({...block,date:order.date,offsetMinutes});
    }
    return blocks.sort((a,b)=>(a.offsetMinutes+a.start)-(b.offsetMinutes+b.start));
  }
  function findInDay(blocks,time){
    const selected=minute(time);
    if(selected===null)return null;
    return blocks.find(block=>block.end!==null&&
      selected>=block.start+block.offsetMinutes&&selected<block.end+block.offsetMinutes)||null;
  }
  function findAt(orders,time,date,master,excludeId,travelFn){
    return findInDay(forDay(orders,date,master,excludeId,travelFn),time);
  }
  function appointmentMinute(date,time){
    const day=dayNumber(date),start=minute(time);
    if(!Number.isFinite(day)||start===null||new Date(day*86400000).toISOString().slice(0,10)!==date)
      return null;
    return day*MINUTES_PER_DAY+start;
  }
  function rescheduleCheck(orders,order,travelFn){
    const masterName=value=>String(value||"").trim().toLocaleLowerCase("ru-RU");
    if(order?.id==null||(!order.assignedUserId&&!masterName(order.master))||
      typeof travelFn!=="function"||!Array.isArray(orders))
      return ()=>"unknown";
    const master=masterName(order.master);
    const sameMaster=row=>order.assignedUserId&&row.assignedUserId?
      order.assignedUserId===row.assignedUserId:Boolean(master)&&master===masterName(row.master);
    // Use the usual three-hour visit for orders whose scope is still unknown.
    const visitMinutes=row=>(workMinutes(row)||180)+travelFn(row.address);
    const blocks=[];
    for(const row of orders){
      if(!row||String(row.id)===String(order.id)||row.status==="Отменён"||!sameMaster(row))continue;
      const start=appointmentMinute(row.date,row.time);
      if(start!==null)blocks.push({
        start,end:row.status==="Выполнен"?start:start+visitMinutes(row)
      });
    }
    const duration=visitMinutes(order),original=appointmentMinute(order.date,order.time);
    return (date,time)=>{
      const start=appointmentMinute(date,time);
      if(start===null)return "unknown";
      if(start===original)return "same";
      const end=start+duration;
      return blocks.some(block=>start===block.start||
        (block.end>block.start&&start<block.end&&end>block.start))?"busy":"available";
    };
  }
  const api={minute,quantity,format,estimate,forDay,findInDay,findAt,appointmentMinute,rescheduleCheck};
  if(root)root.__rdBookingTimeline=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:null);
