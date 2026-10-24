/**
 * «Что хочет клиент» отдельными полями (решение владельца 24 октября 2026): дата, время, гости, формат по порядку
 * (первая игра, вторая…) и пожелания. Хранится понятными строками в заметке карточки клиента — сервер и база не
 * меняются, менеджер видит всё на карточке, а «📅 Записать мероприятие ведущему» (`eventFillFromClient`) читает те же
 * строки: «Дата: 20.12.2026», «Начало: в 19:00», «Гостей: 35», «Программа: Квиз → Музыкальный», «Пожелания: …».
 */
import { dayIndex } from "./calendar";
import { programFromCalc, PROGRAM_FORMATS } from "./eventProgram";
import { parseLeadText } from "./events";

export interface ClientWish {
  /** «2026-12-20» или пусто. */
  day: string;
  /** «19:00» или пусто. */
  time: string;
  /** Число гостей строкой (как в поле) или пусто. */
  guests: string;
  /** Пакеты по порядку вечера. */
  formats: string[];
  wishes: string;
}

export const EMPTY_WISH: ClientWish = { day: "", time: "", guests: "", formats: [], wishes: "" };

/** Строки, которые пишет анкета, и строки контактов — их не повторяем в «Пожеланиях». */
const FIELD_LINE = /^\s*(дата|начало|время|гостей|гости|программа|формат|пожелания|имя|телефон|тел\.?|контакт)\s*:/i;
const OWN_LINE = /^\s*(дата|начало|гостей|программа|пожелания)\s*:/i;

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** Поля → текст заметки. Пустые поля не пишутся. */
export function composeWish(w: ClientWish): string {
  const lines: string[] = [];
  if (dayIndex(w.day) !== null) lines.push(`Дата: ${w.day.slice(8, 10)}.${w.day.slice(5, 7)}.${w.day.slice(0, 4)}`);
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(w.time)) lines.push(`Начало: в ${w.time}`);
  const g = w.guests.trim();
  if (/^\d{1,5}$/.test(g) && Number(g) > 0) lines.push(`Гостей: ${Number(g)}`);
  const formats = w.formats.filter((f) => (PROGRAM_FORMATS as readonly string[]).includes(f));
  if (formats.length) lines.push(`Программа: ${formats.join(" → ")}`);
  const wishes = w.wishes.trim();
  if (wishes) lines.push(`Пожелания: ${wishes}`);
  return lines.join("\n");
}

/**
 * Текст → поля. `strict` — текст из анкеты (заметка карточки): поля берутся только из своих строк («Дата:», «Гостей:»…),
 * всё остальное — в «Пожелания» как было, ничего не теряется. Без `strict` — вставленная переписка: дата, время, гости
 * и формат ищутся по всему тексту, а в «Пожелания» идут строки без имени, телефона и уже разобранных полей.
 */
export function wishFromText(text: string, today: string, strict = false): ClientWish {
  const lines = text.replace(/\r/g, "").split("\n");
  const own = lines.filter((l) => OWN_LINE.test(l));
  const source = strict ? own.filter((l) => !/^\s*пожелания\s*:/i.test(l)).join("\n") : text;
  const lead = parseLeadText(source, today);
  const program = programFromCalc(source);
  // Пожелания: строка «Пожелания: …» и всё, что за ней (многострочные), плюс прочие строки без полей.
  const rest: string[] = [];
  let inWishes = false;
  for (const line of lines) {
    if (/^\s*пожелания\s*:/i.test(line)) {
      inWishes = true;
      rest.push(line.replace(/^\s*пожелания\s*:\s*/i, ""));
      continue;
    }
    if (inWishes && !OWN_LINE.test(line)) {
      rest.push(line);
      continue;
    }
    inWishes = false;
    if (strict ? OWN_LINE.test(line) : FIELD_LINE.test(line)) continue;
    rest.push(line);
  }
  return {
    day: lead.day ?? "",
    time: lead.start !== undefined ? timeOf(lead.start) : "",
    guests: lead.guests !== undefined ? String(lead.guests) : "",
    formats: program?.formats ?? [],
    wishes: rest.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}
