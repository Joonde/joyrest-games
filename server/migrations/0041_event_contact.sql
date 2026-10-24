-- Где писать клиенту мероприятия (решение владельца 24 октября 2026): «telegram:@ник», «whatsapp», «email:адрес», «call».
alter table events add column if not exists client_contact text not null default '';
