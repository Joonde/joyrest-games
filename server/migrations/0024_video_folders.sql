-- Папки «Видео» как отдельные записи (решение владельца 15 октября 2026, как у «Музыки»): папку можно создать пустой,
-- переименовать и удалить (видео остаются без папки). Видео JoyRest общие — у папок нет владельца.
create table if not exists video_folders (
  name text primary key,
  created_at timestamptz not null default now()
);
