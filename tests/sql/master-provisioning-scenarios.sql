-- Exact master-RPC regression scenarios in disposable PostgreSQL 17.
-- Synthetic users/orders only. NEVER execute on a live Supabase project.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $manager$
BEGIN
 BEGIN
   PERFORM public.rabota_approve_master('00000000-0000-4000-8000-000000000005','Свежий');
   RAISE EXCEPTION 'FAIL: manager approved master';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'Доступ запрещён' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.rabota_provision_master('00000000-0000-4000-8000-000000000006','НовыйМастер','fresh_master');
   RAISE EXCEPTION 'FAIL: manager provisioned master';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM <> 'Только владелец может создать мастера' THEN RAISE; END IF;
 END;
END $manager$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner$
DECLARE v_bool boolean;
BEGIN
  BEGIN
    PERFORM public.rabota_approve_master('00000000-0000-4000-8000-000000000005','Исторический');
    RAISE EXCEPTION 'FAIL: paid historical order not rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.rabota_members
    WHERE user_id='00000000-0000-4000-8000-000000000005' AND active) THEN
    RAISE EXCEPTION 'FAIL: rejected approval activated account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000011'
      AND assigned_user_id IS NULL AND paid IS TRUE) THEN
    RAISE EXCEPTION 'FAIL: historic paid order changed';
  END IF;
  BEGIN
    PERFORM public.rabota_provision_master('00000000-0000-4000-8000-000000000008','Рауль','raul_new');
    RAISE EXCEPTION 'FAIL: paid Raul history reassigned';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.rabota_members
    WHERE user_id='00000000-0000-4000-8000-000000000003' AND active) THEN
    RAISE EXCEPTION 'FAIL: failed provision deactivated Raul';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rabota_members
    WHERE user_id='00000000-0000-4000-8000-000000000008') THEN
    RAISE EXCEPTION 'FAIL: rejected provision created account';
  END IF;
  SELECT public.rabota_approve_master('00000000-0000-4000-8000-000000000007','Свежий') INTO v_bool;
  IF v_bool IS DISTINCT FROM TRUE OR NOT EXISTS (
    SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000012'
      AND assigned_user_id='00000000-0000-4000-8000-000000000007') THEN
    RAISE EXCEPTION 'FAIL: normal unpaid approval broken';
  END IF;
  SELECT public.rabota_provision_master('00000000-0000-4000-8000-000000000006','НовыйМастер','fresh_master') INTO v_bool;
  IF v_bool IS DISTINCT FROM TRUE OR NOT EXISTS(
    SELECT 1 FROM public.rabota_orders
    WHERE id='10000000-0000-4000-8000-000000000013'
      AND assigned_user_id='00000000-0000-4000-8000-000000000006') THEN
    RAISE EXCEPTION 'FAIL: normal unpaid provision broken';
  END IF;
END $owner$;
ROLLBACK;
SELECT 'PASS: historic paid orders preserved and ordinary master provisioning works' AS outcome;
