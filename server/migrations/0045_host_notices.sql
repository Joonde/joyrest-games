-- Колокольчик ведущего (решение владельца 6 ноября 2026): менеджер или владелец назначил, изменил, снял или отменил
-- мероприятие — запись тому, кого это касается. Без имени и телефона клиента: только что за мероприятие, когда и кто назначил.
-- Мероприятие удалили навсегда или человека убрали из базы — его уведомления уходят вместе с ними.
create table if not exists host_notices (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  event_id text not null references events (id) on delete cascade,
  kind text not null,
  title text not null default '',
  day date not null,
  start_min smallint not null,
  end_min smallint not null,
  by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists host_notices_user_idx on host_notices (user_id, created_at desc);
