import type { ValidationError } from "../types";
import { embedUrl, KIND_TITLES, type DanceContent } from "./content";

export function validateDance(content: DanceContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.cards.length === 0) errors.push({ path: "cards", message: "Добавьте хотя бы одну карточку: батл, танец или караоке." });
  content.cards.forEach((c, i) => {
    const where = `Карточка ${i + 1} (${KIND_TITLES[c.kind]})`;
    // Без видео и трека можно, если есть название: музыку ведущий включает сам (колонка, телефон).
    if (c.video.source === "none" && !c.trackId && !c.title.trim()) errors.push({ path: `cards/${c.id}/title`, message: `${where}: добавьте название, видео или трек.` });
    if (c.video.source === "link" && !embedUrl(c.video.url)) errors.push({ path: `cards/${c.id}/video`, message: `${where}: ссылка должна вести на ролик YouTube, VK Видео или Rutube.` });
  });
  return errors;
}
