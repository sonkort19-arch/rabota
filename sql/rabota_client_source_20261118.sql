-- Already applied to the connected Supabase project on 2026-11-18.
-- Safe for existing rows: blank source means the channel was not captured.
-- No changes to order/payment RPCs, triggers, privileges or RLS policies.
alter table public.rabota_orders
  add column if not exists client_source text not null default '';

comment on column public.rabota_orders.client_source is
  'Acquisition source code: avito, instagram, 2gis, yandex, google, vk, telegram, website, recommendation, walk_in, regular, other, unknown. Empty for historical orders.';
