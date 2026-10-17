-- Таймер ответа и статус «Провели» (решение владельца 17 октября 2026).
-- `new_since` — с какого момента клиент ждёт в «Новом» (пусто — не ждёт или карточка заведена раньше:
-- тогда отсчёт идёт от последнего обращения). Ушёл из «Нового» — `taken_at`, сколько ждал (`taken_ms`) и кто взял
-- (`taken_by`); каждый такой ответ — строка `client_responses` для среднего времени ответа (в «Клиентах» и «Итогах»).
-- Статус `held` («Провели») — новое значение той же текстовой колонки `status`.
alter table clients add column if not exists new_since timestamptz;
alter table clients add column if not exists taken_at timestamptz;
alter table clients add column if not exists taken_ms bigint;
alter table clients add column if not exists taken_by text not null default '';

create table if not exists client_responses (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  user_id text,
  user_name text not null default '',
  waited_ms bigint not null,
  taken_at timestamptz not null default now()
);
create index if not exists client_responses_taken_at on client_responses (taken_at);
