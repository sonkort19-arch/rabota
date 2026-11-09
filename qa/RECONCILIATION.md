# Ручная сверка старых оплат

Повторное чтение production 09.11.2026 подтвердило **20 оплаченных заказов** с неполными реквизитами. Записи и суммы не менялись. Полный CSV находится отдельно от публичного Git: `/workspace/rabota-private/reconciliation.csv`. Он содержит ID заказа, дату, мастера, текущие суммы/реквизиты, список отсутствующих полей и пустые колонки для решения проверяющего. Имена клиентов и телефоны не выгружались.

Для каждой строки владелец сверяет банковскую выписку, кассовый документ или иной первичный источник. В `evidence_reference` указывает ссылку/номер документа, в `reviewed_by` — проверяющего, в `review_decision` — подтверждённое решение либо «недостаточно данных». Пустое поле не означает наличные, карту, получение компанией или получение мастером. Текущая цена не доказывает фактически полученную сумму.

Повторный экспорт — только SELECT:

```sql
SELECT id AS order_id, appointment_date, master, status, price,
       payment_amount, payment_method, payment_received_by, paid_at,
       concat_ws(', ',
         CASE WHEN payment_method IS NULL THEN 'payment_method' END,
         CASE WHEN payment_received_by IS NULL THEN 'payment_received_by' END,
         CASE WHEN payment_amount IS NULL THEN 'payment_amount' END) AS missing_fields
FROM public.rabota_orders
WHERE paid AND (payment_method IS NULL OR payment_received_by IS NULL OR payment_amount IS NULL)
ORDER BY appointment_date, id;
```

CSV — материал сверки, а не пакет UPDATE. Изменения по результатам сверки требуют отдельного решения владельца и контролируемой корректировки с историей; массового автоматического заполнения в PR нет. До сверки касса с legacy-платежами остаётся расчётной оценкой. Фактический банковский/наличный остаток и чистая прибыль не подтверждены.
