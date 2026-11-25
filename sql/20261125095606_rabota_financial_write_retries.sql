-- Keep the existing ledgers and financial rules. Give each new expense an
-- operation ID and make retries of both cashbook writes and expenses atomic.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('public.rabota_finance_operations'::regclass),
                 ('public.rabota_cashbook_entries'::regclass)) AS ledger(oid)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
      WHERE i.indrelid=ledger.oid AND a.attname='request_id' AND i.indnkeyatts=1
        AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready AND i.indpred IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'The expense and cashbook ledgers require an immediate unique request_id index.';
  END IF;
END;
$preflight$;

CREATE FUNCTION private.rabota_require_expense_request_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $$
BEGIN
  IF NEW.kind = 'expense' AND NEW.request_id IS NULL THEN
    RAISE EXCEPTION 'Обновите приложение перед записью расхода'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.rabota_require_expense_request_id() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER rabota_expense_request_id
BEFORE INSERT ON public.rabota_finance_operations
FOR EACH ROW EXECUTE FUNCTION private.rabota_require_expense_request_id();

CREATE FUNCTION public.rabota_record_expense_v1(
  p_amount numeric, p_note text, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.rabota_record_expense_v1(numeric,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabota_record_expense_v1(numeric,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rabota_cashbook_record_v1(
  p_kind text, p_amount numeric, p_from_account text, p_to_account text, p_note text, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
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
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
