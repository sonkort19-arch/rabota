-- Synthetic old revisions, used before installing the server stamp.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.rabota_orders ALTER COLUMN updated_at DROP NOT NULL;
INSERT INTO public.rabota_orders(id,name,status,price,updated_at) VALUES
 ('10000000-0000-4000-8000-000000000090','Fixture stale writers','Записан',3000,'2000-01-01 12:34:56.123456+00'),
 ('10000000-0000-4000-8000-000000000091','Fixture legacy null revision','Записан',3000,NULL),
 ('10000000-0000-4000-8000-000000000092','Fixture legacy future revision','Записан',3000,'2080-01-01 00:00:00+00');
COMMIT;
