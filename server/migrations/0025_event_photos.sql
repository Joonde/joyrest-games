-- Фотоотчёт мероприятия (решение владельца 15 октября 2026): до 3 общих фото на игру с пульта ведущего.
-- Хранит название игры, ведущего и дату сам: сессии удаляются через 30 дней, фото остаются. Файл — MEDIA_DIR/photos/<sha256>.
create table if not exists event_photos (
  session_id text not null,
  slot integer not null,
  host_id text not null,
  game_title text not null default '',
  played_at timestamptz,
  sha256 text not null,
  mime text not null,
  width integer,
  height integer,
  size integer not null,
  created_at timestamptz not null default now(),
  primary key (session_id, slot)
);
create index if not exists event_photos_host on event_photos (host_id, created_at);
