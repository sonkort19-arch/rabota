-- Roll back the deletion capability: does not restore orders already deleted.
BEGIN;
SET LOCAL lock_timeout='5s';
DROP FUNCTION IF EXISTS public.rabota_delete_order(uuid);
COMMIT;
