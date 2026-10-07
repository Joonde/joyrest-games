-- Предложения ведущих в общую библиотеку (CLAUDE.md, раздел 3). Ведущий предлагает свою личную
-- игру, владелец принимает (копия в библиотеку) или отклоняет с причиной. id создаёт браузер.

create table if not exists library_proposals (
  id text primary key,
  -- Личная игра ведущего (без внешнего ключа: игру можно удалить, история предложения остаётся).
  game_id text not null,
  host_id text not null,
  -- Название на момент предложения — список у владельца не ходит за каждой игрой.
  title text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reason text,
  -- Игра библиотеки, созданная или обновлённая при принятии.
  library_game_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists library_proposals_status on library_proposals (status, created_at);
create index if not exists library_proposals_host on library_proposals (host_id);
create index if not exists library_proposals_game on library_proposals (game_id);
