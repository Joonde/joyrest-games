-- Карточка ведущего (CLAUDE.md, раздел 3, «Команда JoyRest»): аватарка, обложка и пара строк
-- «о себе». Картинки — файлы MEDIA_DIR/profile/<sha256>, здесь только ссылки на них.

alter table users add column if not exists bio text not null default '';
alter table users add column if not exists avatar_sha text;
alter table users add column if not exists avatar_mime text;
alter table users add column if not exists cover_sha text;
alter table users add column if not exists cover_mime text;
