/**
 * Программа мероприятия (решение владельца 22 октября 2026): менеджер указывает форматы, которые заказал клиент
 * (пакеты калькулятора сайта, продление, допы), ведущий сам выбирает из своих игр, что проведёт и в каком порядке.
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

/** Игра, которую ведущий выбрал на вечер (порядок — порядок проведения). */
export interface PlanItem {
  gameId: string;
  title: string;
  mechanic: string;
}

/** Пакеты калькулятора (`site/js/pricing.js`, PACKAGES и «Под ключ») — сверяет тест. */
export const PROGRAM_FORMATS = ["Квиз", "Музыкальный", "Игровой вечер", "Шоу-вечер", "Танцевальный", "Активные настолки", "Под ключ"] as const;
export const PROGRAM_EXTENSIONS = ["30 мин", "1 ч", "1,5 ч", "2 ч"] as const;
/** Допы калькулятора (`ADDONS` в pricing.js) — сверяет тест. */
export const PROGRAM_ADDONS = ["Квиз под компанию", "Логотип на экранах", "Призы и медали", "Танцевальная пауза", "Игра на открытом воздухе", "Выезд за Московскую область"] as const;

/** Какие разделы библиотеки (`CategoryId` из src/mechanics/categories.ts) подходят к формату — ведущему сначала их. */
export const FORMAT_CATEGORIES: Record<string, string[]> = {
  Квиз: ["quiz"],
  Музыкальный: ["music"],
  "Игровой вечер": ["cards", "social"],
  "Шоу-вечер": ["tv", "quiz"],
  Танцевальный: ["active"],
  "Активные настолки": ["adventure", "tv"],
};

export const PLAN_MAX = 8;
const GAME_ID = /^[A-Za-z0-9_-]{1,64}$/;

const known = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/** Программа из тела запроса: только известные форматы и допы, без повторов; пустая — null. */
export function cleanProgram(raw: unknown): EventProgram | null {
  const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown, of: readonly string[]) => [...new Set((Array.isArray(v) ? v : []).filter((x) => known(of, x)) as string[])];
  const program: EventProgram = {
    formats: list(r.formats, PROGRAM_FORMATS).slice(0, 4),
    extension: known(PROGRAM_EXTENSIONS, r.extension) ? r.extension : "",
    addons: list(r.addons, PROGRAM_ADDONS),
    duration: typeof r.duration === "string" ? r.duration.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40) : "",
  };
  return isEmptyProgram(program) ? null : program;
}

export function isEmptyProgram(p: EventProgram | null | undefined): boolean {
  return !p || (p.formats.length === 0 && !p.extension && p.addons.length === 0 && !p.duration);
}

/** Игры ведущего на вечер из тела запроса: до 8, без повторов. */
export function cleanPlan(raw: unknown): PlanItem[] {
  const out: PlanItem[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    if (typeof r.gameId !== "string" || !GAME_ID.test(r.gameId) || out.some((p) => p.gameId === r.gameId)) continue;
    const title = typeof r.title === "string" ? r.title.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 100) : "";
    const mechanic = typeof r.mechanic === "string" && /^[a-z]{1,30}$/.test(r.mechanic) ? r.mechanic : "";
    out.push({ gameId: r.gameId, title: title || "Игра", mechanic });
    if (out.length >= PLAN_MAX) break;
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Программа из расчёта, который клиент прислал с сайта: и сообщение «🧮 Расчёт JoyRest» (`calcMessage`), и строка
 * заявки (`calcSummary`). Цены не берём. Ничего не нашли — null.
 */
export function programFromCalc(text: string): EventProgram | null {
  let rest = text.replace(/ /g, " ");
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

/** Одна-две строки: «Квиз + Музыкальный · продление 30 мин · ≈ 3–3,5 часа» и «Допы: …». */
export function programLines(p: EventProgram | null | undefined): string[] {
  if (!p || isEmptyProgram(p)) return [];
  const main = [p.formats.join(" + "), p.extension ? `продление ${p.extension}` : "", p.duration].filter(Boolean).join(" · ");
  return [main, p.addons.length ? `Допы: ${p.addons.join(", ")}` : ""].filter(Boolean);
}

export function sameProgram(a: EventProgram | null | undefined, b: EventProgram | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Что подготовить по допам — подсказка ведущему. */
export function prepareHints(p: EventProgram | null | undefined): string[] {
  const out: string[] = [];
  for (const a of p?.addons ?? []) {
    if (a === "Логотип на экранах") out.push("Логотип заказчика — загрузите в «Оформление под заказчика» при запуске игры.");
    else if (a === "Призы и медали") out.push("Призы и медали победителям — взять с собой.");
    else if (a === "Квиз под компанию") out.push("Квиз под компанию — вопросы под эту компанию, факты пришлёт менеджер.");
    else if (a === "Танцевальная пауза") out.push("Танцевальная пауза между играми — короткий батл под клипы.");
    else if (a === "Игра на открытом воздухе") out.push("Игра на открытом воздухе — экран и звук для улицы.");
    else if (a === "Выезд за Московскую область") out.push("Выезд за Московскую область — уточните дорогу у менеджера.");
  }
  return out;
}
