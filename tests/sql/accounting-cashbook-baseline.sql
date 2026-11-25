-- Synthetic cashbook table and audited pre-cutover function. Used only by
-- the disposable accounting migration integration test.
\set ON_ERROR_STOP on
CREATE TABLE public.rabota_cashbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  amount numeric NOT NULL,
  from_account text,
  to_account text,
  note text NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.rabota_cashbook_record_v1(p_kind text, p_amount numeric, p_from_account text, p_to_account text, p_note text, p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_actor uuid:=auth.uid();
 v_id uuid;
 v_old public.rabota_cashbook_entries%rowtype;
 v_note text:=btrim(coalesce(p_note,''));
begin
 if v_actor is null or (select private.rabota_my_role()) is distinct from 'owner' then
  raise exception 'Только владелец может проводить операции кассы';
 end if;
 if p_kind not in ('income','expense','transfer') then raise exception 'Некорректный тип операции'; end if;
 if p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) then
  raise exception 'Некорректная сумма'; end if;
 if p_request_id is null then raise exception 'Не указан идентификатор операции'; end if;
 if length(v_note)<1 or length(v_note)>240 then raise exception 'Укажите комментарий до 240 символов'; end if;
 if not (
   (p_kind='income' and p_from_account is null and p_to_account in ('cash','card'))
   or (p_kind='expense' and p_from_account in ('cash','card') and p_to_account is null)
   or (p_kind='transfer' and p_from_account in ('cash','card') and p_to_account in ('cash','card') and p_from_account<>p_to_account)
 ) then raise exception 'Неверное направление денег'; end if;
 select * into v_old from public.rabota_cashbook_entries where request_id=p_request_id;
 if found then
  if v_old.created_by<>v_actor or v_old.kind<>p_kind or v_old.amount<>p_amount
    or v_old.from_account is distinct from p_from_account or v_old.to_account is distinct from p_to_account then
   raise exception 'Идентификатор принадлежит другой операции'; end if;
  return v_old.id;
 end if;
 insert into public.rabota_cashbook_entries(kind,amount,from_account,to_account,note,request_id,created_by)
 values(p_kind,p_amount,p_from_account,p_to_account,v_note,p_request_id,v_actor) returning id into v_id;
 return v_id;
end $function$;
REVOKE EXECUTE ON FUNCTION public.rabota_cashbook_record_v1(text,numeric,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rabota_cashbook_record_v1(text,numeric,text,text,text,uuid) TO authenticated;
INSERT INTO public.rabota_cashbook_entries(kind,amount,from_account,to_account,note,request_id,created_by)
VALUES('transfer',42,'card','cash','Fixture earlier recorded transfer',
 '20000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000001');

-- Mimic a verified historical order imported before payment metadata existed.
-- Its receipt was already confirmed and staged in the old payroll ledger.
ALTER TABLE public.rabota_orders DISABLE TRIGGER rabota_paid_order_guard_trigger;
UPDATE public.rabota_orders
SET payment_amount=NULL,payment_method=NULL,payment_received_by=NULL,paid_at=NULL,paid_by=NULL
WHERE id='10000000-0000-4000-8000-000000000030';
ALTER TABLE public.rabota_orders ENABLE TRIGGER rabota_paid_order_guard_trigger;
