-- Applied to Supabase yedzfmibceboncrytbqz.
-- Shared leads for active owner/manager accounts; masters have no access.
create table if not exists public.rabota_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  phone text not null check (length(btrim(phone)) between 10 and 30),
  phone_normalized text not null unique check (phone_normalized ~ '^7[0-9]{10}$'),
  address text not null default '',
  radiators integer check (radiators between 0 and 999),
  material text not null default '',
  loops integer check (loops between 0 and 999),
  notes text not null default '',
  status text not null default 'new' check (status in ('new','hot','waiting','callback','ready','booked','lost')),
  reason text not null default 'none',
  follow_up_date date,
  follow_up_time time without time zone not null default '18:00',
  date_approx boolean not null default false,
  client_will_call boolean not null default false,
  consent boolean not null default false,
  price_agreed boolean not null default false,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history)='array'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rabota_leads_due_idx on public.rabota_leads(follow_up_date,follow_up_time)
where status not in ('booked','lost');
create index if not exists rabota_leads_status_idx on public.rabota_leads(status);
create or replace function private.rabota_leads_touch_updated_at()
returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at:=clock_timestamp();
 return new;
end $$;
drop trigger if exists rabota_leads_updated_at on public.rabota_leads;
create trigger rabota_leads_updated_at before update on public.rabota_leads
for each row execute function private.rabota_leads_touch_updated_at();
alter table public.rabota_leads enable row level security;
revoke all on public.rabota_leads from public, anon, authenticated;
grant select,insert,delete on public.rabota_leads to authenticated;
grant update(name,phone,phone_normalized,address,radiators,material,loops,notes,status,reason,
 follow_up_date,follow_up_time,date_approx,client_will_call,consent,price_agreed,history)
on public.rabota_leads to authenticated;
create policy rabota_leads_read on public.rabota_leads for select to authenticated
using ((select private.rabota_my_role()) in ('owner','manager'));
create policy rabota_leads_insert on public.rabota_leads for insert to authenticated
with check ((select private.rabota_my_role()) in ('owner','manager') and created_by=(select auth.uid()));
create policy rabota_leads_update on public.rabota_leads for update to authenticated
using ((select private.rabota_my_role()) in ('owner','manager'))
with check ((select private.rabota_my_role()) in ('owner','manager'));
create policy rabota_leads_delete on public.rabota_leads for delete to authenticated
using ((select private.rabota_my_role()) in ('owner','manager'));
