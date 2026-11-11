-- Быстрый канал (CLAUDE.md, «Быстрый канал (комнаты)»): снимок игровой комнаты — одна строка на сессию,
-- перезаписывается на контрольных точках игры и раз в 10 с, если что-то менялось. После перезапуска сервера
-- комната поднимается из снимка на паузе. Сессию удаляет уборка (30 дней) — снимок уходит вместе с ней.
-- Прошлая версия таблицу не читает.
create table if not exists room_snapshots (
  session_id text primary key references sessions (id) on delete cascade,
  data jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);
