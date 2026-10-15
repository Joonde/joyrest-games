-- Видео JoyRest на сервере (решение владельца 15 октября 2026): загружают владелец и заместитель, видят все.
-- Файл приходит частями: received — сколько байт уже есть (MEDIA_DIR/video/<id>.tmp), целиком — MEDIA_DIR/video/<sha256>.
create table if not exists videos (
  id text primary key,
  owner_id text not null,
  title text not null,
  folder text not null default '',
  size bigint not null,
  received bigint not null default 0,
  duration_ms integer,
  sha256 text,
  mime text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists videos_sha256 on videos (sha256);
