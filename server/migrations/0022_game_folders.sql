-- Папки в «Моих играх» (решение владельца 15 октября 2026): у игры — название папки ('' — без папки),
-- сами папки — записи (можно пустую, переименовать, удалить — игры остаются без папки).
alter table games add column if not exists folder text not null default '';
create table if not exists game_folders (
  owner_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, name)
);
