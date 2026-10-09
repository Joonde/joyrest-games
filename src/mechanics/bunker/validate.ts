import type { ValidationError } from "../types";
import type { BunkerContent } from "./content";

export function validateBunker(content: BunkerContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.rounds < 3) errors.push({ path: "rounds", message: "Нужно хотя бы 3 раунда." });
  return errors;
}
