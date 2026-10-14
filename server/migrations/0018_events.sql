-- Планировщик мероприятий (CLAUDE.md, раздел 3, «Календарь»; решение владельца 14 октября 2026):
-- клиент, телефон, дата, время, что за мероприятие, ведущий. У ведущего время занято записью
-- календаря `availability` с id `ev-<id>` (kind = booked). Отмена не стирает — `cancelled_at`.
-- Время — минуты от полуночи `day` (московское), `starts_at`/`ends_at` — для списков и статуса.
create table if not exists events (
  id text primary key,
  host_id text not null references users(id) on delete cascade,
  day date not null,
  start_min smallint not null,
  end_min smallint not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  client_name text not null default '',
  client_phone text not null default '',
  title text not null default '',
  place text not null default '',
  guests integer,
  note text not null default '',
  cancelled_at timestamptz,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_day on events (day);
create index if not exists events_host_day on events (host_id, day);
create index if not exists events_ends_at on events (ends_at);
