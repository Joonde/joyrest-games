// «Правда или действие»: игроки (или команды) ходят по очереди и выбирают на телефоне «Правду» — честный
// ответ на вопрос — или «Действие» — шуточное задание. Карточки — колода игры (обычные и 18+) и задания,
// которые присылают гости (ведущий решает, брать ли их).

export type TruthKind = "truth" | "dare";

export interface TruthCard {
  id: string;
  kind: TruthKind;
  text: string;
  /** Карточка 18+: в колоде, только если в игре включены карточки 18+. */
  adult: boolean;
}

export interface TruthContent {
  cards: TruthCard[];
  /** Играть и карточками 18+. */
  adult: boolean;
  truthPoints: number;
  darePoints: number;
  /** Сколько снимать за отказ (0 — без штрафа, только фант от зала). */
  refusePenalty: number;
  /** Гости могут прислать свои вопросы и задания с телефона. */
  guestCards: boolean;
  /** Сколько кругов (каждый ходит один раз за круг); 0 — пока ведущий не остановит. */
  rounds: number;
}

export const TRUTH_LIMITS = { cards: 300, text: 200, maxPoints: 1000, maxRounds: 20 } as const;

export const KIND_TITLES: Record<TruthKind, string> = { truth: "Правда", dare: "Действие" };

export function newCardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "c" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function createTruth(): TruthContent {
  return { cards: [], adult: false, truthPoints: 50, darePoints: 100, refusePenalty: 0, guestCards: true, rounds: 3 };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function cleanText(value: unknown, max: number = TRUTH_LIMITS.text): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function parseTruth(raw: unknown): TruthContent {
  const d = record(raw);
  const base = createTruth();
  const seen = new Set<string>();
  const cards = (Array.isArray(d.cards) ? d.cards : []).slice(0, TRUTH_LIMITS.cards).flatMap((item, i) => {
    const c = record(item);
    let id = typeof c.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) ? c.id : `c${i + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    return [{ id, kind: c.kind === "dare" ? "dare" : "truth", text: cleanText(c.text), adult: c.adult === true } as TruthCard];
  });
  return {
    cards,
    adult: d.adult === true,
    truthPoints: int(d.truthPoints, base.truthPoints, 0, TRUTH_LIMITS.maxPoints),
    darePoints: int(d.darePoints, base.darePoints, 0, TRUTH_LIMITS.maxPoints),
    refusePenalty: int(d.refusePenalty, base.refusePenalty, 0, TRUTH_LIMITS.maxPoints),
    guestCards: d.guestCards !== false,
    rounds: int(d.rounds, base.rounds, 0, TRUTH_LIMITS.maxRounds),
  };
}

/** Колода игры: без карточек 18+, если они выключены. */
export function deckOf(content: TruthContent, kind: TruthKind): TruthCard[] {
  return content.cards.filter((c) => c.kind === kind && c.text && (content.adult || !c.adult));
}

/**
 * Список строками: «Правда: …» или «Действие: …»; «18+» в начале — карточка для взрослых. Строка без
 * пометки — того же вида, что предыдущая (первая — «Правда»).
 */
export function parseCardList(input: string): TruthCard[] {
  let kind: TruthKind = "truth";
  return input
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean)
    .slice(0, TRUTH_LIMITS.cards)
    .flatMap((line) => {
      let rest = line;
      let adult = false;
      if (/^18\+\s*/.test(rest)) {
        adult = true;
        rest = rest.replace(/^18\+\s*/, "");
      }
      const m = /^(правда|вопрос|действие|задание)\s*[:—–-]\s*(.*)$/i.exec(rest);
      if (m) {
        kind = /^(правда|вопрос)$/i.test(m[1] ?? "") ? "truth" : "dare";
        rest = m[2] ?? "";
      }
      const text = cleanText(rest);
      return text ? [{ id: newCardId(), kind, text, adult }] : [];
    });
}
