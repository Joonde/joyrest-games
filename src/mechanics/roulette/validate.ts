// Проверка игры перед запуском (паспорт, п. 7). Путь ошибки — themes/{themeId}/tasks/{taskId}/{поле}: конструктор
// открывает это место (joyrest:reveal-issues). Проверяются только задания, которые могут выпасть в этой игре: включённые,
// во включённой теме и подходящие под режим 18+ — выключенное задание не мешает запуску. Отрывок трека в пределах
// длины самого трека проверяет конструктор (длина известна только после загрузки трека); здесь — затухания.
import type { ValidationError } from "../types";
import { embedUrl } from "../dance/content";
import { catalogThemes, EFFECT_TITLES, LIMITS, RARITIES, READY_EFFECTS, type RouletteContent, type RouletteTask, type RouletteTheme } from "./content";

function taskErrors(theme: RouletteTheme, task: RouletteTask, n: number): ValidationError[] {
  const at = (field: string) => "themes/" + theme.id + "/tasks/" + task.id + "/" + field;
  const where = "«" + (theme.name || "Тема без названия") + "», задание " + n + (task.title ? " «" + task.title + "»" : "");
  const errors: ValidationError[] = [];
  const add = (field: string, message: string) => errors.push({ path: at(field), message: where + ": " + message });
  if (!task.title) add("title", "впишите название — его видно на экране.");
  if (!task.text) add("text", "впишите текст задания.");
  if ((task.alcohol || task.sport) && !task.alt) add("alt", task.alcohol ? "задание с напитком — впишите безалкогольную замену." : "спортивное задание — впишите безопасную замену.");
  const filled = task.options.filter((o) => o.length > 0);
  switch (task.kind) {
    case "choice":
    case "speed":
      if (task.options.length < LIMITS.minOptions || filled.length !== task.options.length) add("options", "нужно от 2 до 6 заполненных вариантов.");
      if (task.correct.length === 0) add("correct", "отметьте правильный вариант.");
      break;
    case "order":
      if (task.options.length < LIMITS.minOrder || filled.length !== task.options.length) add("options", "нужно от 3 до 6 заполненных карточек в верном порядке.");
      break;
    case "open":
      if (!task.answers.some((a) => a.length > 0)) add("answers", "впишите хотя бы один верный ответ.");
      break;
    case "pictures":
      if (task.pictures.length < LIMITS.minPictures) add("pictures", "нужно от 2 до 4 картинок.");
      task.pictures.forEach((p, i) => {
        if (!p.imageId) add("pictures/" + i + "/image", "добавьте картинку " + (i + 1) + ".");
        if (!p.answers.some((a) => a.length > 0)) add("pictures/" + i + "/answers", "впишите ответ к картинке " + (i + 1) + ".");
      });
      break;
    case "number":
      if (task.numberAnswer === null) add("numberAnswer", "впишите верное число.");
      break;
    case "bonus":
      if (!READY_EFFECTS.has(task.effect)) add("effect", "бонус «" + EFFECT_TITLES[task.effect] + "» появится позже — сейчас работает «" + EFFECT_TITLES.extraSpin + "».");
      break;
    default:
      break;
  }
  if (task.video.source === "link" && !embedUrl(task.video.url)) add("video", "ссылка должна вести на ролик YouTube, VK Видео или Rutube.");
  if (task.video.source === "server" && !task.video.url) add("video", "выберите видео JoyRest или «Без видео».");
  if (task.clip.trackId && task.clip.fadeIn + task.clip.fadeOut > task.clip.length) add("clip", "плавное начало и затухание длиннее отрывка (" + task.clip.length + " с).");
  if (task.answerMusic && task.answerMusic.fadeIn + task.answerMusic.fadeOut > task.answerMusic.length) add("answerMusic", "в музыке на ответ затухания длиннее отрывка.");
  return errors;
}

export function validateRoulette(content: RouletteContent): ValidationError[] {
  const errors: ValidationError[] = [];
  const sum = RARITIES.reduce((s, r) => s + content.weights[r], 0);
  if (sum !== 100) errors.push({ path: "rarity/weights", message: "Сумма шансов редкостей должна быть ровно 100 % (сейчас " + sum + " %)." });
  if (content.themes.length > LIMITS.maxThemes) errors.push({ path: "themes", message: "Тем не больше " + LIMITS.maxThemes + " (сейчас " + content.themes.length + "): уберите лишние." });
  const ready = catalogThemes(content).length;
  if (ready < LIMITS.minThemes) {
    errors.push({
      path: "themes",
      message:
        "Нужно хотя бы " + LIMITS.minThemes + " включённые темы с заданиями, которые могут выпасть (сейчас " + ready + ")" + (content.adult ? "." : ": задания 18+ без режима 18+ не считаются."),
    });
  }
  for (const theme of content.themes) {
    if (!theme.active) continue;
    if (!theme.name) errors.push({ path: "themes/" + theme.id + "/name", message: "У темы нет названия." });
    let n = 0;
    for (const task of theme.tasks) {
      n++;
      if (!task.active || (task.adult && !content.adult)) continue;
      errors.push(...taskErrors(theme, task, n));
    }
  }
  return errors;
}
