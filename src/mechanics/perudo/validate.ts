import type { ValidationError } from "../types";
import type { PerudoContent } from "./content";

/** Настройки «Перудо» всегда в допустимых пределах (их держит `parsePerudo`). */
export function validatePerudo(content: PerudoContent): ValidationError[] {
  return content.startDice >= 1 ? [] : [{ path: "startDice", message: "Нужна хотя бы одна кость у каждого." }];
}
