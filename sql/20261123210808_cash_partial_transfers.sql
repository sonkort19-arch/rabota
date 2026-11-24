-- Partial handovers. Existing, timestamp-only collections remain valid.
begin;

alter table public.rabota_cash_collections
  add column submitted_amount numeric,
  add column confirmed_amount numeric,
  add column last_submitted_at timestamptz,
  add column last_confirmed_at timestamptz,
  add constraint rabota_cash_transfer_totals check (
    (submitted_amount is null and confirmed_amount is null)
    or (submitted_amount is not null and confirmed_amount is not null
      and company_amount is not null and confirmed_amount >= 0
      and confirmed_amount <= submitted_amount and submitted_amount <= company_amount)
  );

create table public.rabota_cash_transfer_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  order_id uuid not null references public.rabota_cash_collections(order_id),
  master_user_id uuid not null,
  kind text not null check (kind in ('submitted','confirmed')),
  amount numeric not null check (amount > 0 and amount < 'Infinity'::numeric and amount = round(amount,2)),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  request_id uuid,
  -- NULL for a handover allocated across the master's orders.
  request_order_id uuid,
  check ((kind = 'submitted' and request_id is not null)
      or (kind = 'confirmed' and request_id is null and request_order_id is null))
);
create unique index rabota_cash_submit_request_allocations
  on public.rabota_cash_transfer_events (master_user_id,request_id,order_id)
  where kind = 'submitted';
create index rabota_cash_confirmation_history
  on public.rabota_cash_transfer_events (created_at desc,id desc) where kind = 'confirmed';
create index rabota_cash_events_order on public.rabota_cash_transfer_events (order_id);

alter table public.rabota_cash_transfer_events enable row level security;
revoke all on public.rabota_cash_transfer_events from public, anon, authenticated;
grant select on public.rabota_cash_transfer_events to authenticated;
create policy rabota_read_transfers on public.rabota_cash_transfer_events
  for select to authenticated using (
    (select private.rabota_my_role()) = 'owner' or
    ((select private.rabota_my_role()) = 'master' and master_user_id = (select auth.uid()))
  );

create function public.rabota_cash_submit_amount(
  p_amount numeric, p_request_id uuid, p_order_id uuid default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  remaining numeric := p_amount;
  previous_amount numeric;
  same_scope boolean;
  collection record;
  allocation numeric;
  event_at timestamptz;
begin
  -- Serialise requests and idempotency checks for one master only.
  perform 1 from public.rabota_members
    where user_id = actor and active and role = 'master' for no key update;
  if not found then raise exception 'Только мастер может отметить передачу'; end if;
  if p_request_id is null or p_amount is null or p_amount <= 0
    or p_amount >= 'Infinity'::numeric or p_amount <> round(p_amount,2) then
    raise exception 'Введите положительную сумму с точностью до копеек';
  end if;

  select sum(e.amount),bool_and(e.request_order_id is not distinct from p_order_id)
    into previous_amount,same_scope from public.rabota_cash_transfer_events e
    where e.master_user_id = actor and e.kind = 'submitted' and e.request_id = p_request_id;
  if previous_amount is not null then
    if previous_amount <> p_amount or not same_scope then
      raise exception 'Идентификатор уже использован для другой передачи';
    end if;
    return true;
  end if;

  event_at := clock_timestamp();
  for collection in
    select c.order_id,c.company_amount,coalesce(c.submitted_amount,0) as submitted
    from public.rabota_cash_collections c
    where c.master_user_id = actor and (p_order_id is null or c.order_id = p_order_id)
      and c.confirmed_at is null and c.submitted_at is null
      and c.company_amount > coalesce(c.submitted_amount,0)
    order by c.created_at,c.order_id for update
  loop
    allocation := least(remaining,collection.company_amount - collection.submitted);
    update public.rabota_cash_collections
      set submitted_amount = collection.submitted + allocation,
          confirmed_amount = coalesce(confirmed_amount,0),
          last_submitted_at = event_at,
          submitted_at = case when collection.submitted + allocation = company_amount then event_at end
      where order_id = collection.order_id;
    insert into public.rabota_cash_transfer_events
      (order_id,master_user_id,kind,amount,created_by,created_at,request_id,request_order_id)
      values (collection.order_id,actor,'submitted',allocation,actor,event_at,p_request_id,p_order_id);
    remaining := remaining - allocation;
    exit when remaining = 0;
  end loop;
  -- The exception rolls back every allocation made by this request.
  if remaining > 0 then raise exception 'Сумма больше доступного остатка. Обновите экран'; end if;
  return true;
end;
$$;

create function public.rabota_cash_confirm_amount(
  p_order_id uuid, p_expected_submitted numeric, p_expected_confirmed numeric
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  collection public.rabota_cash_collections%rowtype;
  submitted numeric;
  confirmed numeric;
  event_at timestamptz;
begin
  if actor is null or (select private.rabota_my_role()) is distinct from 'owner' then
    raise exception 'Только владелец может подтвердить поступление денег';
  end if;
  if p_expected_submitted is null or p_expected_confirmed is null
    or p_expected_confirmed < 0 or p_expected_submitted <= p_expected_confirmed
    or p_expected_submitted >= 'Infinity'::numeric
    or p_expected_submitted <> round(p_expected_submitted,2)
    or p_expected_confirmed <> round(p_expected_confirmed,2) then
    raise exception 'Некорректная сумма подтверждения';
  end if;
  select * into collection from public.rabota_cash_collections where order_id = p_order_id for update;
  if not found then raise exception 'Передача не найдена'; end if;
  confirmed := coalesce(collection.confirmed_amount,
    case when collection.confirmed_at is not null then collection.company_amount else 0 end);
  submitted := coalesce(collection.submitted_amount,
    case when collection.submitted_at is not null or collection.confirmed_at is not null
      then collection.company_amount else 0 end);
  if confirmed >= p_expected_submitted then return true; end if;
  if submitted <> p_expected_submitted or confirmed <> p_expected_confirmed then
    raise exception 'Сумма передачи изменилась. Обновите экран и проверьте её';
  end if;

  event_at := clock_timestamp();
  update public.rabota_cash_collections
    set submitted_amount = submitted, confirmed_amount = submitted,
        last_submitted_at = coalesce(last_submitted_at,submitted_at),
        last_confirmed_at = event_at,
        confirmed_at = case when submitted = company_amount then event_at end,
        confirmed_by = case when submitted = company_amount then actor end
    where order_id = p_order_id;
  insert into public.rabota_cash_transfer_events
    (order_id,master_user_id,kind,amount,created_by,created_at)
    values (p_order_id,collection.master_user_id,'confirmed',submitted-confirmed,actor,event_at);
  return true;
end;
$$;

-- Older clients may still use whole-order handovers and receipts on untouched rows.
-- They must never silently submit or confirm the full value of a partially managed order.
create or replace function public.rabota_cash_submit(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (select private.rabota_my_role()) is distinct from 'master' then
    raise exception 'Только мастер может отметить сдачу денег';
  end if;
  update public.rabota_cash_collections set submitted_at = now()
    where order_id = p_order_id and master_user_id = auth.uid()
      and submitted_at is null and confirmed_at is null and submitted_amount is null;
  if not found then raise exception 'Обновите экран и проверьте остаток к передаче'; end if;
  return true;
end;
$$;

create or replace function public.rabota_cash_confirm(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (select private.rabota_my_role()) is distinct from 'owner' then
    raise exception 'Только владелец может подтвердить поступление денег';
  end if;
  update public.rabota_cash_collections set confirmed_at = now(), confirmed_by = auth.uid()
    where order_id = p_order_id and submitted_at is not null
      and confirmed_at is null and submitted_amount is null;
  if not found then raise exception 'Обновите экран и проверьте сумму подтверждения'; end if;
  return true;
end;
$$;

revoke all on function public.rabota_cash_submit_amount(numeric,uuid,uuid),
  public.rabota_cash_confirm_amount(uuid,numeric,numeric), public.rabota_cash_submit(uuid),
  public.rabota_cash_confirm(uuid) from public, anon;
grant execute on function public.rabota_cash_submit_amount(numeric,uuid,uuid),
  public.rabota_cash_confirm_amount(uuid,numeric,numeric), public.rabota_cash_submit(uuid),
  public.rabota_cash_confirm(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
