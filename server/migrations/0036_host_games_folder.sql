-- Игры, принятые из предложений ведущих, — в отдельную папку библиотеки «Игры от ведущих JoyRest»
-- (решение владельца 22 октября 2026). Только заполняет пустую папку; прошлая версия папку игр библиотеки не читает.
update games set folder = 'Игры от ведущих JoyRest'
where scope = 'agency' and folder = ''
  and id in (select library_game_id from library_proposals where status = 'accepted' and library_game_id is not null);
