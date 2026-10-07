-- База площадок (CLAUDE.md, «База площадок»): анкеты заведений, заявки клиентов с номером и
-- предложения клиенту по ссылке. Содержимое анкеты и заявки — jsonb (формат знает
-- src/core/venues.ts), чтобы новые поля анкеты не требовали миграций. Файлы (фото и меню) —
-- MEDIA_DIR/venues/<sha256>, здесь только ссылки на них.

create table if not exists venues (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  -- new | checked | worked | rejected
  status text not null default 'new',
  rating smallint,
  notes text not null default '',
  -- form — анкета по QR, manual — завёл владелец
  source text not null default 'form',
  -- кто из ведущих привёл (QR со ссылкой ?from=); ведущих не удаляем, только отключаем
  host_id text references users(id) on delete set null,
  -- [{ sha, kind: photo|menu, mime, size, name }]
  files jsonb not null default '[]'::jsonb,
  -- одноразовый допуск анкеты к загрузке файлов: sha256 токена, срок и сколько можно
  upload_hash text,
  upload_until timestamptz,
  upload_quota jsonb,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists venues_created on venues (created_at desc);

create table if not exists venue_requests (
  id text primary key,
  number serial unique,
  data jsonb not null default '{}'::jsonb,
  -- new | sent | agreed | declined
  status text not null default 'new',
  notes text not null default '',
  host_id text references users(id) on delete set null,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists venue_requests_created on venue_requests (created_at desc);

-- Предложение — снимок того, что видит клиент (без адресов и контактов): правка анкеты
-- площадки не меняет уже отправленную ссылку. id — 22 случайных символа (ссылка не угадывается).
create table if not exists venue_offers (
  id text primary key,
  request_id text references venue_requests(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists venue_offers_request on venue_offers (request_id);

alter table users add column if not exists venue_access boolean not null default false;
