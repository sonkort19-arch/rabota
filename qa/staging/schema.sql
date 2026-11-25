-- CRM-only QA schema checkpoint for ca56b74. No data, users, sequence state,
-- upstream Auth configuration, database webhooks or notification providers.
-- Reuses the reviewed SQL definitions for the payroll, travel and reschedule
-- functions. The remaining application DDL comes from catalog metadata only.
-- Prepend SET rabota.qa_project_ref = '<separate Supabase project identifier>'.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL check_function_bodies = off;
DO $target$
DECLARE
  ref text := current_setting('rabota.qa_project_ref',true);
BEGIN
  IF ref IS NULL OR ref = 'yedzfmibceboncrytbqz' OR (
    ref !~ '^[a-z0-9]{20}$' AND NOT (
      ref = 'local-rabota-qa' AND current_database() = 'rabota_qa_rehearsal'
      AND inet_server_addr() IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'A dedicated QA project reference is required';
  END IF;
  IF current_user <> 'postgres' OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'An empty Supabase project with managed Auth is required';
  END IF;
  IF EXISTS (
    SELECT FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname IN ('public','private') AND c.relname LIKE 'rabota\_%'
  ) OR EXISTS (
    SELECT FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
    WHERE n.nspname IN ('public','private') AND p.proname LIKE 'rabota\_%'
  ) THEN
    RAISE EXCEPTION 'The target already contains a CRM schema';
  END IF;
  IF EXISTS (SELECT FROM auth.users) THEN
    RAISE EXCEPTION 'The target already has Auth users';
  END IF;
END;
$target$;

-- Schema and sequences
CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
CREATE SEQUENCE public.rabota_order_number_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 99999 START WITH 1 CACHE 1 NO CYCLE;

-- Application tables
CREATE TABLE private.rabota_order_reschedule_events (id uuid NOT NULL, order_id uuid NOT NULL, previous_date date, previous_time time without time zone, new_date date NOT NULL, new_time time without time zone NOT NULL, expected_updated_at timestamp with time zone, actor_id uuid NOT NULL, actor_name text NOT NULL, moved_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE private.rabota_payroll_cash_review_v3 (order_id uuid NOT NULL, held_amount numeric(12,2) NOT NULL, verified_by uuid NOT NULL, evidence_reference text NOT NULL);
CREATE TABLE private.rabota_payroll_cutover_holds_v3 (order_id uuid NOT NULL, payroll_on_hold boolean DEFAULT false NOT NULL, cash_on_hold boolean DEFAULT false NOT NULL, reason text NOT NULL, verified_by uuid NOT NULL);
CREATE TABLE private.rabota_payroll_earnings_v3 (order_id uuid NOT NULL, master_user_id uuid NOT NULL, paid_amount numeric(12,2) NOT NULL, earned_amount numeric(14,2) NOT NULL, company_share numeric(14,2) NOT NULL, earned_at timestamp with time zone NOT NULL, rule_version text NOT NULL, verified_by uuid, evidence_reference text);
CREATE TABLE private.rabota_payroll_payout_review_v3 (operation_id uuid NOT NULL, credited_amount numeric(14,2) NOT NULL, allocations jsonb NOT NULL, verified_by uuid NOT NULL, evidence_reference text NOT NULL);
CREATE TABLE private.rabota_payroll_policy_v3 (singleton boolean DEFAULT true NOT NULL, master_user_id uuid NOT NULL, activated_at timestamp with time zone NOT NULL, approved_by uuid NOT NULL, backup_reference text NOT NULL, rule_version text DEFAULT 'v3-50pct-plus-1500'::text NOT NULL, rate numeric(5,4) DEFAULT 0.50 NOT NULL, bonus numeric(12,2) DEFAULT 1500 NOT NULL);
CREATE TABLE private.rabota_payroll_refunds_v3 (order_id uuid NOT NULL, request_id uuid NOT NULL, amount numeric(12,2) NOT NULL, refunded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL, refunded_by uuid NOT NULL, note text NOT NULL);
CREATE TABLE private.rabota_payroll_travel_events (id uuid DEFAULT gen_random_uuid() NOT NULL, order_id uuid NOT NULL, order_number integer, master_user_id uuid NOT NULL, delta numeric(14,2) NOT NULL, occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE public.rabota_ai_chats (id uuid DEFAULT gen_random_uuid() NOT NULL, owner_id uuid DEFAULT auth.uid() NOT NULL, title text DEFAULT 'Новый чат'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.rabota_ai_messages (id uuid DEFAULT gen_random_uuid() NOT NULL, chat_id uuid NOT NULL, owner_id uuid DEFAULT auth.uid() NOT NULL, role text NOT NULL, content text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.rabota_ai_order_drafts (id uuid DEFAULT gen_random_uuid() NOT NULL, owner_id uuid NOT NULL, action text NOT NULL, target_order_id uuid, expected_updated_at timestamp with time zone, client_name text NOT NULL, client_phone text DEFAULT ''::text NOT NULL, client_address text DEFAULT ''::text NOT NULL, appointment_date date NOT NULL, appointment_time time without time zone NOT NULL, master_name text NOT NULL, master_user_id uuid NOT NULL, price numeric, details text DEFAULT ''::text NOT NULL, old_summary jsonb, state text DEFAULT 'pending'::text NOT NULL, result_order_id uuid, created_at timestamp with time zone DEFAULT now() NOT NULL, expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval) NOT NULL, radiators integer, floor_loops integer, travel_amount numeric DEFAULT 0 NOT NULL);
CREATE TABLE public.rabota_cash_collections (order_id uuid NOT NULL, master_user_id uuid NOT NULL, gross numeric(12,2) NOT NULL, raul_amount numeric(12,2) NOT NULL, timur_amount numeric(12,2) NOT NULL, company_amount numeric(12,2) NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, submitted_at timestamp with time zone, confirmed_at timestamp with time zone, confirmed_by uuid, submitted_amount numeric, confirmed_amount numeric, last_submitted_at timestamp with time zone, last_confirmed_at timestamp with time zone, payroll_separate boolean DEFAULT false NOT NULL);
CREATE TABLE public.rabota_cash_transfer_events (id uuid DEFAULT gen_random_uuid() NOT NULL, order_id uuid NOT NULL, master_user_id uuid NOT NULL, kind text NOT NULL, amount numeric NOT NULL, created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL, created_by uuid NOT NULL, request_id uuid, request_order_id uuid);
CREATE TABLE public.rabota_cashbook_entries (id uuid DEFAULT gen_random_uuid() NOT NULL, kind text NOT NULL, amount numeric(14,2) NOT NULL, from_account text, to_account text, note text NOT NULL, request_id uuid NOT NULL, created_by uuid NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.rabota_finance_operations (id uuid DEFAULT gen_random_uuid() NOT NULL, kind text NOT NULL, amount numeric(12,2) NOT NULL, master_user_id uuid, note text DEFAULT ''::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, created_by uuid, voided_at timestamp with time zone, voided_by uuid, order_id uuid, payment_method text, request_id uuid);
CREATE TABLE public.rabota_growth_plan (id uuid DEFAULT gen_random_uuid() NOT NULL, owner_id uuid DEFAULT auth.uid() NOT NULL, kind text NOT NULL, title text NOT NULL, details text DEFAULT ''::text NOT NULL, start_on date NOT NULL, end_on date NOT NULL, parent_id uuid, sort_order integer DEFAULT 0 NOT NULL, target_rub numeric(14,2), completed boolean DEFAULT false NOT NULL, completed_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.rabota_leads (id uuid DEFAULT gen_random_uuid() NOT NULL, name text NOT NULL, phone text NOT NULL, phone_normalized text NOT NULL, address text DEFAULT ''::text NOT NULL, radiators integer, material text DEFAULT ''::text NOT NULL, loops integer, notes text DEFAULT ''::text NOT NULL, status text DEFAULT 'new'::text NOT NULL, reason text DEFAULT 'none'::text NOT NULL, follow_up_date date, follow_up_time time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL, date_approx boolean DEFAULT false NOT NULL, client_will_call boolean DEFAULT false NOT NULL, consent boolean DEFAULT false NOT NULL, price_agreed boolean DEFAULT false NOT NULL, history jsonb DEFAULT '[]'::jsonb NOT NULL, created_by uuid DEFAULT auth.uid() NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.rabota_members (user_id uuid NOT NULL, role text DEFAULT 'manager'::text NOT NULL, active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, master_name text DEFAULT ''::text NOT NULL, email text DEFAULT ''::text NOT NULL);
CREATE TABLE public.rabota_order_notifications (id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.rabota_order_notifications_id_seq INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE) NOT NULL, recipient_id uuid NOT NULL, order_id uuid NOT NULL, kind text DEFAULT 'assigned'::text NOT NULL, client_name text DEFAULT ''::text NOT NULL, visit_date date, visit_time time without time zone, read_at timestamp with time zone, sent_at timestamp with time zone, delivery_error text, created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.rabota_orders (id uuid DEFAULT gen_random_uuid() NOT NULL, name text NOT NULL, phone text DEFAULT ''::text NOT NULL, address text DEFAULT ''::text NOT NULL, radiator_type text DEFAULT ''::text NOT NULL, radiators integer, floor_loops integer, master text DEFAULT ''::text NOT NULL, appointment_date date, appointment_time time without time zone, price numeric(12,2), paid boolean DEFAULT false NOT NULL, status text DEFAULT 'Записан'::text NOT NULL, details text DEFAULT ''::text NOT NULL, legacy_id text, created_by uuid DEFAULT auth.uid(), completed_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, assigned_user_id uuid, payment_method text, payment_amount numeric(12,2), payment_received_by text, paid_at timestamp with time zone, paid_by uuid, lead_id uuid, order_number integer NOT NULL, client_source text DEFAULT ''::text NOT NULL, travel_amount numeric DEFAULT 0 NOT NULL, travel_taken boolean);
CREATE TABLE public.rabota_push_subscriptions (endpoint text NOT NULL, user_id uuid NOT NULL, subscription jsonb NOT NULL, active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

-- Application functions
CREATE FUNCTION private.rabota_accounting_payouts_v1(p_activated_at timestamptz)
RETURNS TABLE(id uuid,order_id uuid,amount numeric,payment_method text,created_at timestamptz,note text)
LANGUAGE sql STABLE SET search_path TO ''
AS $payouts$
  SELECT f.id,f.order_id,coalesce(r.credited_amount,f.amount),f.payment_method,f.created_at,f.note
  FROM public.rabota_finance_operations f
  LEFT JOIN private.rabota_payroll_payout_review_v3 r ON r.operation_id=f.id
  WHERE f.voided_at IS NULL AND f.kind IN ('raul_payout','timur_payout')
    AND (r.credited_amount>0 OR (r.operation_id IS NULL AND f.kind='raul_payout'
                               AND f.created_at>=p_activated_at))
$payouts$;
CREATE OR REPLACE FUNCTION private.rabota_accounting_receipts_v1(p_master_user_id uuid)
RETURNS TABLE(order_id uuid,master_id uuid,amount numeric,payment_method text,
  paid_at timestamptz,occurred_at timestamptz)
LANGUAGE sql STABLE SET search_path TO ''
AS $receipts$
  SELECT o.id,o.assigned_user_id,
    coalesce(o.payment_amount,e.paid_amount),o.payment_method,o.paid_at,
    coalesce(o.paid_at,e.earned_at,o.completed_at)
  FROM public.rabota_orders o
  LEFT JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=o.id AND e.rule_version='legacy_verified'
  LEFT JOIN private.rabota_payroll_refunds_v3 r ON r.order_id=o.id
  WHERE o.paid IS TRUE AND (o.status='Выполнен' OR r.order_id IS NOT NULL)
    AND (p_master_user_id IS NULL OR o.assigned_user_id=p_master_user_id)
    AND coalesce(o.payment_amount,e.paid_amount)>0
    AND coalesce(o.payment_amount,e.paid_amount)=o.price+o.travel_amount
$receipts$;
CREATE FUNCTION private.rabota_ai_apply_order_travel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $apply$
BEGIN
  IF auth.uid() IS DISTINCT FROM NEW.owner_id
    OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Подтверждение доступно только владельцу' USING ERRCODE = '42501';
  END IF;
  UPDATE public.rabota_orders
    SET travel_amount = NEW.travel_amount
    WHERE id = NEW.result_order_id AND created_by = NEW.owner_id
      AND travel_amount = 0 AND status = 'Записан' AND paid IS FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Не удалось применить доплату к созданной заявке';
  END IF;
  RETURN NEW;
END;
$apply$;
CREATE OR REPLACE FUNCTION private.rabota_capture_payroll_payment_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $capture$
DECLARE
  v_policy private.rabota_payroll_policy_v3%rowtype;
  v_earned numeric(14,2);
BEGIN
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND OR NEW.paid IS NOT TRUE OR NEW.status<>'Выполнен'
    OR NEW.payment_amount IS NULL OR NEW.payment_amount<=0
    OR NEW.payment_amount IS DISTINCT FROM NEW.price+NEW.travel_amount THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_user_id=v_policy.master_user_id THEN
    v_earned:=round(NEW.price*v_policy.rate,2)+v_policy.bonus;
    INSERT INTO private.rabota_payroll_earnings_v3(
      order_id,master_user_id,paid_amount,earned_amount,company_share,earned_at,rule_version
    ) VALUES(
      NEW.id,NEW.assigned_user_id,NEW.price,v_earned,NEW.price-v_earned,
      clock_timestamp(),v_policy.rule_version
    );
  END IF;
  RETURN NEW;
END;
$capture$;
CREATE FUNCTION private.rabota_capture_travel_payroll()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $capture$
DECLARE
  previous_amount numeric := 0;
  current_amount numeric;
  payroll_master uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM private.rabota_payroll_travel_events e WHERE e.order_id=OLD.id) THEN
      RAISE EXCEPTION 'Заказ с начислениями за дорогу нельзя удалить. Отмените его с сохранением истории'
        USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM 'Отменён' OR OLD.travel_taken IS TRUE) THEN
    previous_amount := OLD.travel_amount;
  END IF;
  current_amount := CASE WHEN NEW.status IS DISTINCT FROM 'Отменён' OR NEW.travel_taken IS TRUE
                         THEN NEW.travel_amount ELSE 0 END;
  IF current_amount = previous_amount THEN RETURN NULL; END IF;

  SELECT master_user_id INTO payroll_master FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Для начисления дороги сначала настройте зарплату Рауля' USING ERRCODE='23514';
  END IF;
  INSERT INTO private.rabota_payroll_travel_events(order_id,order_number,master_user_id,delta)
  VALUES(NEW.id,NEW.order_number,payroll_master,current_amount-previous_amount);
  RETURN NULL;
END;
$capture$;
create or replace function private.rabota_enforce_master_day_capacity()
returns trigger language plpgsql set search_path='' as $$
declare
 candidate_master text;
 assigned_count integer;
begin
 if new.status='Отменён' or new.appointment_date is null or new.appointment_time is null then
   return new;
 end if;
 candidate_master:=lower(btrim(coalesce(new.master,'')));
 if tg_op='UPDATE' then
   if old.status<>'Отменён'
     and old.appointment_date is not distinct from new.appointment_date
     and old.appointment_time is not distinct from new.appointment_time
     and lower(btrim(coalesce(old.master,'')))=candidate_master
   then return new; end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(
     'rabota:orders:master:'||candidate_master||':'||new.appointment_date::text,0
   )
 );
 select count(*) into assigned_count from public.rabota_orders r
 where r.appointment_date=new.appointment_date
   and r.status<>'Отменён'
   and lower(btrim(coalesce(r.master,'')))=candidate_master
   and r.id is distinct from new.id;
 if assigned_count>=2 then
   raise exception 'У мастера на эту дату уже два заказа. Выберите другой день.'
     using errcode='23514',constraint='rabota_master_daily_capacity';
 end if;
 return new;
end;
$$;
CREATE OR REPLACE FUNCTION private.rabota_frozen_cash_archive_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Журнал передачи наличных доступен только как архив' USING ERRCODE='55000';
END;
$function$;
CREATE OR REPLACE FUNCTION private.rabota_leads_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 new.updated_at := clock_timestamp();
 return new;
end $function$;
CREATE OR REPLACE FUNCTION private.rabota_link_master()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.assigned_user_id := null;
  if btrim(coalesce(new.master,'')) <> '' then
    select m.user_id into new.assigned_user_id
    from public.rabota_members m
    where m.role='master' and m.active=true
      and lower(btrim(m.master_name))=lower(btrim(new.master))
    limit 1;
  end if;
  return new;
end
$function$;
CREATE OR REPLACE FUNCTION private.rabota_link_new_order_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  lead_rec public.rabota_leads%rowtype;
  normalized_order_phone text;
begin
  if new.lead_id is null or new.status='Отменён' then return new; end if;
  if private.rabota_my_role() not in ('owner','manager') then
    raise exception 'Недостаточно прав для привязки лида к заказу';
  end if;
  select * into lead_rec from public.rabota_leads where id=new.lead_id for update;
  if not found then raise exception 'Лид не найден: обновите список'; end if;
  normalized_order_phone:=right(regexp_replace(coalesce(new.phone,''),'[^0-9]','','g'),10);
  if length(normalized_order_phone)<>10
    or normalized_order_phone<>right(regexp_replace(coalesce(lead_rec.phone_normalized,''),'[^0-9]','','g'),10)
  then
    raise exception 'Телефон заказа не совпадает с лидом. Проверьте номер или создайте обычный заказ.';
  end if;
  update public.rabota_leads set
    status='booked',
    follow_up_date=null,
    date_approx=false,
    history=(
      select coalesce(lead_rec.history,'[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'at',now(),'event','Заказ оформлен','status','booked','order_id',new.id::text
      ))
    )
  where id=new.lead_id;
  if not found then raise exception 'Не удалось изменить статус лида';end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION private.rabota_lock_travel_payroll()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM 1 FROM public.rabota_members m
  JOIN private.rabota_payroll_policy_v3 p ON p.master_user_id=m.user_id FOR UPDATE OF m;
  RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION private.rabota_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.role from public.rabota_members m
  where m.user_id=(select auth.uid()) and m.active=true
  limit 1
$function$;
CREATE FUNCTION private.rabota_order_number_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.order_number := pg_catalog.nextval('public.rabota_order_number_seq'::pg_catalog.regclass);
  ELSIF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    RAISE EXCEPTION 'Номер заказа нельзя менять'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
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
CREATE OR REPLACE FUNCTION private.rabota_paid_order_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $guard$
DECLARE
  v_actor uuid;
  v_role text;
  v_intent text;
  v_payment_owner name;
  v_refund_owner name;
  v_structural_same boolean;
  v_payment_allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- No direct REST INSERT may start a financial record as paid.
    IF NEW.paid IS TRUE OR NEW.payment_method IS NOT NULL
      OR NEW.payment_amount IS NOT NULL OR NEW.payment_received_by IS NOT NULL
      OR NEW.paid_at IS NOT NULL OR NEW.paid_by IS NOT NULL THEN
      RAISE EXCEPTION 'Оплата создаётся только через утверждённую процедуру'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.paid IS TRUE OR OLD.payment_method IS NOT NULL
      OR OLD.payment_amount IS NOT NULL OR OLD.payment_received_by IS NOT NULL
      OR OLD.paid_at IS NOT NULL OR OLD.paid_by IS NOT NULL THEN
      RAISE EXCEPTION 'Оплаченный заказ нельзя удалить'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- This guard never relies on a caller-provided role or payload flag.
  -- The short-lived intent is set only inside the verified SECURITY DEFINER RPCs.
  -- In addition, the invoking effective DB role must be the owner of that RPC.
  v_actor := (SELECT auth.uid());
  v_role := (SELECT private.rabota_my_role());
  v_intent := pg_catalog.current_setting('rabota.order_payment_intent',true);
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_payment_owner
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.rabota_record_order_payment(uuid,numeric,text)'::pg_catalog.regprocedure;

  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_refund_owner
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.rabota_payroll_refund_v3(uuid,numeric,text,uuid)'::pg_catalog.regprocedure;

  -- Client, calendar and assignment facts cannot be silently changed by
  -- a privileged payment procedure or by ordinary updates of paid rows.
  v_structural_same := ROW(
    NEW.id,NEW.name,NEW.phone,NEW.address,NEW.radiator_type,
    NEW.radiators,NEW.floor_loops,NEW.master,NEW.appointment_date,
    NEW.appointment_time,NEW.details,NEW.legacy_id,NEW.created_by,
    NEW.created_at,NEW.assigned_user_id,NEW.lead_id,NEW.travel_amount
  ) IS NOT DISTINCT FROM ROW(
    OLD.id,OLD.name,OLD.phone,OLD.address,OLD.radiator_type,
    OLD.radiators,OLD.floor_loops,OLD.master,OLD.appointment_date,
    OLD.appointment_time,OLD.details,OLD.legacy_id,OLD.created_by,
    OLD.created_at,OLD.assigned_user_id,OLD.lead_id,OLD.travel_amount
  );

  v_payment_allowed :=
    v_actor IS NOT NULL
    AND current_user = v_payment_owner
    AND v_intent = 'payment:'||OLD.id::text
    AND v_role IN ('owner','manager','master')
    AND OLD.paid IS FALSE
    AND OLD.status <> 'Отменён'
    AND OLD.payment_method IS NULL AND OLD.payment_amount IS NULL
    AND OLD.payment_received_by IS NULL AND OLD.paid_at IS NULL AND OLD.paid_by IS NULL
    AND (v_role <> 'master' OR
      (OLD.assigned_user_id = v_actor AND OLD.status IN ('В работе','Выполнен')))
    AND v_structural_same
    AND NEW.paid IS TRUE AND NEW.status = 'Выполнен'
    AND NEW.completed_at IS NOT NULL
    AND NEW.price IS NOT NULL AND NEW.price > 0 AND NEW.price <= 10000000
    AND NEW.payment_method IN ('cash','card')
    AND NEW.payment_amount = NEW.price+NEW.travel_amount
    AND NEW.payment_received_by =
      CASE WHEN v_role='master' THEN 'master' ELSE 'company' END
    AND NEW.paid_at IS NOT NULL AND NEW.paid_by = v_actor;

  IF OLD.paid IS TRUE OR OLD.payment_method IS NOT NULL
    OR OLD.payment_amount IS NOT NULL OR OLD.payment_received_by IS NOT NULL
    OR OLD.paid_at IS NOT NULL OR OLD.paid_by IS NOT NULL THEN
    -- The scoped refund RPC records evidence before changing the status.
    -- Keep the original payment, assignment, price and completion immutable.
    IF current_user=v_refund_owner AND v_actor IS NOT NULL AND v_role='owner'
      AND v_intent='refund-v3:'||OLD.id::text AND v_structural_same
      AND OLD.paid IS TRUE AND OLD.status='Выполнен' AND NEW.status='Отменён'
      AND ROW(NEW.price,NEW.paid,NEW.completed_at,NEW.payment_method,NEW.payment_amount,
              NEW.payment_received_by,NEW.paid_at,NEW.paid_by)
       IS NOT DISTINCT FROM ROW(OLD.price,OLD.paid,OLD.completed_at,OLD.payment_method,OLD.payment_amount,
                                OLD.payment_received_by,OLD.paid_at,OLD.paid_by)
    THEN
      IF EXISTS (SELECT 1 FROM private.rabota_payroll_refunds_v3 r
        WHERE r.order_id=OLD.id AND r.refunded_by=v_actor AND r.amount=OLD.payment_amount) THEN
        RETURN NEW;
      END IF;
    END IF;

    IF NOT v_structural_same
      OR NEW.price IS DISTINCT FROM OLD.price
      OR NEW.paid IS DISTINCT FROM OLD.paid
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.travel_taken IS DISTINCT FROM OLD.travel_taken
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.payment_amount IS DISTINCT FROM OLD.payment_amount
      OR NEW.payment_received_by IS DISTINCT FROM OLD.payment_received_by
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
      OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
    THEN
      RAISE EXCEPTION 'Оплаченный заказ защищён от редактирования'
        USING ERRCODE = '23514';
    END IF;
    -- A technical updated_at refresh alone remains supported.
    RETURN NEW;
  END IF;

  IF NEW.paid IS TRUE OR NEW.payment_method IS NOT NULL
    OR NEW.payment_amount IS NOT NULL OR NEW.payment_received_by IS NOT NULL
    OR NEW.paid_at IS NOT NULL OR NEW.paid_by IS NOT NULL THEN
    IF NOT COALESCE(v_payment_allowed,FALSE) THEN
      RAISE EXCEPTION 'Прямое изменение оплаты запрещено: используйте RPC'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE FUNCTION private.rabota_payroll_activate_v3(
  p_master_user_id uuid, p_approved_by uuid, p_backup_reference text
) RETURNS timestamptz
LANGUAGE plpgsql
SET search_path TO ''
AS $activate$
DECLARE
  v_cutoff timestamptz;
BEGIN
  IF p_backup_reference IS NULL OR length(btrim(p_backup_reference)) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'Укажите ссылку на проверенную резервную копию' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rabota_members WHERE user_id=p_approved_by AND active AND role='owner'
  ) THEN
    RAISE EXCEPTION 'Сверку должен подтвердить активный владелец' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.rabota_members
  WHERE user_id=p_master_user_id AND active AND role='master'
    AND lower(btrim(master_name))='рауль'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Не найден активный мастер Рауль' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM private.rabota_payroll_policy_v3) THEN
    RAISE EXCEPTION 'Правила начислений уже активированы' USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rabota_orders o
    LEFT JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=o.id
    WHERE o.assigned_user_id=p_master_user_id AND o.paid AND o.status='Выполнен'
      AND (e.master_user_id IS DISTINCT FROM p_master_user_id
        OR e.rule_version IS DISTINCT FROM 'legacy_verified'
        OR e.paid_amount IS DISTINCT FROM o.price
        OR (o.payment_amount IS NOT NULL AND e.paid_amount IS DISTINCT FROM o.payment_amount))
  ) OR EXISTS (
    SELECT 1 FROM private.rabota_payroll_earnings_v3 e
    JOIN public.rabota_orders o ON o.id=e.order_id
    WHERE e.master_user_id=p_master_user_id
      AND (o.assigned_user_id IS DISTINCT FROM p_master_user_id OR o.paid IS NOT TRUE OR o.status<>'Выполнен')
  ) THEN
    RAISE EXCEPTION 'Не подтверждены полные оплаты и начисления по всем прежним выполненным заказам'
      USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h
    JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=h.order_id
    JOIN public.rabota_orders o ON o.id=h.order_id
    WHERE h.verified_by IS DISTINCT FROM p_approved_by
       OR e.master_user_id IS DISTINCT FROM p_master_user_id
       OR e.rule_version IS DISTINCT FROM 'legacy_verified'
       OR o.assigned_user_id IS DISTINCT FROM p_master_user_id
       OR (h.cash_on_hold AND (
         o.payment_method IS DISTINCT FROM 'cash' OR o.payment_received_by IS DISTINCT FROM 'master'
         OR EXISTS(SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=o.id)
         OR EXISTS(SELECT 1 FROM private.rabota_payroll_cash_review_v3 r WHERE r.order_id=o.id)
       ))
  ) THEN
    RAISE EXCEPTION 'Спорная операция не совпадает с подтверждённым заказом или сверкой наличных'
      USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rabota_finance_operations f
    LEFT JOIN private.rabota_payroll_payout_review_v3 r ON r.operation_id=f.id
    WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
      AND f.kind IN ('raul_payout','timur_payout')
      AND (r.operation_id IS NULL OR r.credited_amount>f.amount)
  ) THEN
    RAISE EXCEPTION 'Не подтверждено, какие прежние выплаты получил Рауль' USING ERRCODE='23514';
  END IF;
  -- Reject invalid types and order references before converting monetary values.
  IF EXISTS (
    SELECT 1 FROM private.rabota_payroll_payout_review_v3 r
    JOIN public.rabota_finance_operations f ON f.id=r.operation_id
    CROSS JOIN LATERAL jsonb_each(r.allocations) a
    LEFT JOIN private.rabota_payroll_earnings_v3 e ON e.order_id::text=a.key
    WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
      AND (jsonb_typeof(a.value)<>'number' OR e.master_user_id IS DISTINCT FROM p_master_user_id
           OR (f.order_id IS NOT NULL AND e.order_id IS DISTINCT FROM f.order_id))
  ) THEN
    RAISE EXCEPTION 'Неверная сверка прежних выплат по заказам' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.rabota_payroll_payout_review_v3 r
    JOIN public.rabota_finance_operations f ON f.id=r.operation_id
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(value::numeric),0) AS total,
             bool_and(value::numeric>0 AND value::numeric=round(value::numeric,2)) AS valid
      FROM jsonb_each(r.allocations)
    ) a
    WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
      AND (a.total<>r.credited_amount OR a.valid IS FALSE)
  ) OR EXISTS (
    SELECT 1 FROM private.rabota_payroll_payout_review_v3 r
    JOIN public.rabota_finance_operations f ON f.id=r.operation_id
    CROSS JOIN LATERAL jsonb_each(r.allocations) a
    JOIN private.rabota_payroll_earnings_v3 e ON e.order_id::text=a.key
    WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
    GROUP BY e.order_id,e.earned_amount HAVING sum(a.value::numeric)>e.earned_amount
  ) THEN
    RAISE EXCEPTION 'Сверка прежних выплат не сходится с начислениями по заказам' USING ERRCODE='23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rabota_orders o
    JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=o.id
    LEFT JOIN private.rabota_payroll_cash_review_v3 r ON r.order_id=o.id
    LEFT JOIN private.rabota_payroll_cutover_holds_v3 h ON h.order_id=o.id AND h.cash_on_hold
    WHERE o.assigned_user_id=p_master_user_id AND o.paid AND o.status='Выполнен'
      AND o.payment_method='cash' AND o.payment_received_by='master'
      AND NOT EXISTS(SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=o.id)
      AND h.order_id IS NULL AND (r.order_id IS NULL OR r.held_amount>e.paid_amount)
  ) THEN
    RAISE EXCEPTION 'Не подтверждены прежние суммы наличных у мастера' USING ERRCODE='23514';
  END IF;

  v_cutoff:=clock_timestamp();
  INSERT INTO private.rabota_payroll_policy_v3(master_user_id,activated_at,approved_by,backup_reference)
  VALUES(p_master_user_id,v_cutoff,p_approved_by,btrim(p_backup_reference));

  -- Carry forward only the individually confirmed amount still held. Old
  -- transfers/receipts and payout rows are never synthesized or overwritten.
  INSERT INTO public.rabota_cash_collections(
    order_id,master_user_id,gross,raul_amount,timur_amount,company_amount,payroll_separate
  )
  SELECT o.id,p_master_user_id,r.held_amount,0,0,r.held_amount,true
  FROM private.rabota_payroll_cash_review_v3 r
  JOIN public.rabota_orders o ON o.id=r.order_id
  WHERE o.assigned_user_id=p_master_user_id AND o.paid AND o.status='Выполнен'
    AND o.payment_method='cash' AND o.payment_received_by='master' AND r.held_amount>0
    AND NOT EXISTS (SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h
                    WHERE h.order_id=o.id AND h.cash_on_hold)
    AND NOT EXISTS(SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id=o.id);
  RETURN v_cutoff;
END;
$activate$;
CREATE FUNCTION private.rabota_payroll_operations_v3(p_master_user_id uuid, p_activated_at timestamptz)
RETURNS TABLE(
  id uuid, order_id uuid, amount numeric, created_at timestamptz,
  payment_method text, note text, kind text, recorded_amount numeric, held_amount numeric
)
LANGUAGE sql STABLE SET search_path TO ''
AS $operations$
  SELECT f.id,f.order_id,coalesce(r.credited_amount-hold.amount,f.amount),
    f.created_at,f.payment_method,f.note,
    CASE WHEN r.operation_id IS NULL THEN 'v3'
         WHEN f.kind='timur_payout' THEN 'legacy_on_behalf'
         ELSE 'legacy' END,
    f.amount,hold.amount
  FROM public.rabota_finance_operations f
  LEFT JOIN private.rabota_payroll_payout_review_v3 r ON r.operation_id=f.id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(a.value::numeric),0) AS amount
    FROM jsonb_each(r.allocations) a
    JOIN private.rabota_payroll_cutover_holds_v3 h
      ON h.order_id::text=a.key AND h.payroll_on_hold
  ) hold
  WHERE f.master_user_id=p_master_user_id AND f.voided_at IS NULL
    AND f.kind IN ('raul_payout','timur_payout')
    AND (r.credited_amount>hold.amount OR (r.operation_id IS NULL AND f.kind='raul_payout'
                                          AND f.created_at>=p_activated_at))
$operations$;
CREATE OR REPLACE FUNCTION private.rabota_payroll_totals_v3(p_master_user_id uuid, p_activated_at timestamptz)
RETURNS TABLE(earned numeric, paid numeric)
LANGUAGE sql STABLE SET search_path TO ''
AS $totals$
  SELECT
    (SELECT coalesce(sum(e.earned_amount),0)
     FROM private.rabota_payroll_earnings_v3 e
     WHERE e.master_user_id=p_master_user_id
       AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h
                      WHERE h.order_id=e.order_id AND h.payroll_on_hold)
       AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_refunds_v3 r WHERE r.order_id=e.order_id))
    + (SELECT coalesce(sum(e.delta),0) FROM private.rabota_payroll_travel_events e
       WHERE e.master_user_id=p_master_user_id),
    (SELECT coalesce(sum(p.amount),0) FROM private.rabota_payroll_operations_v3(p_master_user_id,p_activated_at) p)
$totals$;
CREATE OR REPLACE FUNCTION private.rabota_record_assigned_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.assigned_user_id is null or new.status in ('Отменён','Выполнен') then return new; end if;
  if tg_op='INSERT' or old.assigned_user_id is distinct from new.assigned_user_id then
    insert into public.rabota_order_notifications(recipient_id,order_id,kind,client_name,visit_date,visit_time)
    values(new.assigned_user_id,new.id,'assigned',coalesce(new.name,''),new.appointment_date,new.appointment_time);
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION private.rabota_require_expense_request_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.kind = 'expense' AND NEW.request_id IS NULL THEN
    RAISE EXCEPTION 'Обновите приложение перед записью расхода'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION private.rabota_reschedule_block_minutes(p_radiators integer, p_floor_loops integer, p_address text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(nullif(
    CASE WHEN p_radiators BETWEEN 0 AND 500 THEN p_radiators*20 ELSE 0 END
    + CASE WHEN p_floor_loops BETWEEN 0 AND 500 THEN p_floor_loops*10 ELSE 0 END,0),180)
    + CASE WHEN coalesce(p_address,'') ~* $pattern$(^|[[:space:],.;])(за[[:space:]]+город(ом)?|вне[[:space:]]+города|с(ело)?\.[[:space:]]*\S+|село[[:space:]]+|снт[[:space:]]+|пос(елок|ёлок)?\.[[:space:]]*\S+|пос[её]лок[[:space:]]+|ст(аница)?\.[[:space:]]*\S+|станица[[:space:]]+|((верхний[[:space:]]+)?фиагдон|гизель|беслан|ардон|чермен)($|[[:space:],.;]))$pattern$
      THEN 60 ELSE 30 END
$function$;
CREATE OR REPLACE FUNCTION private.rabota_reschedule_event_json(p_event private.rabota_order_reschedule_events)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id',p_event.id,'previous_date',p_event.previous_date,
    'previous_time',left(p_event.previous_time::text,5),
    'new_date',p_event.new_date,'new_time',left(p_event.new_time::text,5),
    'moved_at',p_event.moved_at,'actor_id',p_event.actor_id,'actor_name',p_event.actor_name
  )
$function$;
CREATE OR REPLACE FUNCTION private.rabota_reschedule_order(p_order_id uuid, p_request_id uuid, p_expected_updated_at timestamp with time zone, p_appointment_date date, p_appointment_time time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION private.rabota_stamp_order_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- A late or fast client clock cannot move the revision back. PostgreSQL
  -- rechecks a conditional UPDATE after waiting for a competing row writer.
  IF TG_OP = 'UPDATE' AND OLD.updated_at IS NOT NULL THEN
    NEW.updated_at := GREATEST(pg_catalog.clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  ELSE
    NEW.updated_at := pg_catalog.clock_timestamp();
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_ai_confirm_order(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid:=auth.uid();
 d public.rabota_ai_order_drafts%rowtype;
 old public.rabota_orders%rowtype;
 result_id uuid;
 other_name text;
begin
 if v_user is null or not exists(
  select 1 from public.rabota_members m where m.user_id=v_user and m.role='owner' and m.active
 ) then raise exception 'Подтверждение доступно только владельцу' using errcode='42501'; end if;
 select * into d from public.rabota_ai_order_drafts
  where id=p_draft_id and owner_id=v_user for update;
 if d.id is null then raise exception 'Предпросмотр не найден'; end if;
 if d.state='applied' then
  return jsonb_build_object('ok',true,'already_applied',true,'order_id',d.result_order_id,
   'name',d.client_name,'date',d.appointment_date,'time',to_char(d.appointment_time,'HH24:MI'));
 end if;
 if d.expires_at<now() then raise exception 'Подтверждение устарело. Подготовьте заявку ещё раз'; end if;
 if (d.appointment_date+d.appointment_time) <= (now() at time zone 'Europe/Moscow')
 then raise exception 'Время уже прошло. Подготовьте новую заявку'; end if;
 if not exists(select 1 from public.rabota_members m where m.user_id=d.master_user_id
   and m.role='master' and m.active and m.master_name=d.master_name)
 then raise exception 'Мастер больше не активен. Подготовьте заявку снова'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('rabota_ai_day_'||d.appointment_date::text));
 if d.action='move' then
  select * into old from public.rabota_orders where id=d.target_order_id for update;
  if old.id is null or old.updated_at is distinct from d.expected_updated_at or
     old.status in ('Отменён','Выполнен') then
   raise exception 'Заказ изменился после предпросмотра. Проверьте заново'; end if;
 end if;
 select o.name into other_name from public.rabota_orders o
 where o.id is distinct from d.target_order_id and o.status<>'Отменён'
  and o.appointment_date=d.appointment_date
  and (o.appointment_time=d.appointment_time or
   (lower(btrim(o.master))=lower(btrim(d.master_name)) and o.appointment_time is not null
    and abs(extract(epoch from (o.appointment_time-d.appointment_time)))<12000))
 limit 1;
 if other_name is not null then raise exception 'В расписании появилась конфликтующая запись: %. Предпросмотр устарел',other_name; end if;
 if d.action='create' then
  if exists(select 1 from public.rabota_orders o where o.appointment_date=d.appointment_date
   and o.status<>'Отменён'
   and regexp_replace(o.phone,'[^0-9]','','g')=regexp_replace(d.client_phone,'[^0-9]','','g'))
   then raise exception 'У клиента уже появилась заявка на эту дату. Проверьте дубликат'; end if;
  insert into public.rabota_orders(
   name,phone,address,master,assigned_user_id,appointment_date,appointment_time,price,
   details,status,paid,created_by,updated_at
  ) values (
   d.client_name,d.client_phone,d.client_address,d.master_name,d.master_user_id,
   d.appointment_date,d.appointment_time,d.price,d.details,'Записан',false,v_user,now()
  ) returning id into result_id;
 elsif d.action='move' then
  update public.rabota_orders set appointment_date=d.appointment_date,
   appointment_time=d.appointment_time,master=d.master_name,
   assigned_user_id=d.master_user_id,updated_at=now()
  where id=d.target_order_id returning id into result_id;
 else raise exception 'Неизвестное действие'; end if;
 update public.rabota_ai_order_drafts set state='applied',result_order_id=result_id
  where id=d.id;
 return jsonb_build_object('ok',true,'already_applied',false,'order_id',result_id,
  'name',d.client_name,'date',d.appointment_date,'time',to_char(d.appointment_time,'HH24:MI'),
  'master',d.master_name);
end;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_ai_confirm_order_v2(p_draft_id uuid, p_allow_tight_schedule boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid:=auth.uid();
 d public.rabota_ai_order_drafts%rowtype;
 old public.rabota_orders%rowtype;
 result_id uuid;
 other_name text;
 v_conflict text;
 v_day_count integer;
begin
 if v_user is null or not exists(
  select 1 from public.rabota_members m where m.user_id=v_user and m.role='owner' and m.active
 ) then raise exception 'Подтверждение доступно только владельцу' using errcode='42501'; end if;
 select * into d from public.rabota_ai_order_drafts
  where id=p_draft_id and owner_id=v_user for update;
 if d.id is null then raise exception 'Предпросмотр не найден'; end if;
 if d.state='applied' then
  return jsonb_build_object('ok',true,'already_applied',true,'order_id',d.result_order_id,
   'name',d.client_name,'date',d.appointment_date,'time',to_char(d.appointment_time,'HH24:MI'));
 end if;
 if d.expires_at<now() then raise exception 'Подтверждение устарело. Подготовьте заявку ещё раз'; end if;
 if (d.appointment_date+d.appointment_time) <= (now() at time zone 'Europe/Moscow')
 then raise exception 'Время уже прошло. Подготовьте новую заявку'; end if;
 if not exists(select 1 from public.rabota_members m where m.user_id=d.master_user_id
   and m.role='master' and m.active and m.master_name=d.master_name)
 then raise exception 'Мастер больше не активен. Подготовьте заявку снова'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('rabota_ai_day_'||d.appointment_date::text));
 if d.action='move' then
  select * into old from public.rabota_orders where id=d.target_order_id for update;
  if old.id is null or old.updated_at is distinct from d.expected_updated_at or
     old.status in ('Отменён','Выполнен') then
   raise exception 'Заказ изменился после предпросмотра. Проверьте заново'; end if;
 end if;
 select o.name into other_name from public.rabota_orders o
 where o.id is distinct from d.target_order_id and o.status<>'Отменён'
   and o.appointment_date=d.appointment_date and o.appointment_time=d.appointment_time
 limit 1;
 if other_name is not null then raise exception 'Точное время уже занято: %',other_name; end if;
 select count(*) into v_day_count from public.rabota_orders o
 where o.id is distinct from d.target_order_id and o.status<>'Отменён'
   and o.appointment_date=d.appointment_date and lower(btrim(o.master))=lower(btrim(d.master_name));
 -- daily order count is intentionally unlimited; exact slots remain protected
 select o.name||' ('||to_char(o.appointment_time,'HH24:MI')||')' into v_conflict from public.rabota_orders o
 where o.id is distinct from d.target_order_id and o.status<>'Отменён'
   and o.appointment_date=d.appointment_date and lower(btrim(o.master))=lower(btrim(d.master_name))
   and o.appointment_time is not null and abs(extract(epoch from (o.appointment_time-d.appointment_time)))<12000
 limit 1;
 if v_conflict is not null and not coalesce(p_allow_tight_schedule,false) then
  raise exception 'Плотная запись рядом с %. Требуется отдельное разрешение владельца',v_conflict;
 end if;
 if d.action='create' then
  if exists(select 1 from public.rabota_orders o where o.appointment_date=d.appointment_date
   and o.status<>'Отменён'
   and regexp_replace(o.phone,'[^0-9]','','g')=regexp_replace(d.client_phone,'[^0-9]','','g'))
   then raise exception 'У клиента уже появилась заявка на эту дату. Проверьте дубликат'; end if;
  insert into public.rabota_orders(
   name,phone,address,master,assigned_user_id,appointment_date,appointment_time,price,
   details,radiators,floor_loops,status,paid,created_by,updated_at
  ) values (
   d.client_name,d.client_phone,d.client_address,d.master_name,d.master_user_id,
   d.appointment_date,d.appointment_time,d.price,d.details,d.radiators,d.floor_loops,'Записан',false,v_user,now()
  ) returning id into result_id;
 elsif d.action='move' then
  update public.rabota_orders set appointment_date=d.appointment_date,
   appointment_time=d.appointment_time,master=d.master_name,
   assigned_user_id=d.master_user_id,updated_at=now()
  where id=d.target_order_id returning id into result_id;
 else raise exception 'Неизвестное действие'; end if;
 update public.rabota_ai_order_drafts set state='applied',result_order_id=result_id
  where id=d.id;
 return jsonb_build_object('ok',true,'already_applied',false,'order_id',result_id,
  'name',d.client_name,'date',d.appointment_date,'time',to_char(d.appointment_time,'HH24:MI'),
  'master',d.master_name,'schedule_warning',v_conflict);
end;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_ai_prepare_order(p_action text, p_client_name text, p_date text, p_time text, p_master text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_price numeric DEFAULT NULL::numeric, p_details text DEFAULT NULL::text, p_original_date text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid := auth.uid();
 v_date date;
 v_time time;
 v_name text := left(btrim(coalesce(p_client_name,'')),100);
 v_action text := lower(btrim(coalesce(p_action,'')));
 v_master text;
 v_master_id uuid;
 v_phone text := btrim(coalesce(p_phone,''));
 v_old public.rabota_orders%rowtype;
 v_count int := 0;
 v_order_id uuid;
 v_draft uuid;
 v_original_date date;
 v_conflict text;
begin
 if v_user is null or not exists(
  select 1 from public.rabota_members m where m.user_id=v_user and m.role='owner' and m.active
 ) then raise exception 'ИИ-действия доступны только владельцу' using errcode='42501'; end if;
 if v_action not in ('create','move') then raise exception 'Допустимы только создание и перенос'; end if;
 if length(v_name)<2 then raise exception 'Укажите имя клиента'; end if;
 if p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' or p_time is null or p_time !~ '^([01]\d|2[0-3]):[0-5]\d$'
 then raise exception 'Нужна точная дата ГГГГ-ММ-ДД и время ЧЧ:ММ (Москва)'; end if;
 v_date:=p_date::date; v_time:=p_time::time;
 if (v_date+v_time) <= (now() at time zone 'Europe/Moscow')
 then raise exception 'Нельзя записать клиента на уже прошедшее московское время'; end if;
 if v_date > (now() at time zone 'Europe/Moscow')::date + 365
 then raise exception 'Запись дальше одного года требует ручной проверки'; end if;
 if p_original_date is not null then
  if p_original_date !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Неясная исходная дата'; end if;
  v_original_date:=p_original_date::date;
 end if;
 if v_action='move' then
  select count(*),(array_agg(o.id order by o.created_at desc))[1] into v_count,v_order_id
  from public.rabota_orders o where lower(btrim(o.name))=lower(v_name)
   and o.status not in ('Отменён','Выполнен')
   and (v_original_date is null or o.appointment_date=v_original_date);
  if v_count=0 then
   select count(*),(array_agg(o.id order by o.created_at desc))[1] into v_count,v_order_id
   from public.rabota_orders o where lower(o.name) like '%'||
       replace(replace(replace(lower(v_name),'!','!!'),'%','!%'),'_','!_')||'%' escape '!'
     and o.status not in ('Отменён','Выполнен')
     and (v_original_date is null or o.appointment_date=v_original_date);
  end if;
  if v_count=0 then raise exception 'Активный заказ этого клиента не найден. Уточните имя или дату'; end if;
  if v_count>1 then raise exception 'Найдено несколько заказов клиента. Уточните исходную дату'; end if;
  select * into v_old from public.rabota_orders where id=v_order_id;
  if v_old.id is null then raise exception 'Заказ для переноса не найден'; end if;
  v_master:=coalesce(nullif(btrim(p_master),''),v_old.master);
  v_phone:=v_old.phone;
 else
  v_master:=btrim(coalesce(p_master,''));
  if v_phone !~ '^[+0-9 ()-]+$' or length(regexp_replace(v_phone,'[^0-9]','','g')) not between 10 and 11
  then raise exception 'Для новой заявки нужен корректный номер телефона (10–11 цифр)'; end if;
 end if;
 if length(v_master)=0 then raise exception 'Укажите мастера'; end if;
 select m.user_id,m.master_name into v_master_id,v_master
 from public.rabota_members m
 where m.active and m.role='master' and lower(btrim(m.master_name))=lower(btrim(v_master))
 limit 1;
 if v_master_id is null then raise exception 'Мастер не найден среди активных сотрудников. Уточните имя'; end if;
 if p_price is not null and (p_price<0 or p_price>10000000) then raise exception 'Некорректная цена'; end if;
 if v_action='create' and exists(
  select 1 from public.rabota_orders o where o.appointment_date=v_date and o.status<>'Отменён'
    and regexp_replace(o.phone,'[^0-9]','','g')=regexp_replace(v_phone,'[^0-9]','','g')
 ) then raise exception 'У этого номера уже есть запись на выбранный день. Проверьте дубликат'; end if;
 if exists(select 1 from public.rabota_orders o
  where o.id is distinct from v_order_id and o.status<>'Отменён' and o.appointment_date=v_date
    and o.appointment_time=v_time)
 then raise exception 'В это время уже есть запись другого клиента'; end if;
 select o.name||' ('||to_char(o.appointment_time,'HH24:MI')||')' into v_conflict
 from public.rabota_orders o
 where o.id is distinct from v_order_id and o.status<>'Отменён'
   and o.appointment_date=v_date and lower(btrim(o.master))=lower(btrim(v_master))
   and o.appointment_time is not null
   and abs(extract(epoch from (o.appointment_time-v_time)))<12000
 limit 1;
 if v_conflict is not null then raise exception 'У мастера близкая запись: %. Для исключений используйте ручной календарь', v_conflict; end if;
 insert into public.rabota_ai_order_drafts(
  owner_id,action,target_order_id,expected_updated_at,client_name,client_phone,client_address,
  appointment_date,appointment_time,master_name,master_user_id,price,details,old_summary
 ) values (
  v_user,v_action,v_order_id,case when v_action='move' then v_old.updated_at else null end,
  case when v_action='move' then v_old.name else v_name end,v_phone,
  case when v_action='move' then v_old.address else left(btrim(coalesce(p_address,'')),500) end,
  v_date,v_time,v_master,v_master_id,
  case when v_action='move' then v_old.price else p_price end,
  case when v_action='move' then v_old.details else left(btrim(coalesce(p_details,'')),1500) end,
  case when v_action='move' then jsonb_build_object(
    'date',v_old.appointment_date,'time',to_char(v_old.appointment_time,'HH24:MI'),
    'master',v_old.master,'status',v_old.status) else null end
 ) returning id into v_draft;
 return jsonb_build_object('draft_id',v_draft,'action',v_action,
  'name',case when v_action='move' then v_old.name else v_name end,
  'date',v_date,'time',to_char(v_time,'HH24:MI'),'master',v_master,
  'price',case when v_action='move' then v_old.price else p_price end,
  'address',case when v_action='move' then v_old.address else left(btrim(coalesce(p_address,'')),500) end,
  'phone',v_phone,
  'old',case when v_action='move' then jsonb_build_object(
    'date',v_old.appointment_date,'time',to_char(v_old.appointment_time,'HH24:MI'),
    'master',v_old.master) else null end,
  'expires_in_minutes',15);
end;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_ai_prepare_order_v2(p_action text, p_client_name text, p_date text, p_time text, p_master text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_price numeric DEFAULT NULL::numeric, p_details text DEFAULT NULL::text, p_original_date text DEFAULT NULL::text, p_radiators integer DEFAULT NULL::integer, p_floor_loops integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_user uuid := auth.uid();
 v_date date;
 v_time time;
 v_name text := left(btrim(coalesce(p_client_name,'')),100);
 v_action text := lower(btrim(coalesce(p_action,'')));
 v_master text;
 v_master_id uuid;
 v_phone text := btrim(coalesce(p_phone,''));
 v_old public.rabota_orders%rowtype;
 v_count int := 0;
 v_order_id uuid;
 v_draft uuid;
 v_original_date date;
 v_conflict text;
 v_day_count integer;
begin
 if v_user is null or not exists(
  select 1 from public.rabota_members m where m.user_id=v_user and m.role='owner' and m.active
 ) then raise exception 'ИИ-действия доступны только владельцу' using errcode='42501'; end if;
 if v_action not in ('create','move') then raise exception 'Допустимы только создание и перенос'; end if;
 if length(v_name)<2 then raise exception 'Укажите имя клиента'; end if;
 if p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' or p_time is null or p_time !~ '^([01]\d|2[0-3]):[0-5]\d$'
 then raise exception 'Нужна точная дата ГГГГ-ММ-ДД и время ЧЧ:ММ (Москва)'; end if;
 v_date:=p_date::date; v_time:=p_time::time;
 if (v_date+v_time) <= (now() at time zone 'Europe/Moscow')
 then raise exception 'Нельзя записать клиента на уже прошедшее московское время'; end if;
 if v_date > (now() at time zone 'Europe/Moscow')::date + 365
 then raise exception 'Запись дальше одного года требует ручной проверки'; end if;
 if p_original_date is not null then
  if p_original_date !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Неясная исходная дата'; end if;
  v_original_date:=p_original_date::date;
 end if;
 if v_action='move' then
  select count(*),(array_agg(o.id order by o.created_at desc))[1] into v_count,v_order_id
  from public.rabota_orders o where lower(btrim(o.name))=lower(v_name)
   and o.status not in ('Отменён','Выполнен')
   and (v_original_date is null or o.appointment_date=v_original_date);
  if v_count=0 then
   select count(*),(array_agg(o.id order by o.created_at desc))[1] into v_count,v_order_id
   from public.rabota_orders o where lower(o.name) like '%'||
       replace(replace(replace(lower(v_name),'!','!!'),'%','!%'),'_','!_')||'%' escape '!'
     and o.status not in ('Отменён','Выполнен')
     and (v_original_date is null or o.appointment_date=v_original_date);
  end if;
  if v_count=0 then raise exception 'Активный заказ этого клиента не найден. Уточните имя или дату'; end if;
  if v_count>1 then raise exception 'Найдено несколько заказов клиента. Уточните исходную дату'; end if;
  select * into v_old from public.rabota_orders where id=v_order_id;
  if v_old.id is null then raise exception 'Заказ для переноса не найден'; end if;
  v_master:=coalesce(nullif(btrim(p_master),''),v_old.master);
  v_phone:=v_old.phone;
 else
  v_master:=btrim(coalesce(p_master,''));
  if v_phone !~ '^[+0-9 ()-]+$' or length(regexp_replace(v_phone,'[^0-9]','','g')) not between 10 and 11
  then raise exception 'Для новой заявки нужен корректный номер телефона (10–11 цифр)'; end if;
 end if;
 if length(v_master)=0 then raise exception 'Укажите мастера'; end if;
 select m.user_id,m.master_name into v_master_id,v_master
 from public.rabota_members m
 where m.active and m.role='master' and lower(btrim(m.master_name))=lower(btrim(v_master))
 limit 1;
 if v_master_id is null then raise exception 'Мастер не найден среди активных сотрудников. Уточните имя'; end if;
 if p_price is not null and (p_price<0 or p_price>10000000) then raise exception 'Некорректная цена'; end if;
 if p_radiators is not null and (p_radiators<0 or p_radiators>300) then raise exception 'Недопустимое количество радиаторов'; end if;
 if p_floor_loops is not null and (p_floor_loops<0 or p_floor_loops>300) then raise exception 'Недопустимое количество контуров'; end if;
 if v_action='create' and exists(
  select 1 from public.rabota_orders o where o.appointment_date=v_date and o.status<>'Отменён'
    and regexp_replace(o.phone,'[^0-9]','','g')=regexp_replace(v_phone,'[^0-9]','','g')
 ) then raise exception 'У этого номера уже есть запись на выбранный день. Проверьте дубликат'; end if;
 if exists(select 1 from public.rabota_orders o
  where o.id is distinct from v_order_id and o.status<>'Отменён' and o.appointment_date=v_date
    and o.appointment_time=v_time)
 then raise exception 'В это время уже есть запись другого клиента'; end if;
 select count(*) into v_day_count from public.rabota_orders o where o.id is distinct from v_order_id
  and o.appointment_date=v_date and o.status<>'Отменён' and lower(btrim(o.master))=lower(btrim(v_master));
 -- daily order count is intentionally unlimited; exact slots remain protected
 select o.name||' ('||to_char(o.appointment_time,'HH24:MI')||')' into v_conflict
 from public.rabota_orders o
 where o.id is distinct from v_order_id and o.status<>'Отменён'
   and o.appointment_date=v_date and lower(btrim(o.master))=lower(btrim(v_master))
   and o.appointment_time is not null
   and abs(extract(epoch from (o.appointment_time-v_time)))<12000
 limit 1;
 -- Вместо автоматического сохранения плотной записи показываем владельцу предупреждение.
 insert into public.rabota_ai_order_drafts(
  owner_id,action,target_order_id,expected_updated_at,client_name,client_phone,client_address,
  appointment_date,appointment_time,master_name,master_user_id,price,details,old_summary,radiators,floor_loops
 ) values (
  v_user,v_action,v_order_id,case when v_action='move' then v_old.updated_at else null end,
  case when v_action='move' then v_old.name else v_name end,v_phone,
  case when v_action='move' then v_old.address else left(btrim(coalesce(p_address,'')),500) end,
  v_date,v_time,v_master,v_master_id,
  case when v_action='move' then v_old.price else p_price end,
  case when v_action='move' then v_old.details else left(btrim(coalesce(p_details,'')),1500) end,
  case when v_action='move' then jsonb_build_object(
    'date',v_old.appointment_date,'time',to_char(v_old.appointment_time,'HH24:MI'),
    'master',v_old.master,'status',v_old.status) else null end,
  case when v_action='move' then v_old.radiators else p_radiators end,
  case when v_action='move' then v_old.floor_loops else p_floor_loops end
 ) returning id into v_draft;
 return jsonb_build_object('draft_id',v_draft,'action',v_action,
  'name',case when v_action='move' then v_old.name else v_name end,
  'date',v_date,'time',to_char(v_time,'HH24:MI'),'master',v_master,
  'price',case when v_action='move' then v_old.price else p_price end,
  'address',case when v_action='move' then v_old.address else left(btrim(coalesce(p_address,'')),500) end,
  'phone',v_phone,
  'details',case when v_action='move' then v_old.details else left(btrim(coalesce(p_details,'')),1500) end,
  'radiators',case when v_action='move' then v_old.radiators else p_radiators end,
  'floor_loops',case when v_action='move' then v_old.floor_loops else p_floor_loops end,
  'schedule_warning',case when v_conflict is not null then 'Плотная запись: рядом '||v_conflict||'. Требуется отдельное согласие владельца.' else null end,
  'old',case when v_action='move' then jsonb_build_object(
    'date',v_old.appointment_date,'time',to_char(v_old.appointment_time,'HH24:MI'),
    'master',v_old.master) else null end,
  'expires_in_minutes',15);
end;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_ai_prepare_order_v3(p_action text, p_client_name text, p_date text, p_time text, p_master text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_price numeric DEFAULT NULL::numeric, p_details text DEFAULT NULL::text, p_original_date text DEFAULT NULL::text, p_radiators integer DEFAULT NULL::integer, p_floor_loops integer DEFAULT NULL::integer, p_travel_amount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_owner uuid := auth.uid();
  v_travel numeric := coalesce(p_travel_amount, 0);
  v_preview jsonb;
BEGIN
  IF v_owner IS NULL OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'ИИ-действия доступны только владельцу' USING ERRCODE = '42501';
  END IF;
  IF v_travel NOT BETWEEN 0 AND 10000000 OR v_travel <> round(v_travel, 2)
    OR (v_travel > 0 AND (lower(btrim(coalesce(p_action, ''))) <> 'create'
      OR p_price + v_travel > 10000000)) THEN
    RAISE EXCEPTION 'Укажите корректную доплату за дорогу новой заявки' USING ERRCODE = '22023';
  END IF;
  v_preview := public.rabota_ai_prepare_order_v2(p_action, p_client_name, p_date, p_time,
    p_master, p_phone, p_address, p_price, p_details, p_original_date, p_radiators, p_floor_loops);
  UPDATE public.rabota_ai_order_drafts
    SET travel_amount = v_travel
    WHERE id = (v_preview->>'draft_id')::uuid AND owner_id = v_owner AND state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Не удалось подтвердить данные предпросмотра';
  END IF;
  RETURN v_preview || jsonb_build_object('travel_amount', v_travel);
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_approve_master(p_user_id uuid, p_master_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare name_clean text := btrim(coalesce(p_master_name,''));
begin
  if (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then raise exception 'Доступ запрещён'; end if;
  if p_user_id is null or p_user_id=auth.uid() then raise exception 'Некорректный сотрудник'; end if;
  if length(name_clean) not between 1 and 100 then raise exception 'Укажите имя мастера'; end if;
  -- Never silently attach an unassigned historical paid order.
  if exists (select 1 from public.rabota_orders o
      where o.paid is true and o.assigned_user_id is null
        and lower(btrim(o.master))=lower(name_clean)) then
    raise exception 'Исторические оплаченные заказы требуют отдельной сверки'
      using errcode='23514';
  end if;
  update public.rabota_members
    set active=true, role='master', master_name=name_clean
    where user_id=p_user_id and role<>'owner';
  if not found then raise exception 'Заявка сотрудника не найдена'; end if;
  update public.rabota_orders
    set assigned_user_id=p_user_id, updated_at=now()
    where assigned_user_id is null and paid is not true
      and lower(btrim(master))=lower(name_clean)
      and not exists (select 1 from public.rabota_cash_collections c
        where c.order_id=public.rabota_orders.id);
  return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.rabota_cashbook_record_v1(p_kind text, p_amount numeric, p_from_account text, p_to_account text, p_note text, p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
  v_old public.rabota_cashbook_entries%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
BEGIN
  IF v_actor IS NULL OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Только владелец может проводить операции кассы' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('income', 'expense') THEN
    RAISE EXCEPTION 'Доступны только фактические поступления и расходы' USING ERRCODE = '23514';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Некорректная сумма' USING ERRCODE = '23514';
  END IF;
  IF p_request_id IS NULL OR length(v_note) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'Некорректные реквизиты движения кассы' USING ERRCODE = '23514';
  END IF;
  IF (
      (p_kind = 'income' AND p_from_account IS NULL AND p_to_account IN ('cash', 'card'))
      OR (p_kind = 'expense' AND p_from_account IN ('cash', 'card') AND p_to_account IS NULL)
    ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Неверное направление денег' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.rabota_cashbook_entries(kind,amount,from_account,to_account,note,request_id,created_by)
    VALUES (p_kind,p_amount,p_from_account,p_to_account,v_note,p_request_id,v_actor)
    ON CONFLICT (request_id) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO v_old FROM public.rabota_cashbook_entries WHERE request_id = p_request_id;
  IF NOT FOUND OR v_old.created_by IS DISTINCT FROM v_actor OR v_old.kind <> p_kind
    OR v_old.amount IS DISTINCT FROM p_amount OR v_old.note IS DISTINCT FROM v_note
    OR v_old.from_account IS DISTINCT FROM p_from_account OR v_old.to_account IS DISTINCT FROM p_to_account THEN
    RAISE EXCEPTION 'Идентификатор принадлежит другой операции' USING ERRCODE = '23505';
  END IF;
  RETURN v_old.id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_delete_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order public.rabota_orders%ROWTYPE;
BEGIN
  -- Caller-supplied role flags and order ownership never authorize deletion.
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.rabota_members m
    WHERE m.user_id = auth.uid() AND m.role = 'owner' AND m.active = true
  ) THEN
    RAISE EXCEPTION 'Удалять заказы может только владелец'
      USING ERRCODE='42501';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Укажите заказ для удаления' USING ERRCODE='22023';
  END IF;

  -- Lock before checking payment fields. Payment RPCs lock the same row.
  SELECT * INTO v_order
  FROM public.rabota_orders
  WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ уже удалён или не найден' USING ERRCODE='P0002';
  END IF;

  -- Legacy paid orders are protected even when no finance ledger row exists.
  IF v_order.paid IS TRUE
     OR v_order.payment_method IS NOT NULL
     OR v_order.payment_amount IS NOT NULL
     OR v_order.payment_received_by IS NOT NULL
     OR v_order.paid_at IS NOT NULL
     OR v_order.paid_by IS NOT NULL
  THEN
    RAISE EXCEPTION 'Этот заказ отмечен как оплаченный. Удаление запрещено'
      USING ERRCODE='23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rabota_finance_operations f WHERE f.order_id = p_order_id)
     OR EXISTS (SELECT 1 FROM public.rabota_cash_collections c WHERE c.order_id = p_order_id)
  THEN
    RAISE EXCEPTION 'По заказу есть финансовые операции или распределение денег. Удаление запрещено'
      USING ERRCODE='23514';
  END IF;

  -- Do not corrupt an existing AI draft/history by removing its referenced order.
  IF EXISTS (
    SELECT 1 FROM public.rabota_ai_order_drafts d
    WHERE d.target_order_id = p_order_id OR d.result_order_id = p_order_id
  ) THEN
    RAISE EXCEPTION 'Заказ связан с действием ИИ. Для безопасности удаление запрещено'
      USING ERRCODE='23503';
  END IF;

  DELETE FROM public.rabota_orders WHERE id=p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заказ не удалось удалить' USING ERRCODE='P0002';
  END IF;
  -- Associated non-financial order notifications are removed via existing FK CASCADE.
  RETURN pg_catalog.jsonb_build_object('ok',true,'order_id',p_order_id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_finance_record(p_kind text, p_amount numeric, p_master_user_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_accrued numeric(14,2);
  v_already numeric(14,2);
  v_kind text := btrim(coalesce(p_kind,''));
  v_note text := btrim(coalesce(p_note,''));
begin
  if (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then
    raise exception 'Только администратор может проводить финансовые операции';
  end if;
  if v_kind not in ('raul_payout','timur_payout','expense') then
    raise exception 'Неверный тип операции';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>10000000 or round(p_amount,2)<>p_amount then
    raise exception 'Укажите корректную сумму';
  end if;
  if char_length(v_note)>240 then
    raise exception 'Примечание слишком длинное';
  end if;
  if v_kind <> 'expense' then
    if p_master_user_id is null then
      raise exception 'Не выбран мастер';
    end if;
    perform 1 from public.rabota_members m
      where m.user_id=p_master_user_id and m.role='master'
        and m.active=true and lower(btrim(m.master_name))='рауль'
      for update;
    if not found then raise exception 'Подключённый мастер Рауль не найден'; end if;

    if exists (select 1 from private.rabota_payroll_policy_v3) then
      raise exception 'Откройте новый раздел зарплаты для выплаты' using errcode='23514';
    end if;
    if v_kind='raul_payout' then
      select coalesce(sum(round(o.price*0.50,2)),0) into v_accrued
      from public.rabota_orders o
      where o.assigned_user_id=p_master_user_id
        and o.status='Выполнен' and o.paid=true;
    else
      select coalesce(count(*)*1500,0) into v_accrued
      from public.rabota_orders o
      where o.assigned_user_id=p_master_user_id
        and o.status='Выполнен' and o.paid=true;
    end if;
    select coalesce(sum(f.amount),0) into v_already
    from public.rabota_finance_operations f
    where f.kind=v_kind and f.master_user_id=p_master_user_id and f.voided_at is null;
    if v_accrued-v_already < p_amount then
      raise exception 'Сумма больше доступного баланса. Доступно: % ₽',greatest(0,v_accrued-v_already);
    end if;
  else
    p_master_user_id:=null;
  end if;

  insert into public.rabota_finance_operations(kind,amount,master_user_id,note,created_by)
  values(v_kind,p_amount,p_master_user_id,v_note,auth.uid())
  returning id into v_id;
  return v_id;
end
$function$;
CREATE OR REPLACE FUNCTION public.rabota_finance_void(p_operation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_payroll_master uuid;
begin
 if (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then
  raise exception 'Только администратор может отменить операцию';
 end if;
 select master_user_id into v_payroll_master from public.rabota_finance_operations
 where id=p_operation_id and kind in ('raul_payout','timur_payout');
 if found then
  perform 1 from public.rabota_members where user_id=v_payroll_master for update;
  if exists (select 1 from private.rabota_payroll_policy_v3) then
   raise exception 'Проведённая зарплата защищена от отмены без сверки' using errcode='23514';
  end if;
 end if;
 update public.rabota_finance_operations
 set voided_at=now(),voided_by=auth.uid()
 where id=p_operation_id and voided_at is null and order_id is null;
 if not found then raise exception 'Операция не найдена или автоматически учтена в распределении заказа'; end if;
 return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.rabota_master_action(p_order_id uuid, p_action text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_status text;
  new_status text;
BEGIN
  IF (SELECT private.rabota_my_role()) IS DISTINCT FROM 'master' THEN
    RAISE EXCEPTION 'Доступ запрещён';
  END IF;
  SELECT status INTO current_status
    FROM public.rabota_orders
    WHERE id = p_order_id AND assigned_user_id = auth.uid()
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ недоступен'; END IF;

  IF p_action = 'accept' AND current_status = 'Записан' THEN
    new_status := 'В работе';
  ELSIF p_action = 'complete' AND current_status = 'В работе' THEN
    new_status := 'Выполнен';
  ELSE
    RAISE EXCEPTION 'Недопустимый переход статуса';
  END IF;

  UPDATE public.rabota_orders
     SET status = new_status,
         completed_at = CASE WHEN new_status = 'Выполнен' THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_order_id;
  RETURN new_status;
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_order_reschedule_history(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
RETURN private.rabota_order_reschedule_history(p_order_id);
CREATE OR REPLACE FUNCTION public.rabota_payroll_payout_v3(p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_policy private.rabota_payroll_policy_v3%rowtype;
  v_existing public.rabota_finance_operations%rowtype;
  v_totals record;
  v_id uuid;
  v_note text:=btrim(coalesce(p_note,''));
  v_replayed boolean:=false;
BEGIN
  IF v_actor IS NULL OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Зарплату может выплачивать только владелец' USING ERRCODE='42501';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>10000000 OR p_amount<>round(p_amount,2)
    OR p_payment_method IS NULL OR p_payment_method NOT IN ('cash','card')
    OR p_request_id IS NULL OR length(v_note) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'Некорректные реквизиты выплаты' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND OR p_master_user_id IS DISTINCT FROM v_policy.master_user_id THEN
    RAISE EXCEPTION 'Правила выплат или мастер не подтверждены' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.rabota_members
  WHERE user_id=p_master_user_id AND active AND role='master'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Мастер не активен' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_existing FROM public.rabota_finance_operations WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.master_user_id IS DISTINCT FROM p_master_user_id
      OR v_existing.created_by IS DISTINCT FROM v_actor OR v_existing.kind<>'raul_payout'
      OR v_existing.amount<>p_amount OR v_existing.payment_method IS DISTINCT FROM p_payment_method
      OR v_existing.note IS DISTINCT FROM v_note OR v_existing.created_at<v_policy.activated_at
      OR v_existing.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'Идентификатор уже использован другой операцией' USING ERRCODE='23505';
    END IF;
    v_id:=v_existing.id;
    v_replayed:=true;
  ELSE
    SELECT * INTO v_totals FROM private.rabota_payroll_totals_v3(p_master_user_id,v_policy.activated_at);
    IF p_amount>v_totals.earned-v_totals.paid THEN
      RAISE EXCEPTION 'Сумма больше задолженности по зарплате' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.rabota_finance_operations(
      kind,amount,master_user_id,note,created_by,payment_method,request_id,created_at
    ) VALUES ('raul_payout',p_amount,p_master_user_id,v_note,v_actor,p_payment_method,p_request_id,clock_timestamp())
    RETURNING id INTO v_id;
  END IF;
  SELECT * INTO v_totals FROM private.rabota_payroll_totals_v3(p_master_user_id,v_policy.activated_at);
  RETURN jsonb_build_object('id',v_id,'amount',p_amount,'earned',v_totals.earned,'paid',v_totals.paid,
    'due',greatest(v_totals.earned-v_totals.paid,0),
    'balance',v_totals.earned-v_totals.paid,'overpaid',greatest(v_totals.paid-v_totals.earned,0),
    'replayed',v_replayed);
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_payroll_refund_v3(p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.rabota_payroll_refund_v3(p_order_id,p_amount,p_note,p_request_id,NULL::boolean)
$function$;
CREATE OR REPLACE FUNCTION public.rabota_payroll_refund_v3(p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid, p_travel_taken boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_policy private.rabota_payroll_policy_v3%rowtype;
  v_existing private.rabota_payroll_refunds_v3%rowtype;
  v_order public.rabota_orders%rowtype;
  v_earning private.rabota_payroll_earnings_v3%rowtype;
  v_totals record;
  v_note text:=btrim(coalesce(p_note,''));
BEGIN
  IF v_actor IS NULL OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Возврат может подтвердить только владелец' USING ERRCODE='42501';
  END IF;
  IF p_order_id IS NULL OR p_request_id IS NULL OR p_amount IS NULL OR p_amount<=0
    OR p_amount>10000000 OR p_amount<>round(p_amount,2)
    OR length(v_note) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'Некорректные реквизиты возврата' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND THEN RAISE EXCEPTION 'Новый учёт ещё не активен' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.rabota_members WHERE user_id=v_policy.master_user_id FOR UPDATE;
  SELECT * INTO v_existing FROM private.rabota_payroll_refunds_v3 WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id OR v_existing.amount<>p_amount
      OR v_existing.note<>v_note OR v_existing.refunded_by<>v_actor
      OR (SELECT o.travel_taken FROM public.rabota_orders o WHERE o.id=v_existing.order_id)
        IS DISTINCT FROM p_travel_taken THEN
      RAISE EXCEPTION 'Идентификатор уже использован другой операцией' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('order_id',p_order_id,'amount',p_amount,'refunded_at',v_existing.refunded_at,'replayed',true);
  END IF;
  SELECT * INTO v_order FROM public.rabota_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.paid IS NOT TRUE OR v_order.status IS DISTINCT FROM 'Выполнен'
    OR v_order.price+v_order.travel_amount IS DISTINCT FROM p_amount
    OR v_order.payment_amount IS DISTINCT FROM p_amount THEN
    RAISE EXCEPTION 'Можно подтвердить только полный возврат по однозначно оплаченному заказу' USING ERRCODE='23514';
  END IF;

  IF (v_order.travel_amount>0) IS DISTINCT FROM (p_travel_taken IS NOT NULL) THEN
    RAISE EXCEPTION 'Для возврата по заказу с дорогой укажите, состоялась ли поездка' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h WHERE h.order_id=p_order_id) THEN
    RAISE EXCEPTION 'По заказу продолжается сверка. Возврат пока недоступен'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_earning FROM private.rabota_payroll_earnings_v3 WHERE order_id=p_order_id;
  IF FOUND THEN
    IF v_earning.master_user_id IS DISTINCT FROM v_policy.master_user_id
      OR v_order.assigned_user_id IS DISTINCT FROM v_earning.master_user_id
      OR v_earning.paid_amount IS DISTINCT FROM v_order.price THEN
      RAISE EXCEPTION 'Начисление по заказу не подтверждено. Нужна сверка' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM private.rabota_payroll_payout_review_v3 r
      JOIN public.rabota_finance_operations f ON f.id=r.operation_id
      WHERE f.voided_at IS NULL AND r.allocations ? p_order_id::text
    ) THEN
      RAISE EXCEPTION 'С заказом связана подтверждённая выплата. Нужна сверка перед возвратом'
        USING ERRCODE='23514';
    END IF;
    SELECT * INTO v_totals FROM private.rabota_payroll_totals_v3(v_policy.master_user_id,v_policy.activated_at);
    IF v_totals.earned-v_totals.paid<v_earning.earned_amount THEN
      RAISE EXCEPTION 'Начисление уже покрыто выплатой. Нужна сверка перед возвратом' USING ERRCODE='23514';
    END IF;
  ELSIF v_order.assigned_user_id IS NOT DISTINCT FROM v_policy.master_user_id THEN
    RAISE EXCEPTION 'Начисление по заказу не подтверждено. Нужна сверка' USING ERRCODE='23514';
  END IF;

  INSERT INTO private.rabota_payroll_refunds_v3(order_id,request_id,amount,refunded_by,note)
  VALUES(p_order_id,p_request_id,p_amount,v_actor,v_note)
  RETURNING * INTO v_existing;
  PERFORM pg_catalog.set_config('rabota.order_payment_intent','refund-v3:'||p_order_id::text,true);
  UPDATE public.rabota_orders SET status='Отменён',travel_taken=p_travel_taken,updated_at=clock_timestamp() WHERE id=p_order_id;
  PERFORM pg_catalog.set_config('rabota.order_payment_intent','',true);
  RETURN jsonb_build_object('order_id',p_order_id,'amount',p_amount,'refunded_at',v_existing.refunded_at,'replayed',false);
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_payroll_snapshot_v3()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_role text:=(SELECT private.rabota_my_role());
  v_policy private.rabota_payroll_policy_v3%rowtype;
  v_accounting jsonb:=jsonb_build_object('accounting_version',1);
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Нет доступа к расчётам' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_policy FROM private.rabota_payroll_policy_v3;
  IF NOT FOUND THEN RETURN jsonb_build_object('version',3,'state','inactive'); END IF;
  IF v_role IN ('owner','master') THEN
    v_accounting:=v_accounting || jsonb_build_object('accounting_receipts',coalesce((
      SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object('travel_amount',o.travel_amount)
                       ORDER BY r.occurred_at DESC NULLS LAST,r.order_id)
      FROM private.rabota_accounting_receipts_v1(CASE WHEN v_role='owner' THEN NULL::uuid ELSE v_actor END) r
      JOIN public.rabota_orders o ON o.id=r.order_id
    ),'[]'::jsonb),'accounting_refunds',coalesce((
      SELECT jsonb_agg(jsonb_build_object('order_id',r.order_id,'amount',r.amount,'refunded_at',r.refunded_at,
                                          'travel_amount',o.travel_amount)
                       ORDER BY r.refunded_at DESC,r.order_id)
      FROM private.rabota_payroll_refunds_v3 r
      JOIN public.rabota_orders o ON o.id=r.order_id
      WHERE v_role='owner' OR o.assigned_user_id=v_actor
    ),'[]'::jsonb));
  END IF;
  IF v_role='owner' THEN
    v_accounting:=v_accounting || jsonb_build_object('accounting_payouts',coalesce((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id)
      FROM private.rabota_accounting_payouts_v1(v_policy.activated_at) p
    ),'[]'::jsonb));
  END IF;
  IF v_role<>'owner' AND (v_role<>'master' OR v_actor<>v_policy.master_user_id) THEN
    RETURN jsonb_build_object('version',3,'state','not_applicable','activated_at',v_policy.activated_at)
      || v_accounting;
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'version',3,'state','active','master_id',v_policy.master_user_id,'activated_at',v_policy.activated_at,
      'earned',t.earned,'paid',t.paid,'due',greatest(t.earned-t.paid,0),
      'balance',t.earned-t.paid,'overpaid',greatest(t.paid-t.earned,0),
      'travel_earned',travel.earned,'travel_events',travel.events,
      'orders',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id',e.order_id,'earned_amount',e.earned_amount,'paid_amount',e.paid_amount,
          'company_share',e.company_share,'earned_at',e.earned_at,'rule_version',e.rule_version
        ) ORDER BY e.earned_at DESC,e.order_id)
        FROM private.rabota_payroll_earnings_v3 e
        WHERE e.master_user_id=v_policy.master_user_id
          AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_cutover_holds_v3 h
                         WHERE h.order_id=e.order_id AND h.payroll_on_hold)
          AND NOT EXISTS(SELECT 1 FROM private.rabota_payroll_refunds_v3 r WHERE r.order_id=e.order_id)
      ),'[]'::jsonb),
      'payouts',coalesce((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC,p.id)
        FROM private.rabota_payroll_operations_v3(v_policy.master_user_id,v_policy.activated_at) p
      ),'[]'::jsonb),
      'refunds',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id',r.order_id,'amount',r.amount,'refunded_at',r.refunded_at,
          'earned_reversed',e.earned_amount,'earned_at',e.earned_at
        ) ORDER BY r.refunded_at DESC,r.order_id)
        FROM private.rabota_payroll_refunds_v3 r
        JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=r.order_id
        WHERE e.master_user_id=v_policy.master_user_id
      ),'[]'::jsonb),
      'holds',CASE WHEN v_role='owner' THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id',h.order_id,'order_number',o.order_number,
          'payroll_on_hold',h.payroll_on_hold,'cash_on_hold',h.cash_on_hold,
          'reason',h.reason,
          'earned_amount',CASE WHEN h.payroll_on_hold THEN e.earned_amount END,
          'credited_amount',CASE WHEN h.payroll_on_hold THEN coalesce((
            SELECT sum((r.allocations->>(h.order_id::text))::numeric)
            FROM private.rabota_payroll_payout_review_v3 r
            JOIN public.rabota_finance_operations f ON f.id=r.operation_id
            WHERE f.master_user_id=v_policy.master_user_id AND f.voided_at IS NULL
              AND f.kind IN ('raul_payout','timur_payout')
          ),0) END,
          'linked_recorded_amount',CASE WHEN h.payroll_on_hold THEN coalesce((
            SELECT sum(f.amount) FROM public.rabota_finance_operations f
            WHERE f.order_id=h.order_id AND f.master_user_id=v_policy.master_user_id
              AND f.voided_at IS NULL AND f.kind IN ('raul_payout','timur_payout')
          ),0) END,
          'payment_amount',CASE WHEN h.cash_on_hold THEN e.paid_amount END
        ) ORDER BY e.earned_at DESC,h.order_id)
        FROM private.rabota_payroll_cutover_holds_v3 h
        JOIN private.rabota_payroll_earnings_v3 e ON e.order_id=h.order_id
        JOIN public.rabota_orders o ON o.id=h.order_id
        WHERE e.master_user_id=v_policy.master_user_id
      ),'[]'::jsonb) ELSE '[]'::jsonb END
    )
    || v_accounting
    FROM private.rabota_payroll_totals_v3(v_policy.master_user_id,v_policy.activated_at) t
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(e.delta),0) AS earned,coalesce(jsonb_agg(jsonb_build_object(
        'id',e.id,'order_id',e.order_id,'order_number',e.order_number,'delta',e.delta,'occurred_at',e.occurred_at
      ) ORDER BY e.occurred_at DESC,e.id),'[]'::jsonb) AS events
      FROM private.rabota_payroll_travel_events e WHERE e.master_user_id=v_policy.master_user_id
    ) travel
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_provision_master(p_user_id uuid, p_master_name text, p_login text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text := btrim(coalesce(p_master_name,''));
declare v_login text := lower(btrim(coalesce(p_login,'')));
begin
  if (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then
    raise exception 'Только владелец может создать мастера';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Некорректная учётная запись';
  end if;
  if length(v_name) not between 1 and 100 then
    raise exception 'Некорректное имя мастера';
  end if;
  if v_login !~ '^[a-z][a-z0-9_]{2,23}$' then
    raise exception 'Некорректный логин';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id=p_user_id
      and lower(u.email)=v_login || '@staff.rabota.invalid'
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Учётная запись мастера не подтверждена системой';
  end if;
  -- Reject account replacement instead of orphaning paid salary history.
  if exists (select 1 from public.rabota_orders o
      where lower(btrim(o.master))=lower(v_name)
        and o.assigned_user_id is distinct from p_user_id
        and (o.paid is true or exists(
          select 1 from public.rabota_cash_collections c where c.order_id=o.id))) then
    raise exception 'Оплаченная история требует ручной проверки перед заменой мастера'
      using errcode='23514';
  end if;
  update public.rabota_members
  set active=false
  where active=true and role='master' and lower(btrim(master_name))=lower(v_name);
  insert into public.rabota_members (user_id,role,active,master_name,email)
  values (p_user_id,'master',true,v_name,v_login || '@staff.rabota.invalid');
  update public.rabota_orders
  set assigned_user_id=p_user_id,updated_at=now()
  where lower(btrim(master))=lower(v_name)
    and paid is not true and assigned_user_id is distinct from p_user_id
    and not exists(select 1 from public.rabota_cash_collections c
      where c.order_id=public.rabota_orders.id);
  return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.rabota_record_expense_v1(p_amount numeric, p_note text, p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  v_id uuid;
  v_old public.rabota_finance_operations%rowtype;
BEGIN
  IF v_actor IS NULL OR (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Только владелец может проводить расходы' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000
    OR p_amount <> round(p_amount, 2) OR char_length(v_note) > 240 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Некорректные реквизиты расхода' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.rabota_finance_operations(kind, amount, master_user_id, note, created_by, request_id)
    VALUES ('expense', p_amount, NULL, v_note, v_actor, p_request_id)
    ON CONFLICT (request_id) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO v_old FROM public.rabota_finance_operations WHERE request_id = p_request_id;
  IF NOT FOUND OR v_old.created_by IS DISTINCT FROM v_actor OR v_old.kind <> 'expense'
    OR v_old.amount IS DISTINCT FROM p_amount OR v_old.note IS DISTINCT FROM v_note THEN
    RAISE EXCEPTION 'Идентификатор использован другой операцией' USING ERRCODE = '23505';
  END IF;
  RETURN v_old.id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.rabota_record_order_payment(p_order_id uuid, p_amount numeric, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.rabota_orders%rowtype;
  v_role text;
  v_receiver text;
  v_assigned uuid;
  v_payroll_active boolean;
begin
  v_role := (select private.rabota_my_role());
  if auth.uid() is null or coalesce(v_role,'') not in ('owner','manager','master') then
    raise exception 'Нет прав для оплаты заказа';
  end if;
  if p_method is null or p_method not in ('cash','card') then
    raise exception 'Выберите наличные или карту';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>10000000 or round(p_amount,2)<>p_amount then
    raise exception 'Укажите корректную сумму оплаты';
  end if;
  -- Lock the master before the order, in the same order as payouts,
  -- activation and reversals. Verify the assignment again after locking.
  select assigned_user_id into v_assigned from public.rabota_orders where id=p_order_id;
  if not found then raise exception 'Заказ не найден'; end if;
  if v_assigned is not null then
    perform 1 from public.rabota_members where user_id=v_assigned for update;
  end if;
  select * into v_order from public.rabota_orders where id=p_order_id for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if v_order.assigned_user_id is distinct from v_assigned then
    raise exception 'Назначение заказа изменилось. Заново откройте заказ' using errcode='40001';
  end if;
  if v_role='master' then
    if v_order.assigned_user_id is distinct from auth.uid() then
      raise exception 'Заказ назначен другому мастеру';
    end if;
    if v_order.status not in ('В работе','Выполнен') then
      raise exception 'Мастер может завершить только принятый в работу заказ';
    end if;
  end if;
  if v_order.status='Отменён' then raise exception 'Отменённый заказ нельзя оплатить'; end if;
  if v_order.paid then raise exception 'Заказ уже оплачен'; end if;
  v_payroll_active := exists(select 1 from private.rabota_payroll_policy_v3);
  if (v_payroll_active or v_order.travel_amount>0)
    and v_order.price+v_order.travel_amount is distinct from p_amount then
    raise exception 'Оплата должна совпадать с полной стоимостью заказа. Сначала согласуйте и сохраните цену'
      using errcode='23514';
  end if;
  v_receiver := case when v_role='master' then 'master' else 'company' end;
  -- Authorize exactly this paid transition for the paired row guard.
  perform pg_catalog.set_config('rabota.order_payment_intent','payment:'||p_order_id::text,true);
  update public.rabota_orders
    set status='Выполнен', paid=true,
        price=case when v_payroll_active or v_order.travel_amount>0 then v_order.price else p_amount end,
        payment_method=p_method, payment_amount=p_amount,
        payment_received_by=v_receiver, paid_at=now(), paid_by=auth.uid(),
        completed_at=coalesce(v_order.completed_at,now()), updated_at=now()
    where id=p_order_id;
  perform pg_catalog.set_config('rabota.order_payment_intent','',true);
  return jsonb_build_object('ok',true,'amount',p_amount,'method',p_method,'receiver',v_receiver);
end $function$;
CREATE OR REPLACE FUNCTION public.rabota_request_access()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid := auth.uid(); em text;
begin
  if u is null then raise exception 'Войдите в аккаунт'; end if;
  select coalesce(email,'') into em from auth.users where id=u and email_confirmed_at is not null;
  if not found then raise exception 'Сначала подтвердите электронную почту'; end if;
  insert into public.rabota_members (user_id,role,active,master_name,email)
  values (u,'master',false,'',em)
  on conflict (user_id) do nothing;
  return true;
end
$function$;
CREATE OR REPLACE FUNCTION public.rabota_reschedule_order(p_order_id uuid, p_request_id uuid, p_expected_updated_at timestamp with time zone, p_appointment_date date, p_appointment_time time without time zone)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
RETURN private.rabota_reschedule_order(p_order_id, p_request_id, p_expected_updated_at, p_appointment_date, p_appointment_time);
CREATE OR REPLACE FUNCTION public.rabota_salary_payout_v2(p_kind text, p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid:=auth.uid();
 v_role text;
 v_master uuid;
 v_accrued numeric(14,2);
 v_paid numeric(14,2);
 v_existing public.rabota_finance_operations%rowtype;
 v_id uuid;
 v_note text:=btrim(coalesce(p_note,''));
begin
 if v_actor is null then raise exception 'Нужно войти в аккаунт'; end if;
 v_role:=(select private.rabota_my_role());
 if v_role is distinct from 'owner' then
  raise exception 'Зарплатные выплаты может проводить только владелец' using errcode='42501';
 end if;
 if p_kind not in ('raul_payout','timur_payout') then raise exception 'Недопустимый вид выплаты'; end if;
 if p_payment_method not in ('cash','card') then raise exception 'Выберите наличные или карту'; end if;
 if p_request_id is null then raise exception 'Не указан идентификатор операции'; end if;
 if p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) then
  raise exception 'Некорректная сумма выплаты';
 end if;
 if length(v_note)<1 or length(v_note)>240 then raise exception 'Укажите комментарий до 240 символов'; end if;
 -- Only the owner authorizes payout ledger changes. The master may read
 -- accruals and salary history but cannot mark a payment as received.
 v_master:=p_master_user_id;
 if v_master is null then raise exception 'Не выбран мастер'; end if;
 -- Same lock as existing owner payout RPC: serializes concurrent payouts.
 perform 1 from public.rabota_members m where m.user_id=v_master and m.role='master'
  and m.active=true and lower(btrim(m.master_name))='рауль' for update;
 if not found then raise exception 'Мастер Рауль не найден или не активен'; end if;
 select * into v_existing from public.rabota_finance_operations where request_id=p_request_id;
 if found then
  if v_existing.created_by<>v_actor or v_existing.master_user_id<>v_master
     or v_existing.kind<>p_kind or v_existing.amount<>p_amount
     or v_existing.payment_method<>p_payment_method then
   raise exception 'Идентификатор использован другой операцией';
  end if;
  return v_existing.id;
 end if;
 if exists (select 1 from private.rabota_payroll_policy_v3) then
  raise exception 'Откройте новый раздел зарплаты для выплаты' using errcode='23514';
 end if;
 if p_kind='raul_payout' then
  select coalesce(sum(round(o.price*0.5,2)),0) into v_accrued
   from public.rabota_orders o where o.assigned_user_id=v_master and o.status='Выполнен' and o.paid=true;
 else
  select coalesce(count(*)*1500,0) into v_accrued
   from public.rabota_orders o where o.assigned_user_id=v_master and o.status='Выполнен' and o.paid=true;
 end if;
 select coalesce(sum(f.amount),0) into v_paid from public.rabota_finance_operations f
  where f.master_user_id=v_master and f.kind=p_kind and f.voided_at is null;
 if v_accrued-v_paid<p_amount then
  raise exception 'Недостаточно начислений. Доступно к выплате: % ₽', greatest(0,v_accrued-v_paid);
 end if;
 insert into public.rabota_finance_operations
  (kind,amount,master_user_id,note,created_by,payment_method,request_id)
 values(p_kind,p_amount,v_master,v_note,v_actor,p_payment_method,p_request_id)
 returning id into v_id;
 return v_id;
end $function$;

-- Constraints
ALTER TABLE ONLY private.rabota_order_reschedule_events ADD CONSTRAINT rabota_order_reschedule_events_check CHECK (((previous_date IS DISTINCT FROM new_date) OR (previous_time IS DISTINCT FROM new_time)));
ALTER TABLE ONLY private.rabota_order_reschedule_events ADD CONSTRAINT rabota_order_reschedule_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY private.rabota_payroll_cash_review_v3 ADD CONSTRAINT rabota_payroll_cash_review_v3_evidence_reference_check CHECK (((length(btrim(evidence_reference)) >= 1) AND (length(btrim(evidence_reference)) <= 240)));
ALTER TABLE ONLY private.rabota_payroll_cash_review_v3 ADD CONSTRAINT rabota_payroll_cash_review_v3_held_amount_check CHECK (((held_amount >= (0)::numeric) AND (held_amount <= (10000000)::numeric)));
ALTER TABLE ONLY private.rabota_payroll_cash_review_v3 ADD CONSTRAINT rabota_payroll_cash_review_v3_pkey PRIMARY KEY (order_id);
ALTER TABLE ONLY private.rabota_payroll_cutover_holds_v3 ADD CONSTRAINT rabota_payroll_cutover_holds_v3_check CHECK ((payroll_on_hold OR cash_on_hold));
ALTER TABLE ONLY private.rabota_payroll_cutover_holds_v3 ADD CONSTRAINT rabota_payroll_cutover_holds_v3_pkey PRIMARY KEY (order_id);
ALTER TABLE ONLY private.rabota_payroll_cutover_holds_v3 ADD CONSTRAINT rabota_payroll_cutover_holds_v3_reason_check CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 240)));
ALTER TABLE ONLY private.rabota_payroll_earnings_v3 ADD CONSTRAINT rabota_payroll_earnings_v3_check CHECK (((company_share >= ('-20000000'::integer)::numeric) AND (company_share <= paid_amount)));
ALTER TABLE ONLY private.rabota_payroll_earnings_v3 ADD CONSTRAINT rabota_payroll_earnings_v3_check1 CHECK (((rule_version = 'legacy_verified'::text) OR (company_share = (paid_amount - earned_amount))));
ALTER TABLE ONLY private.rabota_payroll_earnings_v3 ADD CONSTRAINT rabota_payroll_earnings_v3_check2 CHECK ((((rule_version = 'legacy_verified'::text) AND (verified_by IS NOT NULL) AND ((length(btrim(evidence_reference)) >= 1) AND (length(btrim(evidence_reference)) <= 240)) AND (evidence_reference IS NOT NULL)) OR ((rule_version <> 'legacy_verified'::text) AND (verified_by IS NULL) AND (evidence_reference IS NULL))));
ALTER TABLE ONLY private.rabota_payroll_earnings_v3 ADD CONSTRAINT rabota_payroll_earnings_v3_earned_amount_check CHECK (((earned_amount >= (0)::numeric) AND (earned_amount <= (20000000)::numeric)));
ALTER TABLE ONLY private.rabota_payroll_earnings_v3 ADD CONSTRAINT rabota_payroll_earnings_v3_paid_amount_check CHECK (((paid_amount >= 0.01) AND (paid_amount <= (10000000)::numeric)));
ALTER TABLE ONLY private.rabota_payroll_earnings_v3 ADD CONSTRAINT rabota_payroll_earnings_v3_pkey PRIMARY KEY (order_id);
ALTER TABLE ONLY private.rabota_payroll_earnings_v3 ADD CONSTRAINT rabota_payroll_earnings_v3_rule_version_check CHECK (((length(btrim(rule_version)) >= 1) AND (length(btrim(rule_version)) <= 80)));
ALTER TABLE ONLY private.rabota_payroll_payout_review_v3 ADD CONSTRAINT rabota_payroll_payout_review_v3_allocations_check CHECK ((jsonb_typeof(allocations) = 'object'::text));
ALTER TABLE ONLY private.rabota_payroll_payout_review_v3 ADD CONSTRAINT rabota_payroll_payout_review_v3_credited_amount_check CHECK (((credited_amount >= (0)::numeric) AND (credited_amount <= (10000000)::numeric)));
ALTER TABLE ONLY private.rabota_payroll_payout_review_v3 ADD CONSTRAINT rabota_payroll_payout_review_v3_evidence_reference_check CHECK (((length(btrim(evidence_reference)) >= 1) AND (length(btrim(evidence_reference)) <= 240)));
ALTER TABLE ONLY private.rabota_payroll_payout_review_v3 ADD CONSTRAINT rabota_payroll_payout_review_v3_pkey PRIMARY KEY (operation_id);
ALTER TABLE ONLY private.rabota_payroll_policy_v3 ADD CONSTRAINT rabota_payroll_policy_v3_backup_reference_check CHECK (((length(btrim(backup_reference)) >= 1) AND (length(btrim(backup_reference)) <= 240)));
ALTER TABLE ONLY private.rabota_payroll_policy_v3 ADD CONSTRAINT rabota_payroll_policy_v3_bonus_check CHECK (((bonus >= (0)::numeric) AND (bonus <= (10000000)::numeric)));
ALTER TABLE ONLY private.rabota_payroll_policy_v3 ADD CONSTRAINT rabota_payroll_policy_v3_pkey PRIMARY KEY (singleton);
ALTER TABLE ONLY private.rabota_payroll_policy_v3 ADD CONSTRAINT rabota_payroll_policy_v3_rate_check CHECK (((rate >= (0)::numeric) AND (rate <= (1)::numeric)));
ALTER TABLE ONLY private.rabota_payroll_policy_v3 ADD CONSTRAINT rabota_payroll_policy_v3_rule_version_check CHECK (((rule_version <> 'legacy_verified'::text) AND ((length(btrim(rule_version)) >= 1) AND (length(btrim(rule_version)) <= 80))));
ALTER TABLE ONLY private.rabota_payroll_policy_v3 ADD CONSTRAINT rabota_payroll_policy_v3_singleton_check CHECK (singleton);
ALTER TABLE ONLY private.rabota_payroll_refunds_v3 ADD CONSTRAINT rabota_payroll_refunds_v3_amount_check CHECK (((amount >= 0.01) AND (amount <= (10000000)::numeric)));
ALTER TABLE ONLY private.rabota_payroll_refunds_v3 ADD CONSTRAINT rabota_payroll_refunds_v3_note_check CHECK (((length(btrim(note)) >= 1) AND (length(btrim(note)) <= 240)));
ALTER TABLE ONLY private.rabota_payroll_refunds_v3 ADD CONSTRAINT rabota_payroll_refunds_v3_pkey PRIMARY KEY (order_id);
ALTER TABLE ONLY private.rabota_payroll_refunds_v3 ADD CONSTRAINT rabota_payroll_refunds_v3_request_id_key UNIQUE (request_id);
ALTER TABLE ONLY private.rabota_payroll_travel_events ADD CONSTRAINT rabota_payroll_travel_events_delta_check CHECK (((delta <> (0)::numeric) AND (abs(delta) <= (10000000)::numeric)));
ALTER TABLE ONLY private.rabota_payroll_travel_events ADD CONSTRAINT rabota_payroll_travel_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_ai_chats ADD CONSTRAINT rabota_ai_chats_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_ai_chats ADD CONSTRAINT rabota_ai_chats_title_check CHECK ((char_length(title) <= 160));
ALTER TABLE ONLY public.rabota_ai_messages ADD CONSTRAINT rabota_ai_messages_content_check CHECK (((char_length(content) >= 1) AND (char_length(content) <= 12000)));
ALTER TABLE ONLY public.rabota_ai_messages ADD CONSTRAINT rabota_ai_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_ai_messages ADD CONSTRAINT rabota_ai_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_drafts_floor_loops_check CHECK (((floor_loops IS NULL) OR ((floor_loops >= 0) AND (floor_loops <= 300))));
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_drafts_radiators_check CHECK (((radiators IS NULL) OR ((radiators >= 0) AND (radiators <= 300))));
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_order_drafts_action_check CHECK ((action = ANY (ARRAY['create'::text, 'move'::text])));
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_order_drafts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_order_drafts_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'applied'::text])));
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_order_travel_amount_valid CHECK ((((travel_amount >= (0)::numeric) AND (travel_amount <= (10000000)::numeric)) AND (travel_amount = round(travel_amount, 2)) AND ((travel_amount = (0)::numeric) OR ((action = 'create'::text) AND ((price IS NULL) OR ((price + travel_amount) <= (10000000)::numeric))))));
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_amounts_balance CHECK ((gross = ((raul_amount + timur_amount) + company_amount)));
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_collections_company_amount_check CHECK ((company_amount > (0)::numeric));
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_collections_mode_check CHECK ((((NOT payroll_separate) AND (gross > (3000)::numeric) AND (raul_amount > (0)::numeric) AND (timur_amount = (1500)::numeric)) OR (payroll_separate AND (gross > (0)::numeric) AND (raul_amount = (0)::numeric) AND (timur_amount = (0)::numeric) AND (company_amount = gross))));
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_collections_pkey PRIMARY KEY (order_id);
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_confirm_requires_submit CHECK (((confirmed_at IS NULL) OR (submitted_at IS NOT NULL)));
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_transfer_totals CHECK ((((submitted_amount IS NULL) AND (confirmed_amount IS NULL)) OR ((submitted_amount IS NOT NULL) AND (confirmed_amount IS NOT NULL) AND (company_amount IS NOT NULL) AND (confirmed_amount >= (0)::numeric) AND (confirmed_amount <= submitted_amount) AND (submitted_amount <= company_amount))));
ALTER TABLE ONLY public.rabota_cash_transfer_events ADD CONSTRAINT rabota_cash_transfer_events_amount_check CHECK (((amount > (0)::numeric) AND (amount < 'Infinity'::numeric) AND (amount = round(amount, 2))));
ALTER TABLE ONLY public.rabota_cash_transfer_events ADD CONSTRAINT rabota_cash_transfer_events_check CHECK ((((kind = 'submitted'::text) AND (request_id IS NOT NULL)) OR ((kind = 'confirmed'::text) AND (request_id IS NULL) AND (request_order_id IS NULL))));
ALTER TABLE ONLY public.rabota_cash_transfer_events ADD CONSTRAINT rabota_cash_transfer_events_kind_check CHECK ((kind = ANY (ARRAY['submitted'::text, 'confirmed'::text])));
ALTER TABLE ONLY public.rabota_cash_transfer_events ADD CONSTRAINT rabota_cash_transfer_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_accounts_v1 CHECK ((((kind = 'income'::text) AND (from_account IS NULL) AND (to_account IS NOT NULL)) OR ((kind = 'expense'::text) AND (from_account IS NOT NULL) AND (to_account IS NULL)) OR ((kind = 'transfer'::text) AND (from_account IS NOT NULL) AND (to_account IS NOT NULL) AND (from_account <> to_account))));
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_entries_amount_check CHECK (((amount > (0)::numeric) AND (amount <= (10000000)::numeric)));
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_entries_from_account_check CHECK ((from_account = ANY (ARRAY['cash'::text, 'card'::text])));
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_entries_kind_check CHECK ((kind = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text])));
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_entries_note_check CHECK (((length(note) >= 1) AND (length(note) <= 240)));
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_entries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_entries_request_id_key UNIQUE (request_id);
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_entries_to_account_check CHECK ((to_account = ANY (ARRAY['cash'::text, 'card'::text])));
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_operations_amount_check CHECK (((amount > (0)::numeric) AND (amount <= (10000000)::numeric)));
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_operations_kind_check CHECK ((kind = ANY (ARRAY['raul_payout'::text, 'timur_payout'::text, 'expense'::text])));
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_operations_note_check CHECK ((char_length(note) <= 240));
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_operations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_payment_method_v2 CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['cash'::text, 'card'::text]))));
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_payout_master CHECK (((kind = 'expense'::text) OR (master_user_id IS NOT NULL)));
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT growth_unique_plan_item UNIQUE (owner_id, kind, start_on, title);
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT growth_valid_period CHECK ((end_on >= start_on));
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT rabota_growth_plan_details_check CHECK ((length(details) <= 1500));
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT rabota_growth_plan_kind_check CHECK ((kind = ANY (ARRAY['year'::text, 'month'::text, 'week'::text, 'day'::text])));
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT rabota_growth_plan_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT rabota_growth_plan_target_rub_check CHECK ((target_rub >= (0)::numeric));
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT rabota_growth_plan_title_check CHECK (((length(TRIM(BOTH FROM title)) >= 1) AND (length(TRIM(BOTH FROM title)) <= 180)));
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_history_check CHECK ((jsonb_typeof(history) = 'array'::text));
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_loops_check CHECK (((loops >= 0) AND (loops <= 999)));
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 100)));
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_phone_check CHECK (((length(btrim(phone)) >= 10) AND (length(btrim(phone)) <= 30)));
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_phone_normalized_check CHECK ((phone_normalized ~ '^7[0-9]{10}$'::text));
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_phone_normalized_key UNIQUE (phone_normalized);
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_radiators_check CHECK (((radiators >= 0) AND (radiators <= 999)));
ALTER TABLE ONLY public.rabota_leads ADD CONSTRAINT rabota_leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'hot'::text, 'waiting'::text, 'callback'::text, 'ready'::text, 'booked'::text, 'lost'::text])));
ALTER TABLE ONLY public.rabota_members ADD CONSTRAINT rabota_members_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.rabota_members ADD CONSTRAINT rabota_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'master'::text])));
ALTER TABLE ONLY public.rabota_order_notifications ADD CONSTRAINT rabota_order_notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_floor_loops_check CHECK (((floor_loops IS NULL) OR (floor_loops >= 0)));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_legacy_id_key UNIQUE (legacy_id);
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 100)));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_order_number_five_digits CHECK (((order_number >= 1) AND (order_number <= 99999)));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_order_number_unique UNIQUE (order_number);
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_price_check CHECK (((price IS NULL) OR (price >= (0)::numeric)));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_radiators_check CHECK (((radiators IS NULL) OR (radiators >= 0)));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_status_check CHECK ((status = ANY (ARRAY['Записан'::text, 'В работе'::text, 'Выполнен'::text, 'Отменён'::text])));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_travel_amount_check CHECK ((((travel_amount >= (0)::numeric) AND (travel_amount <= (10000000)::numeric)) AND (travel_amount = round(travel_amount, 2)) AND ((travel_amount = (0)::numeric) OR (price IS NULL) OR ((price + travel_amount) <= (10000000)::numeric))));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_travel_taken_check CHECK (
CASE
    WHEN ((travel_amount > (0)::numeric) AND (status = 'Отменён'::text)) THEN (travel_taken IS NOT NULL)
    ELSE (travel_taken IS NULL)
END);
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_payment_amount_check CHECK (((payment_amount IS NULL) OR (payment_amount > (0)::numeric)));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_payment_method_check CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['cash'::text, 'card'::text]))));
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_payment_receiver_check CHECK (((payment_received_by IS NULL) OR (payment_received_by = ANY (ARRAY['master'::text, 'company'::text]))));
ALTER TABLE ONLY public.rabota_push_subscriptions ADD CONSTRAINT rabota_push_endpoint_length CHECK (((length(endpoint) >= 10) AND (length(endpoint) <= 2048)));
ALTER TABLE ONLY public.rabota_push_subscriptions ADD CONSTRAINT rabota_push_payload_endpoint_matches CHECK (((subscription ->> 'endpoint'::text) = endpoint));
ALTER TABLE ONLY public.rabota_push_subscriptions ADD CONSTRAINT rabota_push_subscriptions_pkey PRIMARY KEY (endpoint);
ALTER TABLE ONLY private.rabota_order_reschedule_events ADD CONSTRAINT rabota_order_reschedule_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY private.rabota_payroll_cash_review_v3 ADD CONSTRAINT rabota_payroll_cash_review_v3_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id);
ALTER TABLE ONLY private.rabota_payroll_cutover_holds_v3 ADD CONSTRAINT rabota_payroll_cutover_holds_v3_order_id_fkey FOREIGN KEY (order_id) REFERENCES private.rabota_payroll_earnings_v3(order_id);
ALTER TABLE ONLY private.rabota_payroll_earnings_v3 ADD CONSTRAINT rabota_payroll_earnings_v3_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id);
ALTER TABLE ONLY private.rabota_payroll_payout_review_v3 ADD CONSTRAINT rabota_payroll_payout_review_v3_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.rabota_finance_operations(id);
ALTER TABLE ONLY private.rabota_payroll_policy_v3 ADD CONSTRAINT rabota_payroll_policy_v3_master_user_id_fkey FOREIGN KEY (master_user_id) REFERENCES public.rabota_members(user_id);
ALTER TABLE ONLY private.rabota_payroll_refunds_v3 ADD CONSTRAINT rabota_payroll_refunds_v3_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id);
ALTER TABLE ONLY private.rabota_payroll_travel_events ADD CONSTRAINT rabota_payroll_travel_events_master_user_id_fkey FOREIGN KEY (master_user_id) REFERENCES public.rabota_members(user_id);
ALTER TABLE ONLY private.rabota_payroll_travel_events ADD CONSTRAINT rabota_payroll_travel_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id);
ALTER TABLE ONLY public.rabota_ai_chats ADD CONSTRAINT rabota_ai_chats_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rabota_ai_messages ADD CONSTRAINT rabota_ai_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.rabota_ai_chats(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rabota_ai_messages ADD CONSTRAINT rabota_ai_messages_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_order_drafts_master_user_id_fkey FOREIGN KEY (master_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_order_drafts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_order_drafts_result_order_id_fkey FOREIGN KEY (result_order_id) REFERENCES public.rabota_orders(id);
ALTER TABLE ONLY public.rabota_ai_order_drafts ADD CONSTRAINT rabota_ai_order_drafts_target_order_id_fkey FOREIGN KEY (target_order_id) REFERENCES public.rabota_orders(id);
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_collections_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_collections_master_user_id_fkey FOREIGN KEY (master_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.rabota_cash_collections ADD CONSTRAINT rabota_cash_collections_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id);
ALTER TABLE ONLY public.rabota_cash_transfer_events ADD CONSTRAINT rabota_cash_transfer_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_cash_collections(order_id);
ALTER TABLE ONLY public.rabota_cashbook_entries ADD CONSTRAINT rabota_cashbook_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_operations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_operations_master_user_id_fkey FOREIGN KEY (master_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_operations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id);
ALTER TABLE ONLY public.rabota_finance_operations ADD CONSTRAINT rabota_finance_operations_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT rabota_growth_plan_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rabota_growth_plan ADD CONSTRAINT rabota_growth_plan_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.rabota_growth_plan(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.rabota_members ADD CONSTRAINT rabota_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rabota_order_notifications ADD CONSTRAINT rabota_order_notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.rabota_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rabota_order_notifications ADD CONSTRAINT rabota_order_notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.rabota_orders ADD CONSTRAINT rabota_orders_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.rabota_leads(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.rabota_push_subscriptions ADD CONSTRAINT rabota_push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX rabota_order_reschedule_event_order_idx ON private.rabota_order_reschedule_events USING btree (order_id, moved_at DESC, id);
CREATE INDEX rabota_payroll_travel_events_master_idx ON private.rabota_payroll_travel_events USING btree (master_user_id, occurred_at DESC, id);
CREATE INDEX rabota_payroll_travel_events_order_idx ON private.rabota_payroll_travel_events USING btree (order_id);
CREATE INDEX rabota_ai_chats_owner_updated_idx ON public.rabota_ai_chats USING btree (owner_id, updated_at DESC);
CREATE INDEX rabota_ai_messages_chat_created_idx ON public.rabota_ai_messages USING btree (chat_id, created_at);
CREATE INDEX rabota_ai_drafts_owner_idx ON public.rabota_ai_order_drafts USING btree (owner_id, created_at DESC);
CREATE INDEX rabota_cash_collections_master_idx ON public.rabota_cash_collections USING btree (master_user_id, created_at DESC);
CREATE INDEX rabota_cash_confirmation_history ON public.rabota_cash_transfer_events USING btree (created_at DESC, id DESC) WHERE (kind = 'confirmed'::text);
CREATE INDEX rabota_cash_events_order ON public.rabota_cash_transfer_events USING btree (order_id);
CREATE UNIQUE INDEX rabota_cash_submit_request_allocations ON public.rabota_cash_transfer_events USING btree (master_user_id, request_id, order_id) WHERE (kind = 'submitted'::text);
CREATE INDEX rabota_cashbook_entries_created_at_idx ON public.rabota_cashbook_entries USING btree (created_at DESC);
CREATE INDEX rabota_finance_operations_date_idx ON public.rabota_finance_operations USING btree (created_at DESC);
CREATE INDEX rabota_finance_operations_master_idx ON public.rabota_finance_operations USING btree (master_user_id, created_at DESC);
CREATE UNIQUE INDEX rabota_finance_operations_request_id_qa17_uidx ON public.rabota_finance_operations USING btree (request_id);
CREATE UNIQUE INDEX rabota_finance_operations_request_id_v2_uidx ON public.rabota_finance_operations USING btree (request_id) WHERE (request_id IS NOT NULL);
CREATE UNIQUE INDEX rabota_finance_unique_cash_distribution_idx ON public.rabota_finance_operations USING btree (order_id, kind) WHERE (order_id IS NOT NULL);
CREATE INDEX rabota_growth_plan_owner_start_idx ON public.rabota_growth_plan USING btree (owner_id, start_on, kind, sort_order);
CREATE INDEX rabota_leads_due_idx ON public.rabota_leads USING btree (follow_up_date, follow_up_time) WHERE (status <> ALL (ARRAY['booked'::text, 'lost'::text]));
CREATE INDEX rabota_leads_status_idx ON public.rabota_leads USING btree (status);
CREATE UNIQUE INDEX rabota_unique_active_master_name ON public.rabota_members USING btree (lower(btrim(master_name))) WHERE ((role = 'master'::text) AND (active = true) AND (btrim(master_name) <> ''::text));
CREATE INDEX rabota_order_notifications_recipient_idx ON public.rabota_order_notifications USING btree (recipient_id, created_at DESC);
CREATE UNIQUE INDEX rabota_orders_active_master_slot_unique ON public.rabota_orders USING btree (appointment_date, appointment_time, lower(btrim(COALESCE(master, ''::text)))) WHERE ((appointment_date IS NOT NULL) AND (appointment_time IS NOT NULL) AND (status <> 'Отменён'::text));
CREATE INDEX rabota_orders_assigned_user ON public.rabota_orders USING btree (assigned_user_id);
CREATE INDEX rabota_orders_date_index ON public.rabota_orders USING btree (appointment_date);
CREATE INDEX rabota_orders_lead_id_idx ON public.rabota_orders USING btree (lead_id) WHERE (lead_id IS NOT NULL);
CREATE INDEX rabota_orders_status_index ON public.rabota_orders USING btree (status);
CREATE INDEX rabota_push_subscriptions_user_idx ON public.rabota_push_subscriptions USING btree (user_id) WHERE active;

-- Row security
ALTER TABLE private.rabota_order_reschedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_cash_review_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_cutover_holds_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_earnings_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_payout_review_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_policy_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_refunds_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.rabota_payroll_travel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rabota_ai_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only active Rabota owners manage own AI chats" ON public.rabota_ai_chats AS PERMISSIVE FOR ALL TO authenticated USING (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_members r
  WHERE ((r.user_id = ( SELECT auth.uid() AS uid)) AND (r.role = 'owner'::text) AND (r.active = true)))))) WITH CHECK (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_members r
  WHERE ((r.user_id = ( SELECT auth.uid() AS uid)) AND (r.role = 'owner'::text) AND (r.active = true))))));
ALTER TABLE public.rabota_ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only active Rabota owners manage own AI messages" ON public.rabota_ai_messages AS PERMISSIVE FOR ALL TO authenticated USING (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_ai_chats c
  WHERE ((c.id = rabota_ai_messages.chat_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1
   FROM public.rabota_members r
  WHERE ((r.user_id = ( SELECT auth.uid() AS uid)) AND (r.role = 'owner'::text) AND (r.active = true)))))) WITH CHECK (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_ai_chats c
  WHERE ((c.id = rabota_ai_messages.chat_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1
   FROM public.rabota_members r
  WHERE ((r.user_id = ( SELECT auth.uid() AS uid)) AND (r.role = 'owner'::text) AND (r.active = true))))));
ALTER TABLE public.rabota_ai_order_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_ai_drafts_read_own ON public.rabota_ai_order_drafts AS PERMISSIVE FOR SELECT TO authenticated USING (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_members m
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = 'owner'::text) AND m.active)))));
ALTER TABLE public.rabota_cash_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_cash_collection_read ON public.rabota_cash_collections AS PERMISSIVE FOR SELECT TO authenticated USING (((( SELECT private.rabota_my_role() AS rabota_my_role) = 'owner'::text) OR ((( SELECT private.rabota_my_role() AS rabota_my_role) = 'master'::text) AND (master_user_id = ( SELECT auth.uid() AS uid)))));
ALTER TABLE public.rabota_cash_transfer_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_read_transfers ON public.rabota_cash_transfer_events AS PERMISSIVE FOR SELECT TO authenticated USING (((( SELECT private.rabota_my_role() AS rabota_my_role) = 'owner'::text) OR ((( SELECT private.rabota_my_role() AS rabota_my_role) = 'master'::text) AND (master_user_id = ( SELECT auth.uid() AS uid)))));
ALTER TABLE public.rabota_cashbook_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_cashbook_owner_read_v1 ON public.rabota_cashbook_entries AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT private.rabota_my_role() AS rabota_my_role) = 'owner'::text));
ALTER TABLE public.rabota_finance_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_finance_read ON public.rabota_finance_operations AS PERMISSIVE FOR SELECT TO authenticated USING (((( SELECT private.rabota_my_role() AS rabota_my_role) = 'owner'::text) OR ((( SELECT private.rabota_my_role() AS rabota_my_role) = 'master'::text) AND (master_user_id = ( SELECT auth.uid() AS uid)) AND (kind = ANY (ARRAY['raul_payout'::text, 'timur_payout'::text])))));
ALTER TABLE public.rabota_growth_plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY growth_owner_checkoff ON public.rabota_growth_plan AS PERMISSIVE FOR UPDATE TO authenticated USING (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_members m
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = 'owner'::text) AND m.active))))) WITH CHECK (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_members m
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = 'owner'::text) AND m.active)))));
CREATE POLICY growth_owner_read ON public.rabota_growth_plan AS PERMISSIVE FOR SELECT TO authenticated USING (((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_members m
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = 'owner'::text) AND m.active)))));
ALTER TABLE public.rabota_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_leads_delete ON public.rabota_leads AS PERMISSIVE FOR DELETE TO authenticated USING ((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text])));
CREATE POLICY rabota_leads_insert ON public.rabota_leads AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) AND (created_by = ( SELECT auth.uid() AS uid))));
CREATE POLICY rabota_leads_read ON public.rabota_leads AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text])));
CREATE POLICY rabota_leads_update ON public.rabota_leads AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))) WITH CHECK ((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text])));
ALTER TABLE public.rabota_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_member_read_self_and_owner ON public.rabota_members AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT private.rabota_my_role() AS rabota_my_role) = 'owner'::text)));
CREATE POLICY rabota_owner_can_update_members ON public.rabota_members AS PERMISSIVE FOR UPDATE TO authenticated USING (((( SELECT private.rabota_my_role() AS rabota_my_role) = 'owner'::text) AND (role <> 'owner'::text))) WITH CHECK (((( SELECT private.rabota_my_role() AS rabota_my_role) = 'owner'::text) AND (role = ANY (ARRAY['master'::text, 'manager'::text])) AND (user_id <> ( SELECT auth.uid() AS uid))));
ALTER TABLE public.rabota_order_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_order_notifications_self_mark_read ON public.rabota_order_notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((recipient_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((recipient_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY rabota_order_notifications_self_read ON public.rabota_order_notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((recipient_id = ( SELECT auth.uid() AS uid)));
ALTER TABLE public.rabota_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_managers_insert_orders ON public.rabota_orders AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text])));
CREATE POLICY rabota_managers_update_orders ON public.rabota_orders AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))) WITH CHECK ((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text])));
CREATE POLICY rabota_raul_create_own_bookings ON public.rabota_orders AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((EXISTS (SELECT FROM public.rabota_members m WHERE m.user_id=(SELECT auth.uid()) AND m.email='master@rabota-qa.example')) AND (( SELECT private.rabota_my_role() AS rabota_my_role) = 'master'::text) AND (lower(btrim(master)) = 'рауль'::text) AND (assigned_user_id = ( SELECT auth.uid() AS uid)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (status = 'Записан'::text) AND (paid = false) AND (completed_at IS NULL) AND (legacy_id IS NULL) AND (btrim(name) <> ''::text) AND (btrim(phone) <> ''::text) AND (appointment_date IS NOT NULL) AND (appointment_time IS NOT NULL) AND ((price IS NULL) OR (price >= (0)::numeric)) AND ((radiators IS NULL) OR (radiators >= 0)) AND ((floor_loops IS NULL) OR (floor_loops >= 0))));
CREATE POLICY rabota_scoped_orders_read ON public.rabota_orders AS PERMISSIVE FOR SELECT TO authenticated USING (((( SELECT private.rabota_my_role() AS rabota_my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((assigned_user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT private.rabota_my_role() AS rabota_my_role) = 'master'::text))));
ALTER TABLE public.rabota_push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rabota_push_subscriptions_self_delete ON public.rabota_push_subscriptions AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY rabota_push_subscriptions_self_insert ON public.rabota_push_subscriptions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_members m
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (m.role = 'master'::text))))));
CREATE POLICY rabota_push_subscriptions_self_select ON public.rabota_push_subscriptions AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.rabota_members m
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND m.active AND (m.role = 'master'::text))))));
CREATE POLICY rabota_push_subscriptions_self_update ON public.rabota_push_subscriptions AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- Local triggers
CREATE TRIGGER rabota_ai_confirm_order_travel AFTER UPDATE OF state ON public.rabota_ai_order_drafts FOR EACH ROW WHEN (((old.state IS DISTINCT FROM 'applied'::text) AND (new.state = 'applied'::text) AND (new.action = 'create'::text) AND (new.travel_amount > (0)::numeric))) EXECUTE FUNCTION private.rabota_ai_apply_order_travel();
CREATE TRIGGER rabota_frozen_cash_collections_v1 BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON public.rabota_cash_collections FOR EACH STATEMENT EXECUTE FUNCTION private.rabota_frozen_cash_archive_v1();
CREATE TRIGGER rabota_frozen_cash_transfer_events_v1 BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON public.rabota_cash_transfer_events FOR EACH STATEMENT EXECUTE FUNCTION private.rabota_frozen_cash_archive_v1();
CREATE TRIGGER rabota_expense_request_id BEFORE INSERT ON public.rabota_finance_operations FOR EACH ROW EXECUTE FUNCTION private.rabota_require_expense_request_id();
CREATE TRIGGER rabota_leads_updated_at BEFORE UPDATE ON public.rabota_leads FOR EACH ROW EXECUTE FUNCTION private.rabota_leads_touch_updated_at();
CREATE TRIGGER rabota_assignment_notifications AFTER INSERT OR UPDATE ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_record_assigned_notification();
CREATE TRIGGER rabota_capture_payroll_payment_v3 AFTER UPDATE OF paid ON public.rabota_orders FOR EACH ROW WHEN (((old.paid IS DISTINCT FROM true) AND (new.paid IS TRUE))) EXECUTE FUNCTION private.rabota_capture_payroll_payment_v3();
CREATE TRIGGER rabota_capture_travel_payroll AFTER INSERT OR UPDATE OF travel_amount, travel_taken ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_capture_travel_payroll();
CREATE TRIGGER rabota_keep_travel_payroll_history BEFORE DELETE ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_capture_travel_payroll();
CREATE TRIGGER rabota_link_master_trigger BEFORE INSERT OR UPDATE OF master ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_link_master();
CREATE TRIGGER rabota_link_new_order_to_lead_trigger AFTER INSERT ON public.rabota_orders FOR EACH ROW WHEN (((new.lead_id IS NOT NULL) AND (new.status <> 'Отменён'::text))) EXECUTE FUNCTION private.rabota_link_new_order_to_lead();
CREATE TRIGGER rabota_lock_travel_payroll BEFORE INSERT OR UPDATE OF travel_amount, travel_taken ON public.rabota_orders FOR EACH STATEMENT EXECUTE FUNCTION private.rabota_lock_travel_payroll();
CREATE TRIGGER rabota_order_number_guard_trigger BEFORE INSERT OR UPDATE ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_order_number_guard();
CREATE TRIGGER rabota_paid_order_guard_trigger BEFORE INSERT OR DELETE OR UPDATE ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_paid_order_guard();
CREATE TRIGGER zz_rabota_orders_updated_at_revision BEFORE INSERT OR UPDATE ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_stamp_order_updated_at();

-- Sequence ownership
ALTER SEQUENCE public.rabota_order_number_seq OWNED BY public.rabota_orders.order_number;

-- Explicit role privileges
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_accounting_payouts_v1(p_activated_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_accounting_receipts_v1(p_master_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_ai_apply_order_travel() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_capture_payroll_payment_v3() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_capture_travel_payroll() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_enforce_master_day_capacity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_frozen_cash_archive_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_leads_touch_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_link_master() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_link_new_order_to_lead() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_lock_travel_payroll() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_my_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_order_number_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE private.rabota_order_reschedule_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_order_reschedule_history(p_order_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_paid_order_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_payroll_activate_v3(p_master_user_id uuid, p_approved_by uuid, p_backup_reference text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE private.rabota_payroll_cash_review_v3 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE private.rabota_payroll_cutover_holds_v3 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE private.rabota_payroll_earnings_v3 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_payroll_operations_v3(p_master_user_id uuid, p_activated_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE private.rabota_payroll_payout_review_v3 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE private.rabota_payroll_policy_v3 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE private.rabota_payroll_refunds_v3 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_payroll_totals_v3(p_master_user_id uuid, p_activated_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE private.rabota_payroll_travel_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_record_assigned_notification() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_require_expense_request_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_reschedule_block_minutes(p_radiators integer, p_floor_loops integer, p_address text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_reschedule_event_json(p_event private.rabota_order_reschedule_events) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_reschedule_order(p_order_id uuid, p_request_id uuid, p_expected_updated_at timestamp with time zone, p_appointment_date date, p_appointment_time time without time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.rabota_stamp_order_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_ai_chats FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_ai_confirm_order(p_draft_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_ai_confirm_order_v2(p_draft_id uuid, p_allow_tight_schedule boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_ai_messages FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_ai_order_drafts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_ai_prepare_order(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_ai_prepare_order_v2(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text, p_radiators integer, p_floor_loops integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_ai_prepare_order_v3(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text, p_radiators integer, p_floor_loops integer, p_travel_amount numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_approve_master(p_user_id uuid, p_master_name text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_cash_collections FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_cash_transfer_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_cashbook_entries FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_cashbook_record_v1(p_kind text, p_amount numeric, p_from_account text, p_to_account text, p_note text, p_request_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_delete_order(p_order_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_finance_operations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_finance_record(p_kind text, p_amount numeric, p_master_user_id uuid, p_note text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_finance_void(p_operation_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_growth_plan FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_leads FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_master_action(p_order_id uuid, p_action text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_members FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_order_notifications FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON SEQUENCE public.rabota_order_notifications_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON SEQUENCE public.rabota_order_number_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_order_reschedule_history(p_order_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_orders FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_payroll_payout_v3(p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_payroll_refund_v3(p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_payroll_refund_v3(p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid, p_travel_taken boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_payroll_snapshot_v3() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_provision_master(p_user_id uuid, p_master_name text, p_login text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.rabota_push_subscriptions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_record_expense_v1(p_amount numeric, p_note text, p_request_id uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_record_order_payment(p_order_id uuid, p_amount numeric, p_method text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_request_access() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_reschedule_order(p_order_id uuid, p_request_id uuid, p_expected_updated_at timestamp with time zone, p_appointment_date date, p_appointment_time time without time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.rabota_salary_payout_v2(p_kind text, p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.rabota_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.rabota_order_reschedule_history(p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.rabota_reschedule_order(p_order_id uuid, p_request_id uuid, p_expected_updated_at timestamp with time zone, p_appointment_date date, p_appointment_time time without time zone) TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_ai_chats TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_ai_chats TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_ai_confirm_order(p_draft_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_ai_confirm_order(p_draft_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_ai_confirm_order_v2(p_draft_id uuid, p_allow_tight_schedule boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_ai_confirm_order_v2(p_draft_id uuid, p_allow_tight_schedule boolean) TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_ai_messages TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_ai_messages TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_ai_order_drafts TO service_role;
GRANT SELECT ON TABLE public.rabota_ai_order_drafts TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_ai_prepare_order(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_ai_prepare_order(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_ai_prepare_order_v2(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text, p_radiators integer, p_floor_loops integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_ai_prepare_order_v2(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text, p_radiators integer, p_floor_loops integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_ai_prepare_order_v3(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text, p_radiators integer, p_floor_loops integer, p_travel_amount numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_ai_prepare_order_v3(p_action text, p_client_name text, p_date text, p_time text, p_master text, p_phone text, p_address text, p_price numeric, p_details text, p_original_date text, p_radiators integer, p_floor_loops integer, p_travel_amount numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_approve_master(p_user_id uuid, p_master_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_approve_master(p_user_id uuid, p_master_name text) TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_cash_collections TO service_role;
GRANT SELECT ON TABLE public.rabota_cash_collections TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_cash_transfer_events TO service_role;
GRANT SELECT ON TABLE public.rabota_cash_transfer_events TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_cashbook_entries TO service_role;
GRANT SELECT ON TABLE public.rabota_cashbook_entries TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_cashbook_record_v1(p_kind text, p_amount numeric, p_from_account text, p_to_account text, p_note text, p_request_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_cashbook_record_v1(p_kind text, p_amount numeric, p_from_account text, p_to_account text, p_note text, p_request_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_delete_order(p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_delete_order(p_order_id uuid) TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_finance_operations TO service_role;
GRANT MAINTAIN, SELECT ON TABLE public.rabota_finance_operations TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_finance_record(p_kind text, p_amount numeric, p_master_user_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_finance_record(p_kind text, p_amount numeric, p_master_user_id uuid, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_finance_void(p_operation_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_finance_void(p_operation_id uuid) TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_growth_plan TO service_role;
GRANT SELECT, UPDATE (completed), UPDATE (completed_at), UPDATE (updated_at) ON TABLE public.rabota_growth_plan TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE (address), UPDATE (client_will_call), UPDATE (consent), UPDATE (date_approx), UPDATE (follow_up_date), UPDATE (follow_up_time), UPDATE (history), UPDATE (loops), UPDATE (material), UPDATE (name), UPDATE (notes), UPDATE (phone), UPDATE (phone_normalized), UPDATE (price_agreed), UPDATE (radiators), UPDATE (reason), UPDATE (status) ON TABLE public.rabota_leads TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_leads TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_master_action(p_order_id uuid, p_action text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_master_action(p_order_id uuid, p_action text) TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_members TO service_role;
GRANT SELECT, UPDATE (active), UPDATE (master_name), UPDATE (role) ON TABLE public.rabota_members TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_order_notifications TO service_role;
GRANT SELECT, UPDATE (read_at) ON TABLE public.rabota_order_notifications TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.rabota_order_notifications_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.rabota_order_notifications_id_seq TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.rabota_order_number_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.rabota_order_number_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_order_reschedule_history(p_order_id uuid) TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_orders TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.rabota_orders TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_payout_v3(p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_payout_v3(p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_refund_v3(p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_refund_v3(p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_refund_v3(p_order_id uuid, p_amount numeric, p_note text, p_request_id uuid, p_travel_taken boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_snapshot_v3() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_payroll_snapshot_v3() TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_provision_master(p_user_id uuid, p_master_name text, p_login text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_provision_master(p_user_id uuid, p_master_name text, p_login text) TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.rabota_push_subscriptions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rabota_push_subscriptions TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_record_expense_v1(p_amount numeric, p_note text, p_request_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_record_expense_v1(p_amount numeric, p_note text, p_request_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_record_order_payment(p_order_id uuid, p_amount numeric, p_method text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_record_order_payment(p_order_id uuid, p_amount numeric, p_method text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_request_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_request_access() TO service_role;
GRANT EXECUTE ON FUNCTION public.rabota_reschedule_order(p_order_id uuid, p_request_id uuid, p_expected_updated_at timestamp with time zone, p_appointment_date date, p_appointment_time time without time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_salary_payout_v2(p_kind text, p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_salary_payout_v2(p_kind text, p_amount numeric, p_payment_method text, p_note text, p_request_id uuid, p_master_user_id uuid) TO service_role;

-- Deliberately omit the production push hook and push secrets RPC entirely.
REVOKE ALL ON TABLE public.rabota_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.rabota_push_subscriptions TO authenticated;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE private.rabota_qa_setup (
  name text PRIMARY KEY,
  actors uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.rabota_qa_setup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.rabota_qa_setup FROM PUBLIC, anon, authenticated, service_role;

DO $mark$
BEGIN
  EXECUTE format('CREATE FUNCTION public.rabota_qa_project_ref() RETURNS text LANGUAGE sql
    STABLE SET search_path = %L AS %L','',format('SELECT %L::text',current_setting('rabota.qa_project_ref')));
END;
$mark$;
REVOKE ALL ON FUNCTION public.rabota_qa_project_ref() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rabota_qa_project_ref() TO service_role;

SET LOCAL check_function_bodies = on;
NOTIFY pgrst, 'reload schema';
COMMIT;
