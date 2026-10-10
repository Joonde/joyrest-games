// «Олимп» — противники пробной истории. Обычные — 2–4 способности, боссы — 5–8.
// Здоровье дано на отряд из 4 богов и масштабируется по числу богов в бою (`scaledHp`).
import type { EffectSpec } from "./gods";
import type { ElementId, Rank } from "./rules";
import { resistOf } from "./rules";

export type FoeAbilityKind = "strike" | "blast" | "heal" | "armor" | "curse" | "curseAll";

export interface FoeAbility {
  id: string;
  name: string;
  kind: FoeAbilityKind;
  /** Урон или лечение. */
  power: number;
  effect?: EffectSpec;
  /** Коротко для экрана: «урон всем», «лечится». */
  hint: string;
}

export interface Foe {
  id: string;
  name: string;
  rank: Rank;
  boss: boolean;
  element: ElementId;
  /** Здоровье на отряд из 4 богов. */
  hp: number;
  speed: number;
  /** Сколько драхм делят победители. */
  coins: number;
  /** Сопротивления в % (100 — обычный урон); по умолчанию — из стихии. */
  resist: Record<ElementId, number>;
  /** Способности по порядку: противник ходит по кругу (видно, что он «готовит»). */
  abilities: FoeAbility[];
  /** Картинка выхода (ключ в public/olymp). */
  image: string;
  about: string;
}

export const FOES: Foe[] = [
  {
    id: "wolves", name: "Стая ледяных волков", rank: "D", boss: false, element: "ice", hp: 160, speed: 105, coins: 30,
    resist: resistOf("ice"), image: "wolves", about: "Голодная стая, что пришла с зимой. Вожак светится инеем.",
    abilities: [
      { id: "w-bite", name: "Укус вожака", kind: "strike", power: 14, hint: "урон одному" },
      { id: "w-howl", name: "Вой стаи", kind: "curseAll", power: 0, hint: "−10 к броскам всем", effect: { id: "howl", name: "Вой стаи", kind: "curse", turns: 1, roll: -10 } },
      { id: "w-pack", name: "Стая окружает", kind: "blast", power: 8, hint: "урон всем" },
    ],
  },
  {
    id: "shades", name: "Тени Ахерона", rank: "C", boss: false, element: "dark", hp: 200, speed: 95, coins: 40,
    resist: resistOf("dark"), image: "shades", about: "Безликие тени, что уводят живых к реке.",
    abilities: [
      { id: "s-touch", name: "Холодное касание", kind: "strike", power: 16, hint: "урон одному" },
      { id: "s-forget", name: "Забвение", kind: "curse", power: 0, hint: "проклятие на одного", effect: { id: "forget", name: "Забвение", kind: "curse", turns: 2, stats: { wisdom: -15 } } },
      { id: "s-drain", name: "Пьют тепло", kind: "heal", power: 20, hint: "лечится" },
      { id: "s-mist", name: "Туман реки", kind: "blast", power: 9, hint: "урон всем" },
    ],
  },
  {
    id: "devourer", name: "Пожиратель зимы", rank: "B", boss: true, element: "ice", hp: 300, speed: 130, coins: 80,
    resist: resistOf("ice"), image: "boss", about: "Осколок первичного Хаоса. Пожирает души и тепло; на лбу горит метка Тёмного мира.",
    abilities: [
      { id: "d-howl", name: "Ледяной вой", kind: "blast", power: 12, hint: "урон всем" },
      { id: "d-claw", name: "Удар когтем", kind: "strike", power: 22, hint: "урон одному" },
      { id: "d-cold", name: "Проклятие холода", kind: "curse", power: 0, hint: "проклятие на одного", effect: { id: "cold", name: "Проклятие холода", kind: "curse", turns: 2, roll: -10 } },
      { id: "d-soul", name: "Пожирает душу", kind: "heal", power: 20, hint: "лечится" },
      { id: "d-armor", name: "Ледяная броня", kind: "armor", power: 0, hint: "урон по нему ×0,7", effect: { id: "icearmor", name: "Ледяная броня", kind: "bless", turns: 2, taken: 0.7 } },
      { id: "d-numb", name: "Оцепенение", kind: "curseAll", power: 0, hint: "−15 к броскам всем", effect: { id: "numb", name: "Оцепенение", kind: "curse", turns: 1, roll: -15 } },
      { id: "d-shades", name: "Зовёт тени", kind: "curse", power: 6, hint: "яд на одного", effect: { id: "poison", name: "Яд", kind: "curse", turns: 2, dot: 8 } },
    ],
  },
];

export function foeOf(id: string | null | undefined): Foe | undefined {
  return FOES.find((f) => f.id === id);
}

/** Здоровье противника под отряд: на 4 бога — как в карточке, на каждого следующего +25%, меньше — −20%. */
export function scaledHp(foe: Foe, gods: number): number {
  const n = Math.max(1, gods);
  return Math.round(foe.hp * (1 + (n - 4) * (n > 4 ? 0.25 : 0.2)));
}
