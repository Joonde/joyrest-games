/**
 * Личная карточка гостя для сторис (решение владельца 31 октября 2026): что написать на картинке.
 * Рисует её сам телефон гостя (`src/components/live/StoryCard.tsx`), сервер не участвует.
 * У победителя — «1 место 🏆», у призёров — их место с медалью, у остальных — «Я играл(а) в квиз JoyRest!»,
 * чтобы делиться хотелось всем, а не только первому месту.
 */
import { splitEmoji } from "./emoji";

export interface StoryCardInput {
  /** Имя из таблицы, со смайликом в начале («🦉 Совы»). */
  name: string;
  teams: boolean;
  place: number;
  total: number;
  /** Название игры, как назвал ведущий. */
  gameTitle: string;
  /** Название формата из реестра механик («Квиз», «Музыкальное лото»); null — не знаем. */
  formatTitle: string | null;
  /** id механики: от него зависит «в квиз» / «в музыкальное лото» / «в игру». */
  mechanic: string | null;
  /** Когда шла игра; null — сегодня. */
  playedAt: number | null;
}

export interface StoryCardText {
  /** Крупный смайлик игрока или команды (если выбрали). */
  emoji: string | null;
  /** «Команда «Совы»» или «Аня». */
  who: string;
  /** Главная строка: «1 место 🏆», «2 место 🥈» или «Я играл(а) в квиз JoyRest!». */
  headline: string;
  /** Призовое место — крупной цифрой на карточке. */
  medal: "gold" | "silver" | "bronze" | null;
  /** Цифра призового места и подпись под ней («место 🏆») — для крупного вида на картинке. */
  placeNumber: number | null;
  placeWord: string;
  /** «Квиз «Новогодний переполох» · 31.10.2026». */
  game: string;
  /** Отдельно для картинки: название и дата. */
  gameTitle: string;
  date: string;
  footer: string;
  /** Подпись к картинке в меню «Поделиться». */
  shareText: string;
  /** Имя файла картинки. */
  fileName: string;
  /** Подпись кнопки. */
  button: string;
}

export const STORY_FOOTER = "joy-rest.ru · t.me/JoyRest";

/** «в квиз», «в музыкальное лото» — во что играли (винительный падеж). */
const PLAYED_IN: Record<string, string> = {
  quiz: "квиз",
  wager: "квиз",
  lotto: "музыкальное лото",
  board: "телешоу",
  millionaire: "телешоу",
  hundred: "телешоу",
  dance: "танцевальный батл",
  stage: "танцевальную игру",
  mafia: "мафию",
};

/** «31.10.2026» по московскому времени. */
export function storyDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** «Квиз «Новогодний переполох»»; название уже начинается с формата — без повтора. */
export function storyGameTitle(gameTitle: string, formatTitle: string | null): string {
  const title = gameTitle.trim() || formatTitle || "Игра";
  if (!formatTitle || title === formatTitle) return title;
  const lower = title.toLocaleLowerCase("ru");
  if (lower.startsWith(formatTitle.toLocaleLowerCase("ru"))) return title;
  return `${formatTitle} «${title.replace(/^[«"]+|[»"]+$/g, "")}»`;
}

export function storyCardText(input: StoryCardInput, now = Date.now()): StoryCardText {
  const split = splitEmoji(input.name.trim());
  // Смайлик не из набора (имя с другого устройства, ручная правка) — тоже отдельно.
  const other = split.emoji ? null : /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s+(.+)$/u.exec(split.name);
  const emoji = split.emoji ?? other?.[1] ?? null;
  const name = other?.[2] ?? split.name;
  const clean = name.trim() || (input.teams ? "Команда" : "Игрок");
  const who = input.teams ? (/^команда(\s|$)/iu.test(clean) ? clean : `Команда «${clean}»`) : clean;
  const medal = input.place === 1 ? "gold" : input.place === 2 && input.total >= 3 ? "silver" : input.place === 3 && input.total >= 4 ? "bronze" : null;
  const what = (input.mechanic && PLAYED_IN[input.mechanic]) || "игру";
  const played = input.teams ? `Мы играли в ${what} JoyRest!` : `Я играл(а) в ${what} JoyRest!`;
  const headline =
    medal === "gold" ? "1 место 🏆" : medal === "silver" ? "2 место 🥈" : medal === "bronze" ? "3 место 🥉" : played;
  const title = storyGameTitle(input.gameTitle, input.formatTitle);
  const date = storyDate(input.playedAt ?? now);
  const game = `${title} · ${date}`;
  const shareText = medal === "gold" ? `🏆 ${who} — 1 место! ${game}` : medal ? `${who} — ${headline}. ${game}` : `${played} ${game}`;
  return {
    emoji,
    who,
    headline,
    medal,
    placeNumber: medal ? input.place : null,
    placeWord: medal === "gold" ? "место 🏆" : medal === "silver" ? "место 🥈" : medal === "bronze" ? "место 🥉" : "",
    game,
    gameTitle: title,
    date,
    footer: STORY_FOOTER,
    shareText: `${shareText}\njoy-rest.ru`,
    fileName: medal === "gold" ? "joyrest-pobeda.png" : "joyrest-igra.png",
    button:
      medal === "gold" ? "🏆 Поделиться победой" : medal === "silver" ? "🥈 Поделиться результатом" : medal === "bronze" ? "🥉 Поделиться результатом" : "📸 Поделиться карточкой",
  };
}
