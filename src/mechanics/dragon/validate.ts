import type { ValidationError } from "../types";
import type { DragonContent } from "./content";

export function validateDragon(content: DragonContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.battles.length === 0) errors.push({ path: "battles", message: "Добавьте хотя бы один бой." });
  content.battles.forEach((b, i) => {
    const where = `Бой ${i + 1}`;
    if (b.tasks.length === 0) errors.push({ path: `battles/${b.id}/tasks`, message: `${where}: добавьте задания.` });
    b.tasks.forEach((t, k) => {
      const at = `${where}, задание ${k + 1}`;
      if (t.kind !== "dice" && !t.text.trim()) errors.push({ path: `tasks/${t.id}/text`, message: `${at}: напишите ${t.kind === "task" ? "задание" : "вопрос"}.` });
      if (t.kind === "choice" && t.options.some((o) => !o.trim())) errors.push({ path: `tasks/${t.id}/options`, message: `${at}: заполните все четыре варианта.` });
      if (t.power <= 0) errors.push({ path: `tasks/${t.id}/power`, message: `${at}: урон должен быть больше нуля.` });
    });
  });
  return errors;
}
