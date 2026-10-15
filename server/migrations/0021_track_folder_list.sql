-- Папки «Музыки» как отдельные записи (решение владельца 15 октября 2026): папку можно создать пустой, переименовать
-- и удалить (треки остаются без папки). owner_id — ведущий для личных, 'agency' — общие папки.
create table if not exists track_folders (
  owner_id text not null,
  scope text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, scope, name)
);
