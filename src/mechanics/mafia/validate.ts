import type { ValidationError } from "../types";
import { familyCount, type MafiaContent } from "./content";

export function validateMafia(content: MafiaContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.roles === "custom" && familyCount(content.counts) === 0) errors.push({ path: "counts", message: "Нужна хотя бы одна Мафия, Дон или Адвокат." });
  if (!content.city.trim()) errors.push({ path: "city", message: "Напишите название города." });
  return errors;
}
