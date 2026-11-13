/**
 * Названия: экипажи (по теме), приборы (корень + окончание, стоп-лист, отличие на 3 буквы, близнецы третьего перелёта),
 * детские предметы с картинками. Случайность — только из `rand` (зерно комнаты).
 */
import type { Theme } from "./types";

/** 40 общих корней (ТЗ). У каждой темы ещё свои 40 — они идут первыми. */
export const ROOTS = [
  "Бублико", "Чихо", "Мурлыко", "Ветро", "Пузыре", "Кряко", "Хрюко", "Щекото", "Блино", "Тыкво",
  "Зефиро", "Плюше", "Мяуко", "Гавко", "Хохото", "Пончико", "Карамеле", "Ватрушко", "Сырнико", "Леденцо",
  "Тарахто", "Шуршало", "Пыхтело", "Кукареко", "Бульбо", "Звякало", "Хрустело", "Жужжало", "Топото", "Шлёпо",
  "Скрипо", "Брызго", "Фырко", "Пискло", "Барабано", "Свистело", "Вертело", "Гудело", "Мигало", "Чавкало",
] as const;

/**
 * Корни тем (ТЗ: «20–40 корней» на тему) — по 40, чтобы на 200 гостей (800 приборов в третьем перелёте) названия не
 * повторялись на весь зал. Корни не начинаются как названия экипажей своей темы (первые 4 буквы).
 */
export const THEME_ROOTS: Record<Theme, readonly string[]> = {
  space: [
    "Скафандро", "Плането", "Кратеро", "Телескопо", "Турбо", "Гравито", "Невесомо", "Антенно", "Люко", "Шлюзо",
    "Модуле", "Зондо", "Марсо", "Юпитеро", "Венеро", "Фотоно", "Лазеро", "Радаро", "Нейтроно", "Солнце",
    "Кольце", "Вакуумо", "Сигнало", "Пилото", "Шаттло", "Бортово", "Пусково", "Стыковко", "Тяго", "Топливо",
    "Датчико", "Магнито", "Ионо", "Атомо", "Квантово", "Луче", "Эфиро", "Нептуно", "Плутоно", "Меркурио",
  ],
  pirates: [
    "Пушко", "Якоре", "Штурвало", "Парусо", "Сундуко", "Попугае", "Компасо", "Бочко", "Канато", "Мачто",
    "Пиастро", "Абордажо", "Флаго", "Волно", "Рифо", "Тельняшко", "Кокосо", "Юнго", "Шторме", "Боцмано",
    "Ромо", "Карто", "Сабле", "Крюко", "Повязко", "Трюмо", "Палубо", "Рундуко", "Мушкето", "Гарпуно",
    "Шлюпко", "Подзорно", "Кладо", "Дублоно", "Румбо", "Лоцмано", "Камбузо", "Рындо", "Кливеро", "Буйко",
  ],
  newyear: [
    "Колоколь", "Оленье", "Шурша", "Снежко", "Мандарино", "Хлопушко", "Санко", "Варежко", "Ледышко", "Бубенцо",
    "Морозо", "Ёлко", "Подарко", "Валенко", "Хрусте", "Шишко", "Гирлянде", "Мишуро", "Пингвино", "Пряничо",
    "Салюто", "Куранто", "Тройко", "Узоро", "Хороводо", "Свечко", "Фонарико", "Бенгало", "Оливье", "Карнавало",
    "Блёстко", "Сюрпризо", "Лыжо", "Коньково", "Носочко", "Пуховико", "Ватно", "Морковко", "Шарфо", "Сказко",
  ],
  submarine: [
    "Бульк", "Пузыре", "Перископо", "Глубино", "Сонаро", "Торпедо", "Иллюмино", "Балласто", "Акваланго", "Ракушко",
    "Коралло", "Медузо", "Ласто", "Плавнико", "Жабро", "Фонаре", "Якоре", "Тритоно", "Мурено", "Китово",
    "Гидро", "Водолазо", "Отсеко", "Клапано", "Насосо", "Буйко", "Тюлене", "Осьмино", "Крабо", "Дельфино",
    "Пескаре", "Шлюпо", "Подлодко", "Сардино", "Устрице", "Креветко", "Камбало", "Морже", "Эхолото", "Штурмано",
  ],
  wedding: [
    "Целоваль", "Букето", "Тосто", "Колечко", "Фато", "Вальсо", "Тортико", "Конфетто", "Бантико", "Кружево",
    "Голубко", "Медово", "Лепестко", "Улыбко", "Шлейфо", "Фейерверко", "Свечо", "Розо", "Пионо", "Танцуло",
    "Бокало", "Фрако", "Невесто", "Женихо", "Свадебно", "Тамадо", "Подвязко", "Каблучко", "Галстуко", "Обнимало",
    "Горько", "Конверто", "Шарико", "Лимузино", "Вуале", "Перчатко", "Сюрпризо", "Платочко", "Любо", "Танго",
  ],
};

/** 12 окончаний. Окончание с гласной («атор») встаёт вместо последней гласной корня: Бублико + атор = Бубликатор. */
export const ENDINGS = ["тор", "трон", "метр", "фон", "дуй", "крут", "граф", "скоп", "мёт", "тель", "атор", "ник"] as const;

/**
 * Близнецы третьего перелёта: тот же корень, окончания этих пар (Бубликатор и Бубликатрон, Бубликомёт и Бубликометр) —
 * отличие 1–2 буквы. Пар у корня несколько, поэтому близнецов хватает на весь зал.
 */
export const TWIN_ENDINGS: ReadonlyArray<readonly [string, string]> = [
  ["атор", "атрон"],
  ["тор", "трон"],
  ["мёт", "метр"],
  ["фон", "трон"],
  ["тор", "атор"],
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

/**
 * Свои названия ведущего (конструктор и раздача на сервере): грубое ли. Стоп-лист генератора (`isBlocked`, части слов) здесь не
 * годится: он ловит кусок внутри любого слова и отказывал «Секстанту», «Анализатору», «Гейзерометру», «Хлебатору», «Сабле»
 * (аудит 2d, №3). Поэтому (проверка 2d, №2):
 * 1) текст приводится к русским буквам несколькими способами — похожие латинские буквы («xуй», «Cyka»), транслит («pizda»,
 *    «zhopa»), цифры и значки вместо букв («Пи3дец», «Ж0па», «6лядь», «п*здец», «бл@дь»); повторы букв сжимаются («Хууй»,
 *    «Бляяядь»); буквы через пробелы и точки склеиваются («Ж о п а», «Х.у.й»);
 * 2) настоящие матерные корни опасны где угодно в слове (`OBSCENE`), кроме явных безобидных слов (`HARMLESS_PARTS`: «Страхуй»,
 *    «Психует», «Скипидар», «Эбонит»);
 * 3) остальное грубое (`RUDE_START`) — только целым словом или началом слова, с исключениями для безобидных слов с тем же
 *    началом («Секстант», «Херувим», «Херсон», «Трахома», «Сукияки», «Гробница», «Смертник», «Членистоногий», «Труппа»);
 * 4) английские ругательства (`EN_ANY`, `EN_START`).
 */
const OBSCENE = [/ху[йяеию]/, /пизд/, /пидо?р/, /пидар/, /бляд/, /блят/, /мудак/, /мудил/, /гандон/, /залуп/, /шлюх/, /манда?вош/];
/** Матерный «еб» внутри слова — только в начале или после гласной, «ъ», «ь» (заебал, уебан, долбоеб, съебать); после согласной — «хлеб», «ребус», «небо». */
const OBSCENE_EB = /(^|[аеиоуыэюяъь])еб/;
/** Безобидные слова с матерным куском внутри: кусок вырезается до проверки (по сжатому слову). */
const HARMLESS_PARTS = ["страху", "психу", "скипидар", "ебонит"];
const RUDE_START = [
  /^хер(?!увим|ес|сон)/, /^(на|по|ни)хер/, /^хрен/, /^жоп/, /^ср(ат|ан|ак)/, /^г[оа]вн/, /^дерьм/, /^перд/, /^пук(?!л)/,
  /^(за|на|по|вы|об|от|рас|у)?сса[тлн]/, /^ссык/, /^сук(а|и(?!як)|у)/, /^суч(к?а|ар|ий|ье)/, /^манд[ау]$/, /^член(?!ист|окрут)/,
  /^дроч/, /^секс(?!т|$)/, /^трах(?!е|ом(?![её]т))/, /^сись/, /^писю/, /^письк/, /^попк(?!ор)/, /^задниц/, /^анал(?!из|ог|ит|ь?г)/,
  /^анус/, /^чмо(?!к)/, /^лох(?!м|ан)/, /^дебил/, /^идиот/, /^дура(к|ч(ок|ина))?$/, /^урод/, /^тупиц/, /^тупорыл/,
  /^смерт(?!ник|онос)/, /^труп(?!п)/, /^гроб(?!ниц)/, /^нарк(?!оз)/, /^водк(?!омер)/, /^пьян/, /^гей(?!з|ш|мпад|мер|минг)/,
  /^блев/, /^блюв/, /^рвот/, /^понос/, /^какаш/, /^моч(?!ал|ен|ён|к|еизг|ил)/, /^бля(?!ш|х)/, /^гнид/, /^твар/, /^сдох/,
  /^мраз/, /^падл/, /^ублюд/, /^педик(?!юр)/,
];
const EN_ANY = [/fuck/, /fuk/, /cunt/, /bitch/, /whore/, /slut/, /nigg/, /fagg?ot/, /wank/, /dildo/, /asshole/, /motherf/, /pussy/, /shit(?!ake)/, /dickhead/];
const EN_START = [/^dick(?!ens|son|ey)/, /^cock(?!pit|tail|ato|roach|ney|erel)/, /^ass(es)?$/, /^arse/, /^bastard/, /^penis/, /^tits?$/, /^boobs?$/, /^prick$/, /^twat/, /^piss/, /^crap/, /^fag$/];
/** Похожие латинские буквы — в русские (обход стоп-листа «xуй», «Cyka»). */
const LOOKALIKE: Record<string, string> = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", k: "к", m: "м", t: "т", h: "н", b: "в", u: "и", z: "з" };
/** Транслит латиницей («pizda», «zhopa», «blyad») — сначала сочетания. */
const TRANSLIT_MULTI: ReadonlyArray<readonly [string, string]> = [
  ["shch", "щ"], ["sch", "щ"], ["zh", "ж"], ["kh", "х"], ["ch", "ч"], ["sh", "ш"], ["ts", "ц"],
  ["ya", "я"], ["yu", "ю"], ["yo", "е"], ["ye", "е"], ["ja", "я"], ["ju", "ю"], ["jo", "е"],
];
const TRANSLIT_ONE: Record<string, string> = {
  a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", z: "з",
};
/** Цифры и значки вместо букв — только рядом с буквой («Ж0па», «6лядь»; «Ракета 2000» не трогаем). */
const LEET_RU: Record<string, string> = { "0": "о", "1": "и", "3": "з", "4": "ч", "6": "б", "9": "я", $: "с" };
const LEET_EN: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", $: "s" };
const LETTER = "a-zа-я";

function leet(text: string, map: Record<string, string>): string {
  return text.replace(new RegExp(`(?<=[${LETTER}])[0-9$]|[0-9$](?=[${LETTER}])`, "g"), (ch) => map[ch] ?? ch);
}

/** «*» и «@» между буквами — любая гласная («п*здец», «бл@дь», «х*й»). */
function wildcards(text: string, vowels: readonly string[]): string[] {
  const re = new RegExp(`(?<=[${LETTER}])[*@]+(?=[${LETTER}])`, "g");
  if (!re.test(text)) return [text];
  return vowels.map((v) => text.replace(re, v));
}

function lookalike(text: string): string {
  return text.replace(/[a-z]/g, (ch) => LOOKALIKE[ch] ?? ch);
}

function translit(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (!/[a-z]/.test(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    const multi = TRANSLIT_MULTI.find(([lat]) => text.startsWith(lat, i));
    if (multi) {
      out += multi[1];
      i += multi[0].length;
      continue;
    }
    // «y» после гласной — «й» («huy»), иначе — «ы».
    if (ch === "y") out += /[aeiouаеиоуыэюя]/.test(text[i - 1] ?? "") ? "й" : "ы";
    else out += TRANSLIT_ONE[ch] ?? ch;
    i += 1;
  }
  return out;
}

/** Повторы букв — одной («хууй» → «хуй», «пиздда» → «пизда»): для матерных корней. */
function squeezeAll(word: string): string {
  return word.replace(/(.)\1+/g, "$1");
}

/** Повторы гласных и тройные согласные — одной; двойные согласные остаются («Труппа», «Ссыкло», «Суккулент»). */
function squeezeSoft(word: string): string {
  return word.replace(/([аеиоуыэюя])\1+/g, "$1").replace(/(.)\1\1+/g, "$1");
}

function obscene(word: string): boolean {
  let w = squeezeAll(word);
  for (const part of HARMLESS_PARTS) w = w.split(part).join("·");
  return OBSCENE.some((re) => re.test(w)) || OBSCENE_EB.test(w);
}

/** Слова текста: куски между любыми знаками, слова между пробелами (без дефисов и точек внутри) и буквы через пробел вместе. */
function wordsOf(text: string, letters: RegExp, split: RegExp): { words: Set<string>; spaced: string | null } {
  const pieces = text.split(split).filter((w) => w !== "");
  const words = new Set<string>(pieces);
  for (const w of text.split(/\s+/)) {
    const joined = w.replace(letters, "");
    if (joined !== "") words.add(joined);
  }
  // «Ж о п а», «Супер Ж о п а», «Х.у.й-метр»: подряд идущие кусочки по 1–2 буквы — одним словом, и вместе с соседями.
  let spaced: string | null = null;
  if (pieces.length > 1 && pieces.some((p) => p.length <= 2)) {
    spaced = pieces.join("");
    for (let i = 0; i < pieces.length; ) {
      if ((pieces[i]?.length ?? 0) > 2) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < pieces.length && (pieces[j]?.length ?? 0) <= 2) j += 1;
      const run = pieces.slice(i, j).join("");
      const prev = pieces[i - 1] ?? "";
      const next = pieces[j] ?? "";
      for (const w of [run, prev + run, run + next, prev + run + next]) words.add(w);
      i = j;
    }
  }
  return { words, spaced };
}

function rudeRussian(text: string): boolean {
  const letters = text.replace(/[^а-я]/g, "");
  if (STOP_NAMES.some((n) => norm(n) === letters)) return true;
  const { words, spaced } = wordsOf(text, /[^а-я]/g, /[^а-я]+/);
  if (spaced !== null && obscene(spaced)) return true;
  for (const w of words) {
    if (obscene(w)) return true;
    const soft = squeezeSoft(w);
    if (RUDE_START.some((re) => re.test(soft))) return true;
  }
  return false;
}

function rudeEnglish(text: string): boolean {
  const { words, spaced } = wordsOf(text, /[^a-z]/g, /[^a-z]+/);
  if (spaced !== null) words.add(spaced);
  for (const w of words) {
    const all = squeezeAll(w);
    if (EN_ANY.some((re) => re.test(all) || re.test(w))) return true;
    if (EN_START.some((re) => re.test(w) || re.test(all))) return true;
  }
  return false;
}

export function isRudeName(name: string): boolean {
  const base = norm(name);
  for (const wild of wildcards(base, ["а", "е", "и", "о", "у", "я", "ы"])) {
    for (const digits of [leet(wild, LEET_RU), leet(wild, LEET_EN)]) {
      if (rudeRussian(lookalike(digits)) || rudeRussian(translit(digits))) return true;
    }
  }
  for (const wild of wildcards(base, ["a", "e", "i", "o", "u"])) if (rudeEnglish(leet(wild, LEET_EN))) return true;
  return false;
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

/**
 * Названия похожи — расстояние меньше `limit` (по уже приведённым строкам `norm`). Быстрее полного `distance`: разница длин
 * сразу отвечает «не похожи», считается только полоса шириной `limit`, при выходе за предел — сразу «нет».
 */
export function closer(x: string, y: string, limit: number): boolean {
  const k = limit - 1;
  if (Math.abs(x.length - y.length) > k) return false;
  let prev = new Array<number>(y.length + 1);
  let cur = new Array<number>(y.length + 1);
  for (let j = 0; j <= y.length; j += 1) prev[j] = j;
  for (let i = 1; i <= x.length; i += 1) {
    const lo = Math.max(1, i - k);
    const hi = Math.min(y.length, i + k);
    cur[0] = i;
    if (lo > 1) cur[lo - 1] = limit;
    let best = i <= k ? i : limit;
    for (let j = lo; j <= hi; j += 1) {
      const sub = (prev[j - 1] ?? limit) + (x[i - 1] === y[j - 1] ? 0 : 1);
      const del = (prev[j] ?? limit) + 1;
      const ins = (cur[j - 1] ?? limit) + 1;
      const v = Math.min(sub, del, ins, limit);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (hi < y.length) cur[hi + 1] = limit;
    if (best >= limit) return false;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return (prev[y.length] ?? limit) < limit;
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

/**
 * Детская сложность: 20 предметов (ТЗ) — у каждого прибора своё название на весь зал. Предметов на всех не хватает
 * (3 прибора на ребёнка), поэтому дальше — тот же предмет с цветом: «Красная лягушка» (картинка того же цвета, `tint`).
 * Цвет — только в названии и картинке, у самих приборов детской сложности цветов нет.
 */
export const KIDS_TINTS: ReadonlyArray<{ stem: string; soft: boolean; hard: "ый" | "ой" }> = [
  { stem: "красн", soft: false, hard: "ый" },
  { stem: "син", soft: true, hard: "ый" },
  { stem: "зелён", soft: false, hard: "ый" },
  { stem: "жёлт", soft: false, hard: "ый" },
  { stem: "оранжев", soft: false, hard: "ый" },
  { stem: "фиолетов", soft: false, hard: "ый" },
  { stem: "розов", soft: false, hard: "ый" },
  { stem: "голуб", soft: false, hard: "ой" },
];

/** Род и одушевлённость предметов: для «Красная лягушка» / «красную лягушку», «синего кита». */
const KIDS_GENDER: Record<string, "m" | "ma" | "f" | "n"> = {
  frog: "f", banana: "m", rocket: "f", sun: "n", ball: "m", fish: "f", star: "f", car: "f", balloon: "m", cube: "m",
  hedgehog: "ma", cake: "m", umbrella: "m", apple: "n", bell: "m", butterfly: "f", whale: "ma", elephant: "ma", mushroom: "m", moon: "f",
};

export function kidsTinted(item: { name: string; acc: string; icon: string }, tint: number): { name: string; acc: string } {
  const c = KIDS_TINTS[tint] ?? KIDS_TINTS[0];
  if (!c) return { name: item.name, acc: item.acc };
  const g = KIDS_GENDER[item.icon] ?? "m";
  const nom = g === "f" ? (c.soft ? "яя" : "ая") : g === "n" ? (c.soft ? "ее" : "ое") : c.soft ? "ий" : c.hard;
  const acc = g === "f" ? (c.soft ? "юю" : "ую") : g === "n" ? (c.soft ? "ее" : "ое") : g === "ma" ? (c.soft ? "его" : "ого") : c.soft ? "ий" : c.hard;
  const adj = c.stem + nom;
  return { name: `${adj.charAt(0).toUpperCase()}${adj.slice(1)} ${item.name.toLowerCase()}`, acc: `${c.stem}${acc} ${item.acc}` };
}

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

/** Сочетания темы без стоп-листа и корней экипажей — считаются один раз на тему и набор экипажей (дальше только перемешиваются). */
const candidateCache = new Map<string, Array<Array<{ root: string; name: string }>>>();

/** Все сочетания корень + окончание темы без стоп-листа и без корней экипажей: сначала корни темы, потом общие. */
export function nameCandidates(theme: Theme, crewNames: readonly string[], rand: () => number): Array<{ root: string; name: string }> {
  const cacheKey = `${theme}|${crewNames.join("|")}`;
  let parts = candidateCache.get(cacheKey);
  if (!parts) {
    parts = [];
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
      parts.push(part);
    }
    if (candidateCache.size > 64) candidateCache.clear();
    candidateCache.set(cacheKey, parts);
  }
  const out: Array<{ root: string; name: string }> = [];
  for (const part of parts) out.push(...shuffle(part, rand));
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
