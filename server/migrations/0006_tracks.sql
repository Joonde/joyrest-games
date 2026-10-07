-- Музыка ведущих и общая музыкальная библиотека (CLAUDE.md, раздел 7, «Музыка»). Файл — в
-- MEDIA_DIR/audio/<sha256>, здесь только описание. Ведущий загружает трек себе и может предложить
-- его в общую; владелец принимает (копия-ссылка в библиотеку) или отклоняет. id создаёт браузер.

create table if not exists tracks (
  id text primary key,
  owner_id text not null,
  scope text not null default 'personal' check (scope in ('personal', 'agency')),
  title text not null default '',
  category text not null default 'background',
  -- Откуда права: pixabay, bought (куплен), own (свой), other (с пояснением).
  license text not null default 'other',
  license_note text not null default '',
  sha256 text,
  mime text,
  size integer not null default 0,
  duration_ms integer,
  share_status text not null default 'none' check (share_status in ('none', 'pending', 'accepted', 'rejected')),
  share_reason text,
  -- Трек библиотеки, созданный или обновлённый при принятии.
  library_track_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tracks_owner on tracks (owner_id);
create index if not exists tracks_scope on tracks (scope);
create index if not exists tracks_share on tracks (share_status);
