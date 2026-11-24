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
module.exports = { mockLegacyPayrollSnapshot };
