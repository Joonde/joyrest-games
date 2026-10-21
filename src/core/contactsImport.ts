/**
 * «Загрузить контакты с телефона» в «Клиентах» (решение владельца 21 октября 2026). Владелец выгружает контакты iPhone
 * или Android одним файлом .vcf; файл читается в браузере — на сервер уходят только отмеченные им прежние клиенты
 * (обычный `POST /api/clients`, статус «Провели», источник «Прежний клиент»). Остальная книжка никуда не отправляется.
 *
 * Прежний клиент — контакт, в имени, организации или заметке которого есть слово мероприятия («квиз», «ДР», «корпоратив»,
 * «игры»…) или дата («17.10», «17 октября», «20-е»). Простое имя без таких слов — не клиент.
 */
import { phoneKey } from "./clients";

export interface PhoneContact {
  name: string;
  phones: string[];
  org: string;
  note: string;
}

/** Строки vCard с переносами (RFC 6350: продолжение — строка с пробелом или табом в начале). */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  // Quoted-Printable (старые Android, vCard 2.1): строка на «=» продолжается следующей, без пробела в начале.
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.endsWith("=") && /ENCODING=QUOTED-PRINTABLE/i.test(prev.slice(0, prev.indexOf(":")))) {
      out[out.length - 1] = prev.slice(0, -1) + line;
    } else out.push(line);
  }
  return out;
}

/** Значение поля: экранирование vCard и Quoted-Printable (старые Android). */
function decodeValue(params: string, raw: string): string {
  let value = raw;
  if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) {
    const joined = value.replace(/=\n/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < joined.length; i++) {
      const ch = joined[i] ?? "";
      if (ch === "=" && /^[0-9A-F]{2}$/i.test(joined.slice(i + 1, i + 3))) {
        bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(...new TextEncoder().encode(ch));
    }
    value = new TextDecoder().decode(new Uint8Array(bytes));
  }
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

/** Все контакты из файла .vcf (одна или много карточек). */
export function parseVcf(text: string): PhoneContact[] {
  const out: PhoneContact[] = [];
  let cur: PhoneContact | null = null;
  let structured = "";
  for (const line of unfold(text)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const raw = line.slice(colon + 1);
    const [nameRaw = "", ...rest] = head.split(";");
    const key = (nameRaw.split(".").pop() ?? "").toUpperCase();
    const params = rest.join(";");
    if (key === "BEGIN" && /vcard/i.test(raw)) {
      cur = { name: "", phones: [], org: "", note: "" };
      structured = "";
      continue;
    }
    if (!cur) continue;
    if (key === "END") {
      if (!cur.name) cur.name = structured;
      if (cur.name || cur.phones.length) out.push(cur);
      cur = null;
      continue;
    }
    const value = decodeValue(params, raw);
    if (key === "FN") cur.name = value.replace(/\s+/g, " ").trim();
    else if (key === "N") {
      // N: Фамилия;Имя;Отчество;Префикс;Суффикс — в карточку как «Имя Отчество Фамилия».
      const [family = "", given = "", middle = ""] = value.split(";");
      structured = [given, middle, family].filter(Boolean).join(" ").trim();
    }
    else if (key === "TEL" && value) cur.phones.push(value);
    else if (key === "ORG") cur.org = value.replace(/;/g, " ").trim();
    else if (key === "NOTE") cur.note = value;
  }
  return out;
}

const WORDS: Array<[RegExp, string]> = [
  [/квиз|quiz/i, "квиз"],
  [/мероприят/i, "мероприятие"],
  [/праздн/i, "праздник"],
  [/корпорат|(?<![а-яё])корп(?![а-яё])/i, "корпоратив"],
  [/день\s+рожд|(?<![а-яё])д\.?\s?р\.?(?![а-яё])|(?<![а-яё])др(?![а-яё])/i, "день рождения"],
  [/свадьб/i, "свадьба"],
  [/юбиле/i, "юбилей"],
  [/выпускн/i, "выпускной"],
  [/нов(ый|ого)\s+год|(?<![а-яё])нг(?![а-яё])/i, "Новый год"],
  [/(?<![а-яё])игр[аыуе]?(?![а-яё])|игров/i, "игры"],
  [/тимбилд/i, "тимбилдинг"],
  [/ведущ|тамад/i, "ведущий"],
  [/вечеринк|тусовк/i, "вечеринка"],
  [/девичник|мальчишник/i, "девичник"],
  [/(?<![а-яё])(мафи[яиюей]|бункер[а-яё]*|лото|шоу)(?![а-яё])/i, "игра"],
  [/(?<![а-яё])(клиент|заказчи[кц])[а-яё]{0,2}(?![а-яё])/i, "заказчик"],
];

const MONTHS = "январ[а-яё]*|феврал[а-яё]*|март[а-яё]*|апрел[а-яё]*|ма[йя](?![а-яё])|июн[а-яё]*|июл[а-яё]*|август[а-яё]*|сентябр[а-яё]*|октябр[а-яё]*|ноябр[а-яё]*|декабр[а-яё]*|янв|фев|мар|апр|авг|сен|окт|ноя|дек";

/** Дата в подписи: 17.10, 17/10/24, 17 октября, 20-е. Номер телефона и годы рождения не считаются. */
export function dateIn(text: string): string | null {
  // Не дата, если дальше единица измерения или деньги: «1.5 кг», «2.5 л», «3.5%».
  const numeric = /(?<![\d+])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?![\d])(?!\s*(?:кг|г|л|мл|м|см|км|т|%|р|руб|₽|т\.р|тыс|к)(?![а-яё]))/i.exec(text);
  if (numeric) {
    const d = Number(numeric[1]);
    const m = Number(numeric[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) return numeric[0];
  }
  const word = new RegExp(`(?<!\\d)(\\d{1,2})\\s*-?\\s*(?:го\\s+)?(?:${MONTHS})(?![а-яё])`, "i").exec(text);
  if (word && Number(word[1]) >= 1 && Number(word[1]) <= 31) return word[0];
  const ordinal = /(?<![\d])(\d{1,2})\s?-\s?(?:е|го|ое)(?![а-яё])/i.exec(text);
  if (ordinal && Number(ordinal[1]) >= 1 && Number(ordinal[1]) <= 31) return ordinal[0];
  return null;
}

export interface ContactMatch {
  contact: PhoneContact;
  /** Первый номер, похожий на телефон (для «Клиентов»). */
  phone: string;
  /** Что нашли: «квиз», «день рождения», «17.10». Пусто — не похоже на клиента. */
  reasons: string[];
  /** Подпись контакта целиком — имя, организация и заметка, как в телефоне. */
  label: string;
}

/** Похож ли контакт на прежнего клиента и почему. */
export function matchContact(contact: PhoneContact): ContactMatch {
  const label = [contact.name, contact.org, contact.note].filter(Boolean).join(" · ");
  const reasons: string[] = [];
  for (const [re, title] of WORDS) if (re.test(label) && !reasons.includes(title)) reasons.push(title);
  // Даты ищем без номеров телефонов, которые иногда записаны в имени.
  const date = dateIn(label.replace(/\+?\d[\d\s()-]{8,}\d/g, " "));
  if (date) reasons.push(date);
  const phone = contact.phones.find((p) => phoneKey(p)) ?? "";
  return { contact, phone, reasons, label };
}

/** Все контакты файла: сначала похожие на клиентов; одинаковые номера — один раз. */
export function scanContacts(text: string): { matches: ContactMatch[]; total: number } {
  const all = parseVcf(text).map(matchContact);
  // Один номер в нескольких карточках («Аня» и «Аня квиз 17.10») — остаётся та, где больше признаков клиента.
  const best = new Map<string, ContactMatch>();
  for (const m of all) {
    const key = phoneKey(m.phone) || m.label;
    const prev = best.get(key);
    if (!prev || m.reasons.length > prev.reasons.length) best.set(key, m);
  }
  const unique = [...best.values()];
  unique.sort((a, b) => Number(b.reasons.length > 0) - Number(a.reasons.length > 0) || a.label.localeCompare(b.label, "ru"));
  return { matches: unique, total: all.length };
}

/** Имя для карточки: подпись без слов мероприятия и дат («Аня квиз 17.10» → «Аня»), пусто — подпись целиком. */
export function cleanName(name: string): string {
  let rest = name;
  // Слово целиком, с окончанием: «день рождения», «корпоратив», «свадьба» — без хвостов вроде «ения».
  for (const [re] of WORDS) rest = rest.replace(new RegExp(`(?:${re.source})[а-яё]*`, "gi"), " ");
  const date = dateIn(rest);
  if (date) rest = rest.replace(date, " ");
  rest = rest.replace(/[()\-–—,.:;/|]+/g, " ").replace(/\s+/g, " ").trim();
  return rest.length >= 2 ? rest : name.trim();
}

/** Сообщение прежнему клиенту (согласовано владельцем 21 октября 2026): спасибо, ссылки и вопрос о согласии на новости. */
export function pastClientMessage(sender: string, links: { channel: string; calc: string; avito: string }): string {
  const who = sender.trim() ? `Это ${sender.trim()}, ведущий.` : "Это ведущий.";
  return `Добрый день! ${who} Когда-то я или мой коллега вели у вас праздник — спасибо, что тогда выбрали нас!

Хотел поделиться: мы собрали свою команду — JoyRest. Проводим квизы и игры на корпоративах, днях рождения и вечеринках, а гости теперь играют со своих телефонов.

Если снова задумаете праздник или спросят друзья — вот где нас найти:
— игры и новости: ${links.channel}
— цена праздника за минуту: ${links.calc}
— мы на Авито: ${links.avito}

Мы всегда на связи. И ещё вопрос: можно иногда присылать вам новости? Ответьте «да», если удобно. Если нет — просто не отвечайте, больше не побеспокою. Спасибо!`;
}

/** Ответ тем, кто написал «да»: скидка 10% на первое мероприятие JoyRest (решение владельца 21 октября 2026). */
export function pastClientYesMessage(calc: string): string {
  return `Спасибо! И небольшой подарок: раз вы уже были на нашем празднике — дарим скидку 10% на первое мероприятие в JoyRest. Просто напишите в заявке или в сообщении, что уже пользовались нашими услугами, — менеджер учтёт скидку.

Посчитать стоимость можно здесь: ${calc} — скидка вычитается из итога. Мы всегда на связи!`;
}
