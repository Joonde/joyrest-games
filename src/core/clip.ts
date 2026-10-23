/**
 * Музыкальный фрагмент вопроса (квиз, «Ставка на знания», суперигра): какой трек, какой кусок звучит,
 * пока угадывают, и какой — припевом после верного ответа; как начинается, заканчивается и как
 * переходит к припеву. Хранится внутри содержимого игры; разбор не бросает исключений.
 */

export const FADE_IN = [0, 2, 5] as const;
export const FADE_OUT = [0, 3, 6] as const;
/** Быстрые кнопки длины припева; любая другая длина — ползунками или числом (3–120 с). */
export const CHORUS_LENGTHS = [5, 10, 15, 20, 25, 30] as const;
export type ClipJoin = "cut" | "cross" | "sting";

export const CLIP_LIMITS = { maxStart: 3600, minLength: 3, maxLength: 120 } as const;

export interface Clip {
  trackId: string | null;
  /** Угадывание: с какой секунды и сколько секунд. */
  start: number;
  length: number;
  /** Начало: 0 — сразу громко, иначе плавно за столько секунд. */
  fadeIn: number;
  /** Конец: 0 — обрыв, иначе затухание за столько секунд. */
  fadeOut: number;
  /** Припев после верного ответа: с какой секунды; null — без припева. */
  chorusStart: number | null;
  chorusLength: number;
  /** Переход к припеву: сразу, склейка (короткое затухание и плавный вход) или отбивка. */
  join: ClipJoin;
  /** Конфетти на экране зала при верном ответе. */
  confetti: boolean;
}

export const DEFAULT_CLIP: Clip = {
  trackId: null,
  start: 0,
  length: 15,
  fadeIn: 0,
  fadeOut: 3,
  chorusStart: null,
  chorusLength: 10,
  join: "cross",
  confetti: true,
};

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pick<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export const TRACK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Фрагмент из полей вопроса. Старые игры хранили `trackId`, `trackStart`, `trackLength` прямо в
 * вопросе — они читаются так же; новые поля — `fadeIn`, `fadeOut`, `chorusStart`, `chorusLength`,
 * `join`, `confetti`.
 */
export function parseClip(raw: unknown): Clip {
  const d = rec(raw);
  const trackId = typeof d.trackId === "string" && TRACK_ID.test(d.trackId) ? d.trackId : null;
  const start = int(d.trackStart ?? d.start, 0, 0, CLIP_LIMITS.maxStart);
  const length = int(d.trackLength ?? d.length, DEFAULT_CLIP.length, CLIP_LIMITS.minLength, CLIP_LIMITS.maxLength);
  const chorusStart = d.chorusStart === null || d.chorusStart === undefined ? null : int(d.chorusStart, 0, 0, CLIP_LIMITS.maxStart);
  return {
    trackId,
    start,
    length,
    fadeIn: pick(d.fadeIn, FADE_IN, DEFAULT_CLIP.fadeIn as 0),
    fadeOut: pick(d.fadeOut, FADE_OUT, DEFAULT_CLIP.fadeOut as 3),
    chorusStart,
    chorusLength: int(d.chorusLength, DEFAULT_CLIP.chorusLength, CLIP_LIMITS.minLength, CLIP_LIMITS.maxLength),
    join: d.join === "cut" || d.join === "sting" || d.join === "cross" ? d.join : DEFAULT_CLIP.join,
    confetti: d.confetti !== false,
  };
}

/** Поля фрагмента для записи в вопрос (имена совместимы со старыми играми). */
export function clipFields(clip: Clip): Record<string, unknown> {
  return {
    trackId: clip.trackId,
    trackStart: clip.start,
    trackLength: clip.length,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    chorusStart: clip.chorusStart,
    chorusLength: clip.chorusLength,
    join: clip.join,
    confetti: clip.confetti,
  };
}

/**
 * Участки на таймлайне не заходят за края трека. `which` — какой ползунок двигают: начало или конец
 * угадывания, начало или конец припева, `chorus` — весь припев целиком (длина та же).
 * Длина трека неизвестна — без правого края.
 */
export function moveHandle(clip: Clip, which: "start" | "end" | "guess" | "chorus" | "chorusStart" | "chorusEnd", seconds: number, duration: number | null): Clip {
  const max = duration && duration > 0 ? Math.floor(duration) : CLIP_LIMITS.maxStart + CLIP_LIMITS.maxLength;
  const s = Math.max(0, Math.round(seconds));
  if (which === "start") {
    const end = clip.start + clip.length;
    const start = Math.min(s, end - CLIP_LIMITS.minLength);
    const length = Math.min(CLIP_LIMITS.maxLength, end - Math.max(0, start));
    return { ...clip, start: Math.max(0, end - length), length };
  }
  if (which === "guess") {
    // Поле «С секунды»: весь фрагмент угадывания сдвигается, длина та же.
    return { ...clip, start: Math.max(0, Math.min(s, max - clip.length)) };
  }
  if (which === "end") {
    // Начало за концом трека (трек заменили на короче) — сначала подвигаем начало, длина не бывает меньше минимума.
    const from = Math.max(0, Math.min(clip.start, max - CLIP_LIMITS.minLength));
    const end = Math.min(max, Math.max(from + CLIP_LIMITS.minLength, Math.min(s, from + CLIP_LIMITS.maxLength)));
    return { ...clip, start: from, length: Math.max(CLIP_LIMITS.minLength, end - from) };
  }
  const from = clip.chorusStart ?? 0;
  if (which === "chorusStart") {
    const end = Math.min(max, from + clip.chorusLength);
    const start = Math.max(0, Math.max(end - CLIP_LIMITS.maxLength, Math.min(s, end - CLIP_LIMITS.minLength)));
    return { ...clip, chorusStart: start, chorusLength: end - start };
  }
  if (which === "chorusEnd") {
    const at = Math.max(0, Math.min(from, max - CLIP_LIMITS.minLength));
    const end = Math.min(max, Math.max(at + CLIP_LIMITS.minLength, Math.min(s, at + CLIP_LIMITS.maxLength)));
    return { ...clip, chorusStart: at, chorusLength: Math.max(CLIP_LIMITS.minLength, end - at) };
  }
  const chorus = Math.min(Math.max(0, max - clip.chorusLength), s);
  return { ...clip, chorusStart: chorus };
}

/** «0:42». */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
