-- Игра в реальном времени на своём сервере (PR 4.1): устройства гостей, сессии, участники,
-- ответы и итоги. id сессий, команд и участников создаёт браузер (или переносятся из Firebase):
-- повтор записи после обрыва связи не создаёт дубль.

-- Телефон гостя или экран зала: в cookie — случайный токен, здесь — только его sha256.
create table if not exists devices (
  id text primary key,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  code text not null,
  host_id text not null,
  game_id text,
  game_title text not null default '',
  mechanic text,
  game_snapshot jsonb,
  theme_id text not null default 'joyrest',
  play_mode text not null default 'solo',
  screen_mode text not null default 'laptop',
  -- Формат шага знает механика: без жёсткой схемы (раунды, табло, суперигра — без миграций).
  state jsonb not null,
  leaderboard jsonb not null default '{}'::jsonb,
  -- Фаза — для поиска по коду и для блокировки выкладки во время игры (joyrest, правило 30 минут).
  phase text generated always as (coalesce(state ->> 'phase', 'lobby')) stored,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  -- Меняется при каждом действии пульта.
  updated_at timestamptz not null default now()
);

-- Код уникален среди незавершённых сессий.
create unique index if not exists sessions_active_code on sessions (code) where phase in ('lobby', 'playing');
create index if not exists sessions_host on sessions (host_id, created_at desc);
create index if not exists sessions_created on sessions (created_at);

create table if not exists participants (
  session_id text not null references sessions (id),
  id text not null,
  name text not null,
  kind text not null check (kind in ('player', 'team')),
  team_id text,
  captain_uid text not null,
  joined_at timestamptz not null default now(),
  seen_at timestamptz,
  primary key (session_id, id)
);

-- Один ответ на шаг: повторное нажатие ничего не меняет.
create table if not exists answers (
  session_id text not null references sessions (id),
  step integer not null,
  pid text not null,
  uid text not null,
  value jsonb,
  submitted_at timestamptz not null default now(),
  primary key (session_id, step, pid)
);

-- Итоги прошедших игр: переживают автоочистку старых сессий.
create table if not exists results (
  id text primary key,
  host_id text not null,
  code text not null,
  game_title text not null default '',
  mechanic text,
  theme_id text not null default 'joyrest',
  play_mode text not null default 'solo',
  played_at timestamptz,
  participants_count integer not null default 0,
  board jsonb not null default '[]'::jsonb,
  saved_at timestamptz not null default now()
);

create index if not exists results_host on results (host_id);
