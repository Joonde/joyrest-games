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
  /** Устарело (до 16 октября 2026: очки за фишку). Счёт теперь — фишки, поле только читается для старых игр. */
  chipPoints: number;
  /** Бонус автору догадки, которая оказалась верной, — фишек. */
  authorBonus: number;
  /** Устарело: фишки всегда ставятся из своего запаса. */
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
  /** Бонус автору — не больше стольких фишек. */
  bonusChips: 10,
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
  return { questions: [newQuestion()], guessTime: 60, betTime: 45, chipPoints: 1, authorBonus: 1, stakes: true };
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

/** Число игры: конечное, не больше предела, до двух знаков после запятой. */
export function cleanNumber(v: unknown): number | null {
  // Пустая строка и строка без цифр — не число (Number("") = 0: пустое поле давало ответ 0).
  if (typeof v === "string" && !/\d/.test(v)) return null;
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
    chipPoints: 1,
    // Старые игры считали бонус в очках (фишка = chipPoints очков) — переводим в фишки.
    authorBonus: Math.min(WAGER_LIMITS.bonusChips, Math.round(int(d.authorBonus, 1, 0, WAGER_LIMITS.bonusMax) / Math.max(1, int(d.chipPoints, 1, WAGER_LIMITS.chipMin, WAGER_LIMITS.chipMax)))),
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

/** Фишки (решение владельца 16 октября 2026): у каждого в начале 2, одна из них несгораемая — меньше 1 не бывает. */
export const START_CHIPS = 2;
export const SAFE_CHIPS = 1;
