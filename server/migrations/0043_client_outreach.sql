-- Рассылка прежним клиентам (решение владельца 25 октября 2026, перенос на сервер — 29 октября): когда им написали
-- («написали» — после «Получилось отправить? Да») и куда не дошло («telegram», «whatsapp» через запятую). Раньше
-- хранилось только в браузере телефона. Прошлая версия колонки не читает.
alter table clients add column if not exists outreach_at timestamptz;
alter table clients add column if not exists outreach_fail text not null default '';
