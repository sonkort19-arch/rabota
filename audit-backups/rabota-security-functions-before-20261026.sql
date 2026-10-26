-- Snapshot of the EXACT original functions BEFORE security fix (2026-10-26).
-- Supabase: ma-svyaz-2. Rollback functions only; not a full database backup.
-- Review before running. No customer, finance or auth rows in this file.

-- rabota_approve_master
CREATE OR REPLACE FUNCTION public.rabota_approve_master(p_user_id uuid, p_master_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare name_clean text := btrim(coalesce(p_master_name,''));
begin
  if (select private.rabota_my_role()) <> 'owner' then raise exception 'Доступ запрещён'; end if;
  if p_user_id is null or p_user_id=auth.uid() then raise exception 'Некорректный сотрудник'; end if;
  if length(name_clean) not between 1 and 100 then raise exception 'Укажите имя мастера'; end if;
  update public.rabota_members
    set active=true, role='master', master_name=name_clean
    where user_id=p_user_id and role<>'owner';
  if not found then raise exception 'Заявка сотрудника не найдена'; end if;
  update public.rabota_orders
    set assigned_user_id=p_user_id, updated_at=now()
    where assigned_user_id is null and lower(btrim(master))=lower(name_clean);
  return true;
end
$function$;

-- rabota_cash_confirm
CREATE OR REPLACE FUNCTION public.rabota_cash_confirm(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or (select private.rabota_my_role())<>'owner' then
  raise exception 'Только владелец может подтвердить поступление денег';
 end if;
 update public.rabota_cash_collections
 set confirmed_at=now(),confirmed_by=auth.uid()
 where order_id=p_order_id and submitted_at is not null and confirmed_at is null;
 if not found then raise exception 'Ожидающая подтверждения сдача денег не найдена'; end if;
 return true;
end
$function$;

-- rabota_cash_distribute
CREATE OR REPLACE FUNCTION public.rabota_cash_distribute(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_order public.rabota_orders%rowtype;
 v_raul numeric(12,2);
 v_company numeric(12,2);
 v_timur constant numeric(12,2):=1500;
begin
 if auth.uid() is null or (select private.rabota_my_role())<>'master' then
  raise exception 'Доступ разрешён только мастеру';
 end if;
 if not exists (
  select 1 from public.rabota_members
  where user_id=auth.uid() and role='master' and active=true
    and lower(btrim(master_name))='рауль'
 ) then
  raise exception 'Доступ к распределению не предоставлен';
 end if;
 select * into v_order
 from public.rabota_orders where id=p_order_id for update;
 if not found or v_order.assigned_user_id is distinct from auth.uid() then
  raise exception 'Заказ не назначен этому мастеру';
 end if;
 if v_order.status not in ('В работе','Выполнен') then
  raise exception 'Сначала примите заказ в работу';
 end if;
 if v_order.paid then
  raise exception 'Заказ уже отмечен оплаченным. Обратитесь к администратору';
 end if;
 if v_order.price is null or v_order.price<=3000 then
  raise exception 'Недостаточная сумма заказа для распределения. Обратитесь к администратору';
 end if;
 if exists (select 1 from public.rabota_cash_collections c where c.order_id=p_order_id) then
  raise exception 'Распределение уже записано';
 end if;
 -- Raul gets a full 50% of the gross. Timur's fixed 1500 comes from
 -- the other half, leaving the company gross*50%-1500.
 v_raul:=round(v_order.price*0.5,2);
 v_company:=v_order.price-v_raul-v_timur;

 update public.rabota_orders
 set status='Выполнен',paid=true,
     completed_at=coalesce(v_order.completed_at,now()),
     updated_at=now()
 where id=p_order_id;

 insert into public.rabota_cash_collections(
  order_id,master_user_id,gross,raul_amount,timur_amount,company_amount
 ) values (p_order_id,auth.uid(),v_order.price,v_raul,v_timur,v_company);
 insert into public.rabota_finance_operations(kind,amount,master_user_id,note,created_by,order_id)
 values
  ('raul_payout',v_raul,auth.uid(),'Рауль забрал долю за заказ '||coalesce(v_order.name,'клиента'),auth.uid(),p_order_id),
  ('timur_payout',v_timur,auth.uid(),'Тимуру выдано за заказ '||coalesce(v_order.name,'клиента'),auth.uid(),p_order_id);

 return jsonb_build_object('ok',true,'raul',v_raul,'timur',v_timur,'company',v_company,'completed',true);
end
$function$;

-- rabota_cash_submit
CREATE OR REPLACE FUNCTION public.rabota_cash_submit(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or (select private.rabota_my_role())<>'master' then
  raise exception 'Только мастер может отметить сдачу денег';
 end if;
 update public.rabota_cash_collections
 set submitted_at=now()
 where order_id=p_order_id and master_user_id=auth.uid()
   and submitted_at is null;
 if not found then
  raise exception 'Распределение не найдено или деньги уже отмечены переданными';
 end if;
 return true;
end
$function$;

-- rabota_finance_record
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
  if (select private.rabota_my_role()) <> 'owner' then
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

-- rabota_finance_void
CREATE OR REPLACE FUNCTION public.rabota_finance_void(p_operation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if (select private.rabota_my_role())<>'owner' then
  raise exception 'Только администратор может отменить операцию';
 end if;
 update public.rabota_finance_operations
 set voided_at=now(),voided_by=auth.uid()
 where id=p_operation_id and voided_at is null and order_id is null;
 if not found then raise exception 'Операция не найдена или автоматически учтена в распределении заказа'; end if;
 return true;
end
$function$;

-- rabota_master_action
CREATE OR REPLACE FUNCTION public.rabota_master_action(p_order_id uuid, p_action text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_status text; new_status text;
begin
  if (select private.rabota_my_role()) <> 'master' then raise exception 'Доступ запрещён'; end if;
  select status into current_status from public.rabota_orders
    where id=p_order_id and assigned_user_id=auth.uid() for update;
  if not found then raise exception 'Заказ недоступен'; end if;
  if p_action='accept' and current_status in ('Новый','Записан') then
    new_status := 'В работе';
  elsif p_action='complete' and current_status='В работе' then
    new_status := 'Выполнен';
  else
    raise exception 'Недопустимый переход статуса';
  end if;
  update public.rabota_orders
  set status=new_status, completed_at=case when new_status='Выполнен' then now() else null end,
      updated_at=now()
  where id=p_order_id;
  return new_status;
end
$function$;

-- rabota_provision_master
CREATE OR REPLACE FUNCTION public.rabota_provision_master(p_user_id uuid, p_master_name text, p_login text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text := btrim(coalesce(p_master_name,''));
declare v_login text := lower(btrim(coalesce(p_login,'')));
begin
  if (select private.rabota_my_role()) <> 'owner' then
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
  update public.rabota_members
  set active=false
  where active=true and role='master' and lower(btrim(master_name))=lower(v_name);
  insert into public.rabota_members (user_id,role,active,master_name,email)
  values (p_user_id,'master',true,v_name,v_login || '@staff.rabota.invalid');
  update public.rabota_orders
  set assigned_user_id=p_user_id,updated_at=now()
  where lower(btrim(master))=lower(v_name);
  return true;
end
$function$;
