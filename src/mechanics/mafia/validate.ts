import type { ValidationError } from "../types";
import type { MafiaContent } from "./content";

export function validateMafia(content: MafiaContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.roles === "custom" && content.counts.mafia + content.counts.don === 0) errors.push({ path: "counts", message: "Нужна хотя бы одна мафия или Дон." });
  if (!content.city.trim()) errors.push({ path: "city", message: "Напишите название города." });
  return errors;
}
