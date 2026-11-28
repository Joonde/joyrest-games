-- Физические кнопки «кто первый»: привязка устройства к участнику конкретной сессии.
-- Только добавления: прежняя версия приложения продолжает писать телефонные ответы со source='phone'.
create table if not exists hardware_bindings (
  id text primary key,
  session_id text not null references sessions (id) on delete cascade,
  participant_id text not null,
  source text not null check (source in ('bluetooth', 'usb')),
  hardware_id text not null,
  alias text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_id, participant_id) references participants (session_id, id) on delete cascade,
  unique (session_id, participant_id),
  unique (session_id, source, hardware_id)
);

alter table answers add column if not exists source text not null default 'phone';
alter table answers add column if not exists hardware_event_id text;
alter table answers add column if not exists hardware_binding_id text;

-- Повторная доставка одного физического нажатия не создаёт второй ответ.
create unique index if not exists answers_hardware_event
  on answers (session_id, hardware_event_id) where hardware_event_id is not null;
