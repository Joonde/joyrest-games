/** Тексты телефона «Игр Матрёшки» — на «ты» (решение владельца по виду, 14 ноября 2026). */
import type { TrialKind } from "../rules/types";

export const TRIAL_TITLES: Record<TrialKind, string> = {
  freeze: "Замри!",
  ginger: "Пряник",
  chairs: "Стулья",
  rope: "Канат",
  hopscotch: "Классики",
};

/** Коротко правило испытания — для тех, кто не смотрит на экран (на экране — крупно и с примером). */
export const TRIAL_RULES: Record<TrialKind, string> = {
  freeze: "Держи палец на нижней половине экрана — бежишь. Матрёшка обернётся — сразу отпусти. Поймает — откатишься назад.",
  ginger: "Выбери коробку, потом обведи фигуру пальцем по светлой полосе. Сорвёшься с полосы — пряник треснет.",
  chairs: "Танцуй, пока играет музыка. Музыка оборвётся — появятся стулья: коснись любого. Кто быстрее — тот сел.",
  rope: "Две стороны тянут канат. Жми на узел часто-часто — чья сторона перетянет, та и победила.",
  hopscotch: "В каждом ряду одна клетка крепкая, другая — тонкий лёд. Выбирай: влево или вправо. Смельчаки прыгают первыми.",
};

/** Что угадывают болельщики (решение владельца 3): сколько ошибутся. */
export const GUESS_TITLES: Record<TrialKind, string> = {
  freeze: "Сколько поймают?",
  ginger: "Сколько пряников треснет?",
  chairs: "Сколько прозевают стул?",
  rope: "",
  hopscotch: "Сколько провалятся?",
};

export const GUESS_HINTS: Record<TrialKind, string> = {
  freeze: "Сколько игроков Матрёшка поймает хотя бы раз?",
  ginger: "У скольких игроков пряник треснет?",
  chairs: "Сколько игроков прозевают стул в первом заходе — сядут позже чем через 1 секунду или не сядут вовсе?",
  rope: "",
  hopscotch: "Сколько игроков провалятся под лёд?",
};

export const GUESS_UNITS: Record<TrialKind, string> = {
  freeze: "поймают",
  ginger: "треснут",
  chairs: "прозевают",
  rope: "",
  hopscotch: "провалятся",
};

export const SIDE_NAMES = ["Коралловые", "Шалфейные"] as const;

/** «1 игрок», «2 игрока», «5 игроков». */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
