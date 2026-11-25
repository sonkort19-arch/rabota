"use strict";

// Model an installation before the v3 migration. Other RPCs still go through
// each fixture's regular request and mutation checks.
function mockLegacyPayrollSnapshot(context) {
  return context.route(/^https:\/\/[^/]+\.supabase\.co\/rest\/v1\/rpc\/rabota_payroll_snapshot_v3(?:\?.*)?$/, route =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 404, json: { code: "PGRST202", message: "Payroll snapshot function is missing" } })
      : route.fallback()
  );
}
function mockAccountingSnapshot(context,{role="owner",masterId="fixture-raul"}={}) {
  const active=role!=="manager";
  const snapshot={version:3,state:active?"active":"not_applicable",accounting_version:1,
    activated_at:"2026-11-24T09:00:00Z"};
  if(active)Object.assign(snapshot,{master_id:masterId,earned:0,paid:0,due:0,orders:[],payouts:[],
    accounting_receipts:[],...(role==="owner"?{accounting_payouts:[]}:{}),refunds:[],holds:[]});
  return context.route(/^https:\/\/[^/]+\.supabase\.co\/rest\/v1\/rpc\/rabota_payroll_snapshot_v3(?:\?.*)?$/, route =>
    route.request().method()==="GET"?route.fulfill({json:snapshot}):route.fallback());
}
module.exports = { mockLegacyPayrollSnapshot, mockAccountingSnapshot };
