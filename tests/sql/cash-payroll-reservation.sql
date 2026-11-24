-- Run against the isolated cluster created by tests/cash-payroll-reservation-local.sh.
\set ON_ERROR_STOP on
BEGIN;
-- Cash to be distributed by Raul: 10000 + 1500 in automatic payroll.
-- Card sent to the company and a small cash order do permit manual payroll.
INSERT INTO public.rabota_orders(id,name,phone,master,assigned_user_id,status,price,paid)
VALUES
 ('10000000-0000-4000-8000-000000000020','Synthetic cash','000','Рауль','00000000-0000-4000-8000-000000000003','В работе',20000,false),
 ('10000000-0000-4000-8000-000000000021','Synthetic card','000','Рауль','00000000-0000-4000-8000-000000000003','В работе',12000,false),
 ('10000000-0000-4000-8000-000000000022','Synthetic small cash','000','Рауль','00000000-0000-4000-8000-000000000003','В работе',2500,false);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000020',20000,'cash');
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000022',2500,'cash');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000021',12000,'card');
DO $payouts$
DECLARE
  raul uuid := '00000000-0000-4000-8000-000000000003';
  first_payment uuid;
BEGIN
  BEGIN
    PERFORM public.rabota_salary_payout_v2(
      'raul_payout',7250.01,'card','Synthetic excessive payment',gen_random_uuid(),raul);
    RAISE EXCEPTION 'Reserved cash accepted through salary v2';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_finance_record('timur_payout',3000.01,raul,'Synthetic excessive legacy payment');
    RAISE EXCEPTION 'Reserved cash accepted through legacy finance';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  first_payment := public.rabota_salary_payout_v2(
    'raul_payout',7250,'card','Synthetic permitted payout','20000000-0000-4000-8000-000000000020',raul);
  IF first_payment IS DISTINCT FROM public.rabota_salary_payout_v2(
    'raul_payout',7250,'card','Synthetic permitted payout','20000000-0000-4000-8000-000000000020',raul
  ) THEN RAISE EXCEPTION 'Existing valid request must remain idempotent'; END IF;
  PERFORM public.rabota_finance_record('timur_payout',3000,raul,'Synthetic permitted payout');
  PERFORM public.rabota_finance_record('expense',120,NULL,'Synthetic expense remains available');

  IF has_function_privilege('authenticated','private.rabota_manual_payroll_capacity(uuid)','execute')
    OR has_function_privilege('anon','private.rabota_manual_payroll_capacity(uuid)','execute') THEN
    RAISE EXCEPTION 'Private payroll calculation is exposed to browser roles';
  END IF;
END;
$payouts$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
SELECT public.rabota_cash_distribute('10000000-0000-4000-8000-000000000020');
RESET ROLE;
DO $totals$
BEGIN
  IF (SELECT sum(amount) FROM public.rabota_finance_operations WHERE kind='raul_payout') IS DISTINCT FROM 17250::numeric
    OR (SELECT sum(amount) FROM public.rabota_finance_operations WHERE kind='timur_payout') IS DISTINCT FROM 4500::numeric
    OR (SELECT company_amount FROM public.rabota_cash_collections) IS DISTINCT FROM 8500::numeric THEN
    RAISE EXCEPTION 'Manual and automatic payroll must remain within accrued shares';
  END IF;
END;
$totals$;
ROLLBACK;

BEGIN;
INSERT INTO public.rabota_orders(id,name,phone,master,assigned_user_id,status,price,paid)
VALUES ('10000000-0000-4000-8000-000000000023','Synthetic legacy overlap','000','Рауль',
        '00000000-0000-4000-8000-000000000003','В работе',20000,false);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
SELECT public.rabota_record_order_payment('10000000-0000-4000-8000-000000000023',20000,'cash');
RESET ROLE;
-- Simulate a previously authorized manual ledger entry imported from before protection.
INSERT INTO public.rabota_finance_operations(kind,amount,master_user_id,note,created_by)
VALUES ('raul_payout',10000,'00000000-0000-4000-8000-000000000003',
        'Synthetic existing payout','00000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $overlap$
BEGIN
  BEGIN
    PERFORM public.rabota_cash_distribute('10000000-0000-4000-8000-000000000023');
    RAISE EXCEPTION 'A manual plus automatic payout was possible after protection';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.rabota_cash_collections)
    OR (SELECT count(*) FROM public.rabota_finance_operations)<>1 THEN
    RAISE EXCEPTION 'Rejected automatic payout must leave existing data intact';
  END IF;
END;
$overlap$;
ROLLBACK;

SELECT 'PASS: payroll reservation, precise settlement, historical overlap, expense and grants' AS result;
