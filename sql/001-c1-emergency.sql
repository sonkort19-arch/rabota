-- C1 only. No business-row changes. Apply only after separate owner approval.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF coalesce((SELECT md5(pg_get_functiondef(to_regprocedure('public.rabota_record_order_payment(uuid,numeric,text)')))),'') NOT IN ('9f5f08e98260d60cb527971301b72caf','5470a68b3600bedc2ac13ee16181167c') THEN RAISE EXCEPTION 'Payment RPC drift; stop and review'; END IF; END $guard$;
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
  select * into v_order from public.rabota_orders where id=p_order_id for update;
  if not found then raise exception 'Заказ не найден'; end if;
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
  if exists(select 1 from public.rabota_cash_collections where order_id=p_order_id) then
    raise exception 'По этому заказу уже создано финансовое распределение';
  end if;
  v_receiver := case when v_role='master' then 'master' else 'company' end;
  update public.rabota_orders
    set status='Выполнен', paid=true,
        price=p_amount, payment_method=p_method, payment_amount=p_amount,
        payment_received_by=v_receiver, paid_at=now(), paid_by=auth.uid(),
        completed_at=coalesce(v_order.completed_at,now()), updated_at=now()
    where id=p_order_id;
  return jsonb_build_object('ok',true,'amount',p_amount,'method',p_method,'receiver',v_receiver);
end $function$
;
COMMIT;
