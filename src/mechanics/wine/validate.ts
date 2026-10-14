import type { ValidationError } from "../types";
import type { WineContent } from "./content";

export function validateWine(content: WineContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.wines.length === 0) errors.push({ path: "wines", message: "Добавьте хотя бы одно вино." });
  content.wines.forEach((w, i) => {
    if (!w.name.trim()) errors.push({ path: `wines/${w.id}/name`, message: `Вино ${i + 1}: напишите название (гости увидят его, когда откроете бутылку).` });
    if (!w.country.trim()) errors.push({ path: `wines/${w.id}/country`, message: `Вино ${i + 1}: укажите страну.` });
    if (!w.grape.trim()) errors.push({ path: `wines/${w.id}/grape`, message: `Вино ${i + 1}: укажите сорт.` });
  });
  if (content.countries.length === 0) errors.push({ path: "countries", message: "На поле нужна хотя бы одна страна." });
  if (content.grapes.length === 0) errors.push({ path: "grapes", message: "На поле нужен хотя бы один сорт." });
  return errors;
}
