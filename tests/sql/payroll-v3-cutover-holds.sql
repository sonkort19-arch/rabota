-- Deliberately leave one payroll dispute and one custody dispute open.
-- The socket-only payroll v3 runner establishes the original RPCs first.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.rabota_orders(id,order_number,name,master,assigned_user_id,status,price)
VALUES
 ('10000000-0000-4000-8000-000000000060',60,'Fixture verified','Рауль','00000000-0000-4000-8000-000000000003','В работе',12000),
 ('10000000-0000-4000-8000-000000000061',61,'Fixture payroll dispute','Рауль','00000000-0000-4000-8000-000000000003','В работе',10000),
 ('10000000-0000-4000-8000-000000000062',62,'Fixture custody dispute','Рауль','00000000-0000-4000-8000-000000000003','В работе',9000);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
SELECT public.rabota_cash_distribute('10000000-0000-4000-8000-000000000061');
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000062',9000,'cash');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000060',12000,'card');
SELECT public.rabota_salary_payout_v2('raul_payout',7000,'card','Fixture verified mixed payment',
 '20000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000003');
RESET ROLE;

DO $prepare_holds$
DECLARE
  v_master uuid:='00000000-0000-4000-8000-000000000003';
  v_owner uuid:='00000000-0000-4000-8000-000000000001';
  v_custody uuid:='10000000-0000-4000-8000-000000000062';
BEGIN
  INSERT INTO private.rabota_payroll_earnings_v3(
    order_id,master_user_id,paid_amount,earned_amount,company_share,earned_at,rule_version,
    verified_by,evidence_reference
  )
  SELECT id,v_master,payment_amount,payment_amount*0.50,payment_amount*0.50-1500,
    completed_at,'legacy_verified',v_owner,'Fixture verified receipt'
  FROM public.rabota_orders;
  INSERT INTO private.rabota_payroll_payout_review_v3(
    operation_id,credited_amount,allocations,verified_by,evidence_reference
  )
  SELECT id,CASE WHEN order_id IS NULL THEN amount ELSE 0 END,
    CASE WHEN order_id IS NULL THEN
      '{"10000000-0000-4000-8000-000000000060":3000,"10000000-0000-4000-8000-000000000061":4000}'::jsonb
      ELSE '{}'::jsonb END,v_owner,'Fixture verified allocation, possible duplicate requires review'
  FROM public.rabota_finance_operations;
  INSERT INTO private.rabota_payroll_cutover_holds_v3(
    order_id,payroll_on_hold,cash_on_hold,reason,verified_by
  ) VALUES ('10000000-0000-4000-8000-000000000061',true,false,'Fixture possible duplicate',v_owner),
           (v_custody,false,true,'Fixture remaining cash is unknown',v_owner);
  -- A stated zero or positive cash balance contradicts an unresolved hold.
  INSERT INTO private.rabota_payroll_cash_review_v3
  VALUES(v_custody,0,v_owner,'Fixture contradictory balance');
  BEGIN
    PERFORM private.rabota_payroll_activate_v3(v_master,v_owner,'Verified fixture backup');
    RAISE EXCEPTION 'Conflicting cash review and hold were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  DELETE FROM private.rabota_payroll_cash_review_v3 WHERE order_id=v_custody;
  PERFORM private.rabota_payroll_activate_v3(v_master,v_owner,'Verified fixture backup');
  ASSERT (SELECT count(*) FROM public.rabota_cash_collections)=1;
  ASSERT (SELECT company_amount FROM public.rabota_cash_collections)=3500;
  ASSERT (SELECT sum(amount) FROM public.rabota_finance_operations)=13500;
  BEGIN
    INSERT INTO public.rabota_cash_collections(
      order_id,master_user_id,gross,raul_amount,timur_amount,company_amount,payroll_separate
    ) VALUES(v_custody,v_master,9000,0,0,9000,true);
    RAISE EXCEPTION 'Held order got a fabricated cash collection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$prepare_holds$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner_holds$
DECLARE
  v_snapshot jsonb:=public.rabota_payroll_snapshot_v3();
  v_master uuid:= '00000000-0000-4000-8000-000000000003';
  v_disputed uuid:= '10000000-0000-4000-8000-000000000061';
  v_custody uuid:= '10000000-0000-4000-8000-000000000062';
  v_error text;
BEGIN
  ASSERT (v_snapshot->>'earned')::numeric=10500;
  ASSERT (v_snapshot->>'paid')::numeric=3000;
  ASSERT (v_snapshot->>'due')::numeric=7500;
  ASSERT jsonb_array_length(v_snapshot->'payouts')=1;
  ASSERT v_snapshot->'payouts' @> '[{"amount":3000,"recorded_amount":7000,"held_amount":4000}]';
  ASSERT v_snapshot->'holds' @> '[{"order_number":61,"payroll_on_hold":true,"cash_on_hold":false,
     "earned_amount":5000,"credited_amount":4000,"linked_recorded_amount":6500,"payment_amount":null}]';
  ASSERT v_snapshot->'holds' @> '[{"order_number":62,"payroll_on_hold":false,"cash_on_hold":true,
     "earned_amount":null,"payment_amount":9000}]';
  BEGIN
    PERFORM public.rabota_payroll_payout_v3(7500.01,'cash','Fixture over the safe amount',gen_random_uuid(),v_master);
    RAISE EXCEPTION 'Held value can be paid twice';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_payroll_refund_v3(v_disputed,10000,'Fixture must stay on hold',gen_random_uuid());
    RAISE EXCEPTION 'Held order can be refunded';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM LIKE '%продолжается сверка%';
  END;
  BEGIN
    PERFORM public.rabota_cash_confirm_amount(v_custody,9000,0);
  EXCEPTION WHEN raise_exception THEN v_error:=SQLERRM;
  END;
  ASSERT v_error IS NOT NULL;
END;
$owner_holds$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $master_holds$
DECLARE
  v_custody uuid:= '10000000-0000-4000-8000-000000000062';
  v_error text;
BEGIN
  ASSERT public.rabota_payroll_snapshot_v3()->'holds'='[]'::jsonb;
  ASSERT (public.rabota_payroll_snapshot_v3()->>'paid')::numeric=3000;
  BEGIN
    PERFORM public.rabota_cash_submit_amount(1,gen_random_uuid(),v_custody);
  EXCEPTION WHEN raise_exception THEN v_error:=SQLERRM;
  END;
  ASSERT v_error IS NOT NULL;
  v_error:=NULL;
  -- The only existing collection has 3500 available; FIFO must not source
  -- the extra ruble from the unresolved 9000 receipt.
  BEGIN
    PERFORM public.rabota_cash_submit_amount(3501,gen_random_uuid());
  EXCEPTION WHEN raise_exception THEN v_error:=SQLERRM;
  END;
  ASSERT v_error IS NOT NULL;
  ASSERT NOT EXISTS (SELECT 1 FROM public.rabota_cash_transfer_events);
END;
$master_holds$;
ROLLBACK;
SELECT 'PASS: disputed opening payroll and cash stay outside live payable balances, with audit detail intact';
