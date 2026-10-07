// Звуки по кнопке ведущего (CLAUDE.md, раздел 7, «Звуки»): пульт пишет в state.cue, экран зала
// играет звук, когда меняется id. Чистые функции: их используют и браузер, и сервер.
import type { CueSound, SoundCue } from "./types";

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
