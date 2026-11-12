// Игры робота-ведущего: шаблоны, режимы и составы (run.mjs — правила, inspect.mjs — Ревизор).
export const MECHANICS = {
  quiz: { modes: ["solo", "teams"], demos: 4 },
  lotto: { modes: ["solo", "teams"], demos: 1 },
  board: { modes: ["solo", "teams"], demos: 1 },
  checkers: { modes: ["teams"], demos: 1, players: [2] },
  dance: { modes: ["teams"], demos: 1 },
  stage: { modes: ["teams"], demos: 2 },
  quest: { modes: ["teams"], demos: 2 },
  millionaire: { modes: ["teams", "solo"], demos: 1 },
  hundred: { modes: ["teams", "solo"], demos: 4 },
  survival: { modes: ["teams"], demos: 1 },
  dragon: { modes: ["teams"], demos: 2 },
  mafia: { modes: ["solo"], demos: 1, players: [6, 9] },
  spy: { modes: ["solo"], demos: 1, players: [5, 11] },
  bunker: { modes: ["solo"], demos: 1, players: [5, 8] },
  durak: { modes: ["solo"], demos: 1, players: [2, 4] },
  truth: { modes: ["solo", "teams"], demos: 2 },
  perudo: { modes: ["solo", "teams"], demos: 1, players: [2, 4] },
  wager: { modes: ["teams", "solo"], demos: 1 },
  wine: { modes: ["solo", "teams"], demos: 1 },
  story: { modes: ["solo", "teams"], demos: 1, players: [4, 6] },
  aquarium: { modes: ["solo", "teams"], demos: 2 },
  olymp: { modes: ["teams"], demos: 2, players: [1, 3] },
};

/**
 * Игры, которые робот-ведущий и Ревизор не проводят — с причиной (иначе их молча «нет»).
 * «Бубликатор» идёт не шагами сессии, а в игровой комнате быстрого канала (непрерывные движения приборов, тряска, удержание):
 * страница робота ведёт сессию в памяти и шагами пульта, комнаты у неё нет. Его проверяют свои стенды против тех же правил,
 * что у сервера: `bublikator-phone.*` (телефон), `bublikator-screen.*` (экран зала), `bublikator-host.*` (пульт, конструктор,
 * предпросмотр, полная игра на 50 гостей) и тесты `src/mechanics/bublikator/**`, `server/src/rooms/bublikator.test.ts`.
 */
export const SKIPPED = {
  bublikator: "игровая комната быстрого канала — свои стенды bublikator-phone/-screen/-host",
};
