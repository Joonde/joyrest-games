// «Шпион» (по мотивам Spyfall): все игроки, кроме шпиона, знают, где они (локация) и кто они там (роль).
// Шпион не знает локацию и пытается её угадать по вопросам, город — вычислить шпиона. Содержимое игры —
// колода локаций с ролями и настройки: локация и шпионы выбираются случайно в начале каждой партии.

export interface SpyLocation {
  name: string;
  roles: string[];
}

export interface SpyContent {
  /** Колода локаций: в каждой партии — новая, внутри одной игры локации не повторяются. */
  locations: SpyLocation[];
  /** Шпионов в партии: auto — 1, а с 11 игроков — 2. */
  spies: "auto" | 1 | 2;
  /** Минут на обсуждение (таймер на экране зала по часам сервера). */
  roundMinutes: number;
  /** Секунд на голосование. */
  voteSeconds: number;
  /** Партий за игру: очки копятся в общий счёт. */
  parties: number;
  /** Победил город — каждому не-шпиону. */
  townPoints: number;
  /** Победили шпионы — каждому шпиону. */
  spyPoints: number;
  /** Шпиону, который сам угадал локацию, — сверху. */
  guessBonus: number;
}

export const SPY_LIMITS = {
  minPlayers: 4,
  maxPlayers: 20,
  /** Двое шпионов при auto — с этого числа игроков. */
  twoSpiesFrom: 11,
  minMinutes: 3,
  maxMinutes: 15,
  minVote: 15,
  maxVote: 120,
  /** Последний шанс шпиона, секунд. */
  lastChanceSeconds: 30,
  minLocations: 6,
  maxLocations: 40,
  maxRoles: 10,
  name: 40,
  role: 40,
} as const;

/** Колода по умолчанию: локации для любой компании, у каждой 6–8 ролей. */
export const DEFAULT_LOCATIONS: SpyLocation[] = [
  { name: "Ресторан", roles: ["Шеф-повар", "Официант", "Сомелье", "Гость-критик", "Администратор", "Посудомойщик", "Музыкант", "Влюблённая пара"] },
  { name: "Самолёт", roles: ["Командир экипажа", "Второй пилот", "Стюардесса", "Пассажир бизнес-класса", "Пассажир с ребёнком", "Турист", "Инженер"] },
  { name: "Больница", roles: ["Главврач", "Хирург", "Медсестра", "Пациент", "Посетитель", "Санитар", "Интерн"] },
  { name: "Школа", roles: ["Директор", "Учитель математики", "Отличник", "Двоечник", "Завуч", "Охранник", "Повар в столовой", "Родитель на собрании"] },
  { name: "Пляж", roles: ["Спасатель", "Отдыхающий", "Продавец кукурузы", "Серфер", "Фотограф", "Ребёнок с ведёрком", "Аниматор"] },
  { name: "Театр", roles: ["Режиссёр", "Актриса", "Суфлёр", "Гардеробщица", "Зритель в первом ряду", "Осветитель", "Критик"] },
  { name: "Банк", roles: ["Управляющий", "Кассир", "Охранник", "Клиент", "Инкассатор", "Консультант", "Пенсионер"] },
  { name: "Поезд", roles: ["Машинист", "Проводница", "Пассажир на верхней полке", "Продавец в вагоне-ресторане", "Контролёр", "Студент", "Командировочный"] },
  { name: "Цирк", roles: ["Клоун", "Дрессировщик", "Акробат", "Фокусник", "Зритель", "Жонглёр", "Директор цирка"] },
  { name: "Космическая станция", roles: ["Командир", "Бортинженер", "Учёный", "Космический турист", "Врач", "Пилот"] },
  { name: "Подводная лодка", roles: ["Капитан", "Штурман", "Акустик", "Кок", "Механик", "Матрос", "Радист"] },
  { name: "Свадьба", roles: ["Жених", "Невеста", "Тамада", "Свидетель", "Свидетельница", "Мама невесты", "Фотограф", "Гость издалека"] },
  { name: "Кинотеатр", roles: ["Киномеханик", "Кассир", "Продавец попкорна", "Зритель", "Влюблённая пара", "Кинокритик"] },
  { name: "Полицейский участок", roles: ["Начальник участка", "Детектив", "Дежурный", "Задержанный", "Свидетель", "Адвокат", "Стажёр"] },
  { name: "Супермаркет", roles: ["Кассир", "Охранник", "Покупатель", "Грузчик", "Мерчендайзер", "Директор магазина", "Пенсионерка со скидкой"] },
  { name: "Отель", roles: ["Портье", "Горничная", "Швейцар", "Турист", "Управляющий", "Бармен", "Звезда инкогнито"] },
  { name: "Пиратский корабль", roles: ["Капитан", "Боцман", "Кок", "Юнга", "Пленник", "Штурман", "Пушкарь"] },
  { name: "Музей", roles: ["Экскурсовод", "Смотрительница", "Реставратор", "Турист", "Школьник на экскурсии", "Директор музея", "Охранник"] },
  { name: "Стадион", roles: ["Футболист", "Судья", "Тренер", "Болельщик", "Комментатор", "Продавец хот-догов", "Охранник"] },
  { name: "Зоопарк", roles: ["Смотритель", "Ветеринар", "Посетитель", "Фотограф", "Экскурсовод", "Ребёнок с мороженым", "Кассир"] },
  { name: "Университет", roles: ["Профессор", "Студент", "Ректор", "Аспирант", "Лаборант", "Библиотекарь", "Вахтёр"] },
  { name: "Посольство", roles: ["Посол", "Секретарь", "Охранник", "Переводчик", "Турист без паспорта", "Дипломат", "Журналист"] },
  { name: "Салон красоты", roles: ["Парикмахер", "Мастер маникюра", "Визажист", "Клиентка", "Администратор", "Стилист", "Невеста перед свадьбой"] },
  { name: "Военная база", roles: ["Генерал", "Солдат", "Сержант", "Повар", "Врач", "Связист", "Новобранец"] },
];

export function createSpy(): SpyContent {
  return {
    locations: DEFAULT_LOCATIONS.map((l) => ({ name: l.name, roles: [...l.roles] })),
    spies: "auto",
    roundMinutes: 8,
    voteSeconds: 45,
    parties: 3,
    townPoints: 100,
    spyPoints: 300,
    guessBonus: 100,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function parseSpy(raw: unknown): SpyContent {
  const d = record(raw);
  const base = createSpy();
  const locations = Array.isArray(d.locations)
    ? d.locations.slice(0, SPY_LIMITS.maxLocations).map((x) => {
        const l = record(x);
        const roles = Array.isArray(l.roles) ? l.roles.slice(0, SPY_LIMITS.maxRoles).map((r) => text(r, SPY_LIMITS.role)) : [];
        return { name: text(l.name, SPY_LIMITS.name), roles };
      })
    : base.locations;
  return {
    locations,
    spies: d.spies === 1 || d.spies === 2 ? d.spies : "auto",
    roundMinutes: int(d.roundMinutes, base.roundMinutes, SPY_LIMITS.minMinutes, SPY_LIMITS.maxMinutes),
    voteSeconds: int(d.voteSeconds, base.voteSeconds, SPY_LIMITS.minVote, SPY_LIMITS.maxVote),
    parties: int(d.parties, base.parties, 1, 10),
    townPoints: int(d.townPoints, base.townPoints, 0, 1000),
    spyPoints: int(d.spyPoints, base.spyPoints, 0, 1000),
    guessBonus: int(d.guessBonus, base.guessBonus, 0, 1000),
  };
}

/** Сколько шпионов в партии: не больше трети игроков (и хотя бы один). */
export function spiesFor(content: Pick<SpyContent, "spies">, players: number): number {
  const wanted = content.spies === "auto" ? (players >= SPY_LIMITS.twoSpiesFrom ? 2 : 1) : content.spies;
  return Math.max(1, Math.min(wanted, Math.floor(players / 3) || 1));
}

/** Роли локации без пустых строк. */
export function rolesOf(location: SpyLocation | undefined): string[] {
  return (location?.roles ?? []).map((r) => r.trim()).filter(Boolean);
}
