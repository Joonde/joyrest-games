// Звуки по кнопке ведущего (CLAUDE.md, раздел 7, «Звуки»): пульт пишет в state.cue, экран зала
// играет звук, когда меняется id. Чистые функции: их используют и браузер, и сервер.
import type { CueSound, MixState, MusicState, PeekView, ScreenReport, SlideKind, SlideState, SoundCue, TeamsReveal } from "./types";

export const CUE_SOUNDS: readonly CueSound[] = ["gong", "drumroll", "fanfare", "applause", "wrong", "stop"];

const CUE_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Звук из базы или запроса; всё непонятное — null (экран ничего не играет). */
export function parseCue(value: unknown): SoundCue | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { id, sound } = value as Record<string, unknown>;
  if (typeof id !== "string" || !CUE_ID.test(id)) return null;
  if (typeof sound !== "string" || !(CUE_SOUNDS as readonly string[]).includes(sound)) return null;
  return { id, sound: sound as CueSound };
}

/** Музыка на экране зала из базы или запроса; непонятное — null (музыки нет). */
export function parseMusic(value: unknown): MusicState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { trackId, playing, rev } = value as Record<string, unknown>;
  if (typeof trackId !== "string" || !CUE_ID.test(trackId) || typeof rev !== "string" || !CUE_ID.test(rev)) return null;
  return { trackId, playing: playing === true, rev };
}

export const DEFAULT_MIX: MixState = { music: 70, effects: 100, muted: false };

function volume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;
}

/** Микшер: громкости 0–100; непонятное — null (значения по умолчанию). */
export function parseMix(value: unknown): MixState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return { music: volume(v.music, DEFAULT_MIX.music), effects: volume(v.effects, DEFAULT_MIX.effects), muted: v.muted === true };
}

export const SLIDE_KINDS: readonly SlideKind[] = ["intro", "rules", "round", "break", "award", "thanks", "custom"];
export const SLIDE_LIMITS = { title: 120, text: 400, lines: 8, line: 140 } as const;

function slideText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, max) : "";
}

/** Слайд из базы или запроса; непонятное — null (слайда нет). Длинное обрезается. */
export function parseSlide(value: unknown): SlideState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !CUE_ID.test(v.id)) return null;
  if (typeof v.kind !== "string" || !(SLIDE_KINDS as readonly string[]).includes(v.kind)) return null;
  const lines = Array.isArray(v.lines)
    ? v.lines.slice(0, SLIDE_LIMITS.lines).map((l) => slideText(l, SLIDE_LIMITS.line).replace(/\n/g, " ")).filter((l) => l.trim() !== "")
    : [];
  return {
    id: v.id,
    kind: v.kind as SlideKind,
    title: slideText(v.title, SLIDE_LIMITS.title).replace(/\n/g, " "),
    text: slideText(v.text, SLIDE_LIMITS.text),
    lines,
    endsAt: typeof v.endsAt === "number" && Number.isFinite(v.endsAt) ? v.endsAt : null,
  };
}

/** Сообщение экрана зала о себе; всё непонятное — null. */
export function parseScreenReport(value: unknown): ScreenReport | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { soundReady, muted, musicBlocked } = value as Record<string, unknown>;
  if (typeof soundReady !== "boolean" || typeof muted !== "boolean" || typeof musicBlocked !== "boolean") return null;
  return { soundReady, muted, musicBlocked };
}

/** Экран зала сообщает о себе раз в 20 с; молчит дольше минуты — пульт считает, что его нет. */
export const SCREEN_REPORT_MS = 20_000;
export const SCREEN_STALE_MS = 60_000;

const TEAM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Скрытые названия и представление команд; непонятное — null (всё открыто). */
export function parseTeams(value: unknown): TeamsReveal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const shown = typeof v.shown === "number" && Number.isInteger(v.shown) && v.shown >= 0 && v.shown <= 200 ? v.shown : null;
  const reveal: TeamsReveal = { hidden: v.hidden === true, shown };
  if (typeof v.sizes === "object" && v.sizes !== null && !Array.isArray(v.sizes)) {
    const sizes: Record<string, number> = {};
    for (const [id, n] of Object.entries(v.sizes as Record<string, unknown>).slice(0, 200)) {
      if (TEAM_ID.test(id) && typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100) sizes[id] = n;
    }
    reveal.sizes = sizes;
  }
  return reveal;
}

/** Таблица поверх игры; непонятное — null (таблицы поверх нет). */
export function parsePeek(value: unknown): PeekView | null {
  return value === "total" || value === "round" ? value : null;
}
