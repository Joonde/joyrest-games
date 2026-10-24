/**
 * Из карточки клиента — в мероприятие ведущему (решение владельца 24 октября 2026: анкета клиента и запись мероприятия
 * должны «синергировать»). Имя и телефон — из карточки; дата, время, гости, место, повод и программа — из заметки
 * менеджера (она свежее всего) и обращений клиента (заявка с сайта, расчёт из Telegram, «Что хочет клиент»), новые первыми.
 * Заметка менеджера и цены в комментарий ведущему не переносятся — это внутреннее.
 */
import { programFromCalc, type EventProgram } from "./eventProgram";
import { parseLeadText, type LeadFill } from "./events";

/** Откуда берём подробности: обращения клиента (не смены статуса и не уже записанные мероприятия). */
const SOURCES = new Set(["site", "question", "venue", "telegram", "manual"]);

export interface ClientLike {
  name: string;
  phone: string;
  /** Ссылки карточки: https://t.me/ник → связь Telegram, https://wa.me/… → WhatsApp. */
  links?: string[];
  notes: string;
  history?: Array<{ source: string; summary: string; at: number }>;
}

export interface ClientEventFill extends Omit<LeadFill, "note"> {
  program: EventProgram | null;
  /** Что подставили — для подсказки «Из карточки клиента: …». */
  got: string[];
}

const TITLES: Array<[keyof ClientEventFill, string]> = [
  ["clientName", "имя"],
  ["clientPhone", "телефон"],
  ["contact", "связь"],
  ["title", "повод"],
  ["day", "дата"],
  ["start", "время"],
  ["guests", "гости"],
  ["place", "место"],
  ["program", "программа"],
];

export function eventFillFromClient(c: ClientLike, today: string): ClientEventFill {
  const texts = [c.notes, ...(c.history ?? []).filter((h) => SOURCES.has(h.source) && h.summary.trim()).sort((a, b) => b.at - a.at).map((h) => h.summary)].filter(
    (t) => t.trim() !== "",
  );
  const out: ClientEventFill = { program: null, got: [] };
  for (const text of texts) {
    const f = parseLeadText(text, today);
    if (!out.title && f.title) out.title = f.title;
    if (!out.day && f.day) out.day = f.day;
    if (out.start === undefined && f.start !== undefined && f.end !== undefined) {
      out.start = f.start;
      out.end = f.end;
    }
    if (out.guests === undefined && f.guests !== undefined) out.guests = f.guests;
    if (!out.place && f.place) out.place = f.place;
    if (!out.contact && f.contact) out.contact = f.contact;
    if (!out.program) out.program = programFromCalc(text);
  }
  // Имя и телефон — всегда из самой карточки (в тексте заявки может быть другое написание).
  if (c.name.trim()) out.clientName = c.name.trim();
  if (c.phone.trim()) out.clientPhone = c.phone.trim();
  // Связь — из ссылок карточки (ник Telegram надёжнее, чем найденный в тексте).
  const tg = (c.links ?? []).map((l) => /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})$/i.exec(l)?.[1]).find(Boolean);
  if (tg) out.contact = `telegram:@${tg}`;
  else if (!out.contact && (c.links ?? []).some((l) => /wa\.me\//i.test(l))) out.contact = "whatsapp";
  // Прошедшая дата из старой заявки — не подставляем.
  if (out.day && out.day < today) delete out.day;
  out.got = TITLES.filter(([k]) => out[k] !== undefined && out[k] !== null && out[k] !== "").map(([, t]) => t);
  return out;
}
