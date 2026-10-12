import { PROGRAM_LIMITS } from "../../core/program";
import type { ValidationError } from "../types";
import { NOT_IN_EVENING, type EveningContent } from "./content";

export function validateEvening(content: EveningContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.blocks.length < PROGRAM_LIMITS.minBlocks) errors.push({ path: "blocks", message: "Добавьте хотя бы одну игру в программу вечера." });
  if (content.blocks.length > PROGRAM_LIMITS.maxBlocks) errors.push({ path: "blocks", message: `В вечере не больше ${PROGRAM_LIMITS.maxBlocks} блоков.` });
  content.blocks.forEach((b, i) => {
    if (NOT_IN_EVENING.has(b.mechanic)) errors.push({ path: `blocks/${i}`, message: `Блок ${i + 1}: «${b.title}» нельзя поставить в вечер — проводите её отдельно.` });
  });
  return errors;
}
