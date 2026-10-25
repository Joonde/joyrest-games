-- Способ связи с клиентом (решение владельца 25 октября 2026): «telegram», «whatsapp», «call»; пусто — не указан.
-- Клиент может быть и без телефона — только с ником Telegram (ссылка в `links`). Прошлая версия колонку не читает.
alter table clients add column if not exists contact text not null default '';
