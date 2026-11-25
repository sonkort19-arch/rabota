-- Synthetic data only. Run after the travel and order revision migrations.
\set ON_ERROR_STOP on

CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_user_meta_data jsonb);
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001','{"full_name":"Тестовый владелец"}');

-- Mirror the existing exact-start protection for the tests. The production
-- index is not modified when installing the quick move migration.
CREATE UNIQUE INDEX fixture_orders_active_master_slot_unique
ON public.rabota_orders(lower(btrim(master)),appointment_date,appointment_time)
WHERE status<>'Отменён' AND appointment_date IS NOT NULL AND appointment_time IS NOT NULL;

\ir ../../sql/20261125141828_rabota_quick_reschedule.sql

DO $duration$
BEGIN
  IF private.rabota_reschedule_block_minutes(4,2,'ВЕРХНИЙ ФИАГДОН')<>160
     OR private.rabota_reschedule_block_minutes(4,2,'ул. Ардонская')<>130
     OR private.rabota_reschedule_block_minutes(2,2,'В городе')<>90
     OR private.rabota_reschedule_block_minutes(NULL,0,'')<>210
     OR private.rabota_reschedule_block_minutes(501,1,'с. Верхний')<>70
     OR private.rabota_reschedule_block_minutes(500,500,'село Дальнее')<>15060 THEN
    RAISE EXCEPTION 'Server visit/travel estimates are inconsistent';
  END IF;
  IF has_table_privilege('authenticated','private.rabota_order_reschedule_events','SELECT')
    OR has_function_privilege('anon','public.rabota_reschedule_order(uuid,uuid,timestamptz,date,time)','EXECUTE')
    OR has_function_privilege('anon','public.rabota_order_reschedule_history(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Order move or private history is exposed';
  END IF;
END;
$duration$;

BEGIN;

INSERT INTO public.rabota_orders(
  id,name,phone,address,details,order_number,master,assigned_user_id,price,travel_amount,
  radiators,floor_loops,appointment_date,appointment_time,status
)
SELECT id::uuid, name,'71234567890',addr,'Синтетические заметки',number,master,assignee::uuid,
  10000,road,radiators,loops,(clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date+days,at::time,status
FROM (VALUES
  ('40000000-0000-4000-8000-000000000001','Переносимый','Верхний Фиагдон',91101,'Рауль','00000000-0000-4000-8000-000000000003',1000,4,2,60,'10:00','Записан'),
  ('40000000-0000-4000-8000-000000000002','Предыдущая ночь','ул. Ардонская',91102,'Рауль','00000000-0000-4000-8000-000000000003',0,2,2,62,'23:40','Записан'),
  ('40000000-0000-4000-8000-000000000003','Следующее утро','Город',91103,' Рауль ',NULL,0,1,0,63,'03:50','Записан'),
  ('40000000-0000-4000-8000-000000000004','Другая занятость','Город',91104,'Другой','00000000-0000-4000-8000-000000000004',0,1,0,63,'01:20','Записан'),
  ('40000000-0000-4000-8000-000000000005','Отмечен выполненным','Город',91105,'Рауль','00000000-0000-4000-8000-000000000003',0,3,1,63,'01:45','Выполнен'),
  ('40000000-0000-4000-8000-000000000006','Уже отменён','Город',91106,'Рауль','00000000-0000-4000-8000-000000000003',0,5,0,63,'01:10','Отменён'),
  ('40000000-0000-4000-8000-000000000007','Подбор старого окна','Город',91107,'Рауль','00000000-0000-4000-8000-000000000003',0,1,0,61,'10:00','В работе'),
  ('40000000-0000-4000-8000-000000000008','Без назначения','Город',91108,'',NULL,0,1,0,61,'10:00','Записан')
) t(id,name,addr,number,master,assignee,road,radiators,loops,days,at,status);

CREATE TEMP TABLE reschedule_test_ledger_before AS
SELECT (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM private.rabota_payroll_travel_events e) AS travel,
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.order_id) FROM private.rabota_payroll_earnings_v3 e) AS earned,
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.rabota_finance_operations e) AS payments;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $owner$
DECLARE
  v_order constant uuid := '40000000-0000-4000-8000-000000000001';
  v_request constant uuid := '40000001-0000-4000-8000-000000000001';
  v_old public.rabota_orders%ROWTYPE;
  v_moved public.rabota_orders%ROWTYPE;
  v_new_date date;
  v_result jsonb;
  v_replay jsonb;
  v_history jsonb;
BEGIN
  SELECT * INTO STRICT v_old FROM public.rabota_orders WHERE id=v_order;
  v_new_date := v_old.appointment_date+3;
  IF public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,v_new_date,'01:09')->>'state' IS DISTINCT FROM 'occupied'
    OR public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,v_new_date,'01:11')->>'state' IS DISTINCT FROM 'occupied'
    OR public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,v_new_date,'01:45')->>'state' IS DISTINCT FROM 'occupied' THEN
    RAISE EXCEPTION 'Failed to reject previous-night, next-visit, or exact completed collision';
  END IF;
  IF public.rabota_reschedule_order(v_order,v_request,NULL,v_new_date,'01:10')->>'state' IS DISTINCT FROM 'stale'
    OR public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,current_date-1,'10:00')->>'state' IS DISTINCT FROM 'invalid_time'
    OR public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,v_new_date,'01:10:59')->>'state' IS DISTINCT FROM 'invalid_time'
    OR public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,v_old.appointment_date,v_old.appointment_time)->>'state' IS DISTINCT FROM 'invalid_time' THEN
    RAISE EXCEPTION 'A stale, past, subminute, or unchanged move was not rejected';
  END IF;
  v_result := public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,v_new_date,'01:10');
  v_replay := public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,v_new_date,'01:10');
  SELECT * INTO STRICT v_moved FROM public.rabota_orders WHERE id=v_order;
  v_history := public.rabota_order_reschedule_history(v_order);
  IF v_result->>'state' IS DISTINCT FROM 'saved' OR v_result->>'replayed' IS DISTINCT FROM 'false'
    OR v_result->>'current' IS DISTINCT FROM 'true'
    OR v_replay->>'state' IS DISTINCT FROM 'saved' OR v_replay->>'replayed' IS DISTINCT FROM 'true'
    OR v_replay->>'current' IS DISTINCT FROM 'true'
    OR v_result->'event' IS DISTINCT FROM v_replay->'event'
    OR jsonb_build_array(v_result->'event') IS DISTINCT FROM v_history
    OR v_history->0->>'id' IS DISTINCT FROM v_request::text
    OR v_history->0->>'previous_date' IS DISTINCT FROM v_old.appointment_date::text
    OR v_history->0->>'previous_time' IS DISTINCT FROM '10:00'
    OR v_history->0->>'new_date' IS DISTINCT FROM v_new_date::text
    OR v_history->0->>'new_time' IS DISTINCT FROM '01:10'
    OR v_history->0->>'actor_id' IS DISTINCT FROM auth.uid()::text
    OR v_history->0->>'actor_name' IS DISTINCT FROM 'Тестовый владелец'
    OR (v_history->0->>'moved_at')::timestamptz IS NULL
    OR v_moved.appointment_date IS DISTINCT FROM v_new_date
    OR v_moved.appointment_time IS DISTINCT FROM '01:10'::time
    OR v_moved.updated_at<=v_old.updated_at
    OR (to_jsonb(v_moved)-ARRAY['appointment_date','appointment_time','updated_at'])
      IS DISTINCT FROM (to_jsonb(v_old)-ARRAY['appointment_date','appointment_time','updated_at']) THEN
    RAISE EXCEPTION 'Reschedule did not atomically preserve order facts, event or exact retry';
  END IF;
  BEGIN
    PERFORM public.rabota_reschedule_order(v_order,v_request,v_old.updated_at,v_new_date+1,'01:10');
    RAISE EXCEPTION 'Request ID accepted a different payload';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF public.rabota_reschedule_order('40000000-0000-4000-8000-000000000008',
      gen_random_uuid(),NULL,v_new_date+4,'10:00')->>'state' IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'Opening revision is not checked before assignment';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rabota_orders o WHERE o.id IN (
      '40000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000006',
      '40000000-0000-4000-8000-000000000008')
    AND public.rabota_reschedule_order(o.id,gen_random_uuid(),o.updated_at,v_new_date+4,'10:00')->>'state'
      IS DISTINCT FROM 'unavailable'
  ) THEN
    RAISE EXCEPTION 'A completed, cancelled or unassigned order can move';
  END IF;
END;
$owner$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $manager$
DECLARE
  v_order constant uuid := '40000000-0000-4000-8000-000000000007';
  v_owner_order constant uuid := '40000000-0000-4000-8000-000000000001';
  v_manager_request constant uuid := '40000001-0000-4000-8000-000000000002';
  v_row public.rabota_orders%ROWTYPE;
  v_first jsonb;
BEGIN
  SELECT * INTO STRICT v_row FROM public.rabota_orders WHERE id=v_order;
  v_first := public.rabota_reschedule_order(v_order,v_manager_request,v_row.updated_at,v_row.appointment_date-1,'10:00');
  IF v_first->>'state' IS DISTINCT FROM 'saved' OR v_first->'event'->>'actor_name' IS DISTINCT FROM 'Менеджер'
    OR (SELECT status FROM public.rabota_orders WHERE id=v_order) IS DISTINCT FROM 'В работе' THEN
    RAISE EXCEPTION 'Manager could not move an in-progress order into the released slot';
  END IF;
  SELECT * INTO STRICT v_row FROM public.rabota_orders WHERE id=v_owner_order;
  IF public.rabota_reschedule_order(v_owner_order,gen_random_uuid(),v_row.updated_at,
      v_row.appointment_date+1,'15:00')->>'state' IS DISTINCT FROM 'saved' THEN
    RAISE EXCEPTION 'Second legitimate move failed';
  END IF;
END;
$manager$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $master$
BEGIN
  IF jsonb_array_length(public.rabota_order_reschedule_history('40000000-0000-4000-8000-000000000001'))<>2 THEN
    RAISE EXCEPTION 'Assigned master cannot read their order history';
  END IF;
  BEGIN
    PERFORM public.rabota_reschedule_order('40000000-0000-4000-8000-000000000001',gen_random_uuid(),
       NULL,current_date+60,'10:00');
    RAISE EXCEPTION 'Master moved an order';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$master$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
DO $other_master$
BEGIN
  BEGIN
    PERFORM public.rabota_order_reschedule_history('40000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Unassigned master read another order history';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$other_master$;

RESET ROLE;
DO $ledgers$
DECLARE
  v_saved private.rabota_order_reschedule_events%ROWTYPE;
  v_replay jsonb;
  v_ledger reschedule_test_ledger_before%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_saved FROM private.rabota_order_reschedule_events WHERE id='40000001-0000-4000-8000-000000000001';
  PERFORM set_config('request.jwt.claim.sub',v_saved.actor_id::text,true);
  v_replay := public.rabota_reschedule_order(v_saved.order_id,v_saved.id,v_saved.expected_updated_at,v_saved.new_date,v_saved.new_time);
  IF v_replay->>'replayed' IS DISTINCT FROM 'true' OR v_replay->>'current' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'An old replay did not disclose the changed current schedule';
  END IF;
  SELECT * INTO STRICT v_ledger FROM reschedule_test_ledger_before;
  IF v_ledger.travel IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM private.rabota_payroll_travel_events e)
    OR v_ledger.earned IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.order_id) FROM private.rabota_payroll_earnings_v3 e)
    OR v_ledger.payments IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.rabota_finance_operations e)
    OR (SELECT count(*) FROM private.rabota_order_reschedule_events)<>3 THEN
    RAISE EXCEPTION 'Schedule-only changes altered the financial ledgers or duplicated history';
  END IF;
END;
$ledgers$;
ROLLBACK;
SELECT 'PASS: quick move permissions, occupied windows across midnight, recovery, history and unchanged financial ledgers';
