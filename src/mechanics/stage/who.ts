// Кто выходит на плитку «Танцуй как звезда / Караоке на поле» (решение владельца 12 октября 2026): все составы до
// пяти человек — мужчины, женщины, любого пола, смешанные, вся команда; и батлы «кто против кого».
// Фигурки на экране рисуются по `figs`: m — мужчина, w — женщина, a — любой.

export type Fig = "m" | "w" | "a";

export interface Who {
  id: string;
  /** Полная подпись: «Танцуют 2 мужчины». */
  label: string;
  /** Коротко на поле и в конструкторе: «2 М». */
  short: string;
  group: "men" | "women" | "any" | "mixed" | "team";
  figs: Fig[];
}

const PLURAL_MEN = ["", "мужчина", "мужчины", "мужчины", "мужчины", "мужчин"];
const PLURAL_WOMEN = ["", "женщина", "женщины", "женщины", "женщины", "женщин"];
const PLURAL_ANY = ["", "любой участник", "любых участника", "любых участника", "любых участника", "любых участников"];
const rep = (f: Fig, n: number): Fig[] => Array.from({ length: n }, () => f);

function build(): Who[] {
  const list: Who[] = [];
  for (let n = 1; n <= 5; n++) list.push({ id: `m${n}`, label: `${n} ${PLURAL_MEN[n]}`, short: `${n} М`, group: "men", figs: rep("m", n) });
  for (let n = 1; n <= 5; n++) list.push({ id: `w${n}`, label: `${n} ${PLURAL_WOMEN[n]}`, short: `${n} Ж`, group: "women", figs: rep("w", n) });
  for (let n = 1; n <= 5; n++) list.push({ id: `a${n}`, label: `${n} ${PLURAL_ANY[n]}`, short: n === 1 ? "1 любой" : `${n} любых`, group: "any", figs: rep("a", n) });
  const mixed: Array<[number, number]> = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3], [3, 2], [2, 3], [4, 1], [1, 4]];
  for (const [m, w] of mixed) {
    const label = m === 1 && w === 1 ? "Мужчина и женщина" : `${m} ${PLURAL_MEN[m]} и ${w} ${PLURAL_WOMEN[w]}`;
    list.push({ id: `m${m}w${w}`, label, short: m === 1 && w === 1 ? "М + Ж" : `${m}М + ${w}Ж`, group: "mixed", figs: [...rep("m", m), ...rep("w", w)] });
  }
  list.push({ id: "team", label: "Вся команда", short: "Вся команда", group: "team", figs: ["m", "w", "a", "w", "m"] });
  list.push({ id: "team-w", label: "Девушки команды", short: "Девушки", group: "team", figs: ["w", "w", "w"] });
  list.push({ id: "team-m", label: "Мужчины команды", short: "Мужчины", group: "team", figs: ["m", "m", "m"] });
  return list;
}

export const WHO: Who[] = build();
export const WHO_GROUPS: Array<{ id: Who["group"]; title: string }> = [
  { id: "men", title: "Мужчины" },
  { id: "women", title: "Женщины" },
  { id: "any", title: "Любого пола" },
  { id: "mixed", title: "Смешанные" },
  { id: "team", title: "Команда" },
];

export interface Versus {
  id: string;
  label: string;
  short: string;
  /** Кто слева и справа — подписи на экране и телефоне. */
  leftLabel: string;
  rightLabel: string;
  left: Fig[];
  right: Fig[];
}

export const VERSUS: Versus[] = [
  { id: "m-w", leftLabel: "Мужчина", rightLabel: "Женщина", label: "Мужчина против женщины", short: "М vs Ж", left: ["m"], right: ["w"] },
  { id: "w-w", leftLabel: "Женщина", rightLabel: "Женщина", label: "Женщина против женщины", short: "Ж vs Ж", left: ["w"], right: ["w"] },
  { id: "m-m", leftLabel: "Мужчина", rightLabel: "Мужчина", label: "Мужчина против мужчины", short: "М vs М", left: ["m"], right: ["m"] },
  { id: "2w-2m", leftLabel: "Две девушки", rightLabel: "Двое мужчин", label: "Две девушки против двух мужчин", short: "2Ж vs 2М", left: ["w", "w"], right: ["m", "m"] },
  { id: "pair-pair", leftLabel: "Пара", rightLabel: "Пара", label: "Пара против пары", short: "Пара vs пара", left: ["m", "w"], right: ["m", "w"] },
  { id: "3-3", leftLabel: "Трое", rightLabel: "Трое", label: "Трое против троих", short: "3 vs 3", left: ["a", "a", "a"], right: ["a", "a", "a"] },
  { id: "team-team", leftLabel: "Команда", rightLabel: "Команда", label: "Команда против команды", short: "Команда vs команда", left: ["m", "w", "a"], right: ["w", "m", "a"] },
  { id: "cap-cap", leftLabel: "Капитан", rightLabel: "Капитан", label: "Капитан против капитана", short: "Капитаны", left: ["a"], right: ["a"] },
];

export function whoOf(id: string): Who {
  return WHO.find((w) => w.id === id) ?? (WHO.find((w) => w.id === "a2") as Who);
}

export function versusOf(id: string): Versus {
  return VERSUS.find((v) => v.id === id) ?? (VERSUS[0] as Versus);
}
