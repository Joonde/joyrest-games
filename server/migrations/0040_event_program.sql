-- Программа мероприятия и «Принял, готовлюсь» (решение владельца 22 октября 2026): менеджер вставляет расчёт клиента —
-- форматы, продление, допы (без цены); ведущий подтверждает, что увидел. `accept_rev` растёт, когда менеджер меняет
-- программу, ведущего, дату или время: старая кнопка в Telegram уже не засчитывается.
alter table events add column if not exists program jsonb;
alter table events add column if not exists accepted_at timestamptz;
alter table events add column if not exists accept_rev integer not null default 0;
-- Последнее сообщение ведущему с кнопкой «Принял, готовлюсь» («чат:сообщение»): бот меняет его кнопку на «✅ Принято»
-- (нажал в студии) или убирает её (программу поменяли, мероприятие отменили) — рабочая кнопка всегда одна.
alter table events add column if not exists accept_msg text;
