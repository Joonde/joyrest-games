/**
 * База клиентов агентства (решение владельца 14 октября 2026): каждый, кто оставил заявку на сайте, по QR-анкете,
 * через планировщик или кого владелец переслал боту в Telegram, попадает в базу — даже если мероприятия не было.
 * Один человек — одна запись: ключ — телефон (только цифры, 8… и +7… — одно и то же), без телефона — ссылка.
 * Рассылка — только тем, кто сам согласился (38-ФЗ «О рекламе»): согласие хранится отдельно, с датой и источником.
 * Чистые функции: их же проверяет сервер.
 */

export const CLIENT_LIMITS = { name: 100, phone: 40, link: 200, links: 5, notes: 2000, summary: 3000 } as const;

export type ClientStatus = "new" | "work" | "client" | "lost";
export const CLIENT_STATUSES: ClientStatus[] = ["new", "work", "client", "lost"];
export const CLIENT_STATUS_TITLES: Record<ClientStatus, string> = {
  new: "Новый",
  work: "В работе",
  client: "Клиент",
  lost: "Отказ",
};

/** Согласие на рассылку: да — сам отметил (сайт) или подтвердил владельцу; нет — отказался; неизвестно. */
export type Marketing = "yes" | "no" | "unknown";
export const MARKETING_TITLES: Record<Marketing, string> = {
  yes: "Согласен на рассылку",
  no: "Отказался от рассылки",
  unknown: "Согласия на рассылку нет",
};

export type ClientSource = "site" | "question" | "venue" | "event" | "telegram" | "manual" | "status";
export const SOURCE_TITLES: Record<ClientSource, string> = {
  site: "Заявка с сайта",
  question: "Вопрос с сайта",
  venue: "Запрос по QR",
  event: "Мероприятие",
  telegram: "Из Telegram",
  manual: "Добавлен вручную",
  status: "Статус",
};

export function isClientStatus(value: unknown): value is ClientStatus {
  return typeof value === "string" && (CLIENT_STATUSES as string[]).includes(value);
}
export function isMarketing(value: unknown): value is Marketing {
  return value === "yes" || value === "no" || value === "unknown";
}

/** Телефон → ключ «7XXXXXXXXXX» (Россия) или все цифры для других стран; меньше 10 цифр — пусто. */
export function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) return `7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `7${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

/** Красивый вид российского номера: +7 915 241-59-99; другие — как ввели. */
export function phoneLabel(raw: string): string {
  const key = phoneKey(raw);
  if (key.length === 11 && key.startsWith("7")) return `+7 ${key.slice(1, 4)} ${key.slice(4, 7)}-${key.slice(7, 9)}-${key.slice(9)}`;
  return raw.trim();
}

const LINK_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  // Telegram без ника: ссылка на человека по номеру в Telegram (так приходят клиенты, написавшие в Telegram Business).
  [/tg:\/\/user\?id=(\d{3,15})/i, (m) => `tg://user?id=${m[1]}`],
  [/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,32})/i, (m) => `https://t.me/${m[1]}`],
  [/(?:https?:\/\/)?(?:www\.|m\.)?(?:vk\.com|vk\.ru)\/([A-Za-z0-9_.]{2,50})/i, (m) => `https://vk.com/${m[1]}`],
  [/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})/i, (m) => `https://instagram.com/${m[1]}`],
  [/(?:https?:\/\/)?(?:www\.)?wa\.me\/(\d{10,15})/i, (m) => `https://wa.me/${m[1]}`],
  [/(?:^|[\s,;(])@([A-Za-z][A-Za-z0-9_]{3,31})\b/, (m) => `https://t.me/${m[1]}`],
];

/** Ссылки на соцсети из текста: Telegram (и @ник), ВКонтакте, Instagram, WhatsApp — до 5 разных. */
export function parseLinks(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (const [re, make] of LINK_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of rest.matchAll(global)) {
      const link = make(m as RegExpExecArray);
      if (!out.some((l) => l.toLowerCase() === link.toLowerCase())) out.push(link);
    }
    rest = rest.replace(global, " ");
  }
  return out.slice(0, CLIENT_LIMITS.links);
}

/** Какая сеть у ссылки — для подписи. */
export function linkTitle(link: string): string {
  if (/^tg:\/\/user/i.test(link)) return "Telegram (без ника)";
  if (/t\.me\//i.test(link)) return `Telegram ${link.replace(/^https:\/\/t\.me\//i, "@")}`;
  if (/vk\.com\//i.test(link)) return `ВКонтакте ${link.replace(/^https:\/\/vk\.com\//i, "")}`;
  if (/instagram\.com\//i.test(link)) return `Instagram ${link.replace(/^https:\/\/instagram\.com\//i, "")}`;
  if (/wa\.me\//i.test(link)) return "WhatsApp";
  return link;
}

export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanNotes(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, CLIENT_LIMITS.notes);
}

/** Ссылки из списка: только наши виды сетей, без повторов. */
export function cleanLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return parseLinks(value.filter((v): v is string => typeof v === "string").join(" "));
}

/** Есть ли, как связаться: телефон или ссылка. */
export function reachable(c: { phone: string; links: string[] }): boolean {
  return phoneKey(c.phone) !== "" || c.links.length > 0;
}

function csvCell(value: string): string {
  // Формулы в ячейках Excel не выполняем: =, +, -, @ в начале — с апострофом.
  const safe = /^[=+\-@]/.test(value) && !/^\+\d/.test(value) ? `'${value}` : value;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface ClientCsvRow {
  name: string;
  phone: string;
  links: string[];
  status: ClientStatus;
  marketing: Marketing;
  marketingAt: number | null;
  lastContactAt: number;
}

const dateLabel = (ms: number | null) => (ms ? new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10) : "");

/** Таблица для рассылки (Excel, Google Таблицы): «;», UTF-8 с BOM. */
export function clientsCsv(rows: ClientCsvRow[]): string {
  const head = ["Имя", "Телефон", "Ссылки", "Статус", "Рассылка", "Согласие с", "Последнее обращение"];
  const lines = rows.map((r) =>
    [r.name, phoneLabel(r.phone), r.links.join(" "), CLIENT_STATUS_TITLES[r.status], MARKETING_TITLES[r.marketing], dateLabel(r.marketingAt), dateLabel(r.lastContactAt)]
      .map(csvCell)
      .join(";"),
  );
  return `﻿${[head.join(";"), ...lines].join("\r\n")}\r\n`;
}
