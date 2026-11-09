-- REVIEWED DEPLOYMENT SCRIPT, NOT APPLIED TO PRODUCTION.
-- Baseline: 2026-11-09 schema-only catalog inspection.
-- Run in a transaction after a backup and staging tests. No business-row backfill.
begin;
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
  if coalesce(private.rabota_my_role(),'') not in ('owner','manager') then
    raise exception 'Недостаточно прав для привязки лида к заказу';
  end if;
  select * into lead_rec from public.rabota_leads where id=new.lead_id for update;
  if not found then raise exception 'Лид не найден: обновите список'; end if;
  if exists(select 1 from public.rabota_orders o
    where o.lead_id=new.lead_id and o.id<>new.id and o.status<>'Отменён') then
    raise exception 'По этому лиду уже создан заказ. Обновите список.' using errcode='23505';
  end if;
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
$function$
;

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
    and o.appointment_time=v_time and lower(btrim(o.master))=lower(btrim(v_master)))
 then raise exception 'В это время уже есть запись другого клиента'; end if;
 select count(*) into v_day_count from public.rabota_orders o where o.id is distinct from v_order_id
  and o.appointment_date=v_date and o.status<>'Отменён' and lower(btrim(o.master))=lower(btrim(v_master));
 if v_day_count>=2 then raise exception 'У мастера уже два заказа на этот день. Третий запрещён'; end if;
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
$function$
;

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
   and lower(btrim(o.master))=lower(btrim(d.master_name))
 limit 1;
 if other_name is not null then raise exception 'Точное время уже занято: %',other_name; end if;
 select count(*) into v_day_count from public.rabota_orders o
 where o.id is distinct from d.target_order_id and o.status<>'Отменён'
   and o.appointment_date=d.appointment_date and lower(btrim(o.master))=lower(btrim(d.master_name));
 if v_day_count>=2 then raise exception 'У мастера уже два заказа на этот день. Третий запрещён'; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION private.rabota_cash_order_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if (old.paid or exists(select 1 from public.rabota_cash_collections c where c.order_id=old.id))
 and (
  new.price is distinct from old.price
  or new.paid is distinct from old.paid
  or new.status is distinct from old.status
  or new.assigned_user_id is distinct from old.assigned_user_id
  or new.master is distinct from old.master
  or new.payment_amount is distinct from old.payment_amount
  or new.payment_method is distinct from old.payment_method
  or new.payment_received_by is distinct from old.payment_received_by
  or new.paid_at is distinct from old.paid_at
  or new.paid_by is distinct from old.paid_by
 ) then
  raise exception 'Оплаченный или распределённый заказ: финансовые поля защищены от изменений. Обратитесь к администратору';
 end if;
 return new;
end
$function$
;

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
 v_raul_due numeric;
 v_timur_due numeric;
 v_timur constant numeric(12,2):=1500;
begin
 if auth.uid() is null or (select private.rabota_my_role()) is distinct from 'master' then
  raise exception 'Доступ разрешён только мастеру';
 end if;
 if not exists (
  select 1 from public.rabota_members
  where user_id=auth.uid() and role='master' and active=true
    and lower(btrim(master_name))='рауль'
 ) then
  raise exception 'Доступ к распределению не предоставлен';
 end if;
 -- Same lock as manual payouts: serialize both paths for this employee.
 perform 1 from public.rabota_members where user_id=auth.uid() for update;
 select * into v_order from public.rabota_orders where id=p_order_id for update;
 if not found or v_order.assigned_user_id is distinct from auth.uid() then
  raise exception 'Заказ не назначен этому мастеру';
 end if;
 if v_order.status not in ('В работе','Выполнен') then
  raise exception 'Сначала примите заказ в работу';
 end if;
 if v_order.price is null or v_order.price<=3000 then
  raise exception 'Недостаточная сумма заказа для распределения. Обратитесь к администратору';
 end if;
 if v_order.paid and (v_order.payment_method is distinct from 'cash' or v_order.payment_received_by is distinct from 'master') then
  raise exception 'Распределение наличных недоступно для этого способа оплаты';
 end if;
 if exists(select 1 from public.rabota_cash_collections c where c.order_id=p_order_id) then
  raise exception 'Распределение уже записано';
 end if;
 v_raul:=round(v_order.price*0.5,2);
 v_company:=v_order.price-v_raul-v_timur;
 select coalesce(sum(round(o.price*0.5,2)),0),count(*)*1500 into v_raul_due,v_timur_due
 from public.rabota_orders o where o.assigned_user_id=auth.uid()
 and o.status='Выполнен' and o.paid and o.id<>p_order_id;
 v_raul_due:=v_raul_due+v_raul-coalesce((select sum(f.amount)
   from public.rabota_finance_operations f where f.master_user_id=auth.uid()
   and f.kind='raul_payout' and f.voided_at is null),0);
 v_timur_due:=v_timur_due+v_timur-coalesce((select sum(f.amount)
   from public.rabota_finance_operations f where f.master_user_id=auth.uid()
   and f.kind='timur_payout' and f.voided_at is null),0);
 if v_raul_due<v_raul or v_timur_due<v_timur then
   raise exception 'Доли уже частично выплачены через финансы. Автоматическое распределение приведёт к переплате; обратитесь к владельцу.';
 end if;
 update public.rabota_orders
 set status='Выполнен',paid=true, completed_at=coalesce(v_order.completed_at,now()),
   payment_method=coalesce(v_order.payment_method,'cash'),
   payment_amount=coalesce(v_order.payment_amount,v_order.price),
   payment_received_by=coalesce(v_order.payment_received_by,'master'),
   paid_at=coalesce(v_order.paid_at,now()),paid_by=coalesce(v_order.paid_by,auth.uid()),
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
end $function$
;

-- A separate RPC preserves compatibility; deploy this script BEFORE the client.
alter table public.rabota_finance_operations add column if not exists request_id uuid;
create unique index if not exists rabota_finance_request_id_unique
 on public.rabota_finance_operations(request_id) where request_id is not null;

create or replace function public.rabota_finance_record_v2(
 p_request_id uuid,p_kind text,p_amount numeric,p_master_user_id uuid default null,p_note text default ''
) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.rabota_finance_operations%rowtype; result_id uuid;
begin
 if auth.uid() is null or (select private.rabota_my_role()) is distinct from 'owner' then
   raise exception 'Только владелец может проводить финансовые операции' using errcode='42501';
 end if;
 if p_request_id is null then raise exception 'Не указан ключ финансовой операции'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rabota:finance:'||p_request_id::text,0));
 select * into existing from public.rabota_finance_operations where request_id=p_request_id;
 if found then
   if existing.created_by is distinct from auth.uid()
     or existing.kind is distinct from btrim(coalesce(p_kind,''))
     or existing.amount is distinct from p_amount
     or existing.master_user_id is distinct from (case when p_kind='expense' then null else p_master_user_id end)
     or existing.note is distinct from btrim(coalesce(p_note,''))
   then raise exception 'Ключ операции уже использован с другими данными'; end if;
   return existing.id;
 end if;
 result_id:=public.rabota_finance_record(p_kind,p_amount,p_master_user_id,p_note);
 update public.rabota_finance_operations set request_id=p_request_id where id=result_id;
 return result_id;
end $$;
revoke all on function public.rabota_finance_record_v2(uuid,text,numeric,uuid,text) from public,anon;
grant execute on function public.rabota_finance_record_v2(uuid,text,numeric,uuid,text) to authenticated;

-- Authoritative versions for conditional REST updates; never trust a client clock.
create or replace function private.rabota_orders_touch_updated_at()
returns trigger language plpgsql set search_path='' as $
begin new.updated_at:=clock_timestamp(); return new; end $;
drop trigger if exists rabota_orders_updated_at on public.rabota_orders;
create trigger rabota_orders_updated_at before update on public.rabota_orders
for each row execute function private.rabota_orders_touch_updated_at();
commit;
