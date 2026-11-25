-- Verify the timestamp trigger does not alter installed order business guards.
\set ON_ERROR_STOP on
BEGIN;
DO $migration$
BEGIN
  ASSERT (SELECT updated_at='2000-01-01 12:34:56.123456+00'::timestamptz
          FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000090');
  ASSERT (SELECT updated_at IS NULL FROM public.rabota_orders WHERE id='10000000-0000-4000-8000-000000000091');
  ASSERT NOT has_function_privilege('authenticated','private.rabota_stamp_order_updated_at()','execute');
END;
$migration$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $manager$
DECLARE
  v_revision timestamptz;
  v_first timestamptz;
  v_id uuid:='10000000-0000-4000-8000-000000000093';
BEGIN
  INSERT INTO public.rabota_orders(id,name,status,price,updated_at)
  VALUES(v_id,'Fixture new revision','В работе',3000,'infinity') RETURNING updated_at INTO STRICT v_first;
  ASSERT isfinite(v_first) AND v_first<=clock_timestamp();
  UPDATE public.rabota_orders SET details='First update',updated_at='infinity' WHERE id=v_id
  RETURNING updated_at INTO STRICT v_revision;
  ASSERT isfinite(v_revision) AND v_revision>v_first;

  UPDATE public.rabota_orders SET details='First legacy edit'
  WHERE id='10000000-0000-4000-8000-000000000091' AND updated_at IS NULL
  RETURNING updated_at INTO STRICT v_revision;
  ASSERT v_revision IS NOT NULL AND isfinite(v_revision);
  UPDATE public.rabota_orders SET details='Second legacy edit'
  WHERE id='10000000-0000-4000-8000-000000000091' AND updated_at IS NULL;
  ASSERT NOT FOUND;

  UPDATE public.rabota_orders SET details='Existing revision ahead of clock',updated_at='2000-01-01 00:00:00+00'
  WHERE id='10000000-0000-4000-8000-000000000092' AND updated_at='2080-01-01 00:00:00+00'::timestamptz
  RETURNING updated_at INTO STRICT v_revision;
  ASSERT v_revision='2080-01-01 00:00:00.000001+00'::timestamptz;

  SELECT updated_at INTO STRICT v_first FROM public.rabota_orders WHERE id=v_id;
  PERFORM public.rabota_record_order_payment(v_id,3000,'card');
  SELECT updated_at INTO STRICT v_revision FROM public.rabota_orders WHERE id=v_id;
  ASSERT v_revision>v_first;
  BEGIN
    UPDATE public.rabota_orders SET price=3100 WHERE id=v_id;
    RAISE EXCEPTION 'The version trigger allowed a protected change to paid order';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$manager$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: server order revisions advance on insert, payments and writes; old null revisions supported';
