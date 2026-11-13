/* CRM «Работа»: модель заявок и записи в Supabase.
 * Extracted from index.html in stage 3, without business-rule changes.
 * Database authorization and final booking constraints remain in Supabase.
 */
"use strict";
(function(root){
  function createOrdersModel(deps){
    if(!deps||!Array.isArray(deps.statuses)||
       typeof deps.dbRequest!=="function"||typeof deps.reloadOrders!=="function"||
       typeof deps.getOrders!=="function"||typeof deps.getCurrentUserId!=="function"||
       typeof deps.getFinanceOperations!=="function"||typeof deps.getFinanceCollections!=="function"){
      throw new TypeError("Неверные зависимости модуля заказов");
    }
    const STATUSES=deps.statuses;
    const dbRequest=deps.dbRequest;
    const reloadOrders=deps.reloadOrders;
    const getOrders=deps.getOrders;
    const getCurrentUserId=deps.getCurrentUserId;
    const getFinanceOperations=deps.getFinanceOperations;
    const getFinanceCollections=deps.getFinanceCollections;

function readOrder(row) {
      return {
        id: row.id, createdAt: row.created_at, leadId:row.lead_id||null,
        completedAt: row.completed_at, legacyId: row.legacy_id,
        name:row.name || "",phone:row.phone || "",address:row.address || "",
        radiatorType:row.radiator_type || "",radiators:row.radiators == null ? "" : row.radiators,
        floorLoops:row.floor_loops == null ? "" : row.floor_loops,
        master:row.master || "",date:row.appointment_date || "",
        time:row.appointment_time ? row.appointment_time.slice(0,5) : "",
        price:row.price == null ? null : Number(row.price),assignedUserId:row.assigned_user_id || null,
        paid:Boolean(row.paid),status:row.status || "Новый",details:row.details || "",
        paymentMethod:row.payment_method||"",paymentAmount:row.payment_amount==null?null:Number(row.payment_amount),
        paymentReceivedBy:row.payment_received_by||"",paidAt:row.paid_at||null,paidBy:row.paid_by||null
      };
    }

function serializeOrder(order) {
      const obj = {
        name:String(order.name || "").trim(),phone:String(order.phone || "").trim(),
        address:String(order.address || ""),radiator_type:order.radiatorType || "",
        radiators:order.radiators === "" || order.radiators == null ? null : Number(order.radiators),
        floor_loops:order.floorLoops === "" || order.floorLoops == null ? null : Number(order.floorLoops),
        master:order.master || "", appointment_date:order.date || null,
        appointment_time:order.time || null,
        price:order.price === "" || order.price == null ? null : Number(order.price),
        paid:Boolean(order.paid),status:STATUSES.includes(order.status) ? order.status : "Новый",
        details:order.details || "",completed_at:order.completedAt || null,
        updated_at:new Date().toISOString()
      };
      if (order.paymentMethod && order.paid) {
        obj.payment_method=order.paymentMethod;
        obj.payment_amount=order.paymentAmount??order.price;
        obj.payment_received_by=order.paymentReceivedBy||"company";
        obj.paid_at=order.paidAt||new Date().toISOString();
        obj.paid_by=order.paidBy||getCurrentUserId();
      }
      if (order.legacyId) obj.legacy_id = order.legacyId;
      if (order.leadId) obj.lead_id = order.leadId;
      return obj;
    }

function orderHasFinancialHistory(order){
      if(!order)return false;
      return Boolean(order.paid||order.paymentMethod||order.paymentAmount!=null||
        order.paymentReceivedBy||order.paidAt||order.paidBy||
        getFinanceOperations().some(row=>String(row.order_id)===String(order.id))||
        getFinanceCollections().some(row=>String(row.order_id)===String(order.id)));
    }

async function persistOrder(order) {
      const existing = getOrders().some(o => String(o.id) === String(order.id));
      const data = serializeOrder(order);
      if (existing) {
        const result = await dbRequest("rabota_orders?id=eq." + encodeURIComponent(order.id),"PATCH",data);
        if (!Array.isArray(result) || !result.length) throw new Error("Заказ не обновлён.");
      } else {
        const result = await dbRequest("rabota_orders","POST",data);
        if (!Array.isArray(result) || !result.length) throw new Error("Заказ не сохранён.");
      }
      await reloadOrders();
    }

function hasConflict(date, time, master, excludeId) {
      const selectedMaster=String(master||"").trim().toLocaleLowerCase("ru");
      return getOrders().some(order => String(order.id) !== String(excludeId) &&
        order.status !== "Отменён" && order.date === date && order.time === time &&
        String(order.master||"").trim().toLocaleLowerCase("ru") === selectedMaster);
    }

function findTightBookings(date,time,master,excludeId) {
      const minutes=t=>{
        const p=String(t||"").split(":");
        return p.length>=2 ? Number(p[0])*60+Number(p[1]) : NaN;
      };
      const target=minutes(time),name=String(master||"").trim().toLowerCase();
      if(!date||!Number.isFinite(target)||!name)return [];
      return getOrders().filter(o=>
        String(o.id)!==String(excludeId) && o.status!=="Отменён" &&
        o.date===date && String(o.master||"").trim().toLowerCase()===name &&
        Number.isFinite(minutes(o.time)) && Math.abs(minutes(o.time)-target)<200);
    }

    return {readOrder,serializeOrder,orderHasFinancialHistory,persistOrder,hasConflict,findTightBookings};
  }

  if(root)root.__rdCreateOrdersModel=createOrdersModel;
  if(typeof module!=="undefined"&&module.exports)module.exports={createOrdersModel};
})(typeof window!=="undefined"?window:null);
