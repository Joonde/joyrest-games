import type { ValidationError } from "../types";
import { embedUrl } from "../dance/content";
import { QUEST_LIMITS, type QuestContent } from "./content";

export function validateQuest(content: QuestContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.cells.length < QUEST_LIMITS.minCells) errors.push({ path: "cells", message: `На поле нужно хотя бы ${QUEST_LIMITS.minCells} клеток.` });
  content.cells.forEach((c, i) => {
    const where = `Клетка ${i + 1}`;
    if ((c.kind === "task" || c.kind === "question") && !c.text.trim()) errors.push({ path: `cells/${c.id}/text`, message: `${where}: напишите ${c.kind === "question" ? "вопрос" : "задание"}.` });
    if (c.kind === "question" && !c.answer.trim()) errors.push({ path: `cells/${c.id}/answer`, message: `${where}: укажите ответ для ведущего.` });
    if ((c.kind === "dance" || c.kind === "karaoke") && !c.text.trim() && !c.videoUrl && !c.trackId) errors.push({ path: `cells/${c.id}/text`, message: `${where}: напишите, что исполнить, или добавьте видео или трек.` });
    if ((c.kind === "bonus" || c.kind === "trap") && c.move === 0) errors.push({ path: `cells/${c.id}/move`, message: `${where}: укажите, на сколько клеток сдвинуть.` });
    if (c.videoUrl && !embedUrl(c.videoUrl)) errors.push({ path: `cells/${c.id}/video`, message: `${where}: ссылка должна вести на ролик YouTube, VK Видео или Rutube.` });
  });
  return errors;
}
