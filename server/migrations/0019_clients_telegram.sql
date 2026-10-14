-- База клиентов и Telegram команды (решение владельца 14 октября 2026).
-- Клиент — каждый, кто оставил заявку (сайт, QR-анкета), записан в планировщик или переслан владельцем боту.
-- Ключ — телефон (phone_key: только цифры, 7XXXXXXXXXX); без телефона — по ссылке на соцсеть.
-- Согласие на рассылку — отдельно, с датой и источником (38-ФЗ «О рекламе»).
create table if not exists clients (
  id text primary key,
  name text not null default '',
  phone text not null default '',
  phone_key text not null default '',
  links jsonb not null default '[]',
  status text not null default 'new',
  marketing text not null default 'unknown',
  marketing_at timestamptz,
  marketing_source text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_contact_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists clients_phone_key on clients (phone_key) where phone_key <> '';
create index if not exists clients_last_contact on clients (last_contact_at);

-- Обращения клиента: заявка, вопрос, запрос по QR, мероприятие, пересланное в Telegram, вручную.
create table if not exists client_contacts (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  source text not null,
  summary text not null default '',
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists client_contacts_client on client_contacts (client_id, created_at);
create unique index if not exists client_contacts_ref on client_contacts (source, ref) where ref is not null;

-- Telegram человека команды: бот уведомлений (назначение, изменения, напоминания о мероприятиях).
create table if not exists tg_links (
  user_id text primary key references users(id) on delete cascade,
  chat_id bigint not null,
  username text not null default '',
  linked_at timestamptz not null default now()
);
create index if not exists tg_links_chat on tg_links (chat_id);

-- Одноразовые коды «Подключить Telegram» (ссылка t.me/<бот>?start=<код>, 30 минут).
create table if not exists tg_codes (
  code text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

-- Служебное: до какого сообщения бот уже прочитал (getUpdates offset).
create table if not exists tg_state (
  key text primary key,
  value text not null
);

-- Отправленные напоминания: одно на мероприятие, вид и время начала (перенос времени — новое напоминание).
create table if not exists event_notices (
  event_id text not null,
  kind text not null,
  starts_at timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, kind, starts_at)
);

-- Итоги мероприятий: после начала ведущий или владелец отмечает «Проведено» (true) или «Не состоялось» (false).
alter table events add column if not exists held boolean;
alter table events add column if not exists held_at timestamptz;
alter table events add column if not exists held_by text;
