-- «Опрос гостей заранее» для «100 к 1» (решение владельца 15 октября 2026): гости до мероприятия по ссылке без
-- входа пишут свой ответ на каждый вопрос; ведущий видит сводку и берёт 6 лучших ответов в табло игры.
-- Имя гостя не спрашиваем: в ответе — только тексты ответов по вопросам. Опрос относится к игре (game_id).
create table if not exists polls (
  id text primary key,
  game_id text not null,
  owner_id text not null,
  title text not null default '',
  questions jsonb not null default '[]'::jsonb,
  -- Решения ведущего по вопросам: объединения похожих ответов и подписи групп.
  edits jsonb not null default '{}'::jsonb,
  open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists polls_owner on polls (owner_id, updated_at desc);
create index if not exists polls_game on polls (game_id);

-- Ответы гостя: id создаёт браузер (повтор после обрыва или правка — та же запись).
create table if not exists poll_answers (
  poll_id text not null,
  id text not null,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, id)
);
