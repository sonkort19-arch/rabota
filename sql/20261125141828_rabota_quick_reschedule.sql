-- Date/time-only rescheduling uses the existing order revision and payment
-- guards. No existing rows are rewritten by this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE private.rabota_order_reschedule_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.rabota_orders(id) ON DELETE CASCADE,
  previous_date date,
  previous_time time without time zone,
  new_date date NOT NULL,
  new_time time without time zone NOT NULL,
  expected_updated_at timestamptz,
  actor_id uuid NOT NULL,
  actor_name text NOT NULL,
  moved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ROW(previous_date,previous_time) IS DISTINCT FROM ROW(new_date,new_time))
);
CREATE INDEX rabota_order_reschedule_event_order_idx
  ON private.rabota_order_reschedule_events(order_id,moved_at DESC,id);
ALTER TABLE private.rabota_order_reschedule_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.rabota_order_reschedule_events FROM PUBLIC, anon, authenticated, service_role;

-- Keep these estimates aligned with booking-timeline.js and calendar-load.js.
-- An unspecified amount of work uses the standard three-hour estimate.
CREATE FUNCTION private.rabota_reschedule_block_minutes(
  p_radiators integer,p_floor_loops integer,p_address text
) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $duration$
  SELECT coalesce(nullif(
    CASE WHEN p_radiators BETWEEN 0 AND 500 THEN p_radiators*20 ELSE 0 END
    + CASE WHEN p_floor_loops BETWEEN 0 AND 500 THEN p_floor_loops*10 ELSE 0 END,0),180)
    + CASE WHEN coalesce(p_address,'') ~* $pattern$(^|[[:space:],.;])(за[[:space:]]+город(ом)?|вне[[:space:]]+города|с(ело)?\.[[:space:]]*\S+|село[[:space:]]+|снт[[:space:]]+|пос(елок|ёлок)?\.[[:space:]]*\S+|пос[её]лок[[:space:]]+|ст(аница)?\.[[:space:]]*\S+|станица[[:space:]]+|((верхний[[:space:]]+)?фиагдон|гизель|беслан|ардон|чермен)($|[[:space:],.;]))$pattern$
      THEN 60 ELSE 30 END
$duration$;

CREATE FUNCTION private.rabota_reschedule_event_json(p_event private.rabota_order_reschedule_events)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $format$
  SELECT jsonb_build_object(
    'id',p_event.id,'previous_date',p_event.previous_date,
    'previous_time',left(p_event.previous_time::text,5),
    'new_date',p_event.new_date,'new_time',left(p_event.new_time::text,5),
    'moved_at',p_event.moved_at,'actor_id',p_event.actor_id,'actor_name',p_event.actor_name
  )
$format$;

CREATE FUNCTION private.rabota_reschedule_order(
  p_order_id uuid,p_request_id uuid,p_expected_updated_at timestamptz,
  p_appointment_date date,p_appointment_time time without time zone
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $reschedule$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := (SELECT private.rabota_my_role());
  v_order public.rabota_orders%ROWTYPE;
  v_event private.rabota_order_reschedule_events%ROWTYPE;
  v_master_name text;
  v_actor_name text;
  v_start timestamp without time zone;
  v_end timestamp without time zone;
  v_lock_taken boolean := false;
BEGIN
  IF v_actor IS NULL OR coalesce(v_role,'') NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'Перенос доступен владельцу и менеджеру' USING ERRCODE='42501';
  END IF;
  IF p_order_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Не указан заказ или номер запроса' USING ERRCODE='22023';
  END IF;

  LOOP
    SELECT * INTO v_event FROM private.rabota_order_reschedule_events WHERE id=p_request_id;
    IF FOUND THEN
      IF v_event.order_id IS DISTINCT FROM p_order_id
        OR v_event.actor_id IS DISTINCT FROM v_actor
        OR v_event.expected_updated_at IS DISTINCT FROM p_expected_updated_at
        OR v_event.new_date IS DISTINCT FROM p_appointment_date
        OR v_event.new_time IS DISTINCT FROM p_appointment_time THEN
        RAISE EXCEPTION 'Идентификатор уже принадлежит другому запросу переноса' USING ERRCODE='23505';
      END IF;
      RETURN jsonb_build_object('state','saved','replayed',true,
        'current',EXISTS (SELECT 1 FROM public.rabota_orders o WHERE o.id=p_order_id
          AND o.appointment_date=v_event.new_date AND o.appointment_time=v_event.new_time
          AND o.status IN ('Записан','В работе')),
        'event',private.rabota_reschedule_event_json(v_event));
    END IF;
    EXIT WHEN v_lock_taken;
    -- This short lock serializes the check/update with normal inserts, edits,
    -- payment RPCs and AI moves without changing these existing write routes.
    -- EXCLUSIVE also waits for earlier SELECT FOR UPDATE holders. Plain
    -- schedule reads stay available during the transaction.
    LOCK TABLE public.rabota_orders IN EXCLUSIVE MODE;
    v_lock_taken := true;
  END LOOP;

  IF p_appointment_date IS NULL OR NOT isfinite(p_appointment_date)
    OR p_appointment_date>DATE '9999-12-31' OR p_appointment_time IS NULL
    OR p_appointment_time>=TIME '24:00' OR extract(second FROM p_appointment_time)<>0 THEN
    RETURN jsonb_build_object('state','invalid_time');
  END IF;
  v_start := p_appointment_date+p_appointment_time;
  IF v_start <= (clock_timestamp() AT TIME ZONE 'Europe/Moscow')+interval '20 minutes' THEN
    RETURN jsonb_build_object('state','invalid_time');
  END IF;

  SELECT * INTO v_order FROM public.rabota_orders WHERE id=p_order_id;
  IF NOT FOUND OR v_order.status NOT IN ('Записан','В работе')
    OR v_order.paid IS DISTINCT FROM false OR v_order.payment_method IS NOT NULL
    OR v_order.payment_amount IS NOT NULL OR v_order.payment_received_by IS NOT NULL
    OR v_order.paid_at IS NOT NULL OR v_order.paid_by IS NOT NULL THEN
    RETURN jsonb_build_object('state','unavailable');
  END IF;
  IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('state','stale');
  END IF;
  SELECT coalesce(nullif(btrim(v_order.master),''),nullif(btrim(m.master_name),''),'')
    INTO v_master_name FROM public.rabota_members m
    WHERE m.user_id=v_order.assigned_user_id AND m.active AND m.role='master';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','unavailable');
  END IF;
  IF ROW(v_order.appointment_date,v_order.appointment_time)
    IS NOT DISTINCT FROM ROW(p_appointment_date,p_appointment_time) THEN
    RETURN jsonb_build_object('state','invalid_time');
  END IF;

  v_end := v_start+make_interval(mins=>private.rabota_reschedule_block_minutes(
    v_order.radiators,v_order.floor_loops,v_order.address));
  IF EXISTS (
    SELECT 1 FROM public.rabota_orders o
    WHERE o.id<>p_order_id AND o.status<>'Отменён'
      -- The longest known scope is 500 radiators, 500 loops and 60 minutes'
      -- travel (less than eleven days). Bound the calendar read on both sides.
      AND o.appointment_date BETWEEN p_appointment_date-11 AND v_end::date
      AND o.appointment_time IS NOT NULL
      AND (o.assigned_user_id=v_order.assigned_user_id OR
        (o.assigned_user_id IS NULL AND v_master_name<>'' AND
          lower(btrim(o.master))=lower(v_master_name)))
      AND (o.appointment_date+o.appointment_time=v_start OR
        (o.status<>'Выполнен' AND o.appointment_date+o.appointment_time<v_end
          AND o.appointment_date+o.appointment_time+make_interval(mins=>
            private.rabota_reschedule_block_minutes(o.radiators,o.floor_loops,o.address))>v_start))
  ) THEN
    RETURN jsonb_build_object('state','occupied');
  END IF;

  SELECT coalesce(nullif(left(btrim(u.raw_user_meta_data->>'full_name'),100),''),
      nullif(left(btrim(u.raw_user_meta_data->>'name'),100),''),
      nullif(left(btrim(u.raw_user_meta_data->>'display_name'),100),''),
      CASE v_role WHEN 'owner' THEN 'Владелец' ELSE 'Менеджер' END)
    INTO v_actor_name
    FROM (SELECT v_actor AS user_id) a LEFT JOIN auth.users u ON u.id=a.user_id;

  BEGIN
    UPDATE public.rabota_orders
      SET appointment_date=p_appointment_date,appointment_time=p_appointment_time
      WHERE id=p_order_id;
  EXCEPTION WHEN unique_violation THEN
    -- Keep the existing exact-slot constraint as a last line of defense.
    RETURN jsonb_build_object('state','occupied');
  END;

  INSERT INTO private.rabota_order_reschedule_events(
    id,order_id,previous_date,previous_time,new_date,new_time,expected_updated_at,actor_id,actor_name
  ) VALUES (
    p_request_id,p_order_id,v_order.appointment_date,v_order.appointment_time,
    p_appointment_date,p_appointment_time,p_expected_updated_at,v_actor,v_actor_name
  ) RETURNING * INTO v_event;

  RETURN jsonb_build_object('state','saved','replayed',false,'current',true,
    'event',private.rabota_reschedule_event_json(v_event));
END;
$reschedule$;

CREATE FUNCTION private.rabota_order_reschedule_history(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $history$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := (SELECT private.rabota_my_role());
BEGIN
  IF v_actor IS NULL OR coalesce(v_role,'') NOT IN ('owner','manager','master')
    OR NOT EXISTS (SELECT 1 FROM public.rabota_orders o WHERE o.id=p_order_id
      AND (v_role IN ('owner','manager') OR o.assigned_user_id=v_actor)) THEN
    RAISE EXCEPTION 'История заказа недоступна' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(private.rabota_reschedule_event_json(e)
      ORDER BY e.moved_at DESC,e.id),'[]'::jsonb)
    FROM private.rabota_order_reschedule_events e WHERE e.order_id=p_order_id);
END;
$history$;

CREATE FUNCTION public.rabota_reschedule_order(
  p_order_id uuid,p_request_id uuid,p_expected_updated_at timestamptz,
  p_appointment_date date,p_appointment_time time without time zone
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = ''
RETURN private.rabota_reschedule_order(
  p_order_id,p_request_id,p_expected_updated_at,p_appointment_date,p_appointment_time);

CREATE FUNCTION public.rabota_order_reschedule_history(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
RETURN private.rabota_order_reschedule_history(p_order_id);

REVOKE ALL ON FUNCTION private.rabota_reschedule_block_minutes(integer,integer,text),
  private.rabota_reschedule_event_json(private.rabota_order_reschedule_events) FROM
  PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  private.rabota_reschedule_order(uuid,uuid,timestamptz,date,time),
  public.rabota_reschedule_order(uuid,uuid,timestamptz,date,time),
  private.rabota_order_reschedule_history(uuid),public.rabota_order_reschedule_history(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  private.rabota_reschedule_order(uuid,uuid,timestamptz,date,time),
  public.rabota_reschedule_order(uuid,uuid,timestamptz,date,time),
  private.rabota_order_reschedule_history(uuid),public.rabota_order_reschedule_history(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
