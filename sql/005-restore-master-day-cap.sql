-- Optional rollback ONLY after reconciling bookings made with no daily limit.
-- The rollback does not delete or edit orders. It reinstates the original cap.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30000ms';

DO $restore_ai$
DECLARE
  v_oid oid;
  v_ddl text;
  v_removed constant text := '-- daily order count is intentionally unlimited; exact slots remain protected';
  v_original constant text :=
    'if v_day_count>=2 then raise exception ''У мастера уже два заказа на этот день. Третий запрещён''; end if;';
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'public.rabota_ai_prepare_order_v2(text,text,text,text,text,text,text,numeric,text,text,integer,integer)',
    'public.rabota_ai_confirm_order_v2(uuid,boolean)'
  ] LOOP
    v_oid:=pg_catalog.to_regprocedure(v_name);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'AI RPC missing: %',v_name; END IF;
    v_ddl:=pg_catalog.pg_get_functiondef(v_oid);
    IF pg_catalog.strpos(v_ddl,v_removed)=0 THEN
      RAISE EXCEPTION 'Unexpected AI RPC definition: %',v_name;
    END IF;
    EXECUTE pg_catalog.replace(v_ddl,v_removed,v_original);
  END LOOP;
END;
$restore_ai$;

DO $restore_trigger$
BEGIN
  IF EXISTS(
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.rabota_orders'::regclass
      AND tgname='rabota_master_daily_capacity_trigger'
  ) THEN
    RAISE EXCEPTION 'Day capacity trigger already exists; aborting';
  END IF;
END;
$restore_trigger$;

CREATE TRIGGER rabota_master_daily_capacity_trigger
  BEFORE INSERT OR UPDATE OF appointment_date,appointment_time,master,status
  ON public.rabota_orders FOR EACH ROW
  EXECUTE FUNCTION private.rabota_enforce_master_day_capacity();

COMMIT;
