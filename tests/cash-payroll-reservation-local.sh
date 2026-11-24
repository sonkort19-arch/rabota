#!/usr/bin/env bash
# Start a local Unix-socket-only PostgreSQL 17 instance with synthetic data.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${RABOTA_PG_BIN:-}" ]]; then
  export PATH="$RABOTA_PG_BIN:$PATH"
fi

cluster="$(mktemp -d /tmp/rabota-payroll-pg.XXXXXXXX)"
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

migration=sql/20261124224203_cash_payroll_reservation.sql
owner='00000000-0000-4000-8000-000000000001'
raul='00000000-0000-4000-8000-000000000003'
cash_order='10000000-0000-4000-8000-000000000029'
card_order='10000000-0000-4000-8000-000000000030'
as_owner="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','$owner',true);"
as_raul="SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','$raul',true);"
seed_cash="INSERT INTO public.rabota_orders(id,name,phone,master,assigned_user_id,status,price,paid) VALUES('$cash_order','Synthetic cash','000','Рауль','$raul','В работе',20000,false);"

# Reproduce the original double-payment path using only the old deployed-equivalent RPCs.
db -c "BEGIN; $seed_cash $as_raul SELECT public.rabota_record_order_payment('$cash_order',20000,'cash'); $as_owner
 SELECT public.rabota_finance_record('raul_payout',10000,'$raul','Synthetic existing manual payout'); COMMIT;" >/dev/null
if db -f "$migration" >"$cluster/preflight.log" 2>&1; then
  echo "Migration accepted a historical cash and manual payroll overlap." >&2
  exit 1
fi
grep -Fq 'Нужна сверка перед включением защиты' "$cluster/preflight.log"
test "$(db -c "SELECT to_regprocedure('private.rabota_manual_payroll_capacity(uuid)') IS NULL")" = 't'
db -c "BEGIN; $as_raul SELECT public.rabota_cash_distribute('$cash_order'); COMMIT;" >/dev/null
test "$(db -c "SELECT sum(amount)=20000 FROM public.rabota_finance_operations WHERE kind='raul_payout'")" = 't'
echo "PASS: baseline double payout reproduced; migration refuses activation with existing overlap"

db -c 'TRUNCATE public.rabota_finance_operations,public.rabota_cash_collections,public.rabota_orders;'
db -f "$migration"
db -f tests/sql/cash-payroll-reservation.sql | grep '^PASS:'

db -c "BEGIN; $seed_cash
 INSERT INTO public.rabota_orders(id,name,phone,master,assigned_user_id,status,price,paid)
 VALUES('$card_order','Synthetic card','000','Рауль','$raul','В работе',12000,false);
 $as_raul SELECT public.rabota_record_order_payment('$cash_order',20000,'cash');
 $as_owner SELECT public.rabota_record_order_payment('$card_order',12000,'card'); COMMIT;" >/dev/null

wait_for() {
  local query="$1"
  for ((attempt=0; attempt<30; attempt++)); do
    if [[ "$(db -c "$query")" == 't' ]]; then return 0; fi
    sleep 0.05
  done
  return 1
}
# Hold the owner's transaction open while the master tries to distribute.
# Confirm the latter is actually waiting for the same master lock.
PGAPPNAME=rabota_manual_payroll_test db -c "BEGIN; $as_owner
 SELECT public.rabota_finance_record('raul_payout',6000,'$raul','Synthetic eligible manual payout');
 SELECT pg_sleep(3); COMMIT;" >"$cluster/manual.log" 2>&1 &
manual_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_manual_payroll_test' AND wait_event='PgSleep')"
PGAPPNAME=rabota_cash_distribution_test db -c "BEGIN; $as_raul
 SELECT public.rabota_cash_distribute('$cash_order'); COMMIT;" >"$cluster/automatic.log" 2>&1 &
automatic_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_cash_distribution_test' AND wait_event_type='Lock')"
wait "$manual_pid" || { cat "$cluster/manual.log" >&2; exit 1; }
wait "$automatic_pid" || { cat "$cluster/automatic.log" >&2; exit 1; }
test "$(db -c "SELECT count(*)=2 AND sum(amount)=16000 FROM public.rabota_finance_operations WHERE kind='raul_payout'")" = 't'
test "$(db -c "SELECT count(*)=1 FROM public.rabota_cash_collections WHERE order_id='$cash_order'")" = 't'
echo "PASS: manual and automatic payroll serialized on the same master with exact totals"
