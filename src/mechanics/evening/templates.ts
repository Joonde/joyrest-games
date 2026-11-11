// Готовые программы «Мероприятия из блоков»: какие игры по порядку и как их найти среди своих игр и библиотеки.
// Каждая программа должна запускаться: игры не из `NOT_IN_EVENING`, 1–5 блоков, режимы сочетаются
// (нельзя смешать «только каждый сам» и «только команды») — это проверяет `templates.test.ts`.
import { PROGRAM_LIMITS } from "../../core/program";
import type { AgeRating, Game } from "../../data/types";
import { mechanicTitle } from "../registry";
import { categoryOf, type CategoryId } from "../categories";
import { parseDance } from "../dance/content";
import { mainStyle, styleById } from "../dance/styles";

export interface TemplateSlot {
  /** Механика игры блока. */
  mechanic: string;
  /** Раздел библиотеки («music» — музыкальный квиз). */
  category?: CategoryId;
  /** Стиль танца (у батла). */
  style?: string;
  /** Вариант («Танцуй как звезда» или «Караоке на поле»). */
  variant?: string;
  /** Вид поля или арены (`content.style` «Активной настолки» и «Боя с драконом»): подходит любой из списка. */
  look?: string[];
  /** Возраст игры (`ageRating`). */
  age?: AgeRating;
  /** Как назвать слот в «Не нашлось игр: …», если название механики неточно («Бой с драконом (детский)»). */
  label?: string;
}

export interface Template {
  id: string;
  title: string;
  hint: string;
  slots: TemplateSlot[];
}

/** Слот программы подходит игре: механика, раздел, стиль танца, вариант, вид поля и возраст. */
export function fits(game: Pick<Game, "mechanic" | "content" | "ageRating" | "title">, slot: TemplateSlot): boolean {
  if (game.mechanic !== slot.mechanic) return false;
  if (slot.category && categoryOf(game) !== slot.category) return false;
  if (slot.style && mainStyle(parseDance(game.content).cards) !== slot.style) return false;
  const raw = game.content as { variant?: unknown; style?: unknown } | null;
  if (slot.variant && (raw?.variant ?? "dance") !== slot.variant) return false;
  if (slot.look) {
    const look = typeof raw?.style === "string" ? raw.style : "classic";
    if (!slot.look.includes(look)) return false;
  }
  if (slot.age && game.ageRating !== slot.age) return false;
  return true;
}

/** Название слота для подсказки «Не нашлось игр: …». */
export function slotLabel(slot: TemplateSlot): string {
  if (slot.label) return slot.label;
  if (slot.style) return `${mechanicTitle(slot.mechanic)} (${styleById(slot.style)?.title ?? slot.style})`;
  return mechanicTitle(slot.mechanic);
}

const ADULT_LOOKS = ["classic", "party"];

export const TEMPLATES: Template[] = [
  {
    id: "trial",
    title: "Пробный вечер",
    hint: "«Бой с драконом» → «Активная настолка» → квиз",
    slots: [
      { mechanic: "dragon", look: ["classic"], label: "Бой с драконом" },
      { mechanic: "quest", look: ADULT_LOOKS, label: "Активная настолка (Классика или Вечеринка)" },
      { mechanic: "quiz", category: "quiz" },
    ],
  },
  {
    id: "trial-kids",
    title: "Детский пробный вечер",
    hint: "Детский «Бой с драконом» → «Сладкая страна» → детский квиз",
    slots: [
      { mechanic: "dragon", look: ["kids"], label: "Бой с драконом (детский)" },
      { mechanic: "quest", look: ["kids"], label: "Активная настолка (Детская)" },
      { mechanic: "quiz", category: "quiz", age: "0+", label: "Квиз 0+" },
    ],
  },
  { id: "corp", title: "Корпоратив", hint: "Квиз → «Ставка на знания» → «Миллион на кону»", slots: [{ mechanic: "quiz", category: "quiz" }, { mechanic: "board" }, { mechanic: "millionaire" }] },
  { id: "birthday", title: "День рождения", hint: "«Давайте знакомиться» → квиз → «Правда или действие»", slots: [{ mechanic: "story" }, { mechanic: "quiz", category: "quiz" }, { mechanic: "truth" }] },
  { id: "music", title: "Музыкальный вечер", hint: "«Узнай по нотам» → музыкальное лото → танцевальный батл", slots: [{ mechanic: "quiz", category: "music" }, { mechanic: "lotto" }, { mechanic: "dance" }] },
  { id: "table", title: "Вечер настолок", hint: "«Кости лжеца» → «Мафия»", slots: [{ mechanic: "perudo" }, { mechanic: "mafia" }] },
  {
    id: "intrigue",
    title: "Вечер интриг",
    hint: "«Шпион» → «Убежище» → «Мафия» · каждый сам за себя",
    slots: [{ mechanic: "spy" }, { mechanic: "bunker" }, { mechanic: "mafia" }],
  },
  {
    id: "dance",
    title: "Танцевальный вечер",
    hint: "Джаз-фанк → диско → латина → Танцуй как звезда",
    slots: [{ mechanic: "dance", style: "jazz" }, { mechanic: "dance", style: "disco" }, { mechanic: "dance", style: "latin" }, { mechanic: "stage", variant: "dance" }],
  },
  { id: "show", title: "Телешоу", hint: "«Ставка на знания» → «Гонка на выживание» → «Миллион на кону»", slots: [{ mechanic: "board" }, { mechanic: "survival" }, { mechanic: "millionaire" }] },
];

/** Сколько блоков может быть в программе — для проверки шаблонов. */
export const TEMPLATE_MAX_BLOCKS = PROGRAM_LIMITS.maxBlocks;
