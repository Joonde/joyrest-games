-- Итоги игры: во сколько началась («Начать игру») и когда завершилась — для «Истории игр» и
-- страницы итогов (сколько шла игра). У старых итогов — пусто.

alter table results add column if not exists started_at timestamptz;
alter table results add column if not exists finished_at timestamptz;
