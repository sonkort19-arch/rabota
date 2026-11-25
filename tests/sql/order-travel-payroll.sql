-- Synthetic PostgreSQL regression for the separate travel allowance.
\set ON_ERROR_STOP on
BEGIN;

DO $unchanged_history$
BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.rabota_orders WHERE travel_amount<>0 OR travel_taken IS NOT NULL);
  ASSERT NOT EXISTS(SELECT 1 FROM private.rabota_payroll_travel_events);
  ASSERT EXISTS(SELECT 1 FROM private.rabota_payroll_earnings_v3
    WHERE order_id='10000000-0000-4000-8000-000000000042' AND earned_amount=11500 AND company_share=8500);
END;
$unchanged_history$;

UPDATE private.rabota_payroll_policy_v3
SET rate=0.50,bonus=1500,rule_version='v3-50pct-plus-1500';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

DO $pay_and_refund$
DECLARE
  master_id constant uuid:='00000000-0000-4000-8000-000000000003';
  order_id constant uuid:='10000000-0000-4000-8000-000000000151';
  payout_key uuid:=gen_random_uuid();
  refund_key uuid:=gen_random_uuid();
  initial jsonb:=public.rabota_payroll_snapshot_v3();
  snap jsonb;
  reply jsonb;
BEGIN
  ASSERT (initial->>'travel_earned')::numeric=0 AND initial->'travel_events'='[]'::jsonb;
  IF (initial->>'due')::numeric>0 THEN
    PERFORM public.rabota_payroll_payout_v3((initial->>'due')::numeric,
      'cash','Fixture settle earlier wages',gen_random_uuid(),master_id);
  END IF;
  INSERT INTO public.rabota_orders(id,order_number,name,master,assigned_user_id,status,price,travel_amount)
    VALUES(order_id,1051,'Fixture travel and wash','Рауль',master_id,'Записан',10000,1000);

  snap:=public.rabota_payroll_snapshot_v3();
  ASSERT (snap->>'due')::numeric=1000 AND (snap->>'travel_earned')::numeric=1000;
  ASSERT snap->'travel_events' @> '[{"order_id":"10000000-0000-4000-8000-000000000151","order_number":1051,"delta":1000}]';
  ASSERT snap->'orders'=initial->'orders' AND snap->'accounting_receipts'=initial->'accounting_receipts';

  UPDATE public.rabota_orders SET travel_amount=1000 WHERE id=order_id;
  ASSERT jsonb_array_length(public.rabota_payroll_snapshot_v3()->'travel_events')=1;

  BEGIN
    UPDATE public.rabota_orders SET status='Отменён' WHERE id=order_id;
    RAISE EXCEPTION 'Cancellation accepted without deciding whether the trip happened';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.rabota_orders SET travel_amount=9995000 WHERE id=order_id;
    RAISE EXCEPTION 'Unpayable gross price accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.rabota_orders SET travel_amount=1000.001 WHERE id=order_id;
    RAISE EXCEPTION 'Fraction of a kopeck accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  reply:=public.rabota_payroll_payout_v3(1000,'cash','Fixture advance for the trip',payout_key,master_id);
  ASSERT (reply->>'due')::numeric=0;
  BEGIN
    PERFORM public.rabota_record_order_payment(order_id,10000,'card');
    RAISE EXCEPTION 'Only the wash charge was accepted as full payment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.rabota_record_order_payment(order_id,11000,'card');
  ASSERT EXISTS(SELECT 1 FROM public.rabota_orders o WHERE o.id=order_id AND o.paid
    AND o.price=10000 AND o.travel_amount=1000 AND o.payment_amount=11000);
  snap:=public.rabota_payroll_snapshot_v3();
  ASSERT (snap->>'due')::numeric=6500 AND (snap->>'travel_earned')::numeric=1000;
  ASSERT snap->'orders' @> '[{"order_id":"10000000-0000-4000-8000-000000000151","paid_amount":10000,"earned_amount":6500,"company_share":3500}]';
  ASSERT snap->'accounting_receipts' @> '[{"order_id":"10000000-0000-4000-8000-000000000151","amount":11000,"travel_amount":1000}]';
  ASSERT jsonb_array_length(snap->'travel_events')=1;

  BEGIN
    UPDATE public.rabota_orders SET travel_amount=0 WHERE id=order_id;
    RAISE EXCEPTION 'A confirmed travel receipt was changed directly';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_payroll_refund_v3(order_id,11000,'Fixture no trip decision',gen_random_uuid());
    RAISE EXCEPTION 'Accepted a refund without deciding whether the trip happened';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.rabota_payroll_refund_v3(order_id,11000,'Fixture trip did not happen',refund_key,false);
  snap:=public.rabota_payroll_snapshot_v3();
  ASSERT (snap->>'balance')::numeric=-1000 AND (snap->>'due')::numeric=0
    AND (snap->>'overpaid')::numeric=1000 AND (snap->>'travel_earned')::numeric=0;
  ASSERT snap->'travel_events' @> '[{"order_number":1051,"delta":-1000},{"order_number":1051,"delta":1000}]';
  ASSERT snap->'accounting_refunds' @> '[{"order_id":"10000000-0000-4000-8000-000000000151","amount":11000,"travel_amount":1000}]';
  ASSERT snap->'accounting_receipts' @> '[{"order_id":"10000000-0000-4000-8000-000000000151","amount":11000,"travel_amount":1000}]';
  ASSERT snap->'refunds' @> '[{"order_id":"10000000-0000-4000-8000-000000000151","earned_reversed":6500}]';
  ASSERT EXISTS(SELECT 1 FROM public.rabota_orders WHERE id=order_id AND status='Отменён'
    AND travel_taken IS FALSE AND payment_amount=11000 AND price=10000);

  reply:=public.rabota_payroll_refund_v3(order_id,11000,'Fixture trip did not happen',refund_key,false);
  ASSERT (reply->>'replayed')::boolean;
  ASSERT jsonb_array_length(public.rabota_payroll_snapshot_v3()->'travel_events')=2;
  BEGIN
    PERFORM public.rabota_payroll_refund_v3(order_id,11000,'Fixture trip did not happen',refund_key,true);
    RAISE EXCEPTION 'Refund replay accepted a changed trip decision';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  reply:=public.rabota_payroll_payout_v3(1000,'cash','Fixture advance for the trip',payout_key,master_id);
  ASSERT (reply->>'replayed')::boolean AND (reply->>'balance')::numeric=-1000 AND (reply->>'due')::numeric=0;
  BEGIN
    PERFORM public.rabota_payroll_payout_v3(1,'cash','Fixture no payable balance',gen_random_uuid(),master_id);
    RAISE EXCEPTION 'Paid out more after travel reversal left an overpayment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$pay_and_refund$;

-- A manager's booking for a different master still credits only Raul.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
INSERT INTO public.rabota_orders(id,order_number,name,master,assigned_user_id,status,price,travel_amount)
  VALUES('10000000-0000-4000-8000-000000000152',1052,'Fixture trip happened','Олег',
    '00000000-0000-4000-8000-000000000004','Записан',8000,400);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
DO $other_master$
DECLARE snap jsonb:=public.rabota_payroll_snapshot_v3();
BEGIN
  ASSERT snap->>'state'='not_applicable' AND NOT (snap ? 'travel_events');
END;
$other_master$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
UPDATE public.rabota_orders SET travel_amount=600 WHERE id='10000000-0000-4000-8000-000000000152';
UPDATE public.rabota_orders SET status='Отменён',travel_taken=true WHERE id='10000000-0000-4000-8000-000000000152';
UPDATE public.rabota_orders SET travel_amount=500 WHERE id='10000000-0000-4000-8000-000000000152';
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $raul_travel$
DECLARE snap jsonb:=public.rabota_payroll_snapshot_v3();
BEGIN
  ASSERT snap->'travel_events' @> '[{"order_number":1052,"delta":400},{"order_number":1052,"delta":200},{"order_number":1052,"delta":-100}]';
  ASSERT (snap->>'travel_earned')::numeric=500 AND (snap->>'balance')::numeric=-500;
  ASSERT jsonb_array_length(snap->'travel_events')=5;
  ASSERT NOT (jsonb_path_exists(snap,'$.travel_events[*].customer') OR
    jsonb_path_exists(snap,'$.travel_events[*].name') OR jsonb_path_exists(snap,'$.travel_events[*].address'));
END;
$raul_travel$;

RESET ROLE;
DO $history_and_permissions$
BEGIN
  ASSERT NOT has_table_privilege('authenticated','private.rabota_payroll_travel_events','SELECT');
  ASSERT NOT has_table_privilege('authenticated','private.rabota_payroll_travel_events','INSERT');
  ASSERT NOT has_function_privilege('anon','public.rabota_payroll_refund_v3(uuid,numeric,text,uuid,boolean)','EXECUTE');
END;
$history_and_permissions$;

-- Exercise the triggers as an authenticated invoker even if order deletion
-- is disabled by the application's ordinary grants or policies.
GRANT DELETE ON public.rabota_orders TO authenticated;
CREATE POLICY fixture_travel_order_delete ON public.rabota_orders FOR DELETE TO authenticated USING (true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $delete_guard$
BEGIN
  INSERT INTO public.rabota_orders(id,name,status)
    VALUES('10000000-0000-4000-8000-000000000153','Fixture without travel','Записан');
  DELETE FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000153';
  ASSERT FOUND;
  BEGIN
    DELETE FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000152';
    RAISE EXCEPTION 'Order with travel history was removed';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM LIKE 'Заказ с начислениями за дорогу%';
  END;
END;
$delete_guard$;

ROLLBACK;
\echo 'PASS: separate travel accrual, adjustment, gross payment, scoped reports, refund and overpayment'
