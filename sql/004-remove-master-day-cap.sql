-- CRM «Работа»: remove daily order count restrictions.
-- PREPARED ONLY: do not run in production before independent approval, backup,
-- and coordination with the matching frontend release.
-- Does not modify any order, payment, role or financial row.
--
-- PostgreSQL retains rabota_orders_active_master_slot_unique so two active
-- orders for the SAME master cannot share an exact date/time. The form also
-- still warns when starts are less than 3 h 20 min apart.
--
-- ROLLBACK: 005-restore-master-day-cap.sql (note that existing >2 order days
-- will remain; the restored trigger would reject certain subsequent edits).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30000ms';

DO $preflight$
DECLARE
  v_trigger_oid oid;
  v_indexdef text;
BEGIN
  SELECT t.oid INTO v_trigger_oid
  FROM pg_catalog.pg_trigger t
  WHERE t.tgrelid='public.rabota_orders'::regclass
    AND t.tgname='rabota_master_daily_capacity_trigger'
    AND NOT t.tgisinternal;
  IF v_trigger_oid IS NULL THEN
    RAISE EXCEPTION 'Expected original day-cap trigger missing; aborting';
  END IF;
  SELECT indexdef INTO v_indexdef
  FROM pg_catalog.pg_indexes
  WHERE schemaname='public' AND tablename='rabota_orders'
    AND indexname='rabota_orders_active_master_slot_unique';
  IF v_indexdef IS NULL
     OR v_indexdef NOT LIKE '%CREATE UNIQUE INDEX%'
     OR v_indexdef NOT LIKE '%appointment_date%'
     OR v_indexdef NOT LIKE '%appointment_time%'
     OR v_indexdef NOT LIKE '%master%'
     OR v_indexdef NOT LIKE '%status%' THEN
    RAISE EXCEPTION 'Exact slot uniqueness protection not confirmed; aborting';
  END IF;
END;
$preflight$;

DO $replace_ai_caps$
DECLARE
  v_oid oid;
  v_ddl text;
  v_old constant text :=
    'if v_day_count>=2 then raise exception ''У мастера уже два заказа на этот день. Третий запрещён''; end if;';
  v_new constant text := '-- daily order count is intentionally unlimited; exact slots remain protected';
  v_expected text;
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'public.rabota_ai_prepare_order_v2(text,text,text,text,text,text,text,numeric,text,text,integer,integer)',
    'public.rabota_ai_confirm_order_v2(uuid,boolean)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_name);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required AI RPC missing: %', v_name;
    END IF;
    v_ddl := pg_catalog.pg_get_functiondef(v_oid);
    v_expected := CASE
      WHEN v_name LIKE '%prepare%' THEN 'e629c874fce83a79cc3555b97dd78407'
      ELSE 'f62d9d1f729de646caf1efb4792df8b2'
    END;
    IF pg_catalog.md5(v_ddl) <> v_expected THEN
      RAISE EXCEPTION 'AI RPC changed since review: %. Re-review before applying', v_name;
    END IF;
    IF pg_catalog.strpos(v_ddl,v_old)=0 THEN
      RAISE EXCEPTION 'Expected old AI capacity guard missing: %', v_name;
    END IF;
    v_ddl := pg_catalog.replace(v_ddl,v_old,v_new);
    EXECUTE v_ddl;
  END LOOP;
END;
$replace_ai_caps$;

-- Preserve the function itself for an easy rollback. Remove only its trigger.
DROP TRIGGER rabota_master_daily_capacity_trigger ON public.rabota_orders;

COMMIT;

-- READ-ONLY post-deploy check:
-- select tgname from pg_trigger
--  where tgrelid='public.rabota_orders'::regclass
--    and tgname='rabota_master_daily_capacity_trigger' and not tgisinternal;
-- (expect 0 rows);
-- select indexname from pg_indexes where schemaname='public'
--   and tablename='rabota_orders' and indexname='rabota_orders_active_master_slot_unique';
-- (expect 1 row).
