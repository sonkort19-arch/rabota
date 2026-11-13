-- Post-restoration verification: only synthetic PostgreSQL 17 data.
\set ON_ERROR_STOP on
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.rabota_orders)<>8
 OR (SELECT count(*) FROM public.rabota_orders WHERE paid)<>5
 OR (SELECT count(*) FROM public.rabota_cash_collections)<>1
 OR (SELECT count(*) FROM public.rabota_finance_operations)<>3
 OR (SELECT count(*) FROM public.rabota_finance_operations
     WHERE kind='raul_payout' AND order_id IS NULL AND amount=2500)<>1
 OR NOT EXISTS (
    SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000001'
      AND paid AND status='Выполнен' AND price=13000
      AND payment_method='card' AND payment_amount=13000)
 OR NOT EXISTS (
    SELECT 1 FROM public.rabota_cash_collections
    WHERE order_id='10000000-0000-4000-8000-000000000002'
      AND gross=20000)
 THEN
    RAISE EXCEPTION 'FAIL: missing or inconsistent synthetic data after restore';
 END IF;

 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname='rabota_paid_order_guard_trigger'
      AND tgrelid='public.rabota_orders'::regclass AND tgenabled='O')
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname='rabota_cash_order_guard_trigger'
      AND tgrelid='public.rabota_orders'::regclass AND tgenabled='O')
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid='public.rabota_salary_payout_v2(text,numeric,text,text,uuid,uuid)'::regprocedure
      AND p.prosecdef)
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid='public.rabota_orders'::regclass AND c.relrowsecurity)
 THEN
    RAISE EXCEPTION 'FAIL: security triggers / functions / RLS not recovered';
 END IF;
END $verify$;

-- Even after restore, a direct owner PATCH on a paid order must be rejected.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner$
BEGIN
  BEGIN
    UPDATE public.rabota_orders SET price=999999
    WHERE id='10000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: restored paid order can be edited directly';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $owner$;
ROLLBACK;

-- Raul must be able to read own salary history but cannot register salary payments.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $raul$
BEGIN
 IF (SELECT count(*) FROM public.rabota_finance_operations
     WHERE kind='raul_payout' AND master_user_id=auth.uid())<>2 THEN
   RAISE EXCEPTION 'FAIL: salary history missing or RLS hidden after restore';
 END IF;
 BEGIN
   PERFORM public.rabota_salary_payout_v2(
     'raul_payout',500,'cash','Fake restored payout',
     '20000000-0000-4000-8000-000000000021',auth.uid());
   RAISE EXCEPTION 'FAIL: Raul can self-record payout after restore';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $raul$;
ROLLBACK;

SELECT 'PASS: restored financial data, paid guard, RLS and owner-only salary privileges' AS result;
