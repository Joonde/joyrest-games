/**
 * «Данные по номеру» (решение владельца 15 октября 2026): человек просит на почту удалить свои данные —
 * владелец вводит его телефон, ник или почту и видит всё, что по нему есть в базе. Здесь — общая
 * логика сравнения (сервер ищет и удаляет по ней, тесты проверяют без базы).
 */
import { parseLinks, phoneKey } from "./clients";

export interface ContactQuery {
  /** Ключ телефона «7XXXXXXXXXX» или пусто. */
  phone: string;
  /** Ссылки на соцсети в нижнем регистре: https://t.me/nick … */
  links: string[];
  /** Почта в нижнем регистре или пусто. */
  email: string;
  /**
   * Все цифры номера (не короче 6, без первой «7»/«8» у 10–12 цифр) — запасной поиск записей с неполным или ошибочным
   * номером (третья проверка QA 22 октября 2026): у такой записи нет ключа телефона, а удалить её по просьбе нужно.
   * Пусто — в запросе нет номера.
   */
  digits: string;
}

/** Цифры номера для запасного сравнения: «8 915 123 45 6» и «+7 915 123 45 6» — одно и то же («915123456»). */
export function looseDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 12 && /^[78]/.test(digits) ? digits.slice(1) : digits;
}

/** Меньше 6 цифр — не номер (дата, число гостей), по ним не ищем. */
const MIN_DIGITS = 6;

const EMAIL = /[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[A-Za-zА-Яа-яЁё]{2,}/;

/** Что ввёл владелец → по чему искать. Ничего узнаваемого — null. */
export function contactQuery(raw: string): ContactQuery | null {
  const text = raw.trim().slice(0, 200);
  if (!text) return null;
  const email = (EMAIL.exec(text)?.[0] ?? "").toLowerCase();
  const rest = email ? text.replace(EMAIL, " ") : text;
  const phone = phoneKey(rest);
  const links = parseLinks(rest).map((l) => l.toLowerCase());
  // Цифры — только если запрос похож на номер (ссылки и ники могут содержать цифры: vk.com/id123456).
  const bare = links.length === 0 ? looseDigits(rest) : "";
  const digits = bare.length >= MIN_DIGITS ? bare : "";
  // Просто «ник» без @ и ссылки — тоже Telegram-ник.
  if (!phone && !digits && links.length === 0 && !email && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(rest.trim())) links.push(`https://t.me/${rest.trim().toLowerCase()}`);
  if (!phone && !digits && links.length === 0 && !email) return null;
  return { phone, links, email, digits };
}

/** Чем запись связывается с человеком: телефоны, тексты со ссылками и никами, почты. */
export interface ContactFields {
  phones?: string[];
  links?: string[];
  texts?: string[];
  emails?: string[];
}

export function matchesContact(q: ContactQuery, f: ContactFields): boolean {
  if (q.phone && (f.phones ?? []).some((p) => phoneKey(p) === q.phone)) return true;
  if (q.phone && (f.texts ?? []).some((t) => phoneKey(t) === q.phone)) return true;
  // Запасной путь: записи с неполным номером (ключа нет) — по всем цифрам номера.
  if (q.digits && [...(f.phones ?? []), ...(f.texts ?? [])].some((p) => looseDigits(p) === q.digits)) return true;
  if (q.links.length > 0) {
    const own = new Set([...(f.links ?? []), ...(f.texts ?? []).flatMap((t) => parseLinks(t))].map((l) => l.toLowerCase()));
    if (q.links.some((l) => own.has(l))) return true;
  }
  if (q.email && [...(f.emails ?? []), ...(f.texts ?? [])].some((e) => e.trim().toLowerCase() === q.email)) return true;
  return false;
}

/** Как показать запрос: «+7 915 241-59-99», «@nick», почта. */
export function queryLabel(q: ContactQuery): string {
  if (q.phone) return q.phone.length === 11 && q.phone.startsWith("7") ? `+7 ${q.phone.slice(1, 4)} ${q.phone.slice(4, 7)}-${q.phone.slice(7, 9)}-${q.phone.slice(9)}` : q.phone;
  if (q.email) return q.email;
  if (q.digits && q.links.length === 0) return q.digits.length < 10 ? `${q.digits} (номер неполный)` : q.digits;
  return q.links.map((l) => l.replace(/^https:\/\/t\.me\//, "@")).join(", ");
}
