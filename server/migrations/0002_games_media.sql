-- Игры и картинки на своём сервере (PR 3.2). id игр и картинок создаёт браузер (или переносятся
-- из Firebase в PR 5): повтор записи после обрыва связи не создаёт дубль.

create table if not exists games (
  id text primary key,
  scope text not null check (scope in ('agency', 'personal')),
  owner_id text not null,
  title text not null default '',
  mechanic text not null default 'quiz',
  theme_id text not null default 'joyrest',
  age_rating text not null default '0+',
  play_mode text not null default 'solo',
  -- Формат знает механика: без жёсткой схемы, новые раунды и поля — без миграций.
  content jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists games_scope_owner on games (scope, owner_id);

-- Картинка игры: файл на диске (MEDIA_DIR/<sha256>), здесь — ссылка на него. Копия игры
-- ссылается на те же файлы; файл без ссылок удаляет ночная уборка.
create table if not exists media (
  game_id text not null references games (id),
  media_id text not null,
  variant text not null check (variant in ('hd', 'full', 'small')),
  sha256 text not null,
  mime text not null,
  width integer not null,
  height integer not null,
  size integer not null,
  created_at timestamptz not null default now(),
  primary key (game_id, media_id, variant)
);

create index if not exists media_sha256 on media (sha256);
