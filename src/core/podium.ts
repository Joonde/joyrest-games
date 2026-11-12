// Пьедестал победителей (CLAUDE.md, раздел 6, «Пьедестал»): после таблицы последнего шага
// ведущий открывает 3-е, 2-е и 1-е место по одному. Этап `stage: "podium"` общий для всех
// механик; сколько мест открыто — `state.result.podium` (остальное в `result` не трогаем,
// чтобы «Назад» вернул таблицу и ответ шага как были).
import type { Leaderboard, LeaderboardEntry, Session, SessionChange, SessionState, StepStage } from "../data/types";
import { rankedLeaderboard } from "./leaderboard";

export type PodiumPlaceNumber = 1 | 2 | 3;

export interface PodiumPlace {
  place: PodiumPlaceNumber;
  entries: Array<LeaderboardEntry & { id: string }>;
  score: number;
}

/** Места 1–3 у кого есть очки; при равных очках — все на одной ступени. Пустые места пропущены. */
export function podiumPlaces(leaderboard: Leaderboard): PodiumPlace[] {
  const places: PodiumPlace[] = [];
  for (const entry of rankedLeaderboard(leaderboard)) {
    if (entry.place > 3 || entry.score <= 0) continue;
    const place = entry.place as PodiumPlaceNumber;
    const existing = places.find((p) => p.place === place);
    const { place: _omit, ...rest } = entry;
    if (existing) existing.entries.push(rest);
    else places.push({ place, entries: [rest], score: entry.score });
  }
  return places;
}

/** Порядок открытия: с третьего места к первому. */
export function revealOrder(leaderboard: Leaderboard): PodiumPlaceNumber[] {
  return podiumPlaces(leaderboard)
    .map((p) => p.place)
    .sort((a, b) => b - a);
}

/** Есть кого награждать (хотя бы у одного участника есть очки). */
export function hasPodium(leaderboard: Leaderboard): boolean {
  return podiumPlaces(leaderboard).length > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Сколько мест уже открыто (0 — только заставка «Награждение»). */
export function podiumShown(state: Pick<SessionState, "result">): number {
  const n = asRecord(state.result).podium;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
}

/** Места открыты до этого номера включительно (3 — открыто третье, 1 — все); 4 — ни одного (только заставка). */
const NONE_OPEN = 4;

/**
 * До какого места открыли (`result.podiumAt`): открываются 3 → 2 → 1, поэтому открыто всё, что не выше этого места.
 * Хранится номер места, а не число открытых: ведущий поправил очки во время награждения и появилось новое третье
 * место — уже открытые места не сдвигаются (паспорт общей части, Н-10). Старые сессии — по числу открытых.
 */
function openedFrom(session: Pick<Session, "leaderboard" | "state">): number {
  const at = asRecord(session.state.result).podiumAt;
  if (typeof at === "number" && Number.isInteger(at) && at >= 1 && at <= NONE_OPEN) return at;
  const shown = podiumShown(session.state);
  if (shown === 0) return NONE_OPEN;
  return revealOrder(session.leaderboard)[shown - 1] ?? 1;
}

/** Открытые места. */
export function revealedPlaces(session: Pick<Session, "leaderboard" | "state">): Set<PodiumPlaceNumber> {
  const at = openedFrom(session);
  return new Set(revealOrder(session.leaderboard).filter((p) => p >= at));
}

/** Какое место откроется следующим; null — все открыты. */
export function nextPlace(session: Pick<Session, "leaderboard" | "state">): PodiumPlaceNumber | null {
  const at = openedFrom(session);
  return revealOrder(session.leaderboard).find((p) => p < at) ?? null;
}

/** Все места открыты — дальше «Завершить игру». */
export function podiumDone(session: Pick<Session, "leaderboard" | "state">): boolean {
  return nextPlace(session) === null;
}

/** `shown` — число открытых мест (для старых пультов и «Назад»), `at` — до какого места открыто. */
function withPodium(result: unknown, shown: number | null, at: number = NONE_OPEN): Record<string, unknown> {
  const { podium: _omit, podiumFrom: _from, podiumAt: _at, ...rest } = asRecord(result);
  const from = asRecord(result).podiumFrom;
  if (shown === null) return rest;
  return { ...rest, podium: shown, podiumAt: at, ...(from === undefined ? {} : { podiumFrom: from }) };
}

/** Откуда ведущий ушёл на досрочное награждение («Назад» с заставки вернёт туда же). */
function podiumFrom(state: Pick<SessionState, "result">): { stage: StepStage; revealed: boolean } | null {
  const from = asRecord(asRecord(state.result).podiumFrom);
  const stage = from.stage;
  // «question» — досрочное награждение в механиках со своим ходом (настолка, шашки): назад — туда же.
  if (stage !== "ready" && stage !== "reveal" && stage !== "board" && stage !== "question") return null;
  return { stage, revealed: from.revealed === true };
}

/** Досрочное награждение можно начать, когда на экране нет открытого вопроса. */
export function canAwardNow(state: Pick<SessionState, "phase" | "stage">): boolean {
  return state.phase === "playing" && (state.stage === "ready" || state.stage === "reveal" || state.stage === "board");
}

/** «Наградить сейчас»: пьедестал по текущему счёту; «Назад» с заставки вернёт на тот же этап. */
export function awardNow(session: Session): SessionChange {
  const { stage, revealed } = session.state;
  return {
    state: {
      stage: "podium",
      revealed: true,
      result: { ...withPodium(session.state.result, 0), podiumFrom: { stage, revealed } },
    },
  };
}

/** «Награждение»: заставка, места ещё закрыты. */
export function startPodium(session: Session): SessionChange {
  return { state: { stage: "podium", revealed: true, result: withPodium(session.state.result, 0) } };
}

/** Открыть следующее место. */
export function podiumNext(session: Session): SessionChange {
  const next = nextPlace(session);
  const at = next ?? openedFrom(session);
  const shown = revealOrder(session.leaderboard).filter((p) => p >= at).length;
  return { state: { result: withPodium(session.state.result, shown, at) } };
}

/** «Назад»: закрыть последнее открытое место, с заставки — к таблице. */
export function podiumBack(session: Session): SessionChange {
  const at = openedFrom(session);
  if (at < NONE_OPEN) {
    // Закрываем самое высокое из открытых (последнее открытое); открытым остаётся то, что ниже его по пьедесталу.
    const order = revealOrder(session.leaderboard);
    const back = [...order].reverse().find((p) => p > at) ?? NONE_OPEN;
    const shown = order.filter((p) => p >= back).length;
    return { state: { result: withPodium(session.state.result, shown, back) } };
  }
  const from = podiumFrom(session.state);
  if (from) return { state: { stage: from.stage, revealed: from.revealed, result: withPodium(session.state.result, null) } };
  return { state: { stage: "board", revealed: true, result: withPodium(session.state.result, null) } };
}

/** Подпись главной кнопки пульта на пьедестале. */
export function podiumLabel(session: Pick<Session, "leaderboard" | "state">): string {
  const place = nextPlace(session);
  return place === null ? "Завершить игру" : `Показать ${place} место`;
}
