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
  /** Цель перелёта (финиш), родительный падеж: «до ёлки на площади». */
  goal: string;
  /** Цель перелёта — подпись на экране зала: «Ёлка на площади». */
  goalTitle: string;
  /** Беда «Притяжения» — заголовок события. */
  pull: string;
  /** Чем подают «Сигнал SOS»: «огни маяка». */
  sos: string;
  /** Название темы для экрана зала: «Новый год». */
  title: string;
  /** Призыв в лобби экрана зала: «Садитесь в сани!». */
  board: string;
}

export const THEME_WORDS: Record<Theme, ThemeWords> = {
  space: { ship: "корабль", shipGen: "корабля", plural: false, fem: false, goal: "станции «Пончик»", goalTitle: "Станция «Пончик»", pull: "Чёрная дыра тянет!", sos: "огни маяка", title: "Космос", board: "Все на борт!" },
  pirates: { ship: "парусник", shipGen: "парусника", plural: false, fem: false, goal: "острова с сундуком", goalTitle: "Остров с сундуком", pull: "Кракен тянет назад!", sos: "флажки", title: "Пираты", board: "Поднимайтесь на борт!" },
  newyear: { ship: "сани", shipGen: "саней", plural: true, fem: false, goal: "ёлки на площади", goalTitle: "Ёлка на площади", pull: "Снежный ком догоняет!", sos: "огоньки гирлянды", title: "Новый год", board: "Садитесь в сани!" },
  submarine: { ship: "субмарина", shipGen: "субмарины", plural: false, fem: true, goal: "затонувшего корабля", goalTitle: "Затонувший корабль", pull: "Осьминог тянет назад!", sos: "фонари", title: "Подводный мир", board: "Задраить люки!" },
  wedding: { ship: "воздушный шар", shipGen: "воздушного шара", plural: false, fem: false, goal: "свадебного торта", goalTitle: "Свадебный торт", pull: "Грозовая туча тянет!", sos: "букеты", title: "Свадьба", board: "Все в корзину шара!" },
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
