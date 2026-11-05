/**
 * Названия: экипажи (по теме), приборы (корень + окончание, стоп-лист, отличие на 3 буквы, близнецы третьего перелёта),
 * детские предметы с картинками. Случайность — только из `rand` (зерно комнаты).
 */
import type { Theme } from "./types";

/** 40 общих корней (тема «Космос» — только они; у остальных тем свои корни идут первыми). */
export const ROOTS = [
  "Бублико", "Чихо", "Мурлыко", "Ветро", "Пузыре", "Кряко", "Хрюко", "Щекото", "Блино", "Тыкво",
  "Зефиро", "Плюше", "Мяуко", "Гавко", "Хохото", "Пончико", "Карамеле", "Ватрушко", "Сырнико", "Леденцо",
  "Тарахто", "Шуршало", "Пыхтело", "Кукареко", "Бульбо", "Звякало", "Хрустело", "Жужжало", "Топото", "Шлёпо",
  "Скрипо", "Брызго", "Фырко", "Пискло", "Барабано", "Свистело", "Вертело", "Гудело", "Мигало", "Чавкало",
] as const;

export const THEME_ROOTS: Record<Theme, readonly string[]> = {
  space: [],
  pirates: ["Пушко", "Якоре", "Штурвало", "Парусо", "Сундуко", "Попугае", "Компасо", "Бочко", "Канато", "Мачто", "Пиастро", "Абордажо", "Флаго", "Волно", "Рифо", "Тельняшко", "Кокосо", "Юнго", "Шторме", "Боцмано"],
  newyear: ["Колоколь", "Оленье", "Шурша", "Снежко", "Мандарино", "Хлопушко", "Санко", "Варежко", "Ледышко", "Бубенцо", "Морозо", "Ёлко", "Подарко", "Валенко", "Хрусте", "Шишко", "Гирлянде", "Мишуро", "Пингвино", "Пряничо"],
  submarine: ["Бульк", "Пузыре", "Перископо", "Глубино", "Сонаро", "Торпедо", "Иллюмино", "Балласто", "Акваланго", "Ракушко", "Коралло", "Медузо", "Ласто", "Плавнико", "Жабро", "Фонаре", "Якоре", "Тритоно", "Мурено", "Китово"],
  wedding: ["Целоваль", "Букето", "Тосто", "Колечко", "Фато", "Вальсо", "Тортико", "Конфетто", "Бантико", "Кружево", "Голубко", "Медово", "Лепестко", "Улыбко", "Шлейфо", "Фейерверко", "Свечо", "Розо", "Пионо", "Танцуло"],
};

/** 12 окончаний. Окончание с гласной («атор») встаёт вместо последней гласной корня: Бублико + атор = Бубликатор. */
export const ENDINGS = ["тор", "трон", "метр", "фон", "дуй", "крут", "граф", "скоп", "мёт", "тель", "атор", "ник"] as const;

/** Близнецы третьего перелёта: тот же корень, окончания этих пар (Бубликатор и Бубликатрон). */
export const TWIN_ENDINGS: ReadonlyArray<readonly [string, string]> = [
  ["атор", "атрон"],
  ["тор", "трон"],
];

/**
 * Стоп-лист (проверяется до раздачи): части слов, которые звучат грубо или двусмысленно, и отдельные сочетания.
 * Сравнение — без регистра, «ё» = «е».
 */
export const STOP_PARTS = [
  "хуй", "хуе", "хуя", "хер", "пизд", "бля", "еба", "ебл", "ебу", "ебн", "жоп", "срат", "сран", "говн", "дерьм", "перд",
  "пук", "ссык", "ссат", "сука", "суки", "член", "дроч", "секс", "трах", "сись", "писю", "письк", "попк", "задн", "анал",
  "чмо", "лох", "дебил", "идиот", "дурак", "урод", "тупо", "смерт", "убий", "труп", "гроб", "нарк", "водк", "пьян", "гей",
  "сопл", "блев", "рвот", "понос", "какаш", "моч",
];
export const STOP_NAMES = ["Хрюкодуй", "Пыхтелодуй", "Чавкалодуй", "Брызгодуй", "Пузыредуй", "Пушкомёт"];

export function norm(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

export function isBlocked(name: string): boolean {
  const n = norm(name);
  return STOP_PARTS.some((part) => n.includes(part)) || STOP_NAMES.some((s) => norm(s) === n);
}

export function joinName(root: string, ending: string): string {
  return /^[аеёиоуыэюя]/.test(ending) ? root.replace(/[аеёиоуыэюяь]$/, "") + ending : root + ending;
}

/** Расстояние Левенштейна (без регистра, ё = е). */
export function distance(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length] ?? 0;
}

/** Корень похож на название экипажа (первые 4 буквы): у «Снежинки» нет «Снежкомёта». */
export function rootClashes(root: string, crewNames: readonly string[]): boolean {
  const r = norm(root).replace(/[^а-я]/g, "").slice(0, 4);
  return r.length === 4 && crewNames.some((c) => norm(c).replace(/[^а-я]/g, "").slice(0, 4) === r);
}

/** Детские предметы с картинками: название, винительный падеж, ключ картинки. */
export const KIDS_ITEMS: ReadonlyArray<{ name: string; acc: string; icon: string }> = [
  { name: "Лягушка", acc: "лягушку", icon: "frog" },
  { name: "Банан", acc: "банан", icon: "banana" },
  { name: "Ракета", acc: "ракету", icon: "rocket" },
  { name: "Солнышко", acc: "солнышко", icon: "sun" },
  { name: "Мяч", acc: "мяч", icon: "ball" },
  { name: "Рыбка", acc: "рыбку", icon: "fish" },
  { name: "Звезда", acc: "звезду", icon: "star" },
  { name: "Машинка", acc: "машинку", icon: "car" },
  { name: "Шарик", acc: "шарик", icon: "balloon" },
  { name: "Кубик", acc: "кубик", icon: "cube" },
  { name: "Ёжик", acc: "ёжика", icon: "hedgehog" },
  { name: "Торт", acc: "торт", icon: "cake" },
  { name: "Зонтик", acc: "зонтик", icon: "umbrella" },
  { name: "Яблоко", acc: "яблоко", icon: "apple" },
  { name: "Колокольчик", acc: "колокольчик", icon: "bell" },
  { name: "Бабочка", acc: "бабочку", icon: "butterfly" },
  { name: "Кит", acc: "кита", icon: "whale" },
  { name: "Слон", acc: "слона", icon: "elephant" },
  { name: "Гриб", acc: "гриб", icon: "mushroom" },
  { name: "Луна", acc: "луну", icon: "moon" },
];

/** Названия экипажей по темам — по 20. */
export const CREW_NAMES: Record<Theme, readonly string[]> = {
  space: ["Комета", "Орбита", "Ракета", "Луноход", "Галактика", "Квазар", "Метеор", "Спутник", "Туманность", "Пульсар", "Астра", "Звездолёт", "Протон", "Сатурн", "Вега", "Сириус", "Андромеда", "Плазма", "Космик", "Нова"],
  pirates: ["Чайка", "Барракуда", "Акула", "Бриг", "Фрегат", "Каракатица", "Ураган", "Штиль", "Медуза", "Отважный", "Гроза морей", "Морской волк", "Альбатрос", "Корсар", "Буревестник", "Кашалот", "Дельфин", "Скат", "Флибустьер", "Бригантина"],
  newyear: ["Снежинка", "Метелица", "Пряник", "Сосулька", "Хлопушка", "Мандаринка", "Гирлянда", "Снеговик", "Ёлочка", "Вьюга", "Искорка", "Леденец", "Бубенчик", "Огонёк", "Шишка", "Иней", "Конфетти", "Сугроб", "Серпантин", "Звёздочка"],
  submarine: ["Батискаф", "Коралл", "Наутилус", "Глубина", "Риф", "Жемчужина", "Морской конёк", "Касатка", "Ракушка", "Лагуна", "Прилив", "Планктон", "Кальмар", "Афалина", "Звезда морей", "Мурена", "Тритон", "Лосось", "Медуза", "Скат"],
  wedding: ["Голубки", "Колечко", "Фата", "Букет", "Вальс", "Медовый месяц", "Лебеди", "Роза", "Пион", "Ромашка", "Лаванда", "Тюльпан", "Незабудка", "Сердечко", "Купидон", "Каравай", "Карамель", "Лепесток", "Зефирка", "Свеча"],
};

export function crewName(theme: Theme, id: number): string {
  const list = CREW_NAMES[theme];
  const base = list[id % list.length] ?? "Экипаж";
  return id < list.length ? base : `${base} ${Math.floor(id / list.length) + 1}`;
}

/** Цвет 0–4 и значок 0–8: до 5 экипажей — только цвет; дальше у каждого пара «цвет + значок» не повторяется. */
export function crewLook(id: number, crews: number): { color: number; icon: number | null } {
  return { color: id % 5, icon: crews > 5 ? id % 9 : null };
}

/** Все сочетания корень + окончание темы без стоп-листа и без корней экипажей: сначала корни темы, потом общие. */
export function nameCandidates(theme: Theme, crewNames: readonly string[], rand: () => number): Array<{ root: string; name: string }> {
  const out: Array<{ root: string; name: string }> = [];
  const seen = new Set<string>();
  for (const group of [THEME_ROOTS[theme], ROOTS]) {
    const part: Array<{ root: string; name: string }> = [];
    for (const root of group) {
      if (rootClashes(root, crewNames)) continue;
      for (const ending of ENDINGS) {
        const name = joinName(root, ending);
        const key = norm(name);
        if (isBlocked(name) || seen.has(key)) continue;
        seen.add(key);
        part.push({ root, name });
      }
    }
    out.push(...shuffle(part, rand));
  }
  return out;
}

export function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}
