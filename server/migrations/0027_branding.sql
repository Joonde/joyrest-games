-- Оформление под заказчика (решение владельца 15 октября 2026): логотип и фирменные цвета на экране зала и телефонах.
-- Сессия хранит копию оформления (правка сохранённого не меняет идущую игру); сохранённые — у ведущего.
alter table sessions add column if not exists branding jsonb;
create table if not exists brandings (
  id text primary key,
  owner_id text not null,
  name text not null default '',
  colors jsonb not null default '[]'::jsonb,
  logo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brandings_owner on brandings (owner_id, updated_at desc);
