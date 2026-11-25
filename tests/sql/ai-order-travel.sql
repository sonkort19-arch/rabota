-- Synthetic fixture for the migration's compatibility with the existing v2
-- confirmation workflow. Run after the base travel ledger migration.
\set ON_ERROR_STOP on

CREATE TABLE public.rabota_ai_order_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  action text NOT NULL,
  client_name text NOT NULL,
  price numeric,
  state text NOT NULL DEFAULT 'pending',
  result_order_id uuid REFERENCES public.rabota_orders(id)
);
ALTER TABLE public.rabota_ai_order_drafts ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.rabota_ai_prepare_order_v2(
  p_action text, p_client_name text, p_date text, p_time text,
  p_master text, p_phone text, p_address text, p_price numeric,
  p_details text, p_original_date text, p_radiators integer, p_floor_loops integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fixture$
DECLARE
  v_draft uuid;
BEGIN
  IF (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Fixture owner only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.rabota_ai_order_drafts(owner_id,action,client_name,price)
    VALUES(auth.uid(),p_action,p_client_name,p_price) RETURNING id INTO v_draft;
  RETURN jsonb_build_object('draft_id',v_draft,'price',p_price);
END;
$fixture$;

CREATE FUNCTION public.rabota_ai_confirm_order_v2(p_draft_id uuid, p_allow_tight_schedule boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fixture$
DECLARE
  v_draft public.rabota_ai_order_drafts%ROWTYPE;
  v_order uuid;
BEGIN
  IF (SELECT private.rabota_my_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Fixture owner only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT v_draft FROM public.rabota_ai_order_drafts
    WHERE id=p_draft_id AND owner_id=auth.uid() FOR UPDATE;
  IF v_draft.state='applied' THEN
    RETURN jsonb_build_object('ok',true,'already_applied',true,'order_id',v_draft.result_order_id);
  END IF;
  INSERT INTO public.rabota_orders(name,price,master,assigned_user_id,created_by,order_number)
    VALUES(v_draft.client_name,v_draft.price,'Рауль','00000000-0000-4000-8000-000000000003',auth.uid(),18901)
    RETURNING id INTO v_order;
  UPDATE public.rabota_ai_order_drafts SET state='applied',result_order_id=v_order WHERE id=p_draft_id;
  RETURN jsonb_build_object('ok',true,'already_applied',false,'order_id',v_order);
END;
$fixture$;

\ir ../../sql/20261125131800_rabota_ai_order_travel.sql

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE
  v_preview jsonb;
  v_confirm jsonb;
  v_repeat jsonb;
  v_order uuid;
  v_travel numeric;
  v_delta numeric;
  v_events int;
BEGIN
  v_preview := public.rabota_ai_prepare_order_v3(
    p_action=>'create', p_client_name=>'Синтетическая заявка ИИ с дорогой',
    p_date=>'2026-12-31', p_time=>'13:00', p_price=>10000, p_travel_amount=>1000);
  IF (v_preview->>'travel_amount')::numeric IS DISTINCT FROM 1000 OR EXISTS(
      SELECT 1 FROM public.rabota_orders WHERE name='Синтетическая заявка ИИ с дорогой') THEN
    RAISE EXCEPTION 'AI preview must not create an order or omit the travel quote';
  END IF;
  v_confirm := public.rabota_ai_confirm_order_v2((v_preview->>'draft_id')::uuid,false);
  v_repeat := public.rabota_ai_confirm_order_v2((v_preview->>'draft_id')::uuid,false);
  v_order := (v_confirm->>'order_id')::uuid;
  SELECT travel_amount INTO STRICT v_travel FROM public.rabota_orders
    WHERE id=v_order AND price=10000 AND order_number=18901 AND NOT paid;
  SELECT count(*),sum((entry->>'delta')::numeric) INTO v_events,v_delta
    FROM jsonb_array_elements(public.rabota_payroll_snapshot_v3()->'travel_events') entry
    WHERE entry->>'order_id'=v_order::text;
  IF v_travel IS DISTINCT FROM 1000 OR v_events<>1 OR v_delta IS DISTINCT FROM 1000
    OR v_repeat->>'order_id' IS DISTINCT FROM v_confirm->>'order_id'
    OR v_repeat->>'already_applied' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Confirm and replay did not produce exactly one travel accrual';
  END IF;

  BEGIN
    PERFORM public.rabota_ai_prepare_order_v3('move','Синтетический перенос','2026-12-31','15:00',
      p_travel_amount=>1000);
    RAISE EXCEPTION 'AI move accepted a new travel surcharge';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_ai_prepare_order_v3('create','Синтетическая сумма','2026-12-31','15:00',
      p_travel_amount=>1000.001);
    RAISE EXCEPTION 'AI accepted excess decimal precision';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.rabota_ai_prepare_order_v3('create','Синтетический лимит','2026-12-31','15:00',
      p_price=>10000000,p_travel_amount=>0.01);
    RAISE EXCEPTION 'AI preview accepted a gross amount above the maximum payment';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END;
$test$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $test$
BEGIN
  BEGIN
    PERFORM public.rabota_ai_prepare_order_v3('create','Синтетический запрет','2026-12-31','15:00',
      p_travel_amount=>1000);
    RAISE EXCEPTION 'Manager prepared an AI draft with travel';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;
ROLLBACK;

SELECT 'PASS: AI preview preserves wash and travel; v2 confirmation applies travel once; invalid and unauthorized requests are denied';
