-- Управляемое командное лобби (docs/TEAM_LOBBY_AND_COLLABORATION_TZ_2026-11-22.md, раздел 12.2). Только добавления:
-- прежняя версия приложения этих колонок не читает и не пишет (null и false — прежнее лобби).

-- Настройки формирования команд: режим, число команд, вместимость, revision, исключённые. null — прежнее лобби (legacy).
alter table sessions add column if not exists team_formation jsonb;

-- «Не хочу быть капитаном» (ТЗ 6.5): меняет только сам гость.
alter table participants add column if not exists no_captain boolean not null default false;

-- Повтор действия ведущего по actionId возвращает прежний результат, а не перемешивает людей заново (ТЗ 6.2.11).
-- request_hash — отпечаток тела: тот же actionId с другими галочками — отказ. Имён в result нет — только id.
create table if not exists team_formation_actions (
  session_id text not null references sessions (id) on delete cascade,
  action_id text not null,
  kind text not null,
  request_hash text not null default '',
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, action_id)
);
