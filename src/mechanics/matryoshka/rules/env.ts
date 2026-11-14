/**
 * Что правила «Игр Матрёшки» знают о комнате (`Env` = `RoomContext` комнаты), время игры, время события, случайность.
 * Время в состоянии — «время игры»: часы сервера минус все паузы (`offset`); на паузе стоит.
 */
import { TEMPO } from "./constants";
import type { MatState } from "./types";

export interface Env {
  now: number;
  paused: boolean;
  players: ReadonlyArray<{ pid: string; name: string; team: string | null }>;
  online(pid: string): boolean;
  send(pid: string, data: unknown): void;
  changed(): void;
  checkpoint(): void;
  random(key: string): number;
}

/** Событие телефона после проверки комнатой: `at` — по часам сервера (с учётом `ago`), `delayed` — пришло не в свой черёд. */
export interface InEvent {
  t: string;
  at: number;
  late: boolean;
  delayed: boolean;
  [field: string]: unknown;
}

export type Outcome = { ok: true; result?: unknown } | { ok: false; error: string };

export type TimeEnv = Pick<Env, "now" | "paused">;

/** Время игры. На паузе стоит: момент паузы (`pausedGame`), после перезапуска — последний шаг цикла. */
export function gameNow(s: MatState, env: TimeEnv): number {
  if (env.paused) return s.pausedGame ?? s.lastTick ?? env.now - s.offset;
  return env.now - s.offset;
}

/** Время игры → часы сервера (для экрана и телефонов). */
export function toServer(s: MatState, gameTime: number): number {
  return gameTime + s.offset;
}

/**
 * Время события телефона в игре (L5): свежее — **заявленное** (`at`; его предел ставит движок: интервал пачки + 0,5 с, не
 * больше 4 с), `delayed` — время прихода. Не раньше конца паузы (`floor`) и не позже «сейчас». Правила «Бубликатора» «задним
 * числом не больше 0,3 с» здесь нет: честное «отпустил» с пачкой через 1 с сдвинулось бы и поймало бы зря.
 */
export function eventTime(s: MatState, env: TimeEnv, e: Pick<InEvent, "at" | "delayed">): number {
  const now = gameNow(s, env);
  if (e.delayed) return now;
  return Math.min(now, Math.max(s.floor, e.at - s.offset));
}

/**
 * Случайность пачкой: одно число из зерна комнаты на вызов, дальше быстрый генератор (mulberry32). Номер растёт и не
 * откатывается «Назад» — после «Назад» случайность новая.
 */
export function randomOf(s: MatState, env: Pick<Env, "random">): () => number {
  const n = s.rng;
  s.rng += 1;
  let a = Math.floor(env.random(`m${n}`) * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Целое [min, max] из генератора. */
export function between(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/** Перемешать (Фишер — Йейтс). */
export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const x = out[i] as T;
    out[i] = out[j] as T;
    out[j] = x;
  }
  return out;
}

/** Жребий каждому: pid → число, по возрастанию номера (повторяемо). */
export function lots(s: MatState, env: Pick<Env, "random">, pids: readonly string[]): Map<string, number> {
  const rand = randomOf(s, env);
  const sorted = [...pids].sort((a, b) => (s.members[a]?.num ?? 0) - (s.members[b]?.num ?? 0));
  const out = new Map<string, number>();
  for (const pid of sorted) out.set(pid, rand());
  return out;
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Длительность шага с темпом. */
export function tempoMs(s: MatState, ms: number): number {
  return Math.round(ms * TEMPO[s.content.tempo]);
}
