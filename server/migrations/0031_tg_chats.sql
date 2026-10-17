-- «Клиент ждёт ответа» в Telegram (решение владельца 17 октября 2026). Только чаты клиентов из базы: чат попадает сюда,
-- когда клиент прислал расчёт с сайта в Telegram, подключённый к боту (Telegram для бизнеса). Тексты сообщений не храним —
-- только с какого времени клиент ждёт ответа и когда о нём напомнили. Клиента удалили — чат уходит вместе с ним.
create table if not exists tg_chats (
  conn_id text not null,
  chat_id bigint not null,
  client_id text not null references clients (id) on delete cascade,
  waiting_since timestamptz,
  notified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conn_id, chat_id)
);
create index if not exists tg_chats_client on tg_chats (client_id);
