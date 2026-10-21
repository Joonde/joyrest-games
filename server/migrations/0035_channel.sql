-- Публикации в Telegram-канал JoyRest (решение владельца 21 октября 2026): бот JoyRest — админ канала и сам
-- публикует посты из очереди в назначенное время. Очередь приходит с релизом (`channel/queue.json` и ролики в образе),
-- сервер переносит её сюда; ролики — копии в MEDIA_DIR/channel. Статусы: queued, sending, sent, skipped, missed, failed.
create table if not exists channel_posts (
  id text primary key,
  n integer not null default 0,
  at timestamptz not null,
  text text not null,
  video text not null default '',
  pin boolean not null default false,
  status text not null default 'queued',
  attempts integer not null default 0,
  previewed boolean not null default false,
  message_id bigint,
  sent_at timestamptz,
  error text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists channel_posts_due on channel_posts (status, at);
