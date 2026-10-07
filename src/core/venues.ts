/**
 * База площадок (CLAUDE.md, раздел 3, «База площадок»): поля анкеты заведения и запроса клиента,
 * списки вариантов, проверка, критерии подбора и процент совпадения, статусы с цветами, дубли и
 * пункт предложения клиенту. Один модуль для браузера и сервера: сервер проверяет и считает так же,
 * как показывает экран. Без исключений: любые данные из базы или формы проходят через parse*.
 */

// ------------------------------------------------------------------ варианты

export const VENUE_TYPES = ["Ресторан", "Банкетный зал", "Кафе", "Бар", "Лофт", "Кальянная", "Загородная площадка", "Другое"] as const;
export const FURNITURE = ["Можно двигать всё", "Частично", "Закреплена"] as const;
export const LAYOUTS = [
  "Круглые столы",
  "П-образно",
  "Общий стол",
  "Фуршет",
  "Театр, рядами",
  "Т-образно",
  "Ш-образно, гребёнка",
  "Ёлочка",
  "Стол молодожёнов + гости",
  "Каре (квадрат)",
  "Отдельные столы на 4–6",
  "Класс",
  "Коктейль, высокие столы",
  "Лаунж-зоны с диванами",
  "Кабаре",
] as const;
export const FEATURES = [
  "Панорамные окна",
  "Вид на город или воду",
  "Камин",
  "Высокие потолки",
  "Дневной свет",
  "Готовая фотозона",
  "Свой двор или сад",
  "Место для выездной регистрации",
  "Отдельный вход",
  "Комната для невесты или артистов",
  "Гардероб",
  "Кондиционер",
  "Детская комната",
  "Пандус или лифт",
  "Зона для курения",
  "Кальян",
  "Номера для ночлега",
] as const;
export const LOCATIONS = ["Отдельное здание", "В жилом доме", "В торговом центре", "В парке", "У воды", "За городом"] as const;
export const LOUDNESS = ["Можно громко до конца", "Тише после 23:00", "Только спокойный формат"] as const;
export const PARKING = ["Своя бесплатная", "Своя платная", "Городская рядом", "Нет парковки"] as const;
export const CUISINES = [
  "Европейская",
  "Русская",
  "Грузинская / кавказская",
  "Итальянская",
  "Паназиатская",
  "Японская",
  "Узбекская / восточная",
  "Средиземноморская",
  "Мясо и гриль",
  "Авторская",
] as const;
export const MAX_CUISINES = 3;
export const DIETS = ["Детское меню", "Вегетарианские блюда", "Постное меню", "Халяль", "Блюда без глютена"] as const;
export const MENU_KINDS = ["Банкетное меню", "Основное меню", "Фуршетное меню", "Барная карта"] as const;
export const EQUIPMENT = [
  "Колонки / акустика",
  "Сабвуфер",
  "Радиомикрофоны",
  "Проводные микрофоны",
  "Микшерный пульт",
  "Диджейский пульт",
  "Проектор",
  "Экран для проектора",
  "Телевизор / LED-экран",
  "Сценический свет",
  "Сцена или подиум",
  "Дым-машина",
] as const;
export const CONNECTIONS = ["HDMI", "Jack 3,5 / RCA", "Bluetooth", "Нет, только своя техника"] as const;
export const OWN_ITEMS = ["Торт", "Фрукты", "Свой кейтеринг", "Свой декор и цветы"] as const;
export const ALCOHOL = ["Нельзя", "Можно", "Пробковый сбор"] as const;
export const PARALLEL = ["Только одно мероприятие", "Несколько, но в разных залах", "Мероприятие при открытом зале"] as const;
export const FX = ["Конфетти", "Холодные фонтаны", "Живой огонь и свечи", "Мыльные пузыри", "Дым и тяжёлый дым", "Шары с гелием", "Живые животные"] as const;
export const CONTRACTORS = ["Без ограничений", "За сбор", "Только ваши"] as const;
export const SETUP = ["за 1 час", "за 2 часа", "за 3–4 часа", "с утра в день мероприятия"] as const;
export const CLOSE = ["Да", "От определённого числа гостей", "Нет"] as const;
export const UNTIL = ["22:00", "23:00", "00:00", "02:00", "до утра"] as const;
export const PAY = ["Договор и безнал", "Карта", "Наличные"] as const;
export const AGENCY = ["Да, платим комиссию", "Да, без комиссии", "Нет"] as const;
export const TERRACE_SEASONS = ["Только летом", "Круглый год (с обогревом)"] as const;
export const DISTRICTS = ["ЦАО", "САО", "СВАО", "ВАО", "ЮВАО", "ЮАО", "ЮЗАО", "ЗАО", "СЗАО", "За МКАД"] as const;
export const EVENT_TYPES = ["Свадьба", "Корпоратив", "День рождения", "Юбилей", "Выпускной", "Детский праздник", "Другое"] as const;
export const FORMATS = [
  { id: "banquet", label: "Банкет" },
  { id: "buffet", label: "Фуршет" },
  { id: "unknown", label: "Пока не знаю" },
] as const;
export type EventFormat = (typeof FORMATS)[number]["id"];

/** Лимиты файлов анкеты (CLAUDE.md, «База площадок»). */
export const VENUE_FILES = { photo: 5, menu: 5 } as const;
export type VenueFileKind = keyof typeof VENUE_FILES;
/** PDF меню отправляется как есть; Caddy пропускает до 2 МБ на запрос. */
export const MENU_PDF_MAX_BYTES = 1900 * 1024;
/** Картинка (фото зала или страница меню), сжатая на устройстве. */
export const VENUE_IMAGE_MAX_BYTES = 600 * 1024;

// ------------------------------------------------------------------ статусы

export type StatusTone = "rose" | "gold" | "green" | "gray";

export const VENUE_STATUSES = [
  { id: "new", label: "Новая", tone: "rose" },
  { id: "checked", label: "Проверено", tone: "gold" },
  { id: "worked", label: "Работали", tone: "green" },
  { id: "rejected", label: "Не подходит", tone: "gray" },
] as const satisfies ReadonlyArray<{ id: string; label: string; tone: StatusTone }>;
export type VenueStatus = (typeof VENUE_STATUSES)[number]["id"];

export const REQUEST_STATUSES = [
  { id: "new", label: "Новая", tone: "rose" },
  { id: "sent", label: "Предложение отправлено", tone: "gold" },
  { id: "agreed", label: "Договорились", tone: "green" },
  { id: "declined", label: "Отказ", tone: "gray" },
] as const satisfies ReadonlyArray<{ id: string; label: string; tone: StatusTone }>;
export type RequestStatus = (typeof REQUEST_STATUSES)[number]["id"];

export function isVenueStatus(value: unknown): value is VenueStatus {
  return VENUE_STATUSES.some((s) => s.id === value);
}

export function isRequestStatus(value: unknown): value is RequestStatus {
  return REQUEST_STATUSES.some((s) => s.id === value);
}

export function venueStatusInfo(id: VenueStatus) {
  return VENUE_STATUSES.find((s) => s.id === id) ?? VENUE_STATUSES[0];
}

export function requestStatusInfo(id: RequestStatus) {
  return REQUEST_STATUSES.find((s) => s.id === id) ?? REQUEST_STATUSES[0];
}

/** Порядок статусов для сортировки «по статусу»: сначала то, что требует внимания. */
export function statusOrder(list: ReadonlyArray<{ id: string }>, id: string): number {
  const index = list.findIndex((s) => s.id === id);
  return index < 0 ? list.length : index;
}

// ------------------------------------------------------------------ анкета площадки

export interface VenueData {
  name: string;
  type: string;
  address: string;
  district: string;
  metro: string;
  site: string;
  about: string;
  person: string;
  role: string;
  phone: string;
  messenger: string;
  email: string;
  seated: number | null;
  standing: number | null;
  halls: number | null;
  minGuests: number | null;
  terrace: boolean;
  terraceSeats: number | null;
  terraceSeason: string;
  vip: boolean;
  vipSeats: number | null;
  dance: boolean;
  furniture: string;
  layouts: string[];
  features: string[];
  location: string;
  loudness: string;
  parking: string;
  parkingSpots: number | null;
  unload: boolean;
  cuisine: string[];
  diet: string[];
  perGuest: number | null;
  menuLink: string;
  menuKinds: string[];
  /** Оборудование: название → сколько штук. */
  equipment: Record<string, number>;
  connections: string[];
  ownTech: boolean;
  technician: boolean;
  ownItems: string[];
  alcohol: string;
  corkage: number | null;
  deposit: number | null;
  service: number | null;
  parallel: string;
  fx: string[];
  contractors: string;
  setup: string;
  close: string;
  until: string;
  pay: string[];
  agency: string;
  commission: number | null;
  album: string;
}

/** Длина текстовых полей. Длиннее — обрезается. */
export const TEXT_LIMITS = {
  name: 80,
  address: 160,
  metro: 60,
  site: 200,
  about: 500,
  person: 80,
  role: 60,
  phone: 40,
  messenger: 80,
  email: 120,
  menuLink: 300,
  album: 300,
  comment: 1000,
  notes: 2000,
} as const;

export function emptyVenue(): VenueData {
  return {
    name: "",
    type: "",
    address: "",
    district: "",
    metro: "",
    site: "",
    about: "",
    person: "",
    role: "",
    phone: "",
    messenger: "",
    email: "",
    seated: null,
    standing: null,
    halls: null,
    minGuests: null,
    terrace: false,
    terraceSeats: null,
    terraceSeason: "",
    vip: false,
    vipSeats: null,
    dance: false,
    furniture: "",
    layouts: [],
    features: [],
    location: "",
    loudness: "",
    parking: "",
    parkingSpots: null,
    unload: false,
    cuisine: [],
    diet: [],
    perGuest: null,
    menuLink: "",
    menuKinds: [],
    equipment: {},
    connections: [],
    ownTech: true,
    technician: false,
    ownItems: [],
    alcohol: "",
    corkage: null,
    deposit: null,
    service: null,
    parallel: "",
    fx: [],
    contractors: "",
    setup: "",
    close: "",
    until: "",
    pay: [],
    agency: "",
    commission: null,
    album: "",
  };
}

// Управляющие символы и невидимые символы направления текста (ими можно подменить вид строки).
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

/** Строка без управляющих символов; однострочная — без переводов строк. */
export function cleanText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/\r\n?/g, "\n").replace(CONTROL, "");
  text = multiline ? text.replace(/\n{3,}/g, "\n\n") : text.replace(/\n+/g, " ");
  return text.trim().slice(0, max).trim();
}

/** Целое число в пределах; пусто, мусор или вне пределов — null. */
export function cleanNumber(value: unknown, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.replace(/\s/g, "").replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), max);
}

function pick<T extends string>(value: unknown, options: readonly T[]): T | "" {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : "";
}

function pickMany(value: unknown, options: readonly string[], limit = options.length): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && options.includes(item) && !out.includes(item)) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Данные площадки из формы или базы → проверенный формат. Без исключений. */
export function parseVenue(raw: unknown): VenueData {
  const d = record(raw);
  const t = (key: keyof typeof TEXT_LIMITS, multiline = false) => cleanText(d[key], TEXT_LIMITS[key], multiline);
  const equipment: Record<string, number> = {};
  const rawEquipment = record(d.equipment);
  for (const name of EQUIPMENT) {
    const count = cleanNumber(rawEquipment[name], 99);
    if (count && count > 0) equipment[name] = count;
  }
  const terrace = d.terrace === true;
  const vip = d.vip === true;
  return {
    name: t("name"),
    type: pick(d.type, VENUE_TYPES),
    address: t("address"),
    district: pick(d.district, DISTRICTS),
    metro: t("metro"),
    site: t("site"),
    about: t("about", true),
    person: t("person"),
    role: t("role"),
    phone: t("phone"),
    messenger: t("messenger"),
    email: t("email"),
    seated: cleanNumber(d.seated, 5000),
    standing: cleanNumber(d.standing, 5000),
    halls: cleanNumber(d.halls, 50),
    minGuests: cleanNumber(d.minGuests, 5000),
    terrace,
    terraceSeats: terrace ? cleanNumber(d.terraceSeats, 5000) : null,
    terraceSeason: terrace ? pick(d.terraceSeason, TERRACE_SEASONS) : "",
    vip,
    vipSeats: vip ? cleanNumber(d.vipSeats, 1000) : null,
    dance: d.dance === true,
    furniture: pick(d.furniture, FURNITURE),
    layouts: pickMany(d.layouts, LAYOUTS),
    features: pickMany(d.features, FEATURES),
    location: pick(d.location, LOCATIONS),
    loudness: pick(d.loudness, LOUDNESS),
    parking: pick(d.parking, PARKING),
    parkingSpots: cleanNumber(d.parkingSpots, 10000),
    unload: d.unload === true,
    cuisine: pickMany(d.cuisine, CUISINES, MAX_CUISINES),
    diet: pickMany(d.diet, DIETS),
    perGuest: cleanNumber(d.perGuest, 1_000_000),
    menuLink: t("menuLink"),
    menuKinds: pickMany(d.menuKinds, MENU_KINDS),
    equipment,
    connections: pickMany(d.connections, CONNECTIONS),
    ownTech: d.ownTech !== false,
    technician: d.technician === true,
    ownItems: pickMany(d.ownItems, OWN_ITEMS),
    alcohol: pick(d.alcohol, ALCOHOL),
    corkage: d.alcohol === "Пробковый сбор" ? cleanNumber(d.corkage, 100_000) : null,
    deposit: cleanNumber(d.deposit, 100_000_000),
    service: cleanNumber(d.service, 50),
    parallel: pick(d.parallel, PARALLEL),
    fx: pickMany(d.fx, FX),
    contractors: pick(d.contractors, CONTRACTORS),
    setup: pick(d.setup, SETUP),
    close: pick(d.close, CLOSE),
    until: pick(d.until, UNTIL),
    pay: pickMany(d.pay, PAY),
    agency: pick(d.agency, AGENCY),
    commission: d.agency === "Да, платим комиссию" ? cleanNumber(d.commission, 50) : null,
    album: t("album"),
  };
}

/**
 * Чего не хватает в анкете площадки (подписи для посетителя). `menuFiles` — сколько файлов меню
 * прикреплено: меню обязательно файлом или ссылкой. Анкету, которую владелец заводит сам,
 * проверяем мягче (`manual`): нужно только название.
 */
export function venueMissing(v: VenueData, menuFiles: number, manual = false): string[] {
  if (manual) return v.name ? [] : ["название"];
  const missing: string[] = [];
  if (!v.name) missing.push("название");
  if (!v.type) missing.push("тип");
  if (!v.address) missing.push("адрес");
  if (!v.person) missing.push("имя");
  if (!v.phone || phoneDigits(v.phone).length < 10) missing.push("телефон");
  if (v.seated === null) missing.push("гостей сидя");
  if (v.standing === null) missing.push("гостей стоя");
  if (menuFiles <= 0 && !v.menuLink) missing.push("меню (файл или ссылка)");
  return missing;
}

// ------------------------------------------------------------------ запрос клиента

export interface RequestData {
  name: string;
  phone: string;
  eventType: string;
  /** ГГГГ-ММ-ДД или пусто. */
  date: string;
  /** ЧЧ:ММ или пусто. */
  from: string;
  to: string;
  guests: number | null;
  format: EventFormat | "";
  budget: number | null;
  district: string;
  /** Пожелания: id критерия → 1 «хотелось бы», 2 «обязательно». */
  wishes: Record<string, 1 | 2>;
  comment: string;
}

export function emptyRequest(): RequestData {
  return { name: "", phone: "", eventType: "", date: "", from: "", to: "", guests: null, format: "", budget: null, district: "", wishes: {}, comment: "" };
}

function cleanDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : "";
}

function cleanTime(value: unknown): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
}

export function parseRequest(raw: unknown): RequestData {
  const d = record(raw);
  const wishes: Record<string, 1 | 2> = {};
  const rawWishes = record(d.wishes);
  for (const criterion of CRITERIA) {
    const level = rawWishes[criterion.id];
    if (level === 1 || level === 2) wishes[criterion.id] = level;
  }
  const format = FORMATS.find((f) => f.id === d.format)?.id ?? "";
  return {
    name: cleanText(d.name, TEXT_LIMITS.person),
    phone: cleanText(d.phone, TEXT_LIMITS.phone),
    eventType: pick(d.eventType, EVENT_TYPES),
    date: cleanDate(d.date),
    from: cleanTime(d.from),
    to: cleanTime(d.to),
    guests: cleanNumber(d.guests, 5000),
    format,
    budget: cleanNumber(d.budget, 1_000_000),
    district: pick(d.district, DISTRICTS),
    wishes,
    comment: cleanText(d.comment, TEXT_LIMITS.comment, true),
  };
}

export function requestMissing(r: RequestData): string[] {
  const missing: string[] = [];
  if (!r.name) missing.push("имя");
  if (!r.phone || phoneDigits(r.phone).length < 10) missing.push("телефон");
  if (!r.eventType) missing.push("что празднуем");
  if (!r.guests) missing.push("гостей");
  return missing;
}

// ------------------------------------------------------------------ критерии подбора

/** true — есть; false — нет; 0.5 — частично или за доплату; null — площадка не указала. */
export type Fit = true | false | 0.5 | null;

export interface Criterion {
  id: string;
  group: string;
  label: string;
  /** Как пункт называется в предложении клиенту. */
  clientLabel?: string;
  test: (v: VenueData) => Fit;
}

const has = (list: string[], item: string): Fit => (list.length === 0 ? null : list.includes(item));
const feature = (item: string) => (v: VenueData) => has(v.features, item);
const layout = (item: string) => (v: VenueData) => has(v.layouts, item);
const cuisine = (item: string) => (v: VenueData) => has(v.cuisine, item);
const diet = (item: string) => (v: VenueData) => has(v.diet, item);
const equipmentKnown = (v: VenueData) => Object.keys(v.equipment).length > 0 || v.connections.length > 0;
const equipment = (...names: string[]) => (v: VenueData): Fit => (names.some((n) => (v.equipment[n] ?? 0) > 0) ? true : equipmentKnown(v) ? false : null);

export const CRITERIA_GROUPS = ["Атмосфера", "Пространство", "Рассадка", "Кухня и меню", "Техника", "Условия"] as const;

export const CRITERIA: Criterion[] = [
  { id: "panorama", group: "Атмосфера", label: "Панорамные окна", test: feature("Панорамные окна") },
  { id: "view", group: "Атмосфера", label: "Вид на город или воду", test: feature("Вид на город или воду") },
  { id: "ceremony", group: "Атмосфера", label: "Выездная регистрация", test: feature("Место для выездной регистрации") },
  { id: "yard", group: "Атмосфера", label: "Свой двор или сад", test: feature("Свой двор или сад") },
  { id: "fireplace", group: "Атмосфера", label: "Камин", test: feature("Камин") },
  { id: "photozone", group: "Атмосфера", label: "Фотозона", test: feature("Готовая фотозона") },
  { id: "brideRoom", group: "Атмосфера", label: "Комната для невесты", test: feature("Комната для невесты или артистов") },
  { id: "overnight", group: "Атмосфера", label: "Номера для ночлега", test: feature("Номера для ночлега") },
  { id: "countryside", group: "Атмосфера", label: "За городом", test: (v) => (v.location ? v.location === "За городом" : null) },

  { id: "terrace", group: "Пространство", label: "Веранда", test: (v) => v.terrace },
  { id: "dance", group: "Пространство", label: "Танцпол", test: (v) => v.dance },
  { id: "vip", group: "Пространство", label: "VIP-зал", test: (v) => v.vip },
  {
    id: "furniture",
    group: "Пространство",
    label: "Мебель двигается",
    test: (v) => (v.furniture === "Можно двигать всё" ? true : v.furniture === "Частично" ? 0.5 : v.furniture ? false : null),
  },
  {
    id: "closed",
    group: "Пространство",
    label: "Закрывают под нас",
    clientLabel: "закрытие площадки под вас",
    test: (v) => (v.close === "Да" ? true : v.close === "От определённого числа гостей" ? 0.5 : v.close ? false : null),
  },
  { id: "kidsRoom", group: "Пространство", label: "Детская комната", test: feature("Детская комната") },
  { id: "access", group: "Пространство", label: "Доступно маломобильным", test: feature("Пандус или лифт") },

  { id: "round", group: "Рассадка", label: "Круглые столы", test: layout("Круглые столы") },
  { id: "pshape", group: "Рассадка", label: "П-образно", test: layout("П-образно") },
  { id: "common", group: "Рассадка", label: "Общий стол", test: layout("Общий стол") },
  { id: "newlyweds", group: "Рассадка", label: "Стол молодожёнов", test: layout("Стол молодожёнов + гости") },
  { id: "buffetLayout", group: "Рассадка", label: "Фуршет", test: layout("Фуршет") },
  { id: "theater", group: "Рассадка", label: "Театр", test: layout("Театр, рядами") },
  { id: "lounge", group: "Рассадка", label: "Лаунж", test: layout("Лаунж-зоны с диванами") },

  { id: "european", group: "Кухня и меню", label: "Европейская", clientLabel: "европейская кухня", test: cuisine("Европейская") },
  { id: "russian", group: "Кухня и меню", label: "Русская", clientLabel: "русская кухня", test: cuisine("Русская") },
  { id: "caucasian", group: "Кухня и меню", label: "Кавказская", clientLabel: "кавказская кухня", test: cuisine("Грузинская / кавказская") },
  { id: "italian", group: "Кухня и меню", label: "Итальянская", clientLabel: "итальянская кухня", test: cuisine("Итальянская") },
  { id: "asian", group: "Кухня и меню", label: "Паназиатская", clientLabel: "паназиатская кухня", test: cuisine("Паназиатская") },
  { id: "grill", group: "Кухня и меню", label: "Мясо и гриль", test: cuisine("Мясо и гриль") },
  { id: "kidsMenu", group: "Кухня и меню", label: "Детское меню", test: diet("Детское меню") },
  { id: "veg", group: "Кухня и меню", label: "Вегетарианское", clientLabel: "вегетарианские блюда", test: diet("Вегетарианские блюда") },
  { id: "halal", group: "Кухня и меню", label: "Халяль", test: diet("Халяль") },

  { id: "screen", group: "Техника", label: "Экран или проектор", test: equipment("Проектор", "Телевизор / LED-экран") },
  { id: "mics", group: "Техника", label: "Радиомикрофоны", test: equipment("Радиомикрофоны") },
  { id: "hdmi", group: "Техника", label: "HDMI для ноутбука", test: (v) => has(v.connections, "HDMI") },
  { id: "sound", group: "Техника", label: "Звук на площадке", test: equipment("Колонки / акустика") },
  { id: "ownTech", group: "Техника", label: "Можно свою технику", clientLabel: "наша техника на площадке", test: (v) => v.ownTech },

  { id: "loud", group: "Условия", label: "Громко до конца", test: (v) => (v.loudness ? v.loudness === "Можно громко до конца" : null) },
  { id: "late", group: "Условия", label: "До утра", clientLabel: "праздник до утра", test: (v) => (v.until ? v.until === "02:00" || v.until === "до утра" : null) },
  { id: "ownAlcohol", group: "Условия", label: "Свой алкоголь", test: (v) => (v.alcohol === "Можно" ? true : v.alcohol === "Пробковый сбор" ? 0.5 : v.alcohol ? false : null) },
  { id: "ownCake", group: "Условия", label: "Свой торт", test: (v) => has(v.ownItems, "Торт") },
  {
    id: "contractors",
    group: "Условия",
    label: "Наши подрядчики без сбора",
    clientLabel: "работа нашей команды без доплат",
    test: (v) => (v.contractors === "Без ограничений" ? true : v.contractors === "За сбор" ? 0.5 : v.contractors ? false : null),
  },
  { id: "parking", group: "Условия", label: "Парковка", test: (v) => (v.parking ? v.parking !== "Нет парковки" : null) },
  { id: "hookah", group: "Условия", label: "Кальян", test: feature("Кальян") },
  { id: "contract", group: "Условия", label: "Договор и безнал", test: (v) => has(v.pay, "Договор и безнал") },
];

export function criterionById(id: string): Criterion | undefined {
  return CRITERIA.find((c) => c.id === id);
}

// ------------------------------------------------------------------ подбор

export type MarkKind = "capacity" | "budget" | "district" | "criterion";

export interface Mark {
  kind: MarkKind;
  label: string;
  /** Подпись для клиента (предложение). */
  clientLabel: string;
  fit: Fit;
  must: boolean;
}

export interface Match {
  /** 0–100; null — в запросе нечего сравнивать. */
  score: number | null;
  marks: Mark[];
}

/** Вместимость под формат: банкет — сидя, фуршет — стоя, «пока не знаю» — больший из двух. */
export function capacityFor(v: VenueData, format: RequestData["format"]): number | null {
  if (format === "banquet") return v.seated;
  if (format === "buffet") return v.standing;
  if (v.seated === null && v.standing === null) return null;
  return Math.max(v.seated ?? 0, v.standing ?? 0);
}

const money = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

/**
 * Подходит ли площадка под запрос. null — не подходит совсем: мало мест, гостей меньше минимума
 * или нет того, что клиент отметил «обязательно». Иначе — процент: да = 1, частично = 0,5,
 * не указано = 0,25, нет = 0. Вместимость в процент не входит (это жёсткое условие).
 */
export function matchVenue(v: VenueData, r: RequestData): Match | null {
  const marks: Mark[] = [];
  let points = 0;
  let count = 0;
  const add = (mark: Mark) => {
    marks.push(mark);
    count += 1;
    points += mark.fit === true ? 1 : mark.fit === 0.5 ? 0.5 : mark.fit === null ? 0.25 : 0;
  };

  if (r.guests) {
    const capacity = capacityFor(v, r.format);
    if (capacity === null) {
      marks.push({ kind: "capacity", label: "вместимость не указана", clientLabel: "вместимость", fit: null, must: true });
    } else {
      if (capacity < r.guests) return null;
      if (v.minGuests && r.guests < v.minGuests) return null;
      marks.push({ kind: "capacity", label: `вмещает ${capacity}`, clientLabel: `до ${capacity} гостей`, fit: true, must: true });
    }
  }

  if (r.budget) {
    const price = v.perGuest;
    const fit: Fit = !price ? null : price <= r.budget ? true : price <= r.budget * 1.15 ? 0.5 : false;
    add({
      kind: "budget",
      label: price ? `банкет от ${money(price)}` : "цена не указана",
      clientLabel: fit === true ? "в рамках бюджета" : fit === 0.5 ? "чуть выше бюджета" : fit === false ? "выше вашего бюджета" : "стоимость",
      fit,
      must: false,
    });
  }

  if (r.district) {
    add({ kind: "district", label: r.district, clientLabel: `округ ${r.district}`, fit: v.district ? v.district === r.district : null, must: false });
  }

  for (const criterion of CRITERIA) {
    const level = r.wishes[criterion.id];
    if (!level) continue;
    const fit = criterion.test(v);
    if (level === 2 && fit === false) return null;
    add({
      kind: "criterion",
      label: criterion.label,
      clientLabel: criterion.clientLabel ?? criterion.label.toLowerCase(),
      fit,
      must: level === 2,
    });
  }

  return { score: count ? Math.round((points / count) * 100) : null, marks };
}

export interface RankedVenue<T> {
  item: T;
  match: Match;
}

/**
 * Площадки под запрос: без «Не подходит», лучшие сверху; при равном проценте — те, с кем
 * работали, потом проверенные, потом по названию.
 */
export function rankVenues<T extends { data: VenueData; status: VenueStatus }>(items: T[], r: RequestData): Array<RankedVenue<T>> {
  const trust: Record<VenueStatus, number> = { worked: 0, checked: 1, new: 2, rejected: 3 };
  const out: Array<RankedVenue<T>> = [];
  for (const item of items) {
    if (item.status === "rejected") continue;
    const match = matchVenue(item.data, r);
    if (match) out.push({ item, match });
  }
  return out.sort(
    (a, b) =>
      (b.match.score ?? -1) - (a.match.score ?? -1) ||
      trust[a.item.status] - trust[b.item.status] ||
      a.item.data.name.localeCompare(b.item.data.name, "ru"),
  );
}

// ------------------------------------------------------------------ дубли

/** Цифры телефона: последние 10 (8 и +7 в начале не важны). */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function addressKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/ё/g, "е")
    // \b в JS не видит кириллицу, поэтому границы слова — через соседние буквы.
    .replace(/(?<![а-яa-z])(ул|улица|д|дом|пр|просп|проспект|пер|переулок|наб|набережная|г|город|москва|стр|строение|к|корп|корпус)(?![а-яa-z])\.?/g, "")
    .replace(/[^а-яa-z0-9]/g, "");
}

/** Возможные дубли: тот же телефон или тот же адрес. id → id более ранней записи. */
export function findDuplicates(items: Array<{ id: string; data: VenueData; createdAt: number }>): Map<string, string> {
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const byPhone = new Map<string, string>();
  const byAddress = new Map<string, string>();
  const result = new Map<string, string>();
  for (const item of sorted) {
    const phone = phoneDigits(item.data.phone);
    const address = addressKey(item.data.address);
    const twin = (phone.length === 10 ? byPhone.get(phone) : undefined) ?? (address.length >= 6 ? byAddress.get(address) : undefined);
    if (twin) result.set(item.id, twin);
    if (phone.length === 10 && !byPhone.has(phone)) byPhone.set(phone, item.id);
    if (address.length >= 6 && !byAddress.has(address)) byAddress.set(address, item.id);
  }
  return result;
}

// ------------------------------------------------------------------ предложение клиенту

/** Пункт предложения: только то, что можно показать клиенту, — без адреса, телефонов и людей. */
export interface OfferItem {
  venueId: string;
  name: string;
  type: string;
  where: string;
  capacity: string;
  price: string;
  cuisine: string[];
  features: string[];
  about: string;
  ok: string[];
  ask: string[];
  no: string[];
  /** sha256 фото площадки (открываются по ссылке предложения). */
  photos: string[];
}

export interface OfferData {
  /** «Свадьба · 19 июня 2027 · 80 гостей». */
  title: string;
  /** Слово владельца клиенту. */
  comment: string;
  items: OfferItem[];
}

const SKIP_FEATURES = new Set(["Гардероб", "Кондиционер", "Зона для курения", "Пандус или лифт"]);

export function offerItem(venueId: string, v: VenueData, match: Match | null, photos: string[]): OfferItem {
  const marks = match?.marks ?? [];
  const ok = marks.filter((m) => m.fit === true && m.kind !== "capacity").map((m) => m.clientLabel);
  const ask = marks.filter((m) => m.fit === null || m.fit === 0.5).map((m) => m.clientLabel);
  const no = marks.filter((m) => m.fit === false).map((m) => m.clientLabel);
  const capacity = [v.seated ? `до ${v.seated} гостей за столами` : "", v.standing ? `до ${v.standing} на фуршете` : ""].filter(Boolean).join(", ");
  const price = v.perGuest ? `банкет от ${money(v.perGuest)} на гостя` : "стоимость уточним";
  const where = [v.district, v.metro ? `м. ${v.metro}` : "", v.location].filter(Boolean).join(" · ");
  const okText = ok.join("|").toLowerCase();
  const features = v.features.filter((f) => !SKIP_FEATURES.has(f) && !okText.includes(f.toLowerCase().slice(0, 6))).slice(0, 5);
  return {
    venueId,
    name: v.name,
    type: v.type,
    where: where || "Москва",
    capacity: capacity || "уточним",
    price,
    cuisine: v.cuisine,
    features,
    about: v.about,
    ok,
    ask,
    no,
    photos: photos.slice(0, VENUE_FILES.photo),
  };
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «19 июня 2027» из ГГГГ-ММ-ДД. */
export function formatEventDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : "";
}

export function formatLabel(format: RequestData["format"]): string {
  return FORMATS.find((f) => f.id === format)?.label ?? "";
}

/** Заголовок предложения и строка заявки: событие, дата, гости. */
export function requestTitle(r: RequestData): string {
  return [r.eventType || "Мероприятие", formatEventDate(r.date), r.guests ? `${r.guests} гостей` : ""].filter(Boolean).join(" · ");
}

/** Пожелания заявки словами: «обязательно: …; хотелось бы: …». */
export function wishesText(r: RequestData): string {
  const must: string[] = [];
  const want: string[] = [];
  for (const c of CRITERIA) {
    const level = r.wishes[c.id];
    if (level === 2) must.push(c.label.toLowerCase());
    else if (level === 1) want.push(c.label.toLowerCase());
  }
  return [must.length ? `обязательно: ${must.join(", ")}` : "", want.length ? `хотелось бы: ${want.join(", ")}` : ""].filter(Boolean).join("; ");
}

/** Текст предложения для мессенджера (если клиенту удобнее текстом, а не ссылкой). */
export function offerText(offer: OfferData, link: string): string {
  const lines = ["JoyRest — подборка площадок", offer.title, ""];
  if (offer.comment) lines.push(offer.comment, "");
  offer.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name}${item.type ? ` (${item.type.toLowerCase()})` : ""}`);
    lines.push(`   ${item.where}`);
    lines.push(`   ${item.capacity}; ${item.price}`);
    if (item.ok.length) lines.push(`   Подходит: ${item.ok.join(", ")}`);
    if (item.ask.length) lines.push(`   Уточним: ${item.ask.join(", ")}`);
    lines.push("");
  });
  lines.push(`Фото и подробности: ${link}`);
  lines.push("Дата, время и условия подтверждаются заведением после нашего звонка.");
  return lines.join("\n");
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** id анкеты создаёт браузер (повтор после обрыва — та же анкета): 20 случайных символов. */
export function newFormId(): string {
  let id = "";
  const limit = 256 - (256 % ID_ALPHABET.length);
  while (id.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && id.length < 20) id += ID_ALPHABET[byte % ID_ALPHABET.length];
    }
  }
  return id;
}
