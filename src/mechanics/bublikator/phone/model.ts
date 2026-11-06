/**
 * Телефон гостя «Бубликатора» без React: что пришло из личного потока комнаты (снимок, куски `{ t: "me" }`, состав
 * `{ t: "crew" }`, короткие события), часы сервера, пауза, закрытие потока — и какой экран сейчас показывать.
 * Чистые функции: их проверяют тесты (`model.test.ts`) и стенд телефона (`scripts/bublikator/`).
 */
import type { RoomClosedReason, RoomStreamEvent } from "../../../data/types";
import type { CrewSummary, PersonalView } from "../rules/types";

/** Вспышка карточки приказа (1 с, макет «Что случилось с приказом»). */
export interface Flash {
  kind: "done" | "helped" | "fail" | "cancel";
  order: string;
  /** Местное время появления. */
  at: number;
}

export interface PhoneModel {
  view: PersonalView | null;
  crew: CrewSummary | null;
  paused: boolean;
  /** Часы сервера в момент, когда началась пауза (отсчёты на паузе стоят). */
  pausedAt: number | null;
  /** Часы сервера − местные часы: лучшая оценка (событие пришло не раньше, чем было отправлено). */
  offset: number | null;
  closed: RoomClosedReason | null;
  flash: Flash | null;
  /** «Вы у цели!» — местное время. */
  finishedAt: number | null;
  /** Экипаж полный (выбор экипажа в лобби). */
  full: number | null;
  /** Когда последний раз сервер отвечал (поток или пачка), местное время. */
  heardAt: number;
}

export const FLASH_MS = 1000;
/** Сервер молчит дольше (ни потока, ни ответа на пачку) — «Нет связи». */
export const SILENT_MS = 6000;

export function emptyModel(now: number): PhoneModel {
  return { view: null, crew: null, paused: false, pausedAt: null, offset: null, closed: null, flash: null, finishedAt: null, full: null, heardAt: now };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Новый замер часов: сервер прислал `at` (его часы при отправке), мы получили в `local`. */
export function withClock(m: PhoneModel, at: number, local: number): PhoneModel {
  if (!Number.isFinite(at)) return m;
  const sample = at - local;
  // Событие приходит позже, чем отправлено: замер всегда не больше настоящего сдвига — берём больший. Если местные
  // часы прыгнули назад (сдвиг вырос сильно) — тоже больший; прыгнули вперёд на минуты — сбрасываем.
  const offset = m.offset === null || sample > m.offset || m.offset - sample > 60_000 ? sample : m.offset;
  return offset === m.offset ? m : { ...m, offset };
}

function setPaused(m: PhoneModel, paused: boolean, at: number): PhoneModel {
  if (paused === m.paused) return m;
  return { ...m, paused, pausedAt: paused ? at : null };
}

/** Событие личного потока → новая модель. */
export function applyStream(m0: PhoneModel, e: RoomStreamEvent, local: number): PhoneModel {
  let m: PhoneModel = { ...withClock(m0, e.at, local), heardAt: local };
  switch (e.type) {
    case "snapshot": {
      const data = isRecord(e.data) ? (e.data as unknown as PersonalView) : null;
      m = setPaused(m, e.paused, e.at);
      return { ...m, view: data, crew: data?.crew ?? null, closed: null };
    }
    case "room":
      return setPaused(m, e.paused, e.at);
    case "closed":
      return { ...m, closed: e.reason };
    case "event": {
      const d = isRecord(e.data) ? e.data : null;
      if (!d) return m;
      if (d.t === "me" && isRecord(d.me)) {
        const part = d.me as Partial<PersonalView>;
        const view = d.full === true || !m.view ? ({ ...part } as PersonalView) : { ...m.view, ...part };
        // Пока рассылка не стала целиком — части от прошлого личного; без снимка ждём целого.
        if (d.full !== true && !m.view) return m;
        return { ...m, view, closed: null };
      }
      if (d.t === "crew") return { ...m, crew: isRecord(d.crew) ? (d.crew as unknown as CrewSummary) : null };
      if ((d.t === "done" || d.t === "fail" || d.t === "cancel") && typeof d.order === "string") {
        const kind: Flash["kind"] = d.t === "done" ? (d.helped === true ? "helped" : "done") : d.t;
        // Помог товарищу — вспышка только если своего приказа сейчас нет на экране (иначе своя карточка не мигает зря).
        if (kind === "helped" && m.flash && local - m.flash.at < FLASH_MS) return m;
        return { ...m, flash: { kind, order: d.order, at: local } };
      }
      if (d.t === "finish") return { ...m, finishedAt: local };
      if (d.t === "full" && typeof d.crew === "number") return { ...m, full: d.crew };
      return m;
    }
    default:
      return m;
  }
}

/** Ответ сервера на пачку: часы и пауза. */
export function applyReply(m: PhoneModel, reply: { at: number; paused: boolean }, local: number): PhoneModel {
  return setPaused({ ...withClock(m, reply.at, local), heardAt: local }, reply.paused, reply.at);
}

/** Часы сервера сейчас (по лучшему замеру). */
export function serverNow(m: PhoneModel, local: number): number {
  return local + (m.offset ?? 0);
}

/**
 * Сколько осталось до момента по часам сервера. На паузе отсчёт стоит — остаток на момент паузы (сервер после
 * «Продолжить» сдвинет сам момент).
 */
export function leftUntil(m: PhoneModel, at: number | null | undefined, local: number): number | null {
  if (at === null || at === undefined || !Number.isFinite(at)) return null;
  const now = m.paused && m.pausedAt !== null ? m.pausedAt : serverNow(m, local);
  return Math.max(0, at - now);
}

/** Остаток приказа: на паузе и во время события и ремонта — `left` с сервера (он не тикает), иначе — до `dueAt`. */
export function orderLeft(m: PhoneModel, local: number): number | null {
  const o = m.view?.order;
  if (!o) return null;
  if (m.paused || o.frozen || o.dueAt === null) return o.left;
  return Math.min(o.total, leftUntil(m, o.dueAt, local) ?? o.left);
}

/** «0:07». */
export function clockText(ms: number | null): string {
  if (ms === null) return "";
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type Screen =
  | "connecting"
  | "tab"
  | "abandoned"
  | "removed"
  | "over"
  | "lobby"
  | "crews"
  | "drill"
  | "launch"
  | "role"
  | "panel"
  | "meteor"
  | "pull"
  | "sos"
  | "sos-crew"
  | "deck"
  | "repair"
  | "finish"
  | "dock"
  | "vote"
  | "nosab"
  | "voted"
  | "card"
  | "pause"
  | "out";

/** Какой экран показать: закрытие потока сильнее всего, потом пауза, потом этап игры. */
export function screenOf(m: PhoneModel): Screen {
  if (m.closed === "busy" || m.closed === "replaced") return "tab";
  if (m.closed === "abandoned") return "abandoned";
  if (m.closed === "removed") return "removed";
  if (m.closed === "finished") return "over";
  const v = m.view;
  if (!v) return "connecting";
  if (v.phase === "podium" || v.phase === "finished") return v.card ? "card" : "over";
  if (m.paused) return "pause";
  if (v.phase === "lobby") return "lobby";
  if (v.me.role === "out") return "out";
  if (v.phase === "crews") return "crews";
  if (v.phase === "drill") return "drill";
  // Перелёт.
  if (v.role && !v.role.seen && (v.stage === "launch" || v.stage === "fly")) return "role";
  if (v.stage === "launch") return "launch";
  if (v.stage === "fly") {
    if (v.finished) return "finish";
    if (v.repair) return "repair";
    const ev = v.event;
    if (ev && !ev.warn && ev.joined) {
      if (ev.kind === "meteor") return "meteor";
      if (ev.kind === "pull") return "pull";
      if (ev.kind === "sos") return ev.sos?.captain ? "sos" : "sos-crew";
      if (ev.kind === "captain") return "deck";
    }
    return "panel";
  }
  if (v.stage === "vote") return v.vote && !v.vote.none ? "vote" : "nosab";
  if (v.stage === "voted") return v.voted?.none ? "nosab" : "voted";
  return "dock";
}

/** Вспышка ещё видна. */
export function flashOf(m: PhoneModel, local: number): Flash | null {
  return m.flash && local - m.flash.at < FLASH_MS ? m.flash : null;
}

/** Связи нет: браузер без сети или сервер молчит дольше `SILENT_MS`. */
export function silent(m: PhoneModel, local: number, online: boolean): boolean {
  return !online || local - m.heardAt > SILENT_MS;
}
