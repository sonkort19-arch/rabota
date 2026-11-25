-- QA only. Apply after three confirmed Auth users have been provisioned.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';

DO $seed$
DECLARE
  owner_id uuid;
  manager_id uuid;
  master_id uuid;
  today date := (now() AT TIME ZONE 'Europe/Moscow')::date;
  paid_order constant uuid := 'a0000000-0000-4000-8000-000000000003';
  refunded_order constant uuid := 'a0000000-0000-4000-8000-000000000004';
  moved_order constant uuid := 'a0000000-0000-4000-8000-000000000009';
  move_result jsonb;
  demo_chat uuid;
BEGIN
  IF to_regprocedure('public.rabota_qa_project_ref()') IS NULL OR
     to_regclass('private.rabota_qa_setup') IS NULL THEN
    RAISE EXCEPTION 'A separate CRM QA schema is required';
  END IF;

  SELECT id INTO STRICT owner_id FROM auth.users
    WHERE email = 'owner@rabota-qa.example' AND email_confirmed_at IS NOT NULL
      AND raw_app_meta_data->>'rabota_qa_fixture' = 'true';
  SELECT id INTO STRICT manager_id FROM auth.users
    WHERE email = 'manager@rabota-qa.example' AND email_confirmed_at IS NOT NULL
      AND raw_app_meta_data->>'rabota_qa_fixture' = 'true';
  SELECT id INTO STRICT master_id FROM auth.users
    WHERE email = 'master@rabota-qa.example' AND email_confirmed_at IS NOT NULL
      AND raw_app_meta_data->>'rabota_qa_fixture' = 'true';

  IF EXISTS (SELECT FROM private.rabota_qa_setup WHERE name = 'synthetic-v1') THEN
    IF NOT EXISTS (
      SELECT FROM private.rabota_qa_setup WHERE name = 'synthetic-v1'
        AND actors = ARRAY[owner_id,manager_id,master_id]
    ) THEN
      RAISE EXCEPTION 'The synthetic fixture belongs to different test users';
    END IF;
    RETURN;
  END IF;
  IF EXISTS (SELECT FROM public.rabota_orders) OR
     EXISTS (SELECT FROM public.rabota_members) OR
     EXISTS (SELECT FROM private.rabota_payroll_policy_v3) THEN
    RAISE EXCEPTION 'Initial QA seed requires an empty CRM';
  END IF;

  INSERT INTO public.rabota_members(user_id, email, role, active, master_name) VALUES
    (owner_id, 'owner@rabota-qa.example', 'owner', true, ''),
    (manager_id, 'manager@rabota-qa.example', 'manager', true, ''),
    (master_id, 'master@rabota-qa.example', 'master', true, 'Рауль');
  -- A fresh staging ledger has no historical cash custody to migrate.
  INSERT INTO private.rabota_payroll_policy_v3(master_user_id,activated_at,approved_by,backup_reference)
  VALUES (master_id,clock_timestamp(),owner_id,'QA synthetic baseline v1');
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  INSERT INTO public.rabota_orders (
    id, name, phone, address, radiator_type, radiators, floor_loops, master,
    assigned_user_id, appointment_date, appointment_time, price, travel_amount,
    status, details, created_by, client_source
  ) VALUES
    ('a0000000-0000-4000-8000-000000000001','QA · Перенос','+70000000001',
     'Учебная улица, 1','Алюминий',8,2,'Рауль',master_id,today+1,TIME '10:00',10000,600,
     'Записан','Синтетический заказ для переноса',owner_id,'website'),
    ('a0000000-0000-4000-8000-000000000002','QA · Соседнее окно','+70000000002',
     'Учебная улица, 2','Алюминий',6,1,'Рауль',master_id,today+1,TIME '15:00',8000,0,
     'Записан','Проверка занятости',manager_id,'recommendation'),
    (paid_order,'QA · Оплачено картой','+70000000001','Учебная улица, 1',
     'Чугун',7,1,'Рауль',master_id,today-1,TIME '11:00',10000,1500,
     'В работе','Предыдущий заказ того же тестового клиента',owner_id,'regular'),
    (refunded_order,'QA · Возврат','+70000000004','Учебная улица, 4',
     'Алюминий',6,0,'Рауль',master_id,today-2,TIME '14:00',8500,0,
     'В работе','Полный возврат в синтетической истории',owner_id,'website'),
    ('a0000000-0000-4000-8000-000000000005','QA · Без назначения','+70000000005',
     'Учебная улица, 5','Алюминий',4,0,'',NULL,today+3,TIME '10:00',4500,0,
     'Записан','Доступен владельцу и менеджеру',manager_id,'avito'),
    ('a0000000-0000-4000-8000-000000000006','QA · В работе','+70000000006',
     'Учебная улица, 6','Алюминий',10,2,'Рауль',master_id,today,TIME '18:00',14000,1000,
     'В работе','Заказ для проверки оплаты мастером',owner_id,'other'),
    ('a0000000-0000-4000-8000-000000000007','QA · Через полночь','+70000000007',
     'Учебная улица, 7','Чугун',14,8,'Рауль',master_id,today+3,TIME '22:00',21000,0,
     'Записан','Работа и дорога до следующего дня',manager_id,'website'),
    ('a0000000-0000-4000-8000-000000000008','QA · Завершён без оплаты','+70000000008',
     'Учебная улица, 8','Алюминий',5,1,'Рауль',master_id,today-3,TIME '18:00',6500,0,
     'Выполнен','Пример долга за заказ',owner_id,'google'),
    (moved_order,'QA · История переноса','+70000000009','Учебная улица, 9',
     'Алюминий',4,1,'Рауль',master_id,today+4,TIME '14:00',6500,400,
     'Записан','Проверка журнала переноса',owner_id,'website');

  PERFORM public.rabota_record_order_payment(paid_order, 11500, 'card');
  PERFORM public.rabota_record_order_payment(refunded_order, 8500, 'cash');
  PERFORM public.rabota_payroll_refund_v3(refunded_order, 8500,'QA · Синтетический возврат',
    'a1000000-0000-4000-8000-000000000001');
  PERFORM public.rabota_payroll_payout_v3(2100,'card','QA · Учебная выплата',
    'a1000000-0000-4000-8000-000000000002',master_id);
  PERFORM public.rabota_record_expense_v1(815.25,'QA · Синтетические материалы',
    'a1000000-0000-4000-8000-000000000003');
  PERFORM public.rabota_cashbook_record_v1('income',1250,NULL,'cash','QA · Синтетическое внесение',
    'a1000000-0000-4000-8000-000000000004');
  PERFORM public.rabota_cashbook_record_v1('expense',340,'cash',NULL,'QA · Синтетический расход',
    'a1000000-0000-4000-8000-000000000005');
  PERFORM set_config('request.jwt.claim.sub', manager_id::text, true);
  SELECT public.rabota_reschedule_order(moved_order,'a1000000-0000-4000-8000-000000000006',
    o.updated_at,today+5,TIME '10:00') INTO move_result
  FROM public.rabota_orders o WHERE o.id=moved_order;
  IF move_result->>'state' IS DISTINCT FROM 'saved' THEN
    RAISE EXCEPTION 'Could not record the synthetic move';
  END IF;

  INSERT INTO public.rabota_leads(name, phone, phone_normalized, address, status, notes,
    radiators, loops, material, follow_up_date, created_by) VALUES
    ('QA · Лид для записи','+70000000010','70000000010','Учебная улица, 10','ready',
     'Учебный лид для записи в календарь',4,1,'Алюминий',today+2,manager_id),
    ('QA · Повторный звонок','+70000000011','70000000011','Учебная улица, 11','callback',
     'Учебный лид для последующего звонка',6,0,'Чугун',today,owner_id);

  INSERT INTO public.rabota_growth_plan(owner_id,kind,title,details,start_on,end_on)
  VALUES (owner_id,'day','QA · Проверить рабочий день',
    'Синтетический пункт плана для проверки прав владельца',today,today);
  INSERT INTO public.rabota_ai_chats(owner_id,title)
  VALUES (owner_id,'QA · Тестовый диалог') RETURNING id INTO demo_chat;
  INSERT INTO public.rabota_ai_messages(chat_id,owner_id,role,content) VALUES
    (demo_chat,owner_id,'user','Покажи учебные заявки.'),
    (demo_chat,owner_id,'assistant','Синтетический ответ для тестирования интерфейса.');

  INSERT INTO private.rabota_qa_setup(name,actors)
  VALUES ('synthetic-v1',ARRAY[owner_id,manager_id,master_id]);
END;
$seed$;

NOTIFY pgrst, 'reload schema';
COMMIT;
