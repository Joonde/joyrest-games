// Категории игр в библиотеке: чтобы не листать длинный список, игры собраны в разделы, раздел
// раскрывается касанием. Категория выводится из механики (квиз с треками — музыкальный), в базе
// ничего не хранится: новая игра сама попадает в свой раздел.
import { trackIds, parseContent as parseQuiz } from "./quiz/content";

export type CategoryId = "quiz" | "music" | "tv" | "adventure" | "cards" | "social" | "active" | "other";

export interface Category {
  id: CategoryId;
  title: string;
  icon: string;
  hint: string;
}

/** Порядок разделов на экране. */
export const CATEGORIES: Category[] = [
  { id: "quiz", title: "Квизы", icon: "🧠", hint: "Вопросы на экране, ответы на телефонах" },
  { id: "music", title: "Музыкальные", icon: "🎵", hint: "«Угадай мелодию», музыкальное лото" },
  { id: "tv", title: "Телешоу", icon: "📺", hint: "«Своя игра», «Миллионер», «Гонка на выживание»" },
  { id: "adventure", title: "Приключения и настолки", icon: "🎲", hint: "Настолка, шашки, «Бой с драконом»" },
  { id: "cards", title: "Карточные игры", icon: "🃏", hint: "«Мафия», «Правда или действие» и другие игры с картами" },
  { id: "social", title: "Знакомство и общение", icon: "🤝", hint: "«Давайте знакомиться» — игры, чтобы узнать друг друга" },
  { id: "active", title: "Танцы и активные", icon: "💃", hint: "Танцевальный батл, караоке" },
  { id: "other", title: "Другие игры", icon: "✨", hint: "Всё остальное" },
];

const BY_MECHANIC: Record<string, CategoryId> = {
  quiz: "quiz",
  lotto: "music",
  board: "tv",
  millionaire: "tv",
  survival: "tv",
  quest: "adventure",
  checkers: "adventure",
  dragon: "adventure",
  dance: "active",
  mafia: "cards",
  truth: "cards",
  story: "social",
};

/** Квиз про музыку: в названии мелодия, песни, музыка (шаблон «Угадай мелодию» — ещё без треков). */
const MUSIC_TITLE = /мелод|музык|песн|хит/i;

/** Раздел игры: квиз с треками или про музыку по названию — музыкальный («Угадай мелодию»). */
export function categoryOf(game: { mechanic: string | null; content: unknown; title?: string }): CategoryId {
  const id = BY_MECHANIC[game.mechanic ?? ""] ?? "other";
  if (id === "quiz" && (MUSIC_TITLE.test(game.title ?? "") || trackIds(parseQuiz(game.content)).length > 0)) return "music";
  return id;
}

/** Игры по разделам в порядке CATEGORIES; пустые разделы не показываются. */
export function groupByCategory<T extends { mechanic: string | null; content: unknown; title?: string }>(games: T[]): Array<{ category: Category; games: T[] }> {
  const groups = new Map<CategoryId, T[]>();
  for (const g of games) {
    const id = categoryOf(g);
    groups.set(id, [...(groups.get(id) ?? []), g]);
  }
  return CATEGORIES.filter((c) => groups.has(c.id)).map((c) => ({ category: c, games: groups.get(c.id) ?? [] }));
}
