// Слайды-шаблоны экрана зала (CLAUDE.md, раздел 7, «Слайды»): что можно показать между играми
// и какие поля у каждого шаблона. Тексты по умолчанию ведущий правит на пульте.
import type { SlideKind, SlideState } from "../data/types";

export interface SlideTemplate {
  kind: SlideKind;
  /** Название шаблона на пульте. */
  label: string;
  /** Какие поля показывать в редакторе. */
  fields: { title: string; text?: string; lines?: string; minutes?: boolean };
  defaults: { title: string; text: string; lines: string[]; minutes?: number };
}

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  {
    kind: "intro",
    label: "Заставка",
    fields: { title: "Название вечера", text: "Подзаголовок" },
    defaults: { title: "Добро пожаловать!", text: "Сегодня играем вместе с JoyRest", lines: [] },
  },
  {
    kind: "rules",
    label: "Правила",
    fields: { title: "Заголовок", lines: "Правила — каждое с новой строки" },
    defaults: {
      title: "Правила игры",
      text: "",
      lines: [
        "Отвечайте с телефона — вопросы на экране",
        "Чем быстрее верный ответ, тем больше очков",
        "Подсказывать соседям можно, но тихо",
        "Ведущий всегда прав",
      ],
    },
  },
  {
    kind: "round",
    label: "Раунд",
    fields: { title: "Название раунда", text: "Подпись" },
    defaults: { title: "Раунд 2", text: "Готовьте телефоны!", lines: [] },
  },
  {
    kind: "break",
    label: "Перерыв",
    fields: { title: "Заголовок", text: "Подпись", minutes: true },
    defaults: { title: "Перерыв", text: "Скоро продолжим — не уходите далеко", lines: [], minutes: 10 },
  },
  {
    kind: "award",
    label: "Награждение",
    fields: { title: "Заголовок", text: "Подпись" },
    defaults: { title: "Награждение", text: "Встречаем победителей!", lines: [] },
  },
  {
    kind: "thanks",
    label: "Спасибо",
    fields: { title: "Заголовок", text: "Подпись" },
    defaults: { title: "Спасибо за игру!", text: "Ваш вечер провела команда JoyRest", lines: [] },
  },
  {
    kind: "custom",
    label: "Свой слайд",
    fields: { title: "Заголовок", text: "Текст" },
    defaults: { title: "", text: "", lines: [] },
  },
];

export function slideTemplate(kind: SlideKind): SlideTemplate {
  return SLIDE_TEMPLATES.find((t) => t.kind === kind) ?? (SLIDE_TEMPLATES[SLIDE_TEMPLATES.length - 1] as SlideTemplate);
}

/** Пункты из текста поля: строка — пункт, пустые убираются. */
export function linesFromText(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** Сколько осталось до конца перерыва: «9:05»; null — без отсчёта, «0:00» — время вышло. */
export function countdownLabel(slide: Pick<SlideState, "endsAt">, serverNow: number): string | null {
  if (slide.endsAt === null) return null;
  const left = Math.max(0, Math.ceil((slide.endsAt - serverNow) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
