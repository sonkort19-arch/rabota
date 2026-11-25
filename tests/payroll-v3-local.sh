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
ALTER TABLE public.rabota_orders ADD COLUMN order_number integer;
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
db -f tests/sql/payroll-v3-cutover-holds.sql
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

# Upgrade an already active v3 ledger with prior payments, payouts and handoffs.
db -f tests/sql/accounting-cashbook-baseline.sql
db -f sql/20261125001322_rabota_accounting_receipts.sql
db -f tests/sql/accounting-receipts.sql

# Competing writers use the same revision as a PostgREST conditional PATCH.
db -f tests/sql/order-updated-at-baseline.sql
db -f sql/20261125095215_rabota_order_updated_at_revision.sql
db -f tests/sql/order-updated-at-revision.sql
order='10000000-0000-4000-8000-000000000090'
revision="$(db -c "SELECT updated_at FROM public.rabota_orders WHERE id='$order'")"
PGAPPNAME=rabota_order_revision_first db -c "BEGIN; $as_owner
 WITH saved AS (UPDATE public.rabota_orders SET details='First writer'
 WHERE id='$order' AND updated_at='$revision'::timestamptz RETURNING id)
 SELECT 'affected:'||count(*) FROM saved;
 SELECT pg_sleep(3); COMMIT;" >"$cluster/order-first.log" 2>&1 &
first_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_order_revision_first' AND wait_event='PgSleep')"
PGAPPNAME=rabota_order_revision_second db -c "BEGIN; $as_owner
 WITH saved AS (UPDATE public.rabota_orders SET details='Stale second writer'
 WHERE id='$order' AND updated_at='$revision'::timestamptz RETURNING id)
 SELECT 'affected:'||count(*) FROM saved; COMMIT;" >"$cluster/order-second.log" 2>&1 &
second_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_order_revision_second' AND wait_event_type='Lock')"
wait "$first_pid" || { cat "$cluster/order-first.log" >&2; exit 1; }
wait "$second_pid" || { cat "$cluster/order-second.log" >&2; exit 1; }
grep -qx 'affected:1' "$cluster/order-first.log"
grep -qx 'affected:0' "$cluster/order-second.log"
test "$(db -c "SELECT details='First writer' AND updated_at>'$revision'::timestamptz
 FROM public.rabota_orders WHERE id='$order'")" = t
echo 'PASS: concurrent updates with the same order revision affect one row and zero rows respectively'

db -f sql/20261125095418_extend_verified_order_refunds.sql
db -f tests/sql/verified-order-refunds.sql

# A replay blocked on the winning transaction must return its committed ledger ID.
db -f sql/20261125095606_rabota_financial_write_retries.sql
db -f tests/sql/financial-write-retries.sql
check_financial_replay() {
  local label="$1" rpc="$2" audit="$3"
  local first_session="rabota_${label}_retry_first" second_session="rabota_${label}_retry_second"
  local first_log="$cluster/${label}-retry-first.log" second_log="$cluster/${label}-retry-second.log"
  local first_pid second_pid first_id second_id
  PGAPPNAME="$first_session" db -c "BEGIN; $as_owner
   SELECT 'receipt:'||$rpc; SELECT pg_sleep(3); COMMIT;" >"$first_log" 2>&1 &
  first_pid=$!
  wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='$first_session' AND wait_event='PgSleep')"
  PGAPPNAME="$second_session" db -c "BEGIN; $as_owner
   SELECT 'receipt:'||$rpc; COMMIT;" >"$second_log" 2>&1 &
  second_pid=$!
  wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='$second_session' AND wait_event='transactionid')"
  wait "$first_pid" || { cat "$first_log" >&2; return 1; }
  wait "$second_pid" || { cat "$second_log" >&2; return 1; }
  first_id="$(sed -n 's/^receipt://p' "$first_log")"
  second_id="$(sed -n 's/^receipt://p' "$second_log")"
  test -n "$first_id"
  test "$first_id" = "$second_id"
  test "$first_id" = "$(db -c "$audit")"
}
expense_request='20000000-0000-4000-8000-000000000103'
check_financial_replay expense \
  "public.rabota_record_expense_v1(28.34,'Fixture simultaneous expense','$expense_request')" \
  "SELECT min(id::text) FROM public.rabota_finance_operations WHERE request_id='$expense_request'
   HAVING count(*)=1 AND sum(amount)=28.34"
cashbook_request='20000000-0000-4000-8000-000000000104'
check_financial_replay cashbook \
  "public.rabota_cashbook_record_v1('expense',28.34,'card',NULL,'Fixture simultaneous cashbook','$cashbook_request')" \
  "SELECT min(id::text) FROM public.rabota_cashbook_entries WHERE request_id='$cashbook_request'
   HAVING count(*)=1 AND sum(amount)=28.34"
echo 'PASS: concurrent retries for an expense and a cashbook operation return one committed ledger entry each'

db -c 'CREATE ROLE service_role NOLOGIN;'
db -f sql/20261125131547_rabota_order_travel_payroll.sql
db -f tests/sql/order-travel-payroll.sql
db -f tests/sql/verified-order-refunds.sql

# A payout started from a stale balance must see the committed trip reversal.
travel_order='10000000-0000-4000-8000-000000000153'
travel_payout='20000000-0000-4000-8000-000000000153'
db -c "INSERT INTO public.rabota_orders(id,name,master,assigned_user_id,status,price,travel_amount)
 VALUES('$travel_order','Fixture concurrent travel reversal','Рауль','$raul','Записан',10000,1000);" >/dev/null
travel_due="$(db -c "BEGIN; $as_owner SELECT public.rabota_payroll_snapshot_v3()->>'due'; ROLLBACK;" | tail -1)"
PGAPPNAME=rabota_travel_cancel_first db -c "BEGIN; $as_owner
 UPDATE public.rabota_orders SET status='Отменён',travel_taken=false WHERE id='$travel_order';
 SELECT pg_sleep(3); COMMIT;" >"$cluster/travel-first.log" 2>&1 &
first_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_travel_cancel_first' AND wait_event='PgSleep')"
PGAPPNAME=rabota_travel_payout_second db -c "BEGIN; $as_owner
 SELECT public.rabota_payroll_payout_v3($travel_due,'cash','Fixture stale payout','$travel_payout','$raul');
 COMMIT;" >"$cluster/travel-second.log" 2>&1 &
second_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_travel_payout_second' AND wait_event_type='Lock')"
wait "$first_pid" || { cat "$cluster/travel-first.log" >&2; exit 1; }
if wait "$second_pid"; then
  echo 'A payout used the pre-correction travel balance' >&2
  exit 1
fi
grep -Fq 'Сумма больше задолженности по зарплате' "$cluster/travel-second.log"
test "$(db -c "SELECT count(*)=2 AND sum(delta)=0
 FROM private.rabota_payroll_travel_events WHERE order_id='$travel_order'")" = t
test "$(db -c "SELECT NOT EXISTS(SELECT 1 FROM public.rabota_finance_operations WHERE request_id='$travel_payout')")" = t
echo 'PASS: travel correction and concurrent payouts serialize on the payroll master'

db -f tests/sql/ai-order-travel.sql

db -f tests/sql/order-reschedule.sql
move_a='40000000-0000-4000-8000-000000000010'
move_b='40000000-0000-4000-8000-000000000011'
move_request='40000001-0000-4000-8000-000000000010'
move_date="$(db -c "SELECT (clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date+90")"
db -c "INSERT INTO public.rabota_orders(id,name,master,assigned_user_id,radiators,appointment_date,appointment_time)
 VALUES('$move_a','Fixture competing move A','Рауль','$raul',2,'$move_date','08:00'),
       ('$move_b','Fixture competing move B','Рауль','$raul',5,'$move_date','18:00');" >/dev/null
move_a_revision="$(db -c "SELECT updated_at FROM public.rabota_orders WHERE id='$move_a'")"
move_b_revision="$(db -c "SELECT updated_at FROM public.rabota_orders WHERE id='$move_b'")"
move_first="public.rabota_reschedule_order('$move_a','$move_request','$move_a_revision','$move_date','10:00')"
PGAPPNAME=rabota_move_first db -c "BEGIN; $as_owner
 SELECT 'status:'||($move_first->>'state'); SELECT pg_sleep(1.4); COMMIT;" >"$cluster/move-first.log" 2>&1 &
first_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_move_first' AND wait_event='PgSleep')"
PGAPPNAME=rabota_move_second db -c "BEGIN; $as_owner
 SELECT 'status:'||(public.rabota_reschedule_order('$move_b',gen_random_uuid(),
 '$move_b_revision','$move_date','10:30')->>'state'); COMMIT;" >"$cluster/move-second.log" 2>&1 &
second_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_move_second' AND wait_event_type='Lock')"
PGAPPNAME=rabota_move_replay db -c "BEGIN; $as_owner
 SELECT 'replayed:'||($move_first->>'replayed'); COMMIT;" >"$cluster/move-replay.log" 2>&1 &
replay_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='rabota_move_replay' AND wait_event_type='Lock')"
wait "$first_pid" || { cat "$cluster/move-first.log" >&2; exit 1; }
wait "$second_pid" || { cat "$cluster/move-second.log" >&2; exit 1; }
wait "$replay_pid" || { cat "$cluster/move-replay.log" >&2; exit 1; }
grep -qx 'status:saved' "$cluster/move-first.log"
grep -qx 'status:occupied' "$cluster/move-second.log"
grep -qx 'replayed:true' "$cluster/move-replay.log"
test "$(db -c "SELECT count(*)=1 FROM private.rabota_order_reschedule_events
 WHERE order_id IN ('$move_a','$move_b')")" = t
echo 'PASS: concurrent overlapping moves serialize and repeated intent returns original history'

# The ordinary calendar write has no new RPC or trigger. The later quick move
# must still await its committed schedule and reject the overlap.
PGAPPNAME=rabota_move_legacy_first db -c "BEGIN; $as_owner
 INSERT INTO public.rabota_orders(name,master,assigned_user_id,radiators,appointment_date,appointment_time)
 VALUES('Fixture competing legacy edit','Рауль','$raul',2,'$move_date','13:00');
 SELECT pg_sleep(1.4); COMMIT;" >"$cluster/move-legacy-first.log" 2>&1 &
first_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity
 WHERE application_name='rabota_move_legacy_first' AND wait_event='PgSleep')"
PGAPPNAME=rabota_move_legacy_second db -c "BEGIN; $as_owner
 SELECT 'status:'||(public.rabota_reschedule_order('$move_b',gen_random_uuid(),
 '$move_b_revision','$move_date','13:30')->>'state'); COMMIT;" >"$cluster/move-legacy-second.log" 2>&1 &
second_pid=$!
wait_for "SELECT EXISTS(SELECT 1 FROM pg_stat_activity
 WHERE application_name='rabota_move_legacy_second' AND wait_event_type='Lock')"
wait "$first_pid" || { cat "$cluster/move-legacy-first.log" >&2; exit 1; }
wait "$second_pid" || { cat "$cluster/move-legacy-second.log" >&2; exit 1; }
grep -qx 'status:occupied' "$cluster/move-legacy-second.log"
echo 'PASS: quick move rechecks a conflicting ordinary write after it commits'
