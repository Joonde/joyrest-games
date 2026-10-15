-- Показы ведущего (решение владельца 15 октября 2026): фото и страницы PDF на весь экран зала с пульта.
-- Страницы — файлы MEDIA_DIR/slides/<sha256>, порядок и размеры — в pages (jsonb: [{ sha, w, h, size }]).
create table if not exists decks (
  id text primary key,
  owner_id text not null,
  title text not null default '',
  pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists decks_owner on decks (owner_id, updated_at desc);
