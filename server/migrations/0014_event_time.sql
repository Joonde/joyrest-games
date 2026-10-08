-- Время вечера: начало — первый гость вошёл (или «Начать игру» без гостей), перерывы — показы слайда
-- «Перерыв» на экране зала (`src/core/eventTime.ts`). В итогах — сколько длились перерывы и сколько их было.

alter table sessions add column if not exists event_started_at timestamptz;
alter table sessions add column if not exists breaks jsonb not null default '[]'::jsonb;
alter table results add column if not exists breaks_ms bigint not null default 0;
alter table results add column if not exists breaks_count integer not null default 0;
