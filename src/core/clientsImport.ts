/**
 * Загрузка клиентов таблицей Excel по шаблону (решение владельца 25 октября 2026; «Клиенты» → «Мои контакты»). Шаблон
 * скачивается с той же страницы; колонки узнаются по названию («Имя», «Телефон», «Telegram», «Способ связи», «Мероприятие»,
 * «Дата», «Статус», «Заметка» — и похожие: «Ссылка телеграмм», «Интерактив», «Номер»…), поэтому подходит и своя таблица.
 * Клиент без телефона — можно, если есть ник Telegram. Телефон в колонке Telegram и ник в колонке телефона понимаются.
 * Строки проверяются здесь, в браузере: в «Клиенты» уходят только отмеченные, обычным `POST /api/clients`.
 */
import {
  CLIENT_CONTACT_TITLES,
  CLIENT_LIMITS,
  CLIENT_STATUS_TITLES,
  cleanLine,
  contactProblem,
  phoneIssueText,
  phoneKey,
  phoneKeyVariants,
  phoneLabel,
  type ClientContactKind,
  type ClientStatus,
} from "./clients";
import type { SheetSpec } from "./xlsx";

export type ImportField = "name" | "phone" | "telegram" | "contact" | "event" | "date" | "status" | "note";

export interface TemplateColumn {
  field: ImportField;
  title: string;
  hint: string;
  examples: [string, string, string];
  width: number;
}

/** Колонки шаблона — по порядку. Примеры — на листе «Как заполнять» и на странице (в лист «Клиенты» не попадают). */
export const TEMPLATE_COLUMNS: TemplateColumn[] = [
  { field: "name", title: "Имя", hint: "Как подписать клиента", examples: ["Анна", "Игорь Петров", "Мария"], width: 18 },
  { field: "phone", title: "Телефон", hint: "Любой вид: +7 915 241-59-99 или 89152415999. Можно пусто, если есть Telegram", examples: ["+7 915 241-59-99", "", "89261450593"], width: 18 },
  { field: "telegram", title: "Telegram", hint: "Ник: @anna_party или t.me/anna_party. Можно пусто, если есть телефон", examples: ["", "@igor_party", "@maria_quiz"], width: 20 },
  { field: "contact", title: "Способ связи", hint: "Telegram, WhatsApp или Звонок. Пусто — с ником будет Telegram", examples: ["WhatsApp", "Telegram", "Telegram"], width: 16 },
  { field: "event", title: "Мероприятие", hint: "Что проводили: квиз, мафия, день рождения…", examples: ["Квиз", "Мафия", "Музыкальное лото"], width: 20 },
  { field: "date", title: "Дата", hint: "Когда было: 17.10.2026", examples: ["17.10.2026", "05.09.2026", ""], width: 12 },
  { field: "status", title: "Статус", hint: "Провели (если пусто), Клиент, В работе, Новый, Отказ", examples: ["", "", "Клиент"], width: 12 },
  { field: "note", title: "Заметка", hint: "Любые пометки — попадут в историю клиента", examples: ["Корпоратив, 30 гостей", "", "Хочет НГ в декабре"], width: 28 },
];

/** Пометка «нет данных» в ячейке телефона или ника. */
const PLACEHOLDER = /^(?:[-–—_.?!\s]+|нет|не знаю|неизвестно|n\/?a|none|null)$/i;

export const CONTACT_CHOICES = ["Telegram", "WhatsApp", "Звонок"];
/** Сколько строк клиентов за одну загрузку. */
export const IMPORT_MAX_ROWS = 2000;

/** Шаблон: лист «Клиенты» (только шапка, выпадающий список «Способ связи»), лист «Как заполнять» (подсказки и примеры). */
export function templateSheets(): SheetSpec[] {
  const titles = TEMPLATE_COLUMNS.map((c) => c.title);
  const contactCol = TEMPLATE_COLUMNS.findIndex((c) => c.field === "contact");
  const statusCol = TEMPLATE_COLUMNS.findIndex((c) => c.field === "status");
  const text = TEMPLATE_COLUMNS.map((_, i) => i);
  return [
    {
      name: "Клиенты",
      rows: [titles],
      widths: TEMPLATE_COLUMNS.map((c) => c.width),
      textColumns: text,
      header: true,
      lists: [
        { column: contactCol, values: CONTACT_CHOICES, toRow: IMPORT_MAX_ROWS + 1 },
        { column: statusCol, values: ["Провели", "Клиент", "В работе", "Новый", "Отказ"], toRow: IMPORT_MAX_ROWS + 1 },
      ],
    },
    {
      name: "Как заполнять",
      rows: [
        ["Колонка", "Что писать", "Пример 1", "Пример 2", "Пример 3"],
        ...TEMPLATE_COLUMNS.map((c) => [c.title, c.hint, ...c.examples]),
        [],
        ["Правила", "Один клиент — одна строка на листе «Клиенты». Нужен телефон или ник Telegram (или оба)."],
        ["", "Шапку (первую строку) не меняйте. Пустые строки и строки-заголовки («Клиенты 2025») пропускаются."],
        ["", "Кто уже есть в «Клиентах» (тот же телефон или ник), второй раз не добавится."],
        ["", "Сохраните файл как .xlsx (Excel) или .csv и загрузите в «Клиенты» → «Мои контакты» → «Таблица Excel»."],
      ],
      widths: [16, 70, 18, 18, 18],
      header: true,
    },
  ];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

/** Название колонки → поле. Порядок важен: «Способ связи» раньше «Telegram», «Ссылка телеграм» — Telegram. */
/** Не наши колонки, хоть и похожи: «Номер п/п», «Номер заказа», «Ссылка на Instagram», «ВКонтакте» — не телефон и не Telegram. */
const NOT_OURS = /(^номер (п п|по порядку|строки|заказа|договора|счета|брони)|^n п п$|instagram|инстаграм|инста|^vk|вконтакт|^вк( |$)|facebook|фейсбук|почта|email|e mail)/;

const HEADERS: Array<[RegExp, ImportField]> = [
  [/^(способ связи|связь|как связаться|канал связи|канал|мессенджер)$/, "contact"],
  [/(телефон|^номер|номер телефона|^тел$|phone|мобильн|whatsapp|ватсап|^контакты?$)/, "phone"],
  [/(telegram|телеграм|^тг$|^tg$|^ник|ссылка|username)/, "telegram"],
  [/^(имя|фио|имя клиента|клиент|name|кто)$/, "name"],
  [/(мероприят|интерактив|повод|^игра|формат|что проводили|событие|услуга)/, "event"],
  [/^(дата|когда|date|дата мероприятия|дата проведения)$/, "date"],
  [/^(статус|status|этап)$/, "status"],
  [/(заметк|коммент|примеч|note|пометк)/, "note"],
];

export function fieldOfHeader(title: string): ImportField | null {
  const t = norm(title);
  if (!t || NOT_OURS.test(t)) return null;
  for (const [re, field] of HEADERS) if (re.test(t)) return field;
  return null;
}

export interface HeaderMap {
  /** Номер строки шапки (с единицы, как в Excel). */
  line: number;
  columns: Partial<Record<ImportField, number>>;
}

/** Шапка — первая из первых 15 строк, где узнали хотя бы две колонки и среди них телефон или Telegram. */
export function findHeader(rows: string[][]): HeaderMap | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const columns: Partial<Record<ImportField, number>> = {};
    // Просто «Номер» — слабая подсказка: если дальше есть явный «Телефон», телефон — он.
    let weakPhone = false;
    (rows[r] ?? []).forEach((cell, c) => {
      const f = fieldOfHeader(cell);
      const weak = f === "phone" && /^номер$/.test(norm(cell));
      if (f && (columns[f] === undefined || (f === "phone" && weakPhone && !weak))) {
        columns[f] = c;
        if (f === "phone") weakPhone = weak;
      }
    });
    if (Object.keys(columns).length >= 2 && (columns.phone !== undefined || columns.telegram !== undefined)) return { line: r + 1, columns };
  }
  return null;
}

/** Ник Telegram из «@anna», «anna_party», «t.me/anna», «https://t.me/anna»; не ник — пусто. Возвращает «@ник». */
export function nickOf(value: string): string {
  const v = value
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  // Ник Telegram — от 5 до 32 знаков; служебные адреса t.me (joinchat, addstickers…) — не ник.
  if (/^(joinchat|addstickers|addemoji|share|proxy|socks|setlanguage|iv|c|s)$/i.test(v)) return "";
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v) ? `@${v}` : "";
}

/** Похоже на номер: только цифры, пробелы, «+», скобки, тире (и «wa.me/…»), цифр не меньше 7. */
function phoneLike(value: string): string {
  const v = value.trim().replace(/^(?:https?:\/\/)?(?:www\.)?wa\.me\//i, "");
  if (!/^[+\d\s()\-.‐-― ]+$/.test(v)) return "";
  return v.replace(/\D/g, "").length >= 7 ? v.replace(/[‐-―]/g, "-").replace(/ /g, " ").trim() : "";
}

function contactOf(value: string): ClientContactKind | "" | null {
  const t = norm(value);
  if (!t) return "";
  if (/(telegram|телеграм|^тг$|^tg$)/.test(t)) return "telegram";
  if (/(whats ?app|ватс ?ап|вотс ?ап|вацап|ватсап|^wa$|^вацап)/.test(t)) return "whatsapp";
  if (/(звон|call|телефон|сотов)/.test(t)) return "call";
  return null;
}

const STATUS_WORDS: Array<[RegExp, ClientStatus]> = [
  [/^(провели|проведено|проведен|прошло|был|были|прежний)/, "held"],
  [/^(клиент|договорились|бронь)/, "client"],
  [/^(в работе|работа|ведем|переговоры)/, "work"],
  [/^(новый|новая|новые)/, "new"],
  [/^(отказ|отказался|отказалась|не актуально)/, "lost"],
];

function statusOf(value: string): ClientStatus | null {
  const t = norm(value);
  if (!t) return "held";
  for (const [re, s] of STATUS_WORDS) if (re.test(t)) return s;
  return null;
}

export interface ImportRow {
  /** Номер строки в Excel. */
  line: number;
  name: string;
  phone: string;
  /** «@ник» или пусто. */
  nick: string;
  contact: ClientContactKind | "";
  status: ClientStatus;
  /** Первая запись истории клиента: «Из таблицы Excel: Квиз, 06.04.2026». */
  request: string;
  /** Подпись для списка: «Квиз · 06.04.2026». */
  about: string;
  /** Почему не добавить (строка показывается, но галочку не поставить). */
  errors: string[];
  /** Что поправили сами (добавить можно). */
  warnings: string[];
  /** Уже есть в «Клиентах» (тот же телефон или ник). */
  known: boolean;
  /** Ключ повторов: телефон или ник. */
  key: string;
}

export interface ImportResult {
  header: HeaderMap;
  rows: ImportRow[];
  /** Пустые строки и строки-заголовки («Клиенты 2025 года»). */
  skipped: number;
  /** Колонок, которые нашли: «Имя», «Телефон»… */
  found: string[];
  /** Строк больше `IMPORT_MAX_ROWS` — лишние не читали. */
  cut: boolean;
}

export type ImportProblem = "empty" | "no-header";

/** Что уже есть в «Клиентах»: ключи телефонов и ники (без регистра). */
export function knownContacts(clients: Array<{ phone: string; links: string[] }>): { phones: Set<string>; nicks: Set<string> } {
  const phones = new Set<string>();
  const nicks = new Set<string>();
  for (const c of clients) {
    for (const k of phoneKeyVariants(phoneKey(c.phone))) phones.add(k);
    for (const l of c.links) {
      const m = /^https:\/\/t\.me\/([A-Za-z0-9_]+)$/i.exec(l);
      if (m?.[1]) nicks.add(`@${m[1].toLowerCase()}`);
    }
  }
  return { phones, nicks };
}

/** Разобрать таблицу: шапка, строки клиентов, ошибки. Таблица без шапки или пустая — `ImportProblem`. */
export function parseClientRows(
  rows: string[][],
  known: { phones: Set<string>; nicks: Set<string> } = { phones: new Set(), nicks: new Set() },
): ImportResult | ImportProblem {
  if (!rows.some((r) => r.some((c) => c.trim() !== ""))) return "empty";
  const header = findHeader(rows);
  if (!header) return "no-header";
  const cols = header.columns;
  const get = (row: string[], f: ImportField) => (cols[f] === undefined ? "" : (row[cols[f] ?? -1] ?? "").replace(/\s+/g, " ").trim());
  const out: ImportRow[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  let cut = false;
  for (let r = header.line; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const filled = row.filter((c) => c.trim() !== "").length;
    if (filled === 0) continue;
    if (out.length >= IMPORT_MAX_ROWS) {
      cut = true;
      break;
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    const phoneCell = get(row, "phone");
    const tgCell = get(row, "telegram");
    // Телефон и ник — из своих колонок, но в «Ссылке телеграм» часто номер, а в «Телефоне» — ник.
    let phone = "";
    let nick = "";
    // Что не поняли: есть другой способ связи — только предупреждение (строку добавить можно), нет — ошибка.
    const unclear: string[] = [];
    for (const v of [phoneCell, tgCell]) {
      // «-», «—», «нет», «?» — пусто: так часто помечают, что номера или ника нет.
      if (!v || PLACEHOLDER.test(v)) continue;
      const asPhone = phoneLike(v);
      const asNick = nickOf(v);
      if (asPhone && !phone) phone = asPhone;
      else if (asNick && !nick) nick = asNick;
      else if (!asPhone && !asNick) unclear.push(v === phoneCell ? `Не поняли телефон «${v}».` : `Не поняли ник Telegram «${v}» — нужен @ник или t.me/ник.`);
    }
    const name = cleanLine(get(row, "name"), CLIENT_LIMITS.name);
    const event = get(row, "event");
    const date = get(row, "date");
    const note = get(row, "note");
    // Строка-заголовок («Клиенты 2025 года»): одна ячейка, связаться не с кем.
    if (!phone && !nick && errors.length === 0 && filled <= 1 && !name) {
      skipped++;
      continue;
    }
    let key = "";
    if (phone) {
      const k = phoneKey(phone);
      if (!k) {
        unclear.push(`Телефон «${phone}»: ${phoneIssueText(phone) || "не похож на номер."}`);
        phone = "";
      } else {
        key = k;
        // Российский — «+7 915 241-59-99», другой страны — «+972536921872» (как набрали — «972 53 …» — не храним).
        phone = k.length === 11 && k.startsWith("7") ? phoneLabel(phone) : `+${k}`;
      }
    }
    if (phone || nick) warnings.push(...unclear.map((u) => `${u} Добавим по ${phone ? "телефону" : "нику"}.`));
    else errors.push(...unclear);
    if (!phone && !nick && errors.length === 0) errors.push("Нет телефона и ника Telegram — связаться не с кем.");
    if (!key && nick) key = nick.toLowerCase();
    let contact = contactOf(get(row, "contact"));
    if (contact === null) {
      warnings.push(`Способ связи «${get(row, "contact")}» не поняли — оставили пустым (Telegram, WhatsApp или Звонок).`);
      contact = "";
    }
    if (contact === "" && nick) contact = "telegram";
    const links = nick ? [`https://t.me/${nick.slice(1)}`] : [];
    const problem = contact ? contactProblem(contact, { phone: phoneKey(phone) ? phone : "", links }) : "";
    if (problem) {
      warnings.push(`${problem} ${nick ? "Поставили Telegram." : "Способ связи оставили пустым."}`);
      contact = nick ? "telegram" : "";
    }
    let status = statusOf(get(row, "status"));
    if (status === null) {
      warnings.push(`Статус «${get(row, "status")}» не поняли — будет «${CLIENT_STATUS_TITLES.held}».`);
      status = "held";
    }
    if (key && seen.has(key)) errors.push(`Повтор: тот же ${phoneKey(phone) ? "телефон" : "ник"}, что в строке ${seen.get(key)}.`);
    else if (key) seen.set(key, r + 1);
    const isKnown =
      errors.length === 0 &&
      ((phoneKey(phone) !== "" && phoneKeyVariants(phoneKey(phone)).some((k) => known.phones.has(k))) || (nick !== "" && known.nicks.has(nick.toLowerCase())));
    const what = [event, date].filter(Boolean).join(", ");
    const request = [`Из таблицы Excel${what ? `: ${what}` : ""}`, note ? `Заметка: ${note}` : ""].filter(Boolean).join("\n").slice(0, 300);
    out.push({
      line: r + 1,
      name,
      phone: phoneKey(phone) ? phone : "",
      nick,
      contact,
      status,
      request,
      about: [event, date, contact ? `связь: ${CLIENT_CONTACT_TITLES[contact]}` : ""].filter(Boolean).join(" · "),
      errors,
      warnings,
      known: isKnown,
      key,
    });
  }
  const titles: Record<ImportField, string> = {
    name: "Имя",
    phone: "Телефон",
    telegram: "Telegram",
    contact: "Способ связи",
    event: "Мероприятие",
    date: "Дата",
    status: "Статус",
    note: "Заметка",
  };
  const found = (Object.keys(cols) as ImportField[]).sort((a, b) => (cols[a] ?? 0) - (cols[b] ?? 0)).map((f) => titles[f]);
  return { header, rows: out, skipped, found, cut };
}

/** Можно добавить: без ошибок и ещё нет в «Клиентах». */
export function canImport(row: ImportRow): boolean {
  return row.errors.length === 0 && !row.known;
}
