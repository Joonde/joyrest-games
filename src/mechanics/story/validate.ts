import type { ValidationError } from "../types";
import { slotsOf, type StoryContent } from "./content";

export function validateStory(content: StoryContent): ValidationError[] {
  const errors: ValidationError[] = [];
  if (content.sections.length === 0) errors.push({ path: "sections", message: "Включите хотя бы один раздел." });
  if (content.sections.includes("words")) {
    if (content.templates.length === 0) errors.push({ path: "templates", message: "«Сочиняем историю»: добавьте хотя бы одно предложение с пропусками в [скобках]." });
    content.templates.forEach((t, i) => {
      const missing = slotsOf(t).filter((s) => !(content.bank[s]?.length));
      if (missing.length > 0) errors.push({ path: `templates/${i}`, message: `Предложение ${i + 1}: нет слов для пропуска «${missing[0]}» — добавьте их в банк слов.` });
    });
  }
  if (content.sections.includes("said") && content.saidQuestions.length === 0) errors.push({ path: "saidQuestions", message: "«Кто это сказал?»: добавьте хотя бы один вопрос." });
  return errors;
}
