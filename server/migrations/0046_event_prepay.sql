-- Предоплата мероприятия (решение владельца 12 ноября 2026): менеджер записывает мероприятие ведущему только после брони —
-- клиент внёс 2 000 ₽, владелец подтвердил, что деньги пришли. `price` — стоимость по расчёту (ведущему уходит остаток
-- «к оплате на месте» = стоимость − предоплата), `prepaid_at`/`prepaid_by` — когда и кто отметил предоплату.
-- «Вернуть предоплату» (клиент отказался не позже чем за 48 часов до начала): `refund_at`/`refund_by` — мероприятие закрыто
-- у ведущего и у менеджера, владелец возвращает деньги и отмечает `refund_done_at`. Только новые колонки без NOT NULL.
alter table events add column if not exists price integer;
alter table events add column if not exists prepaid_at timestamptz;
alter table events add column if not exists prepaid_by text;
alter table events add column if not exists refund_at timestamptz;
alter table events add column if not exists refund_by text;
alter table events add column if not exists refund_done_at timestamptz;
