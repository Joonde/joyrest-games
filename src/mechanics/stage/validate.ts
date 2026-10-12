import { embedUrl } from "../dance/content";
import type { ValidationError } from "../types";
import type { StageContent } from "./content";

export function validateStage(content: StageContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.categories.length === 0) errors.push({ path: "categories", message: "Добавьте хотя бы одну категорию с плитками." });
  if (content.tiles.length === 0) errors.push({ path: "tiles", message: "На поле нет ни одной плитки." });
  content.categories.forEach((c, i) => {
    if (!c.title.trim()) errors.push({ path: `categories/${c.id}/title`, message: `Категория ${i + 1}: напишите название (видно на экране).` });
  });
  for (const t of content.tiles) {
    const where = `Плитка ${t.points}`;
    if (t.video.source === "link" && !t.video.url.trim()) errors.push({ path: `tiles/${t.id}/video`, message: `${where}: вставьте ссылку на видео или выберите «Без видео».` });
    else if (t.video.source === "link" && !embedUrl(t.video.url)) errors.push({ path: `tiles/${t.id}/video`, message: `${where}: ссылка должна вести на ролик YouTube, VK Видео или Rutube.` });
  }
  return errors;
}
