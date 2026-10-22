// Общий разбор «вставить списком» для квиза и игр с вариантами («Миллион на кону», «Гонка», «Бой с драконом»):
// строки, пометка верного «*», числа и ответы. Без зависимостей — механики берут отсюда, не тянут квиз.

/** Разные переводы строк (Windows, старый Mac) → «\n». */
export function splitLines(input: string): string[] {
  return input.replace(/\r\n?/g, "\n").split("\n");
}

/** «**Москва**» → «Москва»: жирный из мессенджеров и Markdown — не пометка верного варианта. */
export function stripBold(line: string): string {
  return line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
}

/**
 * Пометка верного варианта звёздочкой в начале или в конце: «* Париж», «*Париж», «Париж *», «Париж*».
 * Звёздочка в середине («2*2») — часть текста.
 */
export function markedText(raw: string): { text: string; correct: boolean } {
  let text = raw.trim();
  let correct = false;
  if (text.startsWith("*")) {
    correct = true;
    text = text.slice(1).trim();
  }
  if (text.endsWith("*")) {
    correct = true;
    text = text.slice(0, -1).trim();
  }
  return { text, correct };
}

/** Строка варианта: «- текст», «* текст» (верный), «-* текст» или «- текст *» (тоже верный). */
export function parseOption(line: string): { text: string; correct: boolean } | null {
  const match = /^([-–—•*])\s*(.*)$/.exec(line);
  if (!match) return null;
  const marked = markedText(match[2] ?? "");
  return { text: marked.text, correct: match[1] === "*" || marked.correct };
}

/**
 * Число из текста «~ 1 665 ступеней»: в начале обязательна цифра (можно со знаком минус).
 * «1.665» и «1,665» (1–3 цифры, разделитель, ровно 3 цифры) — тысячи, «1.5» — дробь.
 * Нет числа — `value: null`.
 */
export function parseNumberText(raw: string): { value: number | null; unit: string } {
  const match = /^([-−–]?)\s*(\d[\d\s ]*(?:[.,]\d+)*)\s*(.*)$/.exec(raw.trim());
  if (!match) return { value: null, unit: raw.trim() };
  const sign = match[1] ? -1 : 1;
  const digits = (match[2] ?? "").replace(/[\s ]/g, "");
  const unit = (match[3] ?? "").trim();
  let normalized: string;
  const separators = digits.match(/[.,]/g) ?? [];
  if (separators.length === 0) normalized = digits;
  else if (/^[1-9]\d{0,2}([.,])\d{3}(?:\1\d{3})*$/.test(digits)) normalized = digits.replace(/[.,]/g, "");
  else if (separators.length === 1) normalized = digits.replace(",", ".");
  else {
    // «1.665,5» — последний разделитель дробный, остальные — тысячи.
    const last = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
    const whole = digits.slice(0, last).replace(/[.,]/g, "");
    normalized = `${whole}.${digits.slice(last + 1)}`;
  }
  const value = Number(normalized) * sign;
  return { value: normalized !== "" && Number.isFinite(value) ? value : null, unit };
}

/**
 * «= 30 | тридцать», «= Москва / Питер»: ответы делит «|» или « / » с пробелами вокруг. Слитное «/» — часть ответа:
 * «AC/DC», «300 км/ч», «б/у», «Ж/Д вокзал», «1/2».
 */
export function splitAnswers(raw: string): string[] {
  return raw
    .split(/\||\s+\/\s+/)
    .map((a) => a.trim())
    .filter((a) => a !== "" && !/^[?？.…]+$/.test(a));
}

/**
 * Строка-вариант списка как есть: «- Париж», «* Париж», «- Париж *», а ещё «**Париж**» (жирный — просто вариант,
 * не верный; строка с «?» на конце — вопрос). Не вариант — null.
 */
export function listOption(raw: string): { text: string; correct: boolean } | null {
  const original = raw.trim();
  const line = stripBold(original).trim();
  if (original.startsWith("**") || original.startsWith("__")) return /[?？]\s*$/.test(line) || !line ? null : markedText(line);
  return parseOption(line);
}

/** Год, а не очки: «Пушкин (1799)». */
const YEAR_FROM = 1000;
const YEAR_TO = 2100;

/**
 * Очки (урон) в конце строки: «(150)», «(150 очков)», «(150 баллов)», «(150 урона)». `max` — потолок очков игры.
 * Число без слова: до 999 — очки (больше `max` — `max`); 4 цифры и больше — очки, только если это не похоже на год
 * (1000–2100) и не больше `max`. Иначе скобки остаются в тексте, а `note` объясняет ведущему, почему очки не поставлены
 * (`missing` — «очки не поставлены» / «урон не поставлен»).
 */
export function pointsSuffix(line: string, max: number, missing = "очки не поставлены"): { body: string; points: number | null; note?: string } {
  const match = /\(\s*(\d{1,5})\s*(оч\S*|балл\S*|урон\S*)?\s*\)\s*$/i.exec(line);
  if (!match) return { body: line, points: null };
  const n = Number(match[1]);
  const body = line.slice(0, match.index).trim();
  if (!match[2] && n >= 1000) {
    if (n >= YEAR_FROM && n <= YEAR_TO) return { body: line, points: null, note: `«(${n})» похоже на год — ${missing}. Нужны очки — напишите «(${n} очков)».` };
    if (n > max) return { body: line, points: null, note: `«(${n})» больше ${max} — ${missing}.` };
    return { body, points: n };
  }
  return { body, points: Math.min(max, n) };
}

/**
 * Нумерация в начале вопроса: «1.», «2)», «Вопрос 3:», «Вопрос 1 – Город?», «Вопрос №1.», «#4 Город?», «№ 5.».
 * После «Вопрос N» номер снимается, только если за ним «.», «)», «:» или тире (вместе со знаком): «Вопрос 1?» и
 * «Вопрос 1» без текста остаются как есть. После «#N» и «№N» хватает и пробела перед текстом.
 */
export const QUESTION_NUMBERING =
  /^\s*(?:вопрос\s*№?\s*\d{1,3}\s*(?:[.):]|[—–-](?=\s))|[#№]\s*\d{1,3}\s*(?:[.):]|[—–-](?=\s)|(?=\s+[^\s?？]))|\d{1,3}\s*[.):])\s*/i;

/** Строка «Вопрос 1», «Вопрос №2.», «№3» — только номер: заголовок, текст вопроса — на следующей строке. */
const QUESTION_HEADER = /^\s*(?:вопрос\s*№?|№)\s*\d{1,3}\s*[.):—–-]?\s*$/i;

export function isQuestionHeader(line: string): boolean {
  return QUESTION_HEADER.test(stripBold(line));
}

/** Вариант с буквой или цифрой: «а) Москва», «Б. Питер», «1) Казань», «2. Самара», «*1. Да» (верный). */
const LISTED = /^(\*\s*)?([a-zа-яё]|\d{1,2})\s*[).]\s+(.*)$/i;

export type ListStyle = "letter" | "digit";

/** Как пронумерованы варианты текущего вопроса: «а)» или «1.» и последний номер цифрой. */
export interface ListedRun {
  style: ListStyle | null;
  lastDigit: number;
}

export function newListedRun(): ListedRun {
  return { style: null, lastDigit: 0 };
}

/** Следующая строка показывает, что строка «N. X» перед ней — вопрос, а не вариант. */
function nextMakesQuestion(style: ListStyle, next: string | undefined, next2: string | undefined): boolean {
  if (next === undefined) return false;
  const m = LISTED.exec(next);
  if (m) {
    if (style !== "digit") return false;
    const nextDigit = /\d/.test(m[2] ?? "");
    // «1. Назовите цвет» → «а) Красный»: варианты буквами у вопроса с номером.
    if (!nextDigit) return true;
    // «1. Назовите цвет» → «1. Красный» → «2. Синий»: варианты начинаются заново с 1. А «3. Лена» → «1. Назовите
    // город» → «1. Москва»: нумерация вопросов началась заново — вопрос «1.», а строка перед ним — ещё вариант.
    if (Number(m[2]) !== 1) return false;
    const after = next2 === undefined ? null : LISTED.exec(next2);
    return after !== null && Number(after[2]) === 2;
  }
  // Под строкой — варианты «- …», «* …», ответ «=», число «~», карточка «>».
  return /^[-–—•*=~≈>]/.test(next);
}

/**
 * Строка «а) …» / «1. …» — вариант текущего вопроса, а не новый вопрос. `run` — у текущего вопроса ещё нет вариантов
 * «-»/«*», ответов «=», карточек «>», числа «~» (иначе null — и строка с номером становится вопросом). `next` — следующая
 * непустая строка: если под строкой стоят «- …», «а)», «=», «~», «>», это вопрос. Варианты цифрами идут с 1 подряд;
 * «2.» без «1.» — следующий вопрос; строка с «?» в конце — вопрос. Принятый вариант продолжает `run`.
 */
export function listedOption(line: string, run: ListedRun | null, next?: string, next2?: string): { text: string; correct: boolean } | null {
  if (!run) return null;
  const match = LISTED.exec(line);
  if (!match) return null;
  const body = match[3] ?? "";
  // Вопрос обычно заканчивается «?» — «2. Какой город?» остаётся вопросом.
  if (/[?？]\s*\*?\s*$/.test(body)) return null;
  const marker = match[2] ?? "";
  const style: ListStyle = /\d/.test(marker) ? "digit" : "letter";
  const n = style === "digit" ? Number(marker) : 0;
  if (run.style && run.style !== style) return null;
  if (style === "digit" && n !== (run.style === "digit" ? run.lastDigit + 1 : 1)) return null;
  if (nextMakesQuestion(style, next, next2)) return null;
  // «А. С. Пушкин» — инициалы, а не буква варианта: текст целиком.
  const initials = style === "letter" && /^[a-zа-яё]\./i.test(line.replace(/^\*\s*/, "")) && /^[A-ZА-ЯЁ]\.\s/.test(body);
  const marked = markedText(initials ? line.replace(/^\*\s*/, "") : body);
  run.style = style;
  if (style === "digit") run.lastDigit = n;
  return { text: marked.text, correct: Boolean(match[1]) || marked.correct };
}

/** Для каждой строки — следующая непустая строка (обрезанная), чтобы смотреть на шаг вперёд; `skip` = 1 — через одну. */
export function nextLines(lines: readonly string[], skip = 0): Array<string | undefined> {
  const out: Array<string | undefined> = new Array(lines.length);
  const seen: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    out[i] = seen[seen.length - 1 - skip];
    const t = (lines[i] ?? "").trim();
    if (t) seen.push(t);
  }
  return out;
}

/** Группа знака варианта: дефис, длинное тире (– и — — одно и то же, их ставит автозамена), точка «•», звёздочка. */
function dashGroup(mark: string): string {
  return mark === "—" || mark === "–" ? "long" : mark;
}

/** Знак варианта в начале строки («- Москва» → «-»), без жирного; нет знака — null. */
export function dashMark(raw: string): string | null {
  // «*» — пометка верного, а не знак списка: «* Назад в будущее», «- Титаник» — один вопрос (QA 22 октября, круг 6).
  const m = /^([-–—•])/.exec(stripBold(raw.trim()).trim());
  return m ? (m[1] ?? null) : null;
}

/**
 * «— Какого цвета снег?» после вариантов «- 4», «- 3» — новый вопрос, хотя у текущего ещё есть место для варианта:
 * строка кончается «?», без «*», её знак другой, чем у вариантов текущего вопроса (`optionMark`), а под ней — вариант.
 */
export function dashStartsQuestion(raw: string, optionMark: string | null, next: string | undefined): boolean {
  const mark = dashMark(raw);
  if (!mark || mark === "*" || !optionMark || dashGroup(mark) === dashGroup(optionMark)) return false;
  const option = parseOption(stripBold(raw.trim()).trim());
  if (!option || option.correct || !/[?？]\s*$/.test(option.text)) return false;
  // Под строкой — вариант с тем же знаком, что у вариантов текущего вопроса («- 4», «- 3» … «— Вопрос?» → «- Белый»).
  // Строку «N.» под ней не считаем: «2. Следующий вопрос» — не повод делать вопросом вариант с «?».
  if (next === undefined) return false;
  const nextMark = dashMark(next);
  if (nextMark !== null) return dashGroup(nextMark) === dashGroup(optionMark);
  // «* Белый» — верный вариант следующего вопроса.
  return /^\*/.test(stripBold(next).trim());
}
