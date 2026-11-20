-- «Танцуй как звезда»: исходные записи датчиков и результаты для калибровки на разных людях.
-- Сессии не связаны внешним ключом: автоочистка старых сессий не удаляет собранные эталоны.
create table if not exists dance_attempts (
  id text primary key,
  session_id text not null,
  game_id text,
  tile_id text not null,
  song_key text not null,
  dancer integer not null default 1,
  pid text not null,
  team_id text,
  player_name text not null default '',
  percent integer not null default 0,
  points integer not null default 0,
  max_points integer not null default 0,
  recording jsonb not null,
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists dance_attempts_session_tile on dance_attempts (session_id, tile_id, created_at desc);
create index if not exists dance_attempts_song on dance_attempts (song_key, dancer, created_at desc);
create index if not exists dance_attempts_game on dance_attempts (game_id, created_at desc);
