-- «Добавить в мой календарь» (решение владельца 15 октября 2026): секретная ссылка подписки на свои мероприятия.
-- Телефон сам забирает календарь по ссылке; «Сменить ссылку» — новая, старая перестаёт работать.
alter table users add column if not exists calendar_token text;
create unique index if not exists users_calendar_token on users (calendar_token);
