#!/usr/bin/env bash
# Start a local Unix-socket-only PostgreSQL 17 instance with synthetic data.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${RABOTA_PG_BIN:-}" ]]; then
  export PATH="$RABOTA_PG_BIN:$PATH"
fi

cluster="$(mktemp -d /tmp/rabota-payroll-v3-pg.XXXXXXXX)"
cleanup() {
  pg_ctl -D "$cluster/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$cluster"
}
trap cleanup EXIT
initdb -D "$cluster/data" --auth=trust --username=postgres \
  --locale=C.utf8 --encoding=UTF8 >/dev/null
if ! pg_ctl -D "$cluster/data" -l "$cluster/postgres.log" \
  -o "-k $cluster -h '' -p 5432" -w start >/dev/null; then
  cat "$cluster/postgres.log" >&2
  exit 1
fi
db() {
  psql -X -qAt -h "$cluster" -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

for fixture in tests/sql/roles-stage3-fixture.sql sql/008-protect-paid-orders.sql \
  sql/009-owner-only-salary-payout.sql; do
  db -f "$fixture" > /dev/null
done
# Load just the legacy expense/payout RPC. The other October definitions were
# superseded by the payment and payroll migrations already loaded above.
sed -n '/^CREATE OR REPLACE FUNCTION public\.rabota_finance_record(/,/^\$function\$;/p' \
  sql/rabota_harden_null_role_guards_20261026.sql | db
db -c 'REVOKE EXECUTE ON FUNCTION public.rabota_finance_record(text,numeric,uuid,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.rabota_finance_record(text,numeric,uuid,text) TO authenticated; TRUNCATE public.rabota_finance_operations,public.rabota_cash_collections,public.rabota_orders;'


sed -n '/^CREATE OR REPLACE FUNCTION public\.rabota_finance_void(/,/^\$function\$;/p' \
  sql/rabota_harden_null_role_guards_20261026.sql | db
db <<'SQL'
ALTER TABLE public.rabota_finance_operations
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN voided_by uuid;
ALTER TABLE public.rabota_cash_collections
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN confirmed_by uuid,
  ADD CONSTRAINT rabota_cash_amounts_balance CHECK (gross=raul_amount+timur_amount+company_amount),
  ADD CONSTRAINT rabota_cash_collections_company_amount_check CHECK (company_amount>0),
  ADD CONSTRAINT rabota_cash_collections_gross_check CHECK (gross>3000),
  ADD CONSTRAINT rabota_cash_collections_raul_amount_check CHECK (raul_amount>0),
  ADD CONSTRAINT rabota_cash_collections_timur_amount_check CHECK (timur_amount=1500),
  ADD CONSTRAINT rabota_cash_confirm_requires_submit CHECK (confirmed_at IS NULL OR submitted_at IS NOT NULL);
SQL
db -f sql/20261123210808_cash_partial_transfers.sql
db -f sql/20261124231133_rabota_payroll_v3.sql
db -f tests/sql/payroll-v3.sql

owner='00000000-0000-4000-8000-000000000001'
raul='00000000-0000-4000-8000-000000000003'
order='10000000-0000-4000-8000-000000000046'
as_owner="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','$owner',true);"
db -c "BEGIN; INSERT INTO public.rabota_orders(id,name,master,assigned_user_id,status,price)
 VALUES('$order','Fixture concurrent payouts','Рауль','$raul','В работе',8000);
 $as_owner SELECT public.rabota_record_order_payment('$order',8000,'card'); COMMIT;" >/dev/null
wait_for() {
  local query="$1"
  for ((attempt=0; attempt<30; attempt++)); do
    if [[ "$(db -c "$query")" == 't' ]]; then return 0; fi
    sleep 0.05
  done
  return 1
}
# Two distinct payouts of 4000 must not fit into the same new 5500 balance.
PGAPPNAME=rabota_payroll_v3_first db -c "BEGIN; $as_owner
 SELECT public.rabota_payroll_payout_v3(4000,'card','Fixture first payout','20000000-0000-4000-8000-000000000046','$raul');
 SELECT pg_sleep(3); COMMIT;" >"$cluster/first.log" 2>&1 &
first_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_payroll_v3_first' AND wait_event='PgSleep')"
PGAPPNAME=rabota_payroll_v3_second db -c "BEGIN; $as_owner
 SELECT public.rabota_payroll_payout_v3(4000,'card','Fixture second payout','20000000-0000-4000-8000-000000000047','$raul'); COMMIT;" >"$cluster/second.log" 2>&1 &
second_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_payroll_v3_second' AND wait_event_type='Lock')"
wait "$first_pid" || { cat "$cluster/first.log" >&2; exit 1; }
if wait "$second_pid"; then
  echo "Concurrent payouts exceeded the shared due amount" >&2
  exit 1
fi
grep -Fq 'Сумма больше задолженности по зарплате' "$cluster/second.log"
test "$(db -c "SELECT count(*)=1 FROM public.rabota_finance_operations
 WHERE request_id IN ('20000000-0000-4000-8000-000000000046','20000000-0000-4000-8000-000000000047')")" = t
echo 'PASS: concurrently attempted v3 payouts serialize without exceeding due'

# A future explicitly changed rule applies to subsequently paid orders only.
new_rule_order='10000000-0000-4000-8000-000000000047'
db -c "BEGIN; UPDATE private.rabota_payroll_policy_v3
 SET rate=0.25,bonus=500,rule_version='fixture-future-rule';
 INSERT INTO public.rabota_orders(id,name,master,assigned_user_id,status,price)
 VALUES('$new_rule_order','Fixture subsequent rule','Рауль','$raul','В работе',4096.11);
 $as_owner SELECT public.rabota_record_order_payment('$new_rule_order',4096.11,'card'); COMMIT;" >/dev/null
test "$(db -c "SELECT earned_amount=1524.03 AND company_share=2572.08 AND rule_version='fixture-future-rule'
 FROM private.rabota_payroll_earnings_v3 WHERE order_id='$new_rule_order'")" = t
test "$(db -c "SELECT earned_amount=11500 AND company_share=8500 AND rule_version='v3-50pct-plus-1500'
 FROM private.rabota_payroll_earnings_v3 WHERE order_id='10000000-0000-4000-8000-000000000042'")" = t
echo 'PASS: a future rule change preserves exact earlier earnings and applies only to later payments'
