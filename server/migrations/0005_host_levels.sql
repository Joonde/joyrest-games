-- Квалификация, стаж и баллы ведущих (CLAUDE.md, раздел 3). Только добавления.

-- Квалификация (ставит владелец): intern, novice, host, top; null — не задана.
alter table users add column if not exists level text;
-- «Опыт с» для стажа; null — с даты добавления (created_at).
alter table users add column if not exists experience_since date;

-- Когда нажали «Начать игру»: баллы — только за игру не короче 40 минут.
alter table sessions add column if not exists started_at timestamptz;

-- Баллы ведущих: за игру (одна запись на сессию) или вручную владельцем.
create table if not exists host_points (
  id text primary key,
  host_id text not null,
  points numeric(6, 1) not null,
  kind text not null check (kind in ('game', 'manual')),
  reason text not null default '',
  session_id text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists host_points_host on host_points (host_id, created_at);
create unique index if not exists host_points_session on host_points (session_id) where session_id is not null;
