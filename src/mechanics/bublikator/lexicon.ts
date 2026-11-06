/**
 * Слова тем «Бубликатора» (ТЗ «Три игры», таблица «Оформление по темам»): чем летит экипаж, куда, что тянет назад в
 * «Притяжении», чем подают «Сигнал SOS». Одни и те же слова у телефона, экрана зала и пульта (2b–2d).
 */
import type { Theme } from "./rules/types";

export interface ThemeWords {
  /** Чем летит экипаж: «корабль», «сани». */
  ship: string;
  /** Тот же в родительном: «у корабля», «у саней». */
  shipGen: string;
  /** Множественное для глаголов: «корабль прибавил» / «сани прибавили». */
  plural: boolean;
  /** Женский род: «субмарина прибавила». */
  fem: boolean;
  /** Цель перелёта (финиш). */
  goal: string;
  /** Беда «Притяжения» — заголовок события. */
  pull: string;
  /** Чем подают «Сигнал SOS»: «огни маяка». */
  sos: string;
}

export const THEME_WORDS: Record<Theme, ThemeWords> = {
  space: { ship: "корабль", shipGen: "корабля", plural: false, fem: false, goal: "станции «Пончик»", pull: "Чёрная дыра тянет!", sos: "огни маяка" },
  pirates: { ship: "парусник", shipGen: "парусника", plural: false, fem: false, goal: "острова с сундуком", pull: "Кракен тянет назад!", sos: "флажки" },
  newyear: { ship: "сани", shipGen: "саней", plural: true, fem: false, goal: "ёлки на площади", pull: "Снежный ком догоняет!", sos: "огоньки гирлянды" },
  submarine: { ship: "субмарина", shipGen: "субмарины", plural: false, fem: true, goal: "затонувшего корабля", pull: "Осьминог тянет назад!", sos: "фонари" },
  wedding: { ship: "воздушный шар", shipGen: "воздушного шара", plural: false, fem: false, goal: "свадебного торта", pull: "Грозовая туча тянет!", sos: "букеты" },
};

export function wordsOf(theme: Theme): ThemeWords {
  return THEME_WORDS[theme] ?? THEME_WORDS.space;
}

/** «Корабль прибавил» / «субмарина прибавила» / «сани прибавили» (аудит 2b, №10: у субмарины был мужской род). */
export function verb(w: ThemeWords, single: string, many: string, fem: string = single): string {
  return w.plural ? many : w.fem ? fem : single;
}

/** Первая буква заглавная: «Сани», «Корабль». */
export function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
