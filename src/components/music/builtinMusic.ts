import type { Session } from "../../data/types";
import type { MusicMoment } from "../../mechanics/types";
import { BUILTIN_MUSIC, BUILTIN_VOLUME } from "../live/sound";
import type { BuiltinMusic } from "./useHallMusic";

/** Музыка, которая идёт всю партию, а не заново на каждом шаге. */
const CONTINUOUS = new Set<MusicMoment>(["durakTable"]);

/** Встроенная музыка: лобби (QR, ждём гостей), «Представить команды», слайд «Перерыв» — два трека по кругу с наплывом. */
export function builtinMusicOf(session: Session, moment: MusicMoment | null): BuiltinMusic | null {
  const slide = session.state.slide;
  // Перерыв и технический перерыв — спокойная музыка перерыва по кругу.
  if (slide?.kind === "break" || slide?.kind === "tech") return { key: `break:${slide.id}`, urls: [...BUILTIN_MUSIC.break] };
  // Фон всей партии («Дурак»): один ключ на игру — ходы не перезапускают трек.
  if (moment && !slide && CONTINUOUS.has(moment)) return { key: moment, urls: [...BUILTIN_MUSIC[moment]], volume: BUILTIN_VOLUME[moment] ?? 1 };
  // Момент игры (заставка вопроса, выбор в суперигре): каждый новый шаг — трек с начала.
  if (moment && !slide) return { key: `${moment}:${session.state.step}:${session.state.startedAt ?? 0}`, urls: [...BUILTIN_MUSIC[moment]] };
  if (session.state.phase === "lobby" && session.state.teams?.shown != null) return { key: "teams", urls: [...BUILTIN_MUSIC.teams] };
  // Лобби: на экране QR-код, ждём гостей.
  if (session.state.phase === "lobby" && !slide) return { key: "lobby", urls: [...BUILTIN_MUSIC.lobby] };
  return null;
}

