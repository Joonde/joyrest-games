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
}

const EMAIL = /[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[A-Za-zА-Яа-яЁё]{2,}/;

/** Что ввёл владелец → по чему искать. Ничего узнаваемого — null. */
export function contactQuery(raw: string): ContactQuery | null {
  const text = raw.trim().slice(0, 200);
  if (!text) return null;
  const email = (EMAIL.exec(text)?.[0] ?? "").toLowerCase();
  const rest = email ? text.replace(EMAIL, " ") : text;
  const phone = phoneKey(rest);
  const links = parseLinks(rest).map((l) => l.toLowerCase());
  // Просто «ник» без @ и ссылки — тоже Telegram-ник.
  if (!phone && links.length === 0 && !email && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(rest.trim())) links.push(`https://t.me/${rest.trim().toLowerCase()}`);
  if (!phone && links.length === 0 && !email) return null;
  return { phone, links, email };
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
  return q.links.map((l) => l.replace(/^https:\/\/t\.me\//, "@")).join(", ");
}
