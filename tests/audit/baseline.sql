-- Schema-only subset read from production on 2026-11-09; NO business data.
-- For a disposable LOCAL PostgreSQL only.
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
create schema auth;
create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.rabota_ai_order_drafts (
 "id" uuid default gen_random_uuid() not null,
 "owner_id" uuid not null,
 "action" text not null,
 "target_order_id" uuid,
 "expected_updated_at" timestamp with time zone,
 "client_name" text not null,
 "client_phone" text default ''::text not null,
 "client_address" text default ''::text not null,
 "appointment_date" date not null,
 "appointment_time" time without time zone not null,
 "master_name" text not null,
 "master_user_id" uuid not null,
 "price" numeric,
 "details" text default ''::text not null,
 "old_summary" jsonb,
 "state" text default 'pending'::text not null,
 "result_order_id" uuid,
 "created_at" timestamp with time zone default now() not null,
 "expires_at" timestamp with time zone default (now() + '00:15:00'::interval) not null,
 "radiators" integer,
 "floor_loops" integer
);
create table public.rabota_cash_collections (
 "order_id" uuid not null,
 "master_user_id" uuid not null,
 "gross" numeric(12,2) not null,
 "raul_amount" numeric(12,2) not null,
 "timur_amount" numeric(12,2) not null,
 "company_amount" numeric(12,2) not null,
 "created_at" timestamp with time zone default now() not null,
 "submitted_at" timestamp with time zone,
 "confirmed_at" timestamp with time zone,
 "confirmed_by" uuid
);
create table public.rabota_finance_operations (
 "id" uuid default gen_random_uuid() not null,
 "kind" text not null,
 "amount" numeric(12,2) not null,
 "master_user_id" uuid,
 "note" text default ''::text not null,
 "created_at" timestamp with time zone default now() not null,
 "created_by" uuid,
 "voided_at" timestamp with time zone,
 "voided_by" uuid,
 "order_id" uuid
);
create table public.rabota_leads (
 "id" uuid default gen_random_uuid() not null,
 "name" text not null,
 "phone" text not null,
 "phone_normalized" text not null,
 "address" text default ''::text not null,
 "radiators" integer,
 "material" text default ''::text not null,
 "loops" integer,
 "notes" text default ''::text not null,
 "status" text default 'new'::text not null,
 "reason" text default 'none'::text not null,
 "follow_up_date" date,
 "follow_up_time" time without time zone default '18:00:00'::time without time zone not null,
 "date_approx" boolean default false not null,
 "client_will_call" boolean default false not null,
 "consent" boolean default false not null,
 "price_agreed" boolean default false not null,
 "history" jsonb default '[]'::jsonb not null,
 "created_by" uuid default auth.uid() not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
create table public.rabota_members (
 "user_id" uuid not null,
 "role" text default 'manager'::text not null,
 "active" boolean default true not null,
 "created_at" timestamp with time zone default now() not null,
 "master_name" text default ''::text not null,
 "email" text default ''::text not null
);
create table public.rabota_orders (
 "id" uuid default gen_random_uuid() not null,
 "name" text not null,
 "phone" text default ''::text not null,
 "address" text default ''::text not null,
 "radiator_type" text default ''::text not null,
 "radiators" integer,
 "floor_loops" integer,
 "master" text default ''::text not null,
 "appointment_date" date,
 "appointment_time" time without time zone,
 "price" numeric(12,2),
 "paid" boolean default false not null,
 "status" text default 'Новый'::text not null,
 "details" text default ''::text not null,
 "legacy_id" text,
 "created_by" uuid default auth.uid(),
 "completed_at" timestamp with time zone,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "assigned_user_id" uuid,
 "payment_method" text,
 "payment_amount" numeric(12,2),
 "payment_received_by" text,
 "paid_at" timestamp with time zone,
 "paid_by" uuid,
 "lead_id" uuid
);
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_drafts_floor_loops_check" CHECK (((floor_loops IS NULL) OR ((floor_loops >= 0) AND (floor_loops <= 300))));
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_drafts_radiators_check" CHECK (((radiators IS NULL) OR ((radiators >= 0) AND (radiators <= 300))));
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_order_drafts_action_check" CHECK ((action = ANY (ARRAY['create'::text, 'move'::text])));
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_order_drafts_master_user_id_fkey" FOREIGN KEY (master_user_id) REFERENCES auth.users(id);
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_order_drafts_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id);
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_order_drafts_pkey" PRIMARY KEY (id);
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_order_drafts_result_order_id_fkey" FOREIGN KEY (result_order_id) REFERENCES rabota_orders(id);
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_order_drafts_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'applied'::text])));
alter table public.rabota_ai_order_drafts add constraint "rabota_ai_order_drafts_target_order_id_fkey" FOREIGN KEY (target_order_id) REFERENCES rabota_orders(id);
alter table public.rabota_cash_collections add constraint "rabota_cash_amounts_balance" CHECK ((gross = ((raul_amount + timur_amount) + company_amount)));
alter table public.rabota_cash_collections add constraint "rabota_cash_collections_company_amount_check" CHECK ((company_amount > (0)::numeric));
alter table public.rabota_cash_collections add constraint "rabota_cash_collections_confirmed_by_fkey" FOREIGN KEY (confirmed_by) REFERENCES auth.users(id);
alter table public.rabota_cash_collections add constraint "rabota_cash_collections_gross_check" CHECK ((gross > (3000)::numeric));
alter table public.rabota_cash_collections add constraint "rabota_cash_collections_master_user_id_fkey" FOREIGN KEY (master_user_id) REFERENCES auth.users(id);
alter table public.rabota_cash_collections add constraint "rabota_cash_collections_order_id_fkey" FOREIGN KEY (order_id) REFERENCES rabota_orders(id);
alter table public.rabota_cash_collections add constraint "rabota_cash_collections_pkey" PRIMARY KEY (order_id);
alter table public.rabota_cash_collections add constraint "rabota_cash_collections_raul_amount_check" CHECK ((raul_amount > (0)::numeric));
alter table public.rabota_cash_collections add constraint "rabota_cash_collections_timur_amount_check" CHECK ((timur_amount = (1500)::numeric));
alter table public.rabota_cash_collections add constraint "rabota_cash_confirm_requires_submit" CHECK (((confirmed_at IS NULL) OR (submitted_at IS NOT NULL)));
alter table public.rabota_finance_operations add constraint "rabota_finance_operations_amount_check" CHECK (((amount > (0)::numeric) AND (amount <= (10000000)::numeric)));
alter table public.rabota_finance_operations add constraint "rabota_finance_operations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.rabota_finance_operations add constraint "rabota_finance_operations_kind_check" CHECK ((kind = ANY (ARRAY['raul_payout'::text, 'timur_payout'::text, 'expense'::text])));
alter table public.rabota_finance_operations add constraint "rabota_finance_operations_master_user_id_fkey" FOREIGN KEY (master_user_id) REFERENCES auth.users(id);
alter table public.rabota_finance_operations add constraint "rabota_finance_operations_note_check" CHECK ((char_length(note) <= 240));
alter table public.rabota_finance_operations add constraint "rabota_finance_operations_order_id_fkey" FOREIGN KEY (order_id) REFERENCES rabota_orders(id);
alter table public.rabota_finance_operations add constraint "rabota_finance_operations_pkey" PRIMARY KEY (id);
alter table public.rabota_finance_operations add constraint "rabota_finance_operations_voided_by_fkey" FOREIGN KEY (voided_by) REFERENCES auth.users(id);
alter table public.rabota_finance_operations add constraint "rabota_finance_payout_master" CHECK (((kind = 'expense'::text) OR (master_user_id IS NOT NULL)));
alter table public.rabota_leads add constraint "rabota_leads_history_check" CHECK ((jsonb_typeof(history) = 'array'::text));
alter table public.rabota_leads add constraint "rabota_leads_loops_check" CHECK (((loops >= 0) AND (loops <= 999)));
alter table public.rabota_leads add constraint "rabota_leads_name_check" CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 100)));
alter table public.rabota_leads add constraint "rabota_leads_phone_check" CHECK (((length(btrim(phone)) >= 10) AND (length(btrim(phone)) <= 30)));
alter table public.rabota_leads add constraint "rabota_leads_phone_normalized_check" CHECK ((phone_normalized ~ '^7[0-9]{10}$'::text));
alter table public.rabota_leads add constraint "rabota_leads_phone_normalized_key" UNIQUE (phone_normalized);
alter table public.rabota_leads add constraint "rabota_leads_pkey" PRIMARY KEY (id);
alter table public.rabota_leads add constraint "rabota_leads_radiators_check" CHECK (((radiators >= 0) AND (radiators <= 999)));
alter table public.rabota_leads add constraint "rabota_leads_status_check" CHECK ((status = ANY (ARRAY['new'::text, 'hot'::text, 'waiting'::text, 'callback'::text, 'ready'::text, 'booked'::text, 'lost'::text])));
alter table public.rabota_members add constraint "rabota_members_pkey" PRIMARY KEY (user_id);
alter table public.rabota_members add constraint "rabota_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'master'::text])));
alter table public.rabota_members add constraint "rabota_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.rabota_orders add constraint "rabota_orders_assigned_user_id_fkey" FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.rabota_orders add constraint "rabota_orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.rabota_orders add constraint "rabota_orders_floor_loops_check" CHECK (((floor_loops IS NULL) OR (floor_loops >= 0)));
alter table public.rabota_orders add constraint "rabota_orders_lead_id_fkey" FOREIGN KEY (lead_id) REFERENCES rabota_leads(id) ON DELETE SET NULL;
alter table public.rabota_orders add constraint "rabota_orders_legacy_id_key" UNIQUE (legacy_id);
alter table public.rabota_orders add constraint "rabota_orders_name_check" CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 100)));
alter table public.rabota_orders add constraint "rabota_orders_pkey" PRIMARY KEY (id);
alter table public.rabota_orders add constraint "rabota_orders_price_check" CHECK (((price IS NULL) OR (price >= (0)::numeric)));
alter table public.rabota_orders add constraint "rabota_orders_radiators_check" CHECK (((radiators IS NULL) OR (radiators >= 0)));
alter table public.rabota_orders add constraint "rabota_orders_status_check" CHECK ((status = ANY (ARRAY['Новый'::text, 'Записан'::text, 'В работе'::text, 'Выполнен'::text, 'Отменён'::text])));
alter table public.rabota_orders add constraint "rabota_payment_amount_check" CHECK (((payment_amount IS NULL) OR (payment_amount > (0)::numeric)));
alter table public.rabota_orders add constraint "rabota_payment_method_check" CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['cash'::text, 'card'::text]))));
alter table public.rabota_orders add constraint "rabota_payment_receiver_check" CHECK (((payment_received_by IS NULL) OR (payment_received_by = ANY (ARRAY['master'::text, 'company'::text]))));
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

CREATE OR REPLACE FUNCTION public.rabota_cash_confirm(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or (select private.rabota_my_role()) IS DISTINCT FROM 'owner' then
  raise exception 'Только владелец может подтвердить поступление денег';
 end if;
 update public.rabota_cash_collections
 set confirmed_at=now(),confirmed_by=auth.uid()
 where order_id=p_order_id and submitted_at is not null and confirmed_at is null;
 if not found then raise exception 'Ожидающая подтверждения сдача денег не найдена'; end if;
 return true;
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

CREATE OR REPLACE FUNCTION private.rabota_cash_order_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.rabota_cash_collections c where c.order_id=old.id)
 and (
  new.price is distinct from old.price
  or new.paid is distinct from old.paid
  or new.status is distinct from old.status
  or new.assigned_user_id is distinct from old.assigned_user_id
  or new.master is distinct from old.master
 ) then
  raise exception 'Распределённый заказ: финансовые поля защищены от изменений. Обратитесь к администратору';
 end if;
 return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.rabota_cash_submit(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or (select private.rabota_my_role()) IS DISTINCT FROM 'master' then
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
$function$
;

CREATE OR REPLACE FUNCTION private.rabota_enforce_master_day_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  candidate_master text;
  assigned_count integer;
begin
  if new.status = 'Отменён' or new.appointment_date is null or new.appointment_time is null then
    return new;
  end if;
  candidate_master := lower(btrim(coalesce(new.master,'')));
  if tg_op = 'UPDATE' then
    if old.status <> 'Отменён'
      and old.appointment_date is not distinct from new.appointment_date
      and old.appointment_time is not distinct from new.appointment_time
      and lower(btrim(coalesce(old.master,''))) = candidate_master
    then
      return new;
    end if;
  end if;
  -- Serialize booking checks for the same master on a particular date.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rabota:orders:master:' || candidate_master || ':' || new.appointment_date::text,
      0
    )
  );
  select count(*) into assigned_count
  from public.rabota_orders r
  where r.appointment_date = new.appointment_date
    and r.status <> 'Отменён'
    and lower(btrim(coalesce(r.master,''))) = candidate_master
    and r.id is distinct from new.id;
  if assigned_count >= 2 then
    raise exception 'У мастера на эту дату уже два заказа. Выберите другой день.'
      using errcode = '23514', constraint = 'rabota_master_daily_capacity';
  end if;
  return new;
end;
$function$
;

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
$function$
;

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
$function$
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
$function$
;

CREATE OR REPLACE FUNCTION private.rabota_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.role from public.rabota_members m
  where m.user_id=(select auth.uid()) and m.active=true
  limit 1
$function$
;

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
  if auth.uid() is null or v_role not in ('owner','manager','master') then
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
CREATE TRIGGER rabota_cash_order_guard_trigger BEFORE UPDATE ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_cash_order_guard();
CREATE TRIGGER rabota_link_master_trigger BEFORE INSERT OR UPDATE OF master ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_link_master();
CREATE TRIGGER rabota_link_new_order_to_lead_trigger AFTER INSERT ON public.rabota_orders FOR EACH ROW WHEN (((new.lead_id IS NOT NULL) AND (new.status <> 'Отменён'::text))) EXECUTE FUNCTION private.rabota_link_new_order_to_lead();
CREATE TRIGGER rabota_master_daily_capacity_trigger BEFORE INSERT OR UPDATE OF appointment_date, appointment_time, master, status ON public.rabota_orders FOR EACH ROW EXECUTE FUNCTION private.rabota_enforce_master_day_capacity();
create unique index rabota_orders_active_master_slot_unique on public.rabota_orders(appointment_date,appointment_time,lower(btrim(coalesce(master,'')))) where appointment_date is not null and appointment_time is not null and status<>'Отменён';
create unique index rabota_finance_unique_cash_distribution_idx on public.rabota_finance_operations(order_id,kind) where order_id is not null;
grant usage on schema auth,private,public to authenticated,anon;
grant execute on all functions in schema auth,private,public to authenticated;
revoke execute on all functions in schema public from public,anon;
