-- Роли доступа помощников (src/core/accessRoles.ts): создатель игр, музыкальный редактор, тестировщик,
-- модератор площадок, помощник владельца. Пусто — без роли. Полные права — только у владельца.
alter table users add column if not exists access_role text;
