-- Папки в музыке (решение владельца 15 октября 2026): у трека — название папки ('' — без папки).
alter table tracks add column if not exists folder text not null default '';
