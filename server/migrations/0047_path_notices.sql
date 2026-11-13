-- Путь клиента, доработки (решения владельца 12 ноября 2026). Только новые колонки и таблица.
-- «Кто взял — тот и ведёт»: клиента правит тот, кто его ведёт (`owner_id`); у мероприятия — `events.created_by`.
alter table clients add column if not exists owner_id text;
-- «Не смогу провести»: ведущий отказался — нужна замена.
alter table events add column if not exists declined_at timestamptz;
alter table events add column if not exists declined_reason text not null default '';
-- «Остаток получен» после «Проведено»: yes | no | part, сумма при «частично».
alter table events add column if not exists rest_paid text not null default '';
alter table events add column if not exists rest_amount integer;
-- Уведомления о клиентах (не о мероприятиях): «клиента забрал себе …». Без имени и телефона клиента в тексте.
create table if not exists staff_notices (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  client_id text references clients (id) on delete cascade,
  kind text not null,
  title text not null default '',
  line text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists staff_notices_user_idx on staff_notices (user_id, created_at desc);

-- История мероприятия, созвон, отзыв, доплата за продление (решение владельца 12 ноября 2026).
create table if not exists event_log (
  id text primary key,
  event_id text not null references events (id) on delete cascade,
  at timestamptz not null default now(),
  by_name text not null default '',
  text text not null default ''
);
create index if not exists event_log_event_idx on event_log (event_id, at);
alter table events add column if not exists called_at timestamptz;
alter table events add column if not exists called_by text;
alter table events add column if not exists review text not null default '';
alter table events add column if not exists overtime_paid integer;

-- Следующий шаг с датой у клиента: в этот день — напоминание в колокольчик тому, кто ведёт.
alter table clients add column if not exists next_step text not null default '';
alter table clients add column if not exists next_at date;
alter table clients add column if not exists next_noticed date;
