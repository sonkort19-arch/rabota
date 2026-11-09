/* CRM «Работа»: booking-capacity rule, shared by form, calendar and leads.
   UI only predicts; PostgreSQL trigger is the authoritative limit. */
(function (root, factory) {
  const core=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=core;
  if(root)root.__rdBookingCapacity=core;
})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  const key=name=>String(name||"").trim().toLocaleLowerCase("ru");
  function small(radiators) {
    if(radiators===null||radiators===undefined||radiators==="")return false;
    const count=Number(radiators);
    return Number.isInteger(count)&&count>=1&&count<=5;
  }
  function day(orders,date,master,radiators,excludeId=null) {
    const masterName=key(master);
    if(!masterName||!date)
      return {count:0,max:2,canBook:false,potentialThird:false,allSmall:false,reason:"master"};
    const others=(Array.isArray(orders)?orders:[]).filter(o=>
      String(o.id)!==String(excludeId)&&o.date===date&&o.status!=="Отменён"&&
      key(o.master)===masterName);
    const count=others.length;
    const allSmall=others.every(o=>small(o.radiators));
    const potentialThird=count===2&&allSmall;
    const max=count>=2&&allSmall?3:2;
    const canBook=count<2||(potentialThird&&small(radiators));
    let reason="";
    if(!canBook)
      reason=count>=3?"max3":count===2&&!allSmall?"largeExisting":
        count===2?"radiators":"master";
    return {count,max,canBook,potentialThird,allSmall,reason};
  }
  return {small,day};
});
