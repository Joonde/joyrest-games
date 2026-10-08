/**
 * Кнопка «кто первый» (гонка в квизе, «Своя игра», кот в мешке). Нажатие — ответ шага `{ buzz: true }`,
 * время ставит сервер, порядок — по нему. Пульт держит в `state.result.buzz`: порядок нажатий, кто
 * сейчас отвечает, кто ошибся на этом шаге («мимо») и кто ответил верно. Чистые функции: пульт,
 * репетиция и проверки считают одинаково.
 */
import type { Answer } from "../data/types";

export interface BuzzState {
  /** Нажавшие по порядку (по времени сервера). */
  order: string[];
  /** У кого сейчас слово; null — слово ни у кого, кнопка открыта. */
  current: string | null;
  /** Ошиблись на этом шаге — до следующего шага не отвечают. */
  out: string[];
  /** Ответил верно (шаг закрыт). */
  winner: string | null;
}

export const EMPTY_BUZZ: BuzzState = { order: [], current: null, out: [], winner: null };

const ID = /^[A-Za-z0-9_-]{1,128}$/;

function ids(value: unknown, max = 500): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && ID.test(v)))].slice(0, max) : [];
}

export function parseBuzz(raw: unknown): BuzzState {
  const d = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
  return { order: ids(d.order), current: id(d.current), out: ids(d.out), winner: id(d.winner) };
}

export function isBuzz(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { buzz?: unknown }).buzz === true;
}

/** Порядок нажатий шага: по времени сервера, без отметки — в конце. */
export function buzzOrder(answers: Answer[], step: number): string[] {
  return answers
    .filter((a) => a.step === step && isBuzz(a.value))
    .sort((a, b) => (a.submittedAt ?? Number.MAX_SAFE_INTEGER) - (b.submittedAt ?? Number.MAX_SAFE_INTEGER) || a.pid.localeCompare(b.pid))
    .map((a) => a.pid);
}

function nextSpeaker(order: string[], out: string[]): string | null {
  return order.find((pid) => !out.includes(pid)) ?? null;
}

/**
 * Свежий порядок нажатий → состояние кнопки. Слово у того, у кого оно уже есть; если ни у кого —
 * у первого нажавшего, кто ещё не ошибся. null — менять нечего (пульт не пишет лишнего).
 */
export function syncBuzz(buzz: BuzzState, order: string[]): BuzzState | null {
  if (buzz.winner) return null;
  // Порядок только дополняется: пришедшее позже нажатие не обгоняет уже записанные.
  const merged = [...buzz.order, ...order.filter((pid) => !buzz.order.includes(pid))];
  const current = buzz.current && !buzz.out.includes(buzz.current) ? buzz.current : nextSpeaker(merged, buzz.out);
  if (merged.length === buzz.order.length && current === buzz.current) return null;
  return { ...buzz, order: merged, current };
}

/** «Неверно»: отвечавший — «мимо», слово следующему по порядку (или кнопка снова открыта). */
export function buzzWrong(buzz: BuzzState): BuzzState {
  if (!buzz.current) return buzz;
  const out = buzz.out.includes(buzz.current) ? buzz.out : [...buzz.out, buzz.current];
  return { ...buzz, out, current: nextSpeaker(buzz.order, out) };
}

/** «Верно»: шаг закрыт, слово было у победителя. */
export function buzzRight(buzz: BuzzState): BuzzState {
  return buzz.current ? { ...buzz, winner: buzz.current } : buzz;
}

export type BuzzPhone = "press" | "queued" | "turn" | "out" | "won" | "lost" | "closed";

/**
 * Что показать телефону: можно жать, нажато и ждёт (номер в очереди), ваше слово, «мимо», победа,
 * шаг закрыт другим. `pressed` — телефон уже нажал на этом шаге, `open` — шаг принимает нажатия.
 */
export function buzzPhone(buzz: BuzzState, pid: string, pressed: boolean, open: boolean): { state: BuzzPhone; place: number } {
  const place = buzz.order.indexOf(pid) + 1;
  if (buzz.winner) return { state: buzz.winner === pid ? "won" : "lost", place };
  if (buzz.out.includes(pid)) return { state: "out", place };
  if (buzz.current === pid) return { state: "turn", place };
  if (pressed || place > 0) {
    const ahead = buzz.order.filter((p) => !buzz.out.includes(p)).indexOf(pid) + 1;
    return { state: "queued", place: ahead > 0 ? ahead : place };
  }
  return { state: open ? "press" : "closed", place: 0 };
}
