/* Estimated booking time ranges for Raul's visual calendar.
 * These ranges are planning hints, NOT measured finish times or server locks.
 * The existing RPC/duplicate-start checks remain authoritative. */
"use strict";
(function(root){
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
    const days=Math.floor(mins/1440),within=mins%1440;
    const value=String(Math.floor(within/60)).padStart(2,"0")+":"+
      String(within%60).padStart(2,"0");
    return days?value+" (+"+days+" дн.)":value;
  }
  function estimate(order,travelFn){
    if(!order||order.status==="Отменён"||order.status==="Выполнен")return null;
    const start=minute(order.time);
    if(start===null)return null;
    const radiators=quantity(order.radiators),loops=quantity(order.floorLoops);
    const work=(radiators||0)*20+(loops||0)*10;
    const travel=typeof travelFn==="function"?travelFn(order.address):30;
    const end=work>0&&Number.isFinite(travel)?start+work+travel:null;
    return {id:order.id,start,end,estimated:end!==null,time:order.time,
      name:String(order.name||"Клиент")};
  }
  function forDay(orders,date,master,excludeId,travelFn){
    const masterKey=String(master||"").trim().toLocaleLowerCase("ru-RU");
    if(!masterKey||!date)return [];
    return (Array.isArray(orders)?orders:[])
      .filter(order=>order&&order.date===date&&
        String(order.master||"").trim().toLocaleLowerCase("ru-RU")===masterKey&&
        (excludeId===null||excludeId===undefined||String(order.id)!==String(excludeId)))
      .map(order=>estimate(order,travelFn))
      .filter(Boolean)
      .sort((a,b)=>a.start-b.start);
  }
  function findAt(orders,time,date,master,excludeId,travelFn){
    const selected=minute(time);
    if(selected===null)return null;
    return forDay(orders,date,master,excludeId,travelFn).find(block=>
      block.end!==null&&selected>=block.start&&selected<block.end)||null;
  }
  const api={minute,quantity,format,estimate,forDay,findAt};
  if(root)root.__rdBookingTimeline=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:null);
