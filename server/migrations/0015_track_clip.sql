-- Отрезок, громкость и затухание трека (CLAUDE.md, раздел 7, «Музыка»): { start, end, fadeIn, fadeOut, volume }.
alter table tracks add column if not exists clip jsonb not null default '{}'::jsonb;
