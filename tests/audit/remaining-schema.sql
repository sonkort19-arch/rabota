-- Synthetic transport placeholders only; core six-table fixture is in baseline.sql.
-- Full production schema contract/preflight remains private, outside Git.
ALTER TABLE public.rabota_ai_order_drafts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.rabota_ai_chats(id uuid primary key, owner_id uuid);
CREATE TABLE public.rabota_ai_messages(id uuid primary key, chat_id uuid);
CREATE TABLE public.rabota_order_notifications(id uuid primary key, recipient_id uuid);
CREATE TABLE public.rabota_push_subscriptions(id uuid primary key, user_id uuid);
ALTER TABLE public.rabota_ai_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rabota_ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rabota_order_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rabota_push_subscriptions ENABLE ROW LEVEL SECURITY;
