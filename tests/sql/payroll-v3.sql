-- Run only in tests/payroll-v3-local.sh, after loading the deployed-equivalent
-- definitions and installing v3 in an empty PostgreSQL 17 cluster.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.rabota_orders(id,name,master,assigned_user_id,status,price)
VALUES
 ('10000000-0000-4000-8000-000000000030','Fixture historic card','Рауль','00000000-0000-4000-8000-000000000003','В работе',10000),
 ('10000000-0000-4000-8000-000000000031','Fixture historic cash','Рауль','00000000-0000-4000-8000-000000000003','В работе',5000);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000031',5000,'cash');
DO $inactive$
BEGIN
  ASSERT public.rabota_payroll_snapshot_v3()='{"version":3,"state":"inactive"}'::jsonb;
  ASSERT NOT has_function_privilege('authenticated','private.rabota_payroll_activate_v3(uuid,uuid,text)','execute');
  ASSERT NOT has_function_privilege('anon','public.rabota_payroll_snapshot_v3()','execute');
  ASSERT NOT has_table_privilege('authenticated','private.rabota_payroll_earnings_v3','select');
END;
$inactive$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000030',10000,'card');
SELECT public.rabota_salary_payout_v2('raul_payout',2000,'card','Fixture historical direct payout',
 '20000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000003');
SELECT public.rabota_salary_payout_v2('timur_payout',1500,'card','Fixture historical independent payment',
 '20000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000003');
RESET ROLE;

DO $reconciliation$
DECLARE
  master_id uuid:='00000000-0000-4000-8000-000000000003';
  approver uuid:='00000000-0000-4000-8000-000000000001';
BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM private.rabota_payroll_earnings_v3);
  BEGIN
    PERFORM private.rabota_payroll_activate_v3(master_id,approver,NULL);
    RAISE EXCEPTION 'Activation ignored missing backup';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM private.rabota_payroll_activate_v3(master_id,approver,'Synthetic restore receipt');
    RAISE EXCEPTION 'Activation ignored missing reviewed earnings';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO private.rabota_payroll_earnings_v3(
    order_id,master_user_id,paid_amount,earned_amount,company_share,earned_at,rule_version,
    verified_by,evidence_reference
  )
  SELECT id,master_id,payment_amount,payment_amount*0.50,payment_amount*0.50-1500,
    completed_at,'legacy_verified',approver,'Fixture invoice'
  FROM public.rabota_orders;
  BEGIN
    PERFORM private.rabota_payroll_activate_v3(master_id,approver,'Synthetic restore receipt');
    RAISE EXCEPTION 'Activation ignored missing payout review';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO private.rabota_payroll_payout_review_v3(
    operation_id,credited_amount,allocations,verified_by,evidence_reference
  )
  SELECT id,CASE WHEN kind='raul_payout' THEN amount ELSE 0 END,
    CASE WHEN kind='raul_payout' THEN jsonb_build_object('10000000-0000-4000-8000-000000000030',amount)
         ELSE '{}'::jsonb END,approver,'Fixture confirmed payee'
  FROM public.rabota_finance_operations;
  BEGIN
    PERFORM private.rabota_payroll_activate_v3(master_id,approver,'Synthetic restore receipt');
    RAISE EXCEPTION 'Activation ignored missing cash custody review';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO private.rabota_payroll_cash_review_v3(order_id,held_amount,verified_by,evidence_reference)
  VALUES('10000000-0000-4000-8000-000000000031',1900,approver,'Fixture counted cash');
  PERFORM private.rabota_payroll_activate_v3(master_id,approver,'Synthetic restore receipt');
END;
$reconciliation$;

INSERT INTO public.rabota_orders(id,name,master,assigned_user_id,status,price)
VALUES
 ('10000000-0000-4000-8000-000000000040','Fixture paid 10000','Рауль','00000000-0000-4000-8000-000000000003','В работе',10000),
 ('10000000-0000-4000-8000-000000000041','Fixture paid 16000','Рауль','00000000-0000-4000-8000-000000000003','В работе',16000),
 ('10000000-0000-4000-8000-000000000042','Fixture paid 20000','Рауль','00000000-0000-4000-8000-000000000003','В работе',20000),
 ('10000000-0000-4000-8000-000000000043','Fixture unpaid','Рауль','00000000-0000-4000-8000-000000000003','Выполнен',15000),
 ('10000000-0000-4000-8000-000000000044','Fixture canceled','Рауль','00000000-0000-4000-8000-000000000003','Отменён',12000),
 ('10000000-0000-4000-8000-000000000045','Fixture other master','Другой','00000000-0000-4000-8000-000000000004','В работе',1500);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $payment$
BEGIN
  BEGIN
    PERFORM public.rabota_record_order_payment('10000000-0000-4000-8000-000000000040',9000,'card');
    RAISE EXCEPTION 'Partial receipt classified as full payment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.rabota_record_order_payment('10000000-0000-4000-8000-000000000040',10000,'card');
  PERFORM public.rabota_record_order_payment('10000000-0000-4000-8000-000000000042',20000,'cash');
  BEGIN
    UPDATE public.rabota_orders SET price=15000 WHERE id='10000000-0000-4000-8000-000000000040';
    RAISE EXCEPTION 'Price changed after the payment';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$payment$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $master$
DECLARE
  v_snapshot jsonb;
BEGIN
  PERFORM public.rabota_record_order_payment('10000000-0000-4000-8000-000000000041',16000,'cash');
  v_snapshot:=public.rabota_payroll_snapshot_v3();
  ASSERT v_snapshot->>'master_id'='00000000-0000-4000-8000-000000000003';
  ASSERT (v_snapshot->>'earned')::numeric=35000;
  ASSERT (v_snapshot->>'paid')::numeric=2000;
  ASSERT jsonb_array_length(v_snapshot->'orders')=5;
  ASSERT v_snapshot->'orders' @> '[{"earned_amount":6500,"company_share":3500,"paid_amount":10000}]';
  ASSERT v_snapshot->'orders' @> '[{"earned_amount":9500,"company_share":6500,"paid_amount":16000}]';
  ASSERT v_snapshot->'orders' @> '[{"earned_amount":11500,"company_share":8500,"paid_amount":20000}]';
  BEGIN
    PERFORM public.rabota_cash_distribute('10000000-0000-4000-8000-000000000041');
    RAISE EXCEPTION 'Legacy cash distribution writes v3 salary';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_payroll_payout_v3(1,'cash','Fixture unauthorized',gen_random_uuid(),auth.uid());
    RAISE EXCEPTION 'Master can record own payout';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.rabota_cash_submit_amount(16000,gen_random_uuid(),'10000000-0000-4000-8000-000000000041');
  ASSERT (public.rabota_payroll_snapshot_v3()->>'earned')::numeric=35000;
END;
$master$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000045',1500,'cash');
DO $other$
DECLARE v_snapshot jsonb:=public.rabota_payroll_snapshot_v3();
BEGIN
  ASSERT v_snapshot->>'state'='not_applicable' AND NOT (v_snapshot?'orders' OR v_snapshot?'paid' OR v_snapshot?'master_id');
END;
$other$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $manager$
DECLARE v_snapshot jsonb:=public.rabota_payroll_snapshot_v3();
BEGIN
  ASSERT v_snapshot->>'state'='not_applicable' AND NOT (v_snapshot?'orders' OR v_snapshot?'paid' OR v_snapshot?'master_id');
  BEGIN
    PERFORM public.rabota_payroll_refund_v3('10000000-0000-4000-8000-000000000040',10000,'Fixture denied',gen_random_uuid());
    RAISE EXCEPTION 'Manager can record a refund';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$manager$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner$
DECLARE
  master_id uuid:='00000000-0000-4000-8000-000000000003';
  p_request uuid:='20000000-0000-4000-8000-000000000040';
  r_request uuid:='20000000-0000-4000-8000-000000000041';
  p_order uuid:='10000000-0000-4000-8000-000000000040';
  first_payout jsonb;
  result jsonb;
BEGIN
  PERFORM public.rabota_cash_confirm_amount('10000000-0000-4000-8000-000000000041',16000,0);
  ASSERT (public.rabota_payroll_snapshot_v3()->>'paid')::numeric=2000;
  first_payout:=public.rabota_payroll_payout_v3(5000,'card','Fixture partial payout',p_request,master_id);
  ASSERT (first_payout->>'due')::numeric=28000;
  result:=public.rabota_payroll_payout_v3(5000,'card','Fixture partial payout',p_request,master_id);
  ASSERT result->>'id'=first_payout->>'id' AND (result->>'replayed')::boolean;
  BEGIN
    PERFORM public.rabota_payroll_payout_v3(5001,'card','Fixture changed amount',p_request,master_id);
    RAISE EXCEPTION 'Changed payout replay accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_finance_record('timur_payout',1,master_id,'Fixture legacy payout');
    RAISE EXCEPTION 'Old payroll path still active';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_finance_void((first_payout->>'id')::uuid);
    RAISE EXCEPTION 'Paid salary was erased';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_payroll_refund_v3('10000000-0000-4000-8000-000000000041',16000,'Fixture master cash',gen_random_uuid());
    RAISE EXCEPTION 'Missing cash custody reconciliation was bypassed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  result:=public.rabota_payroll_refund_v3(p_order,10000,'Fixture confirmed refund',r_request);
  ASSERT NOT (result->>'replayed')::boolean;
  result:=public.rabota_payroll_refund_v3(p_order,10000,'Fixture confirmed refund',r_request);
  ASSERT (result->>'replayed')::boolean;
  result:=public.rabota_payroll_snapshot_v3();
  ASSERT (result->>'due')::numeric=21500;
  ASSERT result->'refunds' @> '[{"amount":10000,"earned_reversed":6500}]';
  PERFORM public.rabota_payroll_payout_v3(21500,'cash','Fixture whole residual',gen_random_uuid(),master_id);
  ASSERT (public.rabota_payroll_snapshot_v3()->>'due')::numeric=0;
  BEGIN
    PERFORM public.rabota_payroll_refund_v3('10000000-0000-4000-8000-000000000042',20000,'Fixture needs review',gen_random_uuid());
    RAISE EXCEPTION 'Already-paid salary was reversibly discarded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.rabota_finance_record('expense',120,NULL,'Fixture separate expense');
END;
$owner$;

RESET ROLE;
DO $audit$
BEGIN
  ASSERT (SELECT count(*) FROM private.rabota_payroll_earnings_v3)=5;
  ASSERT (SELECT count(*) FROM private.rabota_payroll_refunds_v3)=1;
  ASSERT (SELECT count(*) FROM public.rabota_finance_operations)=5;
  ASSERT (SELECT sum(amount) FROM public.rabota_finance_operations WHERE kind='timur_payout')=1500;
  ASSERT EXISTS (SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000040' AND paid AND status='Отменён' AND payment_amount=10000);
  ASSERT EXISTS (SELECT 1 FROM public.rabota_cash_collections
    WHERE order_id='10000000-0000-4000-8000-000000000041' AND payroll_separate
      AND gross=16000 AND company_amount=16000 AND raul_amount=0 AND timur_amount=0 AND confirmed_amount=16000);
  ASSERT EXISTS (SELECT 1 FROM public.rabota_cash_collections
    WHERE order_id='10000000-0000-4000-8000-000000000031' AND company_amount=1900 AND confirmed_at IS NULL);
END;
$audit$;
COMMIT;
SELECT 'PASS: v3 activation gates, rule examples, payout replay, roles, cash and refunds';
