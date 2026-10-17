-- Колокольчик уведомлений в студии (решение владельца 17 октября 2026): когда человек последний раз открывал уведомления.
-- Новые — обращения клиентов после этого времени. Сами уведомления не хранятся: их собирает сервер из истории клиентов.
create table if not exists notice_seen (
  user_id text primary key references users (id) on delete cascade,
  seen_at timestamptz not null default now()
);
