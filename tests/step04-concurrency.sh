#!/usr/bin/env bash
# Run only on disposable PostgreSQL 17 seeded with synthetic release fixtures.
set -euo pipefail

psql_safe() { psql -X -v ON_ERROR_STOP=1 -qAt "$@"; }
OWNER="00000000-0000-4000-8000-000000000001"
MASTER="00000000-0000-4000-8000-000000000003"

run_pair() {
  local label="$1" sql1="$2" sql2="$3"
  local a b success=0
  psql_safe -c "$sql1" >"/tmp/step04_$label"_a.log 2>&1 & a=$!
  psql_safe -c "$sql2" >"/tmp/step04_$label"_b.log 2>&1 & b=$!
  if wait "$a"; then success=$((success+1)); fi
  if wait "$b"; then success=$((success+1)); fi
  if [ "$success" -ne 1 ]; then
    echo "FAIL: $label allowed $success successes; expected exactly one"
    cat "/tmp/step04_$label"_a.log "/tmp/step04_$label"_b.log
    exit 1
  fi
  echo "PASS: $label one succeeded and one was rejected"
}

# Two workers both try to mark the SAME order paid.
paySQL="BEGIN; SET LOCAL ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claim.sub','$OWNER',true); SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000002',20000,'cash'); COMMIT;"
run_pair "double_payment" "$paySQL" "$paySQL"
payResult="$(psql_safe -c "SELECT count(*) FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000002' AND paid AND payment_amount=20000 AND payment_received_by='company'")"
[ "$payResult" = "1" ] || { echo "FAIL: order payment state"; exit 1; }

# Accrued salary: 10k/2 + 13k/2 + 20k/2 = 21,500.
# Two distinct payout requests of 14,000 cannot BOTH succeed.
salarySql() {
  local req="$1"
  printf "BEGIN; SET LOCAL ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claim.sub','%s',true); SELECT public.rabota_salary_payout_v2('raul_payout',14000,'cash','Synthetic concurrent salary','%s','%s'); COMMIT;" "$OWNER" "$req" "$MASTER"
}
run_pair "double_salary" "$(salarySql "20000000-0000-4000-8000-000000000011")" "$(salarySql "20000000-0000-4000-8000-000000000012")"
salaryResult="$(psql_safe -c "SELECT count(*)::text||':'||coalesce(sum(amount),0)::text FROM public.rabota_finance_operations WHERE kind='raul_payout' AND voided_at IS NULL AND order_id IS NULL")"
[ "$salaryResult" = "1:14000" ] || { echo "FAIL: duplicate salary entries $salaryResult"; exit 1; }

# Different synthetic in-progress order for Raul's cash collection test.
psql_safe -c "INSERT INTO public.rabota_orders(id,name,phone,master,assigned_user_id,status,price,paid) VALUES('10000000-0000-4000-8000-000000000009','Synthetic cash race','000','Рауль','$MASTER','В работе',15000,false)" >/dev/null
cashSql="BEGIN; SET LOCAL ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claim.sub','$MASTER',true); SELECT public.rabota_cash_distribute('10000000-0000-4000-8000-000000000009'); COMMIT;"
run_pair "double_cash" "$cashSql" "$cashSql"
cashResult="$(psql_safe -c "SELECT count(*) FROM public.rabota_cash_collections WHERE order_id='10000000-0000-4000-8000-000000000009'")"
financeResult="$(psql_safe -c "SELECT count(*) FROM public.rabota_finance_operations WHERE order_id='10000000-0000-4000-8000-000000000009' AND voided_at IS NULL")"
[ "$cashResult" = "1" ] && [ "$financeResult" = "2" ] || {
  echo "FAIL: duplicate distribution/ledger cash=$cashResult finance=$financeResult";exit 1;
}

echo "PASS: three concurrent payment, salary, and cash tests completed"
