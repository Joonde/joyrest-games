/**
 * Черновики мероприятий (решение владельца 24 октября 2026): менеджер начал записывать мероприятие, ушёл в «Клиенты»
 * перевести клиента в «Клиент», вернулся — то, что он заполнил, лежит в черновике, касание продолжает с того же места.
 * Хранятся на устройстве (localStorage), у каждого человека свои; только новые мероприятия и «похожие» — правка
 * записанного мероприятия черновиком не становится. Чистые функции; чтение и запись — в Planner.
 */
import { dayIndex } from "./calendar";
import { cleanProgram, isEmptyProgram, type EventProgram } from "./eventProgram";
import { EVENT_LIMITS } from "./events";

export interface EventFormDraft {
  /** id будущего мероприятия: повторное «Записать» после обрыва — то же мероприятие. */
  id: string;
  savedAt: number;
  day: string;
  start: number;
  end: number;
  hostId: string;
  title: string;
  clientName: string;
  clientPhone: string;
  place: string;
  guests: string;
  note: string;
  program: EventProgram | null;
  /** Где писать клиенту («telegram:@ник», «whatsapp»…); у старых черновиков — пусто. */
  contact?: string;
  /** Дату и время выбрали сами (или подставили из расчёта) — «Когда» заполнено. */
  whenSet?: boolean;
}

/** Не больше 10 черновиков; старше 30 дней — убираются сами. */
export const DRAFTS_MAX = 10;
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function draftsKey(uid: string): string {
  return `joyrest.draft.events.${uid || "me"}`;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const minutes = (v: unknown, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 48 * 60 ? v : fallback);

function parseOne(raw: unknown): EventFormDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const day = str(r.day, 10);
  if (!id || dayIndex(day) === null) return null;
  const start = minutes(r.start, 18 * 60);
  return {
    id,
    savedAt: typeof r.savedAt === "number" && Number.isFinite(r.savedAt) ? r.savedAt : 0,
    day,
    start,
    end: Math.max(start, minutes(r.end, start)),
    hostId: str(r.hostId, 80),
    title: str(r.title, EVENT_LIMITS.title),
    clientName: str(r.clientName, EVENT_LIMITS.client),
    clientPhone: str(r.clientPhone, EVENT_LIMITS.phone),
    place: str(r.place, EVENT_LIMITS.place),
    guests: str(r.guests, 6),
    note: str(r.note, EVENT_LIMITS.note),
    program: cleanProgram(r.program),
    contact: str(r.contact, 120),
    whenSet: r.whenSet === true,
  };
}

/** Из того, что лежит на устройстве: мусор отбрасывается, старые — тоже, свежие сверху. */
export function parseDrafts(text: string | null, now: number): EventFormDraft[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .map(parseOne)
    .filter((d): d is EventFormDraft => d !== null && now - d.savedAt < DRAFT_TTL_MS && !seen.has(d.id) && (seen.add(d.id), true))
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, DRAFTS_MAX);
}

/** Есть ли что хранить: хоть одно поле, кроме даты и времени, заполнено. */
export function draftHasContent(d: EventFormDraft): boolean {
  return Boolean(d.hostId || d.title.trim() || d.clientName.trim() || d.clientPhone.trim() || d.place.trim() || d.guests.trim() || d.note.trim() || !isEmptyProgram(d.program));
}

/** Положить черновик (тот же id — заменить), пустой — убрать. */
export function upsertDraft(list: EventFormDraft[], draft: EventFormDraft): EventFormDraft[] {
  const rest = list.filter((d) => d.id !== draft.id);
  return (draftHasContent(draft) ? [draft, ...rest] : rest).slice(0, DRAFTS_MAX);
}

export function removeDraft(list: EventFormDraft[], id: string): EventFormDraft[] {
  return list.filter((d) => d.id !== id);
}

/** Подпись черновика в списке: «Свадьба · Анна» или «Без названия». */
export function draftTitle(d: EventFormDraft): string {
  return [d.title.trim(), d.clientName.trim()].filter(Boolean).join(" · ") || "Без названия";
}
