// «Дурак» (подкидной и переводной): содержимое игры — только настройки. Колода тасуется в начале
// каждой партии на пульте ведущего.

export type DurakVariant = "podkidnoy" | "perevodnoy";
export type Seating = "solo" | "partners";
export type FirstMove = "under" | "from";

export interface DurakContent {
  variant: DurakVariant;
  deck: 36 | 52;
  /** solo — каждый сам; partners — две команды через одного (4 или 6 игроков). Столик = место — режим команд сессии. */
  seating: Seating;
  /** Кто подкидывает: все или только соседи защитника. */
  throwers: "all" | "neighbors";
  /** В первом отбое переводить нельзя. */
  noTransferFirst: boolean;
  /** «Пики пиками». */
  spades: boolean;
  /** Считать погоны. */
  pogony: boolean;
  /** Первый ход в следующих партиях: «под дурака» (дурак отбивается) или «из-под дурака» (ходит сосед дурака). */
  firstMove: FirstMove;
  /** Секунд на ход; 0 — без таймера. */
  turnSeconds: number;
  /** Подсвечивать карты, которыми можно сыграть. */
  highlight: boolean;
  /** Сукно стола. */
  table: TableTemplate;
  /** Колода (стиль карт). */
  deckStyle: DeckStyle;
  /** Партий за игру; 0 — пока ведущий не завершит. */
  parties: number;
  /** Очки за место: вышел первым — (игроков − 1) × очки, дурак — 0. */
  placePoints: number;
  /** «Партнёры»: каждому игроку победившей команды. */
  teamPoints: number;
}

export type TableTemplate = "emerald" | "bordeaux" | "night" | "graphite";
export const TABLES: Array<{ id: TableTemplate; title: string }> = [
  { id: "emerald", title: "Изумруд" },
  { id: "bordeaux", title: "Бордо" },
  { id: "night", title: "Ночь" },
  { id: "graphite", title: "Графит" },
];

export type DeckStyle = "classic" | "gothic" | "greece" | "rome" | "cyber" | "vintage" | "russia" | "kpop" | "anime" | "wedding";
export const DECKS: Array<{ id: DeckStyle; title: string; hint: string }> = [
  { id: "classic", title: "Классика JoyRest", hint: "айвори, бордо, золото" },
  { id: "gothic", title: "Готика", hint: "витраж, серебро" },
  { id: "greece", title: "Греция", hint: "мрамор, терракота, меандр" },
  { id: "rome", title: "Рим", hint: "пурпур, лавровый венок" },
  { id: "cyber", title: "Киберпанк", hint: "неон и глитч" },
  { id: "vintage", title: "Old fashion", hint: "гравюра, 1920-е" },
  { id: "russia", title: "Хохлома", hint: "чёрный лак и золото" },
  { id: "kpop", title: "K-pop", hint: "голограмма и блёстки" },
  { id: "anime", title: "Аниме", hint: "ночная сакура, рисованные герои" },
  { id: "wedding", title: "Свадьба", hint: "пионы и розовое золото" },
];

export function isDeckStyle(value: unknown): value is DeckStyle {
  return typeof value === "string" && DECKS.some((d) => d.id === value);
}

export function deckTitle(id: DeckStyle): string {
  return DECKS.find((d) => d.id === id)?.title ?? id;
}

/** Мест за столом по правилам. */
export function maxSeats(content: Pick<DurakContent, "deck">): number {
  return content.deck === 36 ? 6 : 8;
}

export const DURAK_LIMITS = { minSeats: 2, minSeconds: 10, maxSeconds: 120 } as const;

export function createDurak(): DurakContent {
  return {
    variant: "podkidnoy",
    deck: 36,
    seating: "solo",
    throwers: "all",
    noTransferFirst: true,
    spades: false,
    pogony: true,
    firstMove: "under",
    turnSeconds: 30,
    highlight: true,
    table: "bordeaux",
    deckStyle: "classic",
    parties: 3,
    placePoints: 10,
    teamPoints: 20,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function parseDurak(raw: unknown): DurakContent {
  const d = record(raw);
  const base = createDurak();
  const turn = int(d.turnSeconds, base.turnSeconds, 0, DURAK_LIMITS.maxSeconds);
  return {
    variant: d.variant === "perevodnoy" ? "perevodnoy" : "podkidnoy",
    deck: d.deck === 52 ? 52 : 36,
    seating: d.seating === "partners" ? "partners" : "solo",
    throwers: d.throwers === "neighbors" ? "neighbors" : "all",
    noTransferFirst: d.noTransferFirst !== false,
    spades: d.spades === true,
    pogony: d.pogony !== false,
    firstMove: d.firstMove === "from" ? "from" : "under",
    turnSeconds: turn === 0 ? 0 : Math.max(DURAK_LIMITS.minSeconds, turn),
    highlight: d.highlight !== false,
    table: TABLES.some((t) => t.id === d.table) ? (d.table as TableTemplate) : base.table,
    deckStyle: isDeckStyle(d.deckStyle) ? d.deckStyle : base.deckStyle,
    parties: int(d.parties, base.parties, 0, 20),
    placePoints: int(d.placePoints, base.placePoints, 0, 1000),
    teamPoints: int(d.teamPoints, base.teamPoints, 0, 1000),
  };
}
