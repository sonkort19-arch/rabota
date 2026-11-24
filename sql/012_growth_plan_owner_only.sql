-- Owner-only MOBA development plan. No changes to operational CRM tables.
create table if not exists public.rabota_growth_plan (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('year','month','week','day')),
  title text not null check (length(trim(title)) between 1 and 180),
  details text not null default '' check (length(details) <= 1500),
  start_on date not null,
  end_on date not null,
  parent_id uuid null references public.rabota_growth_plan(id) on delete set null,
  sort_order integer not null default 0,
  target_rub numeric(14,2) null check (target_rub >= 0),
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_valid_period check (end_on >= start_on),
  constraint growth_unique_plan_item unique (owner_id, kind, start_on, title)
);
create index if not exists rabota_growth_plan_owner_start_idx
  on public.rabota_growth_plan (owner_id, start_on, kind, sort_order);
alter table public.rabota_growth_plan enable row level security;
revoke all on public.rabota_growth_plan from anon;
revoke all on public.rabota_growth_plan from authenticated;
grant select, update (completed, completed_at, updated_at) on public.rabota_growth_plan to authenticated;
drop policy if exists "growth_owner_read" on public.rabota_growth_plan;
create policy "growth_owner_read" on public.rabota_growth_plan for select
  to authenticated using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.rabota_members m
      where m.user_id = (select auth.uid()) and m.role = 'owner' and m.active
    )
  );
drop policy if exists "growth_owner_checkoff" on public.rabota_growth_plan;
create policy "growth_owner_checkoff" on public.rabota_growth_plan for update
  to authenticated using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.rabota_members m
      where m.user_id = (select auth.uid()) and m.role = 'owner' and m.active
    )
  ) with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.rabota_members m
      where m.user_id = (select auth.uid()) and m.role = 'owner' and m.active
    )
  );
comment on table public.rabota_growth_plan is
  'Owner-only MOBA development roadmap; ChatGPT can adjust content, app records completion.';
