import type { ValidationError } from "../types";
import { allCells, type BoardContent } from "./content";

/** Что исправить перед запуском: путь `cells/<id клетки>/<поле>` или `board` для поля целиком. */
export function validateBoard(content: BoardContent): ValidationError[] {
  const errors: ValidationError[] = [];
  const cells = allCells(content);
  if (cells.length === 0) errors.push({ path: "board", message: "Добавьте хотя бы одну категорию с клетками." });
  content.categories.forEach((category, i) => {
    if (!category.title.trim()) errors.push({ path: `categories/${category.id}/title`, message: `Назовите категорию ${i + 1}.` });
  });
  for (const { cell, category } of cells) {
    const where = `«${category.title || "Категория"}», ${cell.points}`;
    if (cell.kind === "track" && !cell.trackId) errors.push({ path: `cells/${cell.id}/track`, message: `${where}: выберите трек.` });
    if (cell.kind === "picture" && !cell.imageId) errors.push({ path: `cells/${cell.id}/image`, message: `${where}: добавьте картинку.` });
    if ((cell.kind === "question" || cell.kind === "cat") && !cell.text.trim() && !cell.imageId) errors.push({ path: `cells/${cell.id}/text`, message: `${where}: напишите вопрос.` });
    if (!cell.answer.trim()) errors.push({ path: `cells/${cell.id}/answer`, message: `${where}: укажите правильный ответ — его увидит ведущий.` });
    if (cell.points <= 0) errors.push({ path: `cells/${cell.id}/points`, message: `${where}: стоимость должна быть больше нуля.` });
  }
  return errors;
}
