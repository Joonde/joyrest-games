/**
 * Программа мероприятия (решение владельца 22 октября 2026): менеджер вставляет расчёт клиента — форматы (пакеты
 * калькулятора сайта), продление, допы; ведущий видит программу и подтверждает «Принял, готовлюсь». Игры ведущий
 * выбирает сам, как привык.
 * Цены здесь нет: её видят только менеджер и владелец в расчёте клиента («Клиенты»).
 * Ни имени, ни телефона клиента — программа уходит ведущему и в Telegram.
 */

export interface EventProgram {
  /** Пакеты по порядку вечера: «Квиз», «Музыкальный»… */
  formats: string[];
  /** Продление: «30 мин», «1 ч», «1,5 ч», «2 ч»; пусто — без продления. */
  extension: string;
  /** Допы калькулятора: «Логотип на экранах», «Призы и медали»… */
  addons: string[];
  /** «≈ 3–3,5 часа» — из расчёта; пусто — не указано. */
  duration: string;
}

/** Пакеты калькулятора (`site/js/pricing.js`, PACKAGES и «Под ключ») — сверяет тест. */
export const PROGRAM_FORMATS = ["Квиз", "Музыкальный", "Игровой вечер", "Шоу-вечер", "Танцевальный", "Активные настолки", "Под ключ"] as const;
/** Сколько форматов в одном вечере (решение владельца 24 октября 2026: «＋ Добавить формат», по порядку). */
export const PROGRAM_MAX_FORMATS = 6;
export const PROGRAM_EXTENSIONS = ["30 мин", "1 ч", "1,5 ч", "2 ч"] as const;
/** Допы калькулятора (`ADDONS` в pricing.js) — сверяет тест. */
export const PROGRAM_ADDONS = ["Квиз под компанию", "Логотип на экранах", "Призы и медали", "Танцевальная пауза", "Игра на открытом воздухе", "Выезд за город"] as const;
/** Прежние названия допов (программы, записанные раньше) → нынешние. */
const ADDON_RENAMES: Record<string, string> = { "Выезд за Московскую область": "Выезд за город" };

const known = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/** Программа из тела запроса: только известные форматы и допы, без повторов; пустая — null. */
export function cleanProgram(raw: unknown): EventProgram | null {
  const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown, of: readonly string[]) => [...new Set((Array.isArray(v) ? v : []).filter((x) => known(of, x)) as string[])];
  const program: EventProgram = {
    formats: list(r.formats, PROGRAM_FORMATS).slice(0, PROGRAM_MAX_FORMATS),
    extension: known(PROGRAM_EXTENSIONS, r.extension) ? r.extension : "",
    addons: list((Array.isArray(r.addons) ? r.addons : []).map((a) => (typeof a === "string" && ADDON_RENAMES[a]) || a), PROGRAM_ADDONS),
    duration: typeof r.duration === "string" ? r.duration.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40) : "",
  };
  return isEmptyProgram(program) ? null : program;
}

export function isEmptyProgram(p: EventProgram | null | undefined): boolean {
  return !p || (p.formats.length === 0 && !p.extension && p.addons.length === 0 && !p.duration);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Программа из расчёта, который клиент прислал с сайта: и сообщение «🧮 Расчёт JoyRest» (`calcMessage`), и строка
 * заявки (`calcSummary`). Цены не берём. Ничего не нашли — null.
 */
export function programFromCalc(text: string): EventProgram | null {
  let rest = text.replace(/ /g, " ");
  // Старый расчёт мог назвать выезд «Выезд за Московскую область».
  for (const [was, now] of Object.entries(ADDON_RENAMES)) rest = rest.replace(new RegExp(escape(was), "gi"), now);
  const addons = PROGRAM_ADDONS.filter((a) => new RegExp(escape(a), "i").test(rest));
  // «Квиз под компанию» — доп, а не пакет «Квиз»: убираем допы из текста, прежде чем искать пакеты.
  for (const a of addons) rest = rest.replace(new RegExp(escape(a), "gi"), " ");
  const found = PROGRAM_FORMATS.map((f) => ({ f, at: rest.search(new RegExp(`(^|[^а-яё])${escape(f)}(?![а-яё])`, "i")) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.f as string);
  const ext = /продление:?\s*(30 мин|1,5 ч|1 ч|2 ч)/i.exec(rest)?.[1] ?? "";
  const duration = /≈\s*\d+(?:,\d+)?\s*[–-]\s*\d+(?:,\d+)?\s*час[а-яё]*/i.exec(rest)?.[0].replace(/\s+/g, " ") ?? "";
  return cleanProgram({ formats: found, extension: ext, addons, duration });
}

/** Одна-две строки: «1 · Квиз → 2 · Музыкальный · продление 30 мин · ≈ 3–3,5 часа» и «Допы: …». */
export function programLines(p: EventProgram | null | undefined): string[] {
  if (!p || isEmptyProgram(p)) return [];
  const main = [p.formats.map((f, i) => (p.formats.length > 1 ? `${i + 1} · ${f}` : f)).join(" → "), p.extension ? `продление ${p.extension}` : "", p.duration].filter(Boolean).join(" · ");
  return [main, p.addons.length ? `🎁 Допы: ${p.addons.join(", ")}` : ""].filter(Boolean);
}

export function sameProgram(a: EventProgram | null | undefined, b: EventProgram | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Что подготовить по допам — подсказка ведущему. */
export function prepareHints(p: EventProgram | null | undefined): string[] {
  const out: string[] = [];
  for (const a of p?.addons ?? []) {
    if (a === "Логотип на экранах") out.push("🖼 Логотип заказчика — загрузите в «Оформление под заказчика» при запуске игры.");
    else if (a === "Призы и медали") out.push("🏅 Призы и медали победителям — взять с собой.");
    else if (a === "Квиз под компанию") out.push("📝 Квиз под компанию — вопросы под эту компанию, факты пришлёт менеджер.");
    else if (a === "Танцевальная пауза") out.push("💃 Танцевальная пауза между играми — короткий батл под клипы.");
    else if (a === "Игра на открытом воздухе") out.push("🌳 Игра на открытом воздухе — экран и звук для улицы.");
    else if (a === "Выезд за город") out.push("🚗 Выезд за город — уточните дорогу и такси у менеджера.");
  }
  return out;
}
