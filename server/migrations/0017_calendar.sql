-- Календарь команды (CLAUDE.md, раздел 3, «Календарь»; решение владельца 14 октября 2026): человек
-- отмечает, когда свободен (free) и занят (busy); владелец закрепляет время за ним (booked).
-- Время — минуты от полуночи дня `day`, конец до 06:00 следующего дня (1800).
create table if not exists availability (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  day date not null,
  start_min smallint not null,
  end_min smallint not null,
  -- free | busy | booked
  kind text not null default 'free',
  note text not null default '',
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists availability_day on availability (day);
create index if not exists availability_user_day on availability (user_id, day);
