// Звуки по кнопке ведущего (CLAUDE.md, раздел 7, «Звуки»): пульт пишет в state.cue, экран зала
// играет звук, когда меняется id. Чистые функции: их используют и браузер, и сервер.
import type { CueSound, MixState, MusicState, SoundCue } from "./types";

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
