import type { Session } from "../../data/types";
import type { MusicMoment } from "../../mechanics/types";
import { BUILTIN_MUSIC, BUILTIN_VOLUME, STEADY_MUSIC } from "../live/sound";
import type { BuiltinMusic } from "./useHallMusic";

/** Встроенная музыка: лобби (QR, ждём гостей), «Представить команды», слайд «Перерыв» — два трека по кругу с наплывом. */
export function builtinMusicOf(session: Session, moment: MusicMoment | null): BuiltinMusic | null {
  const slide = session.state.slide;
  if (slide?.kind === "break") return { key: `break:${slide.id}`, urls: [...BUILTIN_MUSIC.break] };
  if (session.state.phase === "lobby" && session.state.teams?.shown != null) return { key: "teams", urls: [...BUILTIN_MUSIC.teams] };
  // Момент игры (заставка вопроса, выбор в суперигре): каждый новый шаг — трек с начала. Фон игры
  // (STEADY_MUSIC, например бой с драконом) звучит без перерыва через все шаги.
  if (moment && !slide) {
    const key = STEADY_MUSIC.has(moment) ? moment : `${moment}:${session.state.step}:${session.state.startedAt ?? 0}`;
    return { key, urls: [...BUILTIN_MUSIC[moment]], volume: BUILTIN_VOLUME[moment] ?? 1 };
  }
  // Лобби: на экране QR-код, ждём гостей.
  if (session.state.phase === "lobby" && !slide) return { key: "lobby", urls: [...BUILTIN_MUSIC.lobby] };
  return null;
}

