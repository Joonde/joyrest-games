// «Мафия» (клубная классика): Мафия, Дон, Комиссар, Доктор и мирные жители. Содержимое игры — только
// настройки: роли раздаются в начале каждой партии случайно.

export type RoleId = "mafia" | "don" | "commissar" | "doctor" | "civilian";

export interface RoleInfo {
  id: RoleId;
  title: string;
  /** Чья команда: город или мафия. */
  side: "city" | "mafia";
  /** Что делает ночью — коротко для карты. */
  power: string;
  /** Подробнее — на обороте карты. */
  goal: string;
}

export const ROLES: Record<RoleId, RoleInfo> = {
  mafia: {
    id: "mafia",
    title: "Мафия",
    side: "mafia",
    power: "Ночью вместе с семьёй выбираете, кого убрать.",
    goal: "Останьтесь в городе в большинстве. Днём не выдавайте себя.",
  },
  don: {
    id: "don",
    title: "Дон",
    side: "mafia",
    power: "Глава мафии: решающий голос семьи и ночная проверка — не Комиссар ли это.",
    goal: "Найдите Комиссара и приведите мафию к победе.",
  },
  commissar: {
    id: "commissar",
    title: "Комиссар",
    side: "city",
    power: "Каждую ночь проверяете одного игрока: мафия он или нет.",
    goal: "Вычислите мафию и аккуратно подскажите городу.",
  },
  doctor: {
    id: "doctor",
    title: "Доктор",
    side: "city",
    power: "Каждую ночь лечите одного игрока. Одного и того же — не две ночи подряд, себя — один раз за игру.",
    goal: "Спасите мирных от ночных выстрелов.",
  },
  civilian: {
    id: "civilian",
    title: "Мирный житель",
    side: "city",
    power: "Ночью спите. Днём — ваш голос решает, кто покинет город.",
    goal: "Вычислите мафию голосованием.",
  },
};

export interface RoleCounts {
  mafia: number;
  don: number;
  commissar: number;
  doctor: number;
}

export interface MafiaContent {
  /** auto — роли по числу игроков; custom — как задал ведущий (лишние — мирные). */
  roles: "auto" | "custom";
  counts: RoleCounts;
  /** Открывать роль выбывшего (на вечеринке веселее; в клубной игре — нет). */
  revealOnDeath: boolean;
  /** Секунд на речь игрока днём. */
  speechSeconds: number;
  /** Секунд на последнее слово. */
  lastWordSeconds: number;
  /** Секунд на голосование. */
  voteSeconds: number;
  /** Очки за победу каждому игроку победившей стороны. */
  winPoints: number;
  /** Бонус выжившим победителям. */
  survivorBonus: number;
  /** Название города на экране. */
  city: string;
  /** Партий за игру: после каждой — «Следующая партия», очки копятся в общий счёт. */
  parties: number;
}

export const MAFIA_LIMITS = {
  minPlayers: 5,
  maxPlayers: 30,
  minSeconds: 10,
  maxSeconds: 300,
  city: 40,
} as const;

export function createMafia(): MafiaContent {
  return {
    roles: "auto",
    counts: { mafia: 2, don: 1, commissar: 1, doctor: 1 },
    revealOnDeath: false,
    speechSeconds: 60,
    lastWordSeconds: 45,
    voteSeconds: 30,
    winPoints: 100,
    survivorBonus: 50,
    city: "Палермо",
    parties: 3,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function parseMafia(raw: unknown): MafiaContent {
  const d = record(raw);
  const base = createMafia();
  const c = record(d.counts);
  return {
    roles: d.roles === "custom" ? "custom" : "auto",
    counts: {
      mafia: int(c.mafia, base.counts.mafia, 0, 10),
      don: int(c.don, base.counts.don, 0, 1),
      commissar: int(c.commissar, base.counts.commissar, 0, 1),
      doctor: int(c.doctor, base.counts.doctor, 0, 1),
    },
    revealOnDeath: d.revealOnDeath === true,
    speechSeconds: int(d.speechSeconds, base.speechSeconds, MAFIA_LIMITS.minSeconds, MAFIA_LIMITS.maxSeconds),
    lastWordSeconds: int(d.lastWordSeconds, base.lastWordSeconds, MAFIA_LIMITS.minSeconds, MAFIA_LIMITS.maxSeconds),
    voteSeconds: int(d.voteSeconds, base.voteSeconds, MAFIA_LIMITS.minSeconds, MAFIA_LIMITS.maxSeconds),
    winPoints: int(d.winPoints, base.winPoints, 0, 1000),
    survivorBonus: int(d.survivorBonus, base.survivorBonus, 0, 1000),
    city: typeof d.city === "string" && d.city.trim() ? d.city.trim().slice(0, MAFIA_LIMITS.city) : base.city,
    parties: int(d.parties, base.parties, 1, 10),
  };
}

/**
 * Роли по числу игроков (клубная классика): мафии примерно треть без одного, Дон — с 7 игроков,
 * Комиссар всегда, Доктор — с 7 игроков. Остальные — мирные.
 */
export function autoCounts(players: number): RoleCounts {
  const n = Math.max(0, players);
  const family = n <= 6 ? 1 : n <= 9 ? 2 : n <= 12 ? 3 : n <= 16 ? 4 : n <= 20 ? 5 : Math.round(n / 4);
  const don = n >= 7 ? 1 : 0;
  return { mafia: family - don, don, commissar: n >= 5 ? 1 : 0, doctor: n >= 7 ? 1 : 0 };
}

/** Сколько каких ролей будет в этой партии (не больше игроков; мафии меньше половины). */
export function countsFor(content: MafiaContent, players: number): RoleCounts {
  if (content.roles === "auto") return autoCounts(players);
  const c = { ...content.counts };
  const maxFamily = Math.max(1, Math.ceil(players / 2) - 1);
  while (c.mafia + c.don > maxFamily && c.mafia > 0) c.mafia--;
  if (c.mafia + c.don > maxFamily) c.don = 0;
  if (c.mafia + c.don === 0) c.mafia = 1;
  while (c.mafia + c.don + c.commissar + c.doctor > players) {
    if (c.doctor) c.doctor = 0;
    else if (c.commissar) c.commissar = 0;
    else c.mafia = Math.max(1, c.mafia - 1);
    if (c.mafia + c.don + c.commissar + c.doctor <= players || c.mafia === 1) break;
  }
  return c;
}
