// «Держи пари» (по мотивам Wits & Wagers; очередь владельца 11 октября 2026): вопрос с ответом-числом →
// команды пишут свою догадку → догадки раскладываются на поле по возрастанию (середина 2:1, к краям 3:1, 4:1,
// 5:1, «меньше всех» 6:1) → все ставят фишки на ответ, который ближе всех, но не больше правды → «Показать
// ответ»: фишки на верном ответе приносят очки по коэффициенту, автор верной догадки — бонус.

export interface WagerQuestion {
  id: string;
  text: string;
  /** Правильный ответ — число. */
  answer: number;
  /** Единицы: «лет», «км», «штук» — на экране после числа. */
  unit: string;
  /** Пояснение для ведущего и на экран после ответа (откуда число). */
  note: string;
}

export interface WagerContent {
  questions: WagerQuestion[];
  /** Секунд на догадку. */
  guessTime: number;
  /** Секунд на ставки. */
  betTime: number;
  /** Сколько стоит фишка на верном ответе: очки × коэффициент. */
  chipPoints: number;
  /** Бонус автору догадки, которая оказалась верной. */
  authorBonus: number;
  /** Можно ли добавлять к фишкам свои очки (угадали — ×коэффициент, нет — сгорают). */
  stakes: boolean;
}

export const WAGER_LIMITS = {
  questions: 30,
  text: 300,
  unit: 30,
  note: 300,
  chipMin: 1,
  chipMax: 1000,
  bonusMax: 1000,
  timeMin: 10,
  timeMax: 300,
  /** Догадок на поле: дальше от середины — не показываем (ставки только на поле). */
  slots: 11,
  /** Фишек у команды на вопрос. */
  chips: 2,
  /** Предел числа, чтобы не ломать вёрстку. */
  maxAbs: 1e12,
} as const;

/** Коэффициент «меньше всех» — если все догадки больше правды. */
export const LOW_ODDS = 6;

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "w" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newQuestion(): WagerQuestion {
  return { id: id(), text: "", answer: 0, unit: "", note: "" };
}

export function createWager(): WagerContent {
  return { questions: [newQuestion()], guessTime: 60, betTime: 45, chipPoints: 10, authorBonus: 30, stakes: true };
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

/** Число игры: конечное, не больше предела, до двух знаков после запятой. */
export function cleanNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > WAGER_LIMITS.maxAbs) return null;
  return Math.round(n * 100) / 100;
}

export function parseWager(raw: unknown): WagerContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const questions = (Array.isArray(d.questions) ? d.questions : []).slice(0, WAGER_LIMITS.questions).map((item, i) => {
    const q = rec(item);
    let qid = typeof q.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? q.id : `w${i + 1}`;
    while (seen.has(qid)) qid += "_";
    seen.add(qid);
    return {
      id: qid,
      text: str(q.text, WAGER_LIMITS.text),
      answer: cleanNumber(q.answer) ?? 0,
      unit: str(q.unit, WAGER_LIMITS.unit),
      note: str(q.note, WAGER_LIMITS.note),
    };
  });
  return {
    questions,
    guessTime: int(d.guessTime, 60, WAGER_LIMITS.timeMin, WAGER_LIMITS.timeMax),
    betTime: int(d.betTime, 45, WAGER_LIMITS.timeMin, WAGER_LIMITS.timeMax),
    chipPoints: int(d.chipPoints, 10, WAGER_LIMITS.chipMin, WAGER_LIMITS.chipMax),
    authorBonus: int(d.authorBonus, 30, 0, WAGER_LIMITS.bonusMax),
    stakes: d.stakes !== false,
  };
}

/** «1 250,5» — с пробелами по разрядам и запятой. */
export function formatNumber(n: number): string {
  const [whole = "0", frac] = Math.abs(n).toFixed(2).replace(/\.?0+$/, "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n < 0 ? "−" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

export interface Slot {
  value: number;
  odds: number;
  /** Чьи догадки (участники таблицы). */
  authors: string[];
}

/**
 * Поле: разные догадки по возрастанию, одинаковые — в одной ячейке. Коэффициент — по расстоянию от середины:
 * середина 2:1 (при чётном числе ячеек две средние — 3:1), дальше 3:1, 4:1, не больше 5:1. Догадок больше 11 —
 * на поле 11 ближайших к середине (ставить можно только на поле).
 */
export function layoutSlots(guesses: Array<{ pid: string; value: number }>): Slot[] {
  const byValue = new Map<number, string[]>();
  for (const g of guesses) byValue.set(g.value, [...(byValue.get(g.value) ?? []), g.pid]);
  let values = [...byValue.keys()].sort((a, b) => a - b);
  if (values.length > WAGER_LIMITS.slots) {
    const drop = values.length - WAGER_LIMITS.slots;
    const left = Math.floor(drop / 2);
    values = values.slice(left, left + WAGER_LIMITS.slots);
  }
  const center = (values.length - 1) / 2;
  return values.map((value, i) => ({ value, odds: Math.min(5, 2 + Math.ceil(Math.abs(i - center))), authors: byValue.get(value) ?? [] }));
}

/** Какая ячейка выиграла: ближайшая догадка не больше правды; все больше — «меньше всех» (−1). */
export function winningSlot(slots: Slot[], answer: number): number {
  let win = -1;
  slots.forEach((s, i) => {
    if (s.value <= answer) win = i;
  });
  return win;
}

export function oddsOf(slots: Slot[], slot: number): number {
  return slot === -1 ? LOW_ODDS : (slots[slot]?.odds ?? 0);
}
