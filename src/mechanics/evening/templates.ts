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
  /** Как делить гостей: режим, сколько команд и людей — показывается под программой и в инструкции ведущих. */
  setup: string;
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
    hint: "«Бой с драконом» → «Активная настолка» → квиз", setup: "Лучше командами: 3–6 команд по 3–8 человек — в настолке ходят по очереди. Каждый сам за себя — только до 10 гостей.",
    slots: [
      { mechanic: "dragon", look: ["classic"], label: "Бой с драконом" },
      { mechanic: "quest", look: ADULT_LOOKS, label: "Активная настолка (Классика или Вечеринка)" },
      { mechanic: "quiz", category: "quiz" },
    ],
  },
  {
    id: "trial-kids",
    title: "Детский пробный вечер",
    hint: "Детский «Бой с драконом» → «Сладкая страна» → детский квиз", setup: "Дети — командами по 3–6 с капитаном постарше, взрослые помогают, но не играют. До 8 детей — можно каждый сам.",
    slots: [
      { mechanic: "dragon", look: ["kids"], label: "Бой с драконом (детский)" },
      { mechanic: "quest", look: ["kids"], label: "Активная настолка (Детская)" },
      { mechanic: "quiz", category: "quiz", age: "0+", label: "Квиз 0+" },
    ],
  },
  {
    id: "kids-break",
    title: "Детский праздник с перерывом",
    hint: "Детский «Бой с драконом» → «Аквариум» (рисуем рыбок) → «Сладкая страна»", setup: "Командами по 3–6 детей. Нужен экран зала: в «Аквариуме» каждый рисует рыбку со своего телефона, и она плывёт на экране — команды не мешают.",
    slots: [
      { mechanic: "dragon", look: ["kids"], label: "Бой с драконом (детский)" },
      { mechanic: "aquarium" },
      { mechanic: "quest", look: ["kids"], label: "Активная настолка (Детская)" },
    ],
  },
  {
    id: "smart",
    title: "Интеллектуальный вечер",
    hint: "Квиз → «Ставка на знания» · два больших блока на эрудицию", setup: "Каждый сам — до 15 гостей; больше — команды по 4–6: обсуждают вместе, отвечает капитан.",
    slots: [{ mechanic: "quiz", category: "quiz" }, { mechanic: "board" }],
  },
  {
    id: "team-battle",
    title: "Командный батл",
    hint: "«Давайте знакомиться» → «Бой с драконом» → «Гонка на выживание» → «Активная настолка»", setup: "Только команды: 3–6 команд по 4–8 человек. Команды собираются при входе и играют весь вечер одним составом.",
    slots: [
      { mechanic: "story" },
      { mechanic: "dragon", look: ["classic"], label: "Бой с драконом" },
      { mechanic: "survival" },
      { mechanic: "quest", look: ADULT_LOOKS, label: "Активная настолка (Классика или Вечеринка)" },
    ],
  },
  {
    id: "new-year-show",
    title: "Новогоднее телешоу",
    hint: "«Что скажет большинство» → «Ставка на знания» → «Миллион на кону» · поставьте новогодние версии игр", setup: "Каждый сам — до 15 гостей; больше — команды по 4–8.",
    slots: [{ mechanic: "hundred" }, { mechanic: "board" }, { mechanic: "millionaire" }],
  },
  {
    id: "show-dance",
    title: "Шоу и танцы",
    hint: "Квиз → «Узнай по нотам» → «Танцуй как звезда» · командами, с экраном зала", setup: "Только команды и только с экраном зала (так требует «Танцуй как звезда»): 3–6 команд по 4–8 человек.",
    slots: [{ mechanic: "quiz", category: "quiz" }, { mechanic: "quiz", category: "music", label: "Узнай по нотам" }, { mechanic: "stage", variant: "dance", label: "Танцуй как звезда" }],
  },
  { id: "corp", title: "Корпоратив", hint: "Квиз → «Ставка на знания» → «Миллион на кону»", setup: "Каждый сам — до 15 гостей; больше — команды по 4–8.", slots: [{ mechanic: "quiz", category: "quiz" }, { mechanic: "board" }, { mechanic: "millionaire" }] },
  { id: "birthday", title: "День рождения", hint: "«Давайте знакомиться» → квиз → «Правда или действие»", setup: "Каждый сам — до 15 гостей; больше — команды по 4–8.", slots: [{ mechanic: "story" }, { mechanic: "quiz", category: "quiz" }, { mechanic: "truth" }] },
  { id: "music", title: "Музыкальный вечер", hint: "«Узнай по нотам» → музыкальное лото → танцевальный батл", setup: "Только команды (так требует танцевальный батл): 3–6 команд по 4–8 человек, с экраном зала.", slots: [{ mechanic: "quiz", category: "music" }, { mechanic: "lotto" }, { mechanic: "dance" }] },
  { id: "table", title: "Вечер настолок", hint: "«Кости лжеца» → «Мафия»", setup: "Только каждый сам за себя, 5–10 гостей: в «Костях лжеца» до 10 стаканов, «Мафии» нужно от 5.", slots: [{ mechanic: "perudo" }, { mechanic: "mafia" }] },
  {
    id: "intrigue",
    title: "Вечер интриг",
    hint: "«Шпион» → «Убежище» → «Мафия» · каждый сам за себя", setup: "Только каждый сам за себя, 5–20 гостей: «Мафии» нужно от 5, «Шпион» — до 20.",
    slots: [{ mechanic: "spy" }, { mechanic: "bunker" }, { mechanic: "mafia" }],
  },
  {
    id: "cards",
    title: "Карточный вечер",
    hint: "«Дурак» → «Кости лжеца» → «Мафия» · каждый сам за себя", setup: "Только каждый сам за себя, лучше 5–8 гостей: в «Дураке» до 6 мест (52 карты — до 8), в «Костях лжеца» до 10 стаканов. Гостей больше — берите «Вечер интриг».",
    slots: [{ mechanic: "durak" }, { mechanic: "perudo" }, { mechanic: "mafia" }],
  },
  {
    id: "dance",
    title: "Танцевальный вечер",
    hint: "Джаз-фанк → диско → латина → Танцуй как звезда", setup: "Только команды и только с экраном зала: 3–6 команд по 4–8 человек.",
    slots: [{ mechanic: "dance", style: "jazz" }, { mechanic: "dance", style: "disco" }, { mechanic: "dance", style: "latin" }, { mechanic: "stage", variant: "dance" }],
  },
  { id: "show", title: "Телешоу", hint: "«Ставка на знания» → «Гонка на выживание» → «Миллион на кону»", setup: "Каждый сам — до 15 гостей; больше — команды по 4–8.", slots: [{ mechanic: "board" }, { mechanic: "survival" }, { mechanic: "millionaire" }] },
];

/** Сколько блоков может быть в программе — для проверки шаблонов. */
export const TEMPLATE_MAX_BLOCKS = PROGRAM_LIMITS.maxBlocks;
