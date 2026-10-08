-- Архив базы площадок: «Удалить» площадку, анкету или заявку клиента переносит в архив, а не
-- стирает (просьба владельца 8 октября 2026: по ошибке не потерять). Из архива — «Вернуть».
-- Только добавляет колонки без NOT NULL: прошлый релиз их просто не видит.
alter table venues add column if not exists archived_at timestamptz;
alter table venue_requests add column if not exists archived_at timestamptz;
