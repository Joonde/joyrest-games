// Отрезок, громкость и затухание трека ведущего (решение владельца 11 октября 2026): хранятся у трека,
// пульт передаёт их в `state.music.clip`, экран зала играет только выбранный отрезок по кругу. Чистые
// функции — их используют и браузер, и сервер.
import type { TrackClip } from "./types";

export const DEFAULT_TRACK_CLIP: TrackClip = { start: 0, end: null, fadeIn: 0, fadeOut: 0, volume: 100 };
/** Варианты затухания, секунд. */
export const CLIP_FADES = [0, 2, 5] as const;

function sec(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(max, Math.round(value * 10) / 10) : null;
}

/** Из базы или запроса; непонятное — значения по умолчанию, конец всегда позже начала. */
export function parseTrackClip(value: unknown): TrackClip {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...DEFAULT_TRACK_CLIP };
  const v = value as Record<string, unknown>;
  const start = sec(v.start, 3600) ?? 0;
  const endRaw = sec(v.end, 3600);
  const end = endRaw !== null && endRaw > start + 1 ? endRaw : null;
  const fade = (x: unknown) => Math.min(10, sec(x, 10) ?? 0);
  const volume = typeof v.volume === "number" && Number.isFinite(v.volume) ? Math.min(100, Math.max(0, Math.round(v.volume))) : 100;
  return { start, end, fadeIn: fade(v.fadeIn), fadeOut: fade(v.fadeOut), volume };
}

/** Отрезок отличается от «весь трек как есть». */
export function isClipped(clip: TrackClip): boolean {
  return clip.start > 0 || clip.end !== null || clip.fadeIn > 0 || clip.fadeOut > 0 || clip.volume !== 100;
}
