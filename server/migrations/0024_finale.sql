-- Конец игры (решение владельца 15 октября 2026): ссылка ведущего для чаевых и отзывы гостей.
-- Отзыв хранит название игры, ведущего и дату сам: сессии удаляются через 30 дней, отзывы остаются.
alter table users add column if not exists tips_url text;
create table if not exists reviews (
  id text primary key,
  session_id text not null,
  host_id text not null,
  game_title text not null default '',
  played_at timestamptz,
  author_uid text not null,
  rating integer not null default 5,
  text text not null default '',
  name text not null default '',
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists reviews_session_author on reviews (session_id, author_uid);
create index if not exists reviews_host on reviews (host_id, created_at);
