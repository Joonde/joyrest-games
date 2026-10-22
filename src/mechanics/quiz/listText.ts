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

/** «= 30 | тридцать», «= 30 / тридцать»: «/» между цифрами («1/2») ответы не делит. */
export function splitAnswers(raw: string): string[] {
  return raw
    .split(/\||(?<!\d)\s*\/\s*|\s*\/\s*(?!\d)/)
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

/**
 * Очки (урон) в конце строки: «(150)», «(150 очков)», «(150 баллов)», «(150 урона)». Год в скобках — «Пушкин (1799)» —
 * не очки: число без слова считаем очками только до 999. `max` — потолок очков игры.
 */
export function pointsSuffix(line: string, max: number): { body: string; points: number | null } {
  const match = /\(\s*(\d{1,5})\s*(оч\S*|балл\S*|урон\S*)?\s*\)\s*$/i.exec(line);
  if (!match) return { body: line, points: null };
  const n = Number(match[1]);
  if (!match[2] && n >= 1000) return { body: line, points: null };
  return { body: line.slice(0, match.index).trim(), points: Math.min(max, n) };
}
