-- Executed ONLY against disposable PostgreSQL 17 with synthetic orders.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;

-- Owner may enter actual payroll ledger entries, with idempotency retained.
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner$
DECLARE
 v_first uuid;
 v_again uuid;
BEGIN
 v_first:=public.rabota_salary_payout_v2(
  'raul_payout',1200,'cash','Синтетическая выплата',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003');
 IF v_first IS NULL THEN RAISE EXCEPTION 'FAIL: owner payout missing'; END IF;
 v_again:=public.rabota_salary_payout_v2(
  'raul_payout',1200,'cash','Синтетическая выплата',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003');
 IF v_first IS DISTINCT FROM v_again THEN
  RAISE EXCEPTION 'FAIL: same request not idempotent';
 END IF;
 IF (SELECT count(*) FROM public.rabota_finance_operations
   WHERE request_id='20000000-0000-4000-8000-000000000001')<>1 THEN
   RAISE EXCEPTION 'FAIL: duplicate rows for same request';
 END IF;
 BEGIN
  PERFORM public.rabota_salary_payout_v2(
   'raul_payout',1400,'cash','Переиспользование кода',
   '20000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'FAIL: reused payout request with changed amount';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.rabota_salary_payout_v2(
   'raul_payout',100000,'cash','Больше начисленного',
   '20000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'FAIL: payout exceeded accrued amount';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM public.rabota_finance_operations
  WHERE kind='raul_payout' AND voided_at IS NULL)<>1 THEN
  RAISE EXCEPTION 'FAIL: invalid calls inserted rows';
 END IF;
END $owner$;

-- Master must not be able to record own salary; reading stays possible.
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $master$
BEGIN
 IF (SELECT count(*) FROM public.rabota_finance_operations
      WHERE kind='raul_payout' AND master_user_id=auth.uid())<>1 THEN
   RAISE EXCEPTION 'FAIL: master salary history not readable';
 END IF;
 BEGIN
  PERFORM public.rabota_salary_payout_v2(
   'raul_payout',500,'cash','Мастер пытается сам выплатить',
   '20000000-0000-4000-8000-000000000003',auth.uid());
  RAISE EXCEPTION 'FAIL: master can record self payout';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM public.rabota_salary_payout_v2(
   'raul_payout',1200,'cash','Мастер воспроизводит запрос владельца',
   '20000000-0000-4000-8000-000000000001',auth.uid());
  RAISE EXCEPTION 'FAIL: master can replay owner request';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $master$;

-- Other master cannot read Raul's salary records.
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
DO $other$
BEGIN
 IF EXISTS(SELECT 1 FROM public.rabota_finance_operations) THEN
  RAISE EXCEPTION 'FAIL: other master can view Raul payouts';
 END IF;
END $other$;

-- Manager can manage orders, but cannot make salary payout entries.
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $manager$
BEGIN
 IF EXISTS(SELECT 1 FROM public.rabota_finance_operations) THEN
  RAISE EXCEPTION 'FAIL: manager can view restricted salary ledger';
 END IF;
 BEGIN
  PERFORM public.rabota_salary_payout_v2(
   'raul_payout',500,'card','Менеджер пытается выплатить',
   '20000000-0000-4000-8000-000000000004',
   '00000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'FAIL: manager can record salary payout';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $manager$;
ROLLBACK;

-- Anonymous role cannot execute the privileged salary RPC at all.
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
DO $anonymous$
BEGIN
 BEGIN
  PERFORM public.rabota_salary_payout_v2(
   'raul_payout',500,'cash','Anonymous attempt',
   '20000000-0000-4000-8000-000000000005',
   '00000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'FAIL: anonymous can post salary';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $anonymous$;
ROLLBACK;
SELECT 'PASS: owner-only salary rights and role visibility in isolated PostgreSQL 17' as outcome;
