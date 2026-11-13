-- Synthetic RLS smoke tests on disposable PostgreSQL 17 only.
-- The fixture reproduces core order scopes and adds a synthetic Raul self-booking rule.
\set ON_ERROR_STOP on
BEGIN;
CREATE POLICY synthetic_raul_self_bookings ON public.rabota_orders
 FOR INSERT TO authenticated
 WITH CHECK (
   (SELECT auth.uid())='00000000-0000-4000-8000-000000000003'::uuid
   AND (SELECT private.rabota_my_role())='master'
   AND assigned_user_id=(SELECT auth.uid())
   AND created_by=(SELECT auth.uid())
   AND lower(btrim(master))='рауль'
   AND status='Записан'
   AND paid=false
 );

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000005') THEN
  RAISE EXCEPTION 'FAIL: owner cannot read other masters orders';
 END IF;
END $owner$;

SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $manager$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000005') THEN
  RAISE EXCEPTION 'FAIL: manager cannot read orders';
 END IF;
 UPDATE public.rabota_orders SET details='fictional, manager update'
  WHERE id='10000000-0000-4000-8000-000000000001';
 IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: manager cannot edit unpaid orders'; END IF;
END $manager$;

SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $raul$
DECLARE updated_rows integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'FAIL: Raul cannot read assigned order';
 END IF;
 IF EXISTS (SELECT 1 FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000005') THEN
  RAISE EXCEPTION 'FAIL: Raul sees another masters order';
 END IF;
 UPDATE public.rabota_orders SET details='attempt' WHERE id='10000000-0000-4000-8000-000000000001';
 GET DIAGNOSTICS updated_rows=ROW_COUNT;
 IF updated_rows<>0 THEN RAISE EXCEPTION 'FAIL: Raul performed direct order UPDATE'; END IF;
 INSERT INTO public.rabota_orders(id,name,phone,master,assigned_user_id,created_by,status,paid)
 VALUES('10000000-0000-4000-8000-000000000010','Synthetic self booking','000','Рауль',
 '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','Записан',false);
 BEGIN
  INSERT INTO public.rabota_orders(name,phone,master,assigned_user_id,created_by,status,paid)
  VALUES('Fake paid booking','000','Рауль',
   '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','Записан',true);
  RAISE EXCEPTION 'FAIL: Raul directly inserted paid booking';
 EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.rabota_orders(name,phone,master,assigned_user_id,created_by,status,paid)
  VALUES('Other master booking','000','Рауль',
   '00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','Записан',false);
  RAISE EXCEPTION 'FAIL: Raul assigned another master';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $raul$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
DO $anon$
BEGIN
 IF EXISTS (SELECT 1 FROM public.rabota_orders) THEN
  RAISE EXCEPTION 'FAIL: anonymous user can read orders';
 END IF;
END $anon$;
ROLLBACK;
SELECT 'PASS: owner, manager, Raul, other master and anonymous order scopes' AS outcome;
