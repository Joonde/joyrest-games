-- Профессии команды JoyRest: ведущие проводят игры, остальные (диджеи, музыканты, фокусники…)
-- видят команду и свою страницу. Список — src/core/professions.ts; прошлые аккаунты — ведущие.
alter table users add column if not exists profession text not null default 'host';
