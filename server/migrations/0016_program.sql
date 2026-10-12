-- Мероприятие из блоков (CLAUDE.md, раздел 6, «Мероприятие из блоков»): один код на вечер, 1–5 игр подряд.
-- { title, blocks: [{ title, mechanic }], snapshots: [...], at, index, results, totals }; null — обычная игра.
alter table sessions add column if not exists program jsonb;
