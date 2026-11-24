
-- Initial roadmap approved by the MOBA owner. All rows belong only to active owner accounts.
insert into public.rabota_growth_plan
(owner_id,kind,title,details,start_on,end_on,sort_order,target_rub)
select m.user_id,'year','300 000 ₽ чистой прибыли в месяц',
'К декабрю 2027 года выйти на 300 000 ₽ чистой прибыли после всех расходов и сократить ежедневный контроль до одного часа.',
date '2027-01-01',date '2027-12-31',0,300000
from public.rabota_members m where m.role='owner' and m.active
on conflict (owner_id,kind,start_on,title) do nothing;

with months(start_on,end_on,title,details,sort_order) as (
  values
  (date '2026-11-26',date '2026-11-30','Узнать точные цифры MOBA','Проверить выручку, оплаченные заказы и расходы за последние месяцы.',0),
  (date '2026-12-01',date '2026-12-31','Подготовить управляемый план развития','Проанализировать финансы, заявки, менеджера и рекламу.',1),
  (date '2027-01-01',date '2027-01-31','Порядок в финансах','Все доходы и расходы учтены, прибыль по заказам понятна.',1),
  (date '2027-02-01',date '2027-02-28','Ни одной потерянной заявки','Все обращения записываются в CRM, у каждого есть статус.',2),
  (date '2027-03-01',date '2027-03-31','Самостоятельный менеджер','Менеджер ведёт клиента от первого обращения до записи.',3),
  (date '2027-04-01',date '2027-04-30','Эффективная реклама','Определены рекламные каналы с положительной окупаемостью.',4),
  (date '2027-05-01',date '2027-05-31','Партнёры и новые клиенты','Найти партнёров и получить первые обращения по рекомендациям.',5),
  (date '2027-06-01',date '2027-06-30','Больше прибыли с заказа','Пересчитать себестоимость и отказаться от нерентабельных затрат.',6),
  (date '2027-07-01',date '2027-07-31','Снизить зависимость от сезона','Проверить предложения для низкого сезона и план загрузки команды.',7),
  (date '2027-08-01',date '2027-08-31','Подготовиться к росту заказов','Обеспечить готовность рекламы, оборудования и мастеров.',8),
  (date '2027-09-01',date '2027-09-30','Увеличить число оплаченных заказов','Повысить число выполненных прибыльных заказов.',9),
  (date '2027-10-01',date '2027-10-31','Качество и рекомендации','Наладить контроль качества, отзывы и рекомендации.',10),
  (date '2027-11-01',date '2027-11-30','Бизнес работает без тебя','Передать сотрудникам ежедневные операции; контролировать показатели до одного часа в день.',11),
  (date '2027-12-01',date '2027-12-31','Достичь цели 300 000 ₽','Проверить чистую прибыль и самостоятельность работы бизнеса по данным CRM.',12)
)
insert into public.rabota_growth_plan
(owner_id,kind,title,details,start_on,end_on,parent_id,sort_order)
select m.user_id,'month',s.title,s.details,s.start_on,s.end_on,y.id,s.sort_order
from public.rabota_members m
cross join months s
left join public.rabota_growth_plan y on y.owner_id=m.user_id
  and y.kind='year' and y.start_on=date '2027-01-01'
  and s.start_on>=date '2027-01-01'
where m.role='owner' and m.active
on conflict (owner_id,kind,start_on,title) do nothing;

with weeks(start_on,end_on,month_start,title,details,sort_order) as (
  values
  (date '2026-11-23',date '2026-11-29',date '2026-11-26','Собрать данные за три месяца','Получить число выполненных и оплаченных заказов и выручку.',1),
  (date '2026-11-30',date '2026-12-06',date '2026-12-01','Проверить реальную прибыль MOBA','Собрать доходы, выплаты и остальные расходы.',1),
  (date '2026-12-07',date '2026-12-13',date '2026-12-01','Разобрать источники заявок','Посчитать заявки, источники и причины отказов.',2),
  (date '2026-12-14',date '2026-12-20',date '2026-12-01','Наладить работу менеджера','Утвердить и проверить стандарты приёма заявок.',3),
  (date '2026-12-21',date '2026-12-27',date '2026-12-01','Подготовить план рекламы','Определить рекламные каналы, бюджет и метрики.',4),
  (date '2026-12-28',date '2027-01-03',date '2026-12-01','Подвести итоги подготовки','Уточнить задачи и финансовые ориентиры на январь.',5)
)
insert into public.rabota_growth_plan
(owner_id,kind,title,details,start_on,end_on,parent_id,sort_order)
select m.user_id,'week',s.title,s.details,s.start_on,s.end_on,p.id,s.sort_order
from public.rabota_members m
cross join weeks s
left join public.rabota_growth_plan p on p.owner_id=m.user_id and p.kind='month'
  and p.start_on=s.month_start
where m.role='owner' and m.active
on conflict (owner_id,kind,start_on,title) do nothing;

insert into public.rabota_growth_plan
(owner_id,kind,title,details,start_on,end_on,parent_id,sort_order)
select m.user_id,'day','Собрать выполненные заказы за три месяца',
'Получить количество выполненных заказов и сумму выручки отдельно за каждый месяц. Проверить оплату.',
date '2026-11-26',date '2026-11-26',w.id,1
from public.rabota_members m
left join public.rabota_growth_plan w on w.owner_id=m.user_id and w.kind='week'
  and w.start_on=date '2026-11-23'
where m.role='owner' and m.active
on conflict (owner_id,kind,start_on,title) do nothing;
