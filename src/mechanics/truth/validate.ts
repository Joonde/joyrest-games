import type { ValidationError } from "../types";
import { deckOf, type TruthContent } from "./content";

export function validateTruth(content: TruthContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (deckOf(content, "truth").length === 0) errors.push({ path: "cards", message: "Добавьте хотя бы одну карточку «Правда»." });
  if (deckOf(content, "dare").length === 0) errors.push({ path: "cards", message: "Добавьте хотя бы одну карточку «Действие»." });
  content.cards.forEach((c, i) => {
    if (!c.text.trim()) errors.push({ path: `cards/${c.id}/text`, message: `Карточка ${i + 1}: напишите текст.` });
  });
  return errors;
}
