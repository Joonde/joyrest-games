// «Олимп» — боги пробной истории: роль, стихия, символы, характеристики 1-го уровня,
// три способности и ультимативный навык. Тексты — черновик Claude, правит владелец.
import type { ElementId, StatId, Stats } from "./rules";

export type RoleId = "warrior" | "guardian" | "healer" | "oracle" | "sorcerer" | "trickster";

export const ROLES: Record<RoleId, { name: string; hint: string }> = {
  warrior: { name: "Воитель", hint: "главный урон по одному" },
  guardian: { name: "Страж", hint: "держит удары, щиты" },
  healer: { name: "Целитель", hint: "лечение, снятие проклятий" },
  oracle: { name: "Оракул", hint: "усиления, предвидение" },
  sorcerer: { name: "Чародей", hint: "стихийный урон по всем, проклятия" },
  trickster: { name: "Плут", hint: "скорость, ловушки, обман" },
};

/** Эффект, который вешает способность: благословение или проклятие на несколько ходов. */
export interface EffectSpec {
  id: string;
  name: string;
  kind: "bless" | "curse";
  /** Сколько ходов цели действует (1 — до конца её следующего хода). */
  turns: number;
  /** Прибавка к броскам (−10 «Рок»). */
  roll?: number;
  /** Прибавка к характеристикам. */
  stats?: Partial<Stats>;
  /** Урон в начале хода (яд, огонь); отрицательный — лечение. */
  dot?: number;
  /** Прибавка к скорости. */
  speed?: number;
  /** Множитель входящего урона (0,7 — броня, 1,3 — уязвимость). */
  taken?: number;
  /** Пропустить ход (оцепенение, сон). */
  skip?: boolean;
}

export type AbilityKind = "strike" | "blast" | "heal" | "shield" | "bless" | "curse";
export type AbilityTarget = "foe" | "foes" | "ally" | "allies" | "self";

export interface Ability {
  id: string;
  name: string;
  kind: AbilityKind;
  /** Стихия урона; null — без стихии. */
  element: ElementId | null;
  /** Чем бросают: от характеристики зависит порог успеха. */
  stat: StatId;
  /** База: урон, лечение или щит при исходе «средне» (×1). */
  power: number;
  target: AbilityTarget;
  /** Сколько своих ходов ждать до повтора (0 — каждый ход). */
  cooldown: number;
  /** Ультимативный навык: копит заряд, раз за бой. */
  ult?: boolean;
  /** Лечение снимает проклятия: сколько (99 — все). */
  cleanse?: number;
  effect?: EffectSpec;
  /** Что делает — для телефона и инструкции. */
  text: string;
}

export interface God {
  id: string;
  name: string;
  role: RoleId;
  element: ElementId;
  /** Символ эмблемы (контурная картинка). */
  emblem: string;
  symbols: string;
  weakness: string;
  /** Описание для страницы «История» на телефоне. */
  about: string;
  /** Характеристики 1-го уровня (сумма ~255). */
  stats: Stats;
  speed: number;
  abilities: [Ability, Ability, Ability];
  ult: Ability;
}

const s = (might: number, influence: number, wisdom: number, endurance: number, luck: number, cunning: number): Stats => ({ might, influence, wisdom, endurance, luck, cunning });

export const GODS: God[] = [
  {
    id: "zeus", name: "Зевс", role: "warrior", element: "bolt", emblem: "bolt",
    symbols: "орёл, молния, дуб, скипетр", weakness: "ревность Геры: против Геры и её союзников броски −10",
    about: "Царь богов и громовержец. Ведёт отряд прямо в бой и не любит ждать.",
    stats: s(65, 50, 40, 45, 30, 25), speed: 100,
    abilities: [
      { id: "zeus-1", name: "Разряд", kind: "strike", element: "bolt", stat: "might", power: 22, target: "foe", cooldown: 0, text: "Молния в одного врага." },
      { id: "zeus-2", name: "Гром небес", kind: "blast", element: "bolt", stat: "might", power: 12, target: "foes", cooldown: 2, text: "Гром бьёт всех врагов." },
      { id: "zeus-3", name: "Орлиный взор", kind: "bless", element: null, stat: "wisdom", power: 0, target: "allies", cooldown: 3, effect: { id: "eagle", name: "Орлиный взор", kind: "bless", turns: 2, roll: 10 }, text: "Отряд видит слабые места врага: +10 к броскам на 2 хода." },
    ],
    ult: { id: "zeus-u", name: "Гнев Олимпа", kind: "strike", element: "bolt", stat: "might", power: 60, target: "foe", cooldown: 0, ult: true, text: "Небо раскалывается: огромный удар молнией по одному врагу." },
  },
  {
    id: "poseidon", name: "Посейдон", role: "guardian", element: "water", emblem: "trident",
    symbols: "трезубец, конь, дельфин", weakness: "вспыльчив: после крит. неудачи следующий бросок −10",
    about: "Владыка морей. Стоит стеной перед отрядом, а волной сбивает врагов с ног.",
    stats: s(55, 35, 35, 65, 35, 30), speed: 90,
    abilities: [
      { id: "poseidon-1", name: "Удар трезубца", kind: "strike", element: "water", stat: "might", power: 18, target: "foe", cooldown: 0, text: "Трезубец в одного врага." },
      { id: "poseidon-2", name: "Морская стена", kind: "shield", element: null, stat: "endurance", power: 25, target: "allies", cooldown: 3, text: "Щит всему отряду." },
      { id: "poseidon-3", name: "Прилив", kind: "curse", element: "water", stat: "endurance", power: 8, target: "foes", cooldown: 3, effect: { id: "tide", name: "Прилив", kind: "curse", turns: 2, speed: -20 }, text: "Волна по всем врагам: урон и −20 к скорости на 2 хода." },
    ],
    ult: { id: "poseidon-u", name: "Землетрясение", kind: "blast", element: "earth", stat: "might", power: 35, target: "foes", cooldown: 0, ult: true, text: "Колебатель земли: сильный удар по всем врагам." },
  },
  {
    id: "hades", name: "Аид", role: "sorcerer", element: "dark", emblem: "bident",
    symbols: "двузубец, шлем-невидимка, кипарис", weakness: "в светлых храмах броски −10",
    about: "Владыка подземного мира. Знает тени по именам и проклинает так, что не отмолить.",
    stats: s(40, 40, 60, 40, 30, 45), speed: 95,
    abilities: [
      { id: "hades-1", name: "Пламя Тартара", kind: "strike", element: "fire", stat: "wisdom", power: 20, target: "foe", cooldown: 0, text: "Огонь из глубин в одного врага." },
      { id: "hades-2", name: "Тень Эреба", kind: "blast", element: "dark", stat: "wisdom", power: 11, target: "foes", cooldown: 2, text: "Тьма бьёт всех врагов." },
      { id: "hades-3", name: "Проклятие Стикса", kind: "curse", element: "dark", stat: "wisdom", power: 0, target: "foe", cooldown: 3, effect: { id: "styx", name: "Проклятие Стикса", kind: "curse", turns: 3, taken: 1.3 }, text: "Враг получает на 30% больше урона 3 хода." },
    ],
    ult: { id: "hades-u", name: "Суд мёртвых", kind: "blast", element: "dark", stat: "wisdom", power: 32, target: "foes", cooldown: 0, ult: true, text: "Тени судят всех врагов разом." },
  },
  {
    id: "athena", name: "Афина", role: "oracle", element: "light", emblem: "owl",
    symbols: "сова, олива, эгида", weakness: "гордость: против Ареса броски −10",
    about: "Богиня мудрости и справедливой войны. Видит исход боя раньше других.",
    stats: s(40, 50, 65, 45, 30, 30), speed: 100,
    abilities: [
      { id: "athena-1", name: "Копьё мудрости", kind: "strike", element: "light", stat: "wisdom", power: 18, target: "foe", cooldown: 0, text: "Копьё света в одного врага." },
      { id: "athena-2", name: "Эгида", kind: "shield", element: null, stat: "wisdom", power: 30, target: "ally", cooldown: 2, text: "Щит одному союзнику." },
      { id: "athena-3", name: "Мудрость Афины", kind: "bless", element: null, stat: "wisdom", power: 0, target: "ally", cooldown: 2, effect: { id: "wisdom", name: "Мудрость Афины", kind: "bless", turns: 2, roll: 10 }, text: "Союзник получает +10 к броскам на 2 хода." },
    ],
    ult: { id: "athena-u", name: "Победа Ники", kind: "bless", element: null, stat: "wisdom", power: 0, target: "allies", cooldown: 0, ult: true, effect: { id: "nike", name: "Победа Ники", kind: "bless", turns: 2, roll: 20 }, text: "Весь отряд получает +20 к броскам на 2 хода." },
  },
  {
    id: "hestia", name: "Гестия", role: "healer", element: "fire", emblem: "hearth",
    symbols: "очаг, факел, хлеб", weakness: "не любит раздоров: в спорах броски −10",
    about: "Хранительница очага. Пока горит её огонь, отряд встаёт после любой беды.",
    stats: s(30, 55, 55, 50, 35, 25), speed: 95,
    abilities: [
      { id: "hestia-1", name: "Жар очага", kind: "strike", element: "fire", stat: "wisdom", power: 16, target: "foe", cooldown: 0, text: "Огонь очага в одного врага." },
      { id: "hestia-2", name: "Тёплые руки", kind: "heal", element: null, stat: "wisdom", power: 25, target: "ally", cooldown: 1, cleanse: 1, text: "Лечит одного союзника и снимает одно проклятие." },
      { id: "hestia-3", name: "Общий стол", kind: "heal", element: null, stat: "influence", power: 14, target: "allies", cooldown: 3, text: "Лечит весь отряд." },
    ],
    ult: { id: "hestia-u", name: "Вечный огонь", kind: "heal", element: null, stat: "wisdom", power: 40, target: "allies", cooldown: 0, ult: true, cleanse: 99, text: "Сильное лечение всего отряда и снятие всех проклятий." },
  },
  {
    id: "hermes", name: "Гермес", role: "trickster", element: "wind", emblem: "caduceus",
    symbols: "крылатые сандалии, кадуцей, кошелёк", weakness: "любопытен: ловушки срабатывают на нём чаще",
    about: "Вестник богов, покровитель путников и хитрецов. Успевает дважды, пока другие думают.",
    stats: s(35, 45, 40, 30, 50, 60), speed: 125,
    abilities: [
      { id: "hermes-1", name: "Удар кадуцея", kind: "strike", element: "wind", stat: "cunning", power: 15, target: "foe", cooldown: 0, text: "Быстрый удар в одного врага." },
      { id: "hermes-2", name: "Попутный ветер", kind: "bless", element: null, stat: "cunning", power: 0, target: "allies", cooldown: 3, effect: { id: "tailwind", name: "Попутный ветер", kind: "bless", turns: 2, speed: 25 }, text: "Отряду +25 к скорости на 2 хода." },
      { id: "hermes-3", name: "Обман", kind: "curse", element: null, stat: "cunning", power: 0, target: "foe", cooldown: 3, effect: { id: "trick", name: "Обман", kind: "curse", turns: 1, skip: true }, text: "Враг путается и пропускает ход." },
    ],
    ult: { id: "hermes-u", name: "Кража огня", kind: "strike", element: "wind", stat: "cunning", power: 30, target: "foe", cooldown: 0, ult: true, effect: { id: "stolen", name: "Украденная сила", kind: "curse", turns: 2, stats: { might: -15 } }, text: "Сильный удар и −15 к Мощи врага на 2 хода." },
  },
  {
    id: "artemis", name: "Артемида", role: "warrior", element: "ice", emblem: "moon",
    symbols: "лук, лань, серебряный месяц", weakness: "не прощает обмана: против лжецов броски −10",
    about: "Охотница при луне. Стрела находит цель даже в метель.",
    stats: s(55, 30, 40, 35, 45, 45), speed: 110,
    abilities: [
      { id: "artemis-1", name: "Серебряная стрела", kind: "strike", element: "ice", stat: "might", power: 20, target: "foe", cooldown: 0, text: "Стрела в одного врага." },
      { id: "artemis-2", name: "Дождь стрел", kind: "blast", element: "ice", stat: "luck", power: 10, target: "foes", cooldown: 2, text: "Стрелы по всем врагам." },
      { id: "artemis-3", name: "Метка охотницы", kind: "curse", element: null, stat: "cunning", power: 0, target: "foe", cooldown: 3, effect: { id: "mark", name: "Метка охотницы", kind: "curse", turns: 2, taken: 1.25 }, text: "Врага легче ранить: +25% урона по нему 2 хода." },
    ],
    ult: { id: "artemis-u", name: "Лунная охота", kind: "strike", element: "ice", stat: "might", power: 55, target: "foe", cooldown: 0, ult: true, text: "Выстрел при полной луне в одного врага." },
  },
  {
    id: "hephaestus", name: "Гефест", role: "guardian", element: "earth", emblem: "anvil",
    symbols: "молот, наковальня, кузнечные клещи", weakness: "медлителен: скорость ниже всех",
    about: "Кузнец богов. Кует щиты прямо в бою и бьёт так, что звенит земля.",
    stats: s(55, 25, 45, 65, 30, 30), speed: 80,
    abilities: [
      { id: "hephaestus-1", name: "Удар молота", kind: "strike", element: "earth", stat: "might", power: 22, target: "foe", cooldown: 0, text: "Молот в одного врага." },
      { id: "hephaestus-2", name: "Кованый щит", kind: "shield", element: null, stat: "endurance", power: 40, target: "ally", cooldown: 2, text: "Крепкий щит одному союзнику." },
      { id: "hephaestus-3", name: "Раскалённый металл", kind: "curse", element: "fire", stat: "might", power: 8, target: "foe", cooldown: 3, effect: { id: "burn", name: "Ожог", kind: "curse", turns: 3, dot: 8 }, text: "Удар и ожог: −8 здоровья в начале хода 3 хода." },
    ],
    ult: { id: "hephaestus-u", name: "Доспех Олимпа", kind: "shield", element: null, stat: "endurance", power: 45, target: "allies", cooldown: 0, ult: true, text: "Щит всему отряду." },
  },
  {
    id: "ares", name: "Арес", role: "warrior", element: "chaos", emblem: "helm",
    symbols: "копьё, шлем, коршун", weakness: "безрассуден: после промаха сам получает урон",
    about: "Бог яростной битвы. Где он — там шум, кровь и победа любой ценой.",
    stats: s(70, 25, 25, 50, 40, 35), speed: 105,
    abilities: [
      { id: "ares-1", name: "Удар копья", kind: "strike", element: "chaos", stat: "might", power: 24, target: "foe", cooldown: 0, text: "Копьё в одного врага." },
      { id: "ares-2", name: "Боевой клич", kind: "bless", element: null, stat: "influence", power: 0, target: "allies", cooldown: 3, effect: { id: "warcry", name: "Боевой клич", kind: "bless", turns: 2, stats: { might: 10 } }, text: "Отряду +10 к Мощи на 2 хода." },
      { id: "ares-3", name: "Ярость", kind: "bless", element: null, stat: "might", power: 0, target: "self", cooldown: 3, effect: { id: "rage", name: "Ярость", kind: "bless", turns: 2, stats: { might: 20 }, taken: 1.2 }, text: "+20 к Мощи себе, но получает на 20% больше урона." },
    ],
    ult: { id: "ares-u", name: "Бойня", kind: "blast", element: "chaos", stat: "might", power: 38, target: "foes", cooldown: 0, ult: true, text: "Ярость войны обрушивается на всех врагов." },
  },
  {
    id: "apollo", name: "Аполлон", role: "healer", element: "poison", emblem: "lyre",
    symbols: "лира, лавр, солнечная колесница", weakness: "тщеславен: если смеются над ним — броски −10",
    about: "Бог света, музыки и врачевания. Его лира лечит, а стрелы несут мор.",
    stats: s(35, 55, 55, 40, 40, 30), speed: 100,
    abilities: [
      { id: "apollo-1", name: "Стрела мора", kind: "curse", element: "poison", stat: "wisdom", power: 12, target: "foe", cooldown: 0, effect: { id: "plague", name: "Мор", kind: "curse", turns: 2, dot: 6 }, text: "Стрела и яд: −6 здоровья в начале хода 2 хода." },
      { id: "apollo-2", name: "Песнь лиры", kind: "heal", element: null, stat: "influence", power: 22, target: "ally", cooldown: 1, cleanse: 1, text: "Лечит одного союзника и снимает одно проклятие." },
      { id: "apollo-3", name: "Лавровый венок", kind: "bless", element: null, stat: "influence", power: 0, target: "ally", cooldown: 3, effect: { id: "laurel", name: "Лавровый венок", kind: "bless", turns: 3, dot: -10 }, text: "Союзник восстанавливает 10 здоровья в начале хода 3 хода." },
    ],
    ult: { id: "apollo-u", name: "Солнце в зените", kind: "heal", element: null, stat: "wisdom", power: 30, target: "allies", cooldown: 0, ult: true, cleanse: 99, text: "Лечит весь отряд и снимает все проклятия." },
  },
];

export function godOf(id: string | null | undefined): God | undefined {
  return GODS.find((g) => g.id === id);
}

/** Все способности бога: три обычные и ульта. */
export function abilitiesOf(god: God): Ability[] {
  return [...god.abilities, god.ult];
}

export function abilityOf(id: string): { god: God; ability: Ability } | undefined {
  for (const god of GODS) {
    const ability = abilitiesOf(god).find((a) => a.id === id);
    if (ability) return { god, ability };
  }
  return undefined;
}
