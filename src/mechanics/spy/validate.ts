import type { ValidationError } from "../types";
import { rolesOf, SPY_LIMITS, type SpyContent } from "./content";

export function validateSpy(content: SpyContent): ValidationError[] {
  const errors: ValidationError[] = [];
  const named = content.locations.filter((l) => l.name.trim());
  if (named.length < SPY_LIMITS.minLocations) errors.push({ path: "locations", message: `Нужно хотя бы ${SPY_LIMITS.minLocations} локаций — иначе шпиону слишком легко угадать.` });
  else if (named.length < content.parties) errors.push({ path: "locations", message: `Локаций меньше, чем партий (${content.parties}): в одной игре локации не повторяются.` });
  const seen = new Set<string>();
  content.locations.forEach((l, i) => {
    const name = l.name.trim();
    if (!name) {
      errors.push({ path: `locations/${i}/name`, message: `Локация ${i + 1}: напишите название.` });
      return;
    }
    const key = name.toLowerCase().replace(/ё/g, "е");
    if (seen.has(key)) errors.push({ path: `locations/${i}/name`, message: `Локация «${name}» повторяется.` });
    seen.add(key);
    if (rolesOf(l).length === 0) errors.push({ path: `locations/${i}/roles`, message: `«${name}»: добавьте хотя бы одну роль.` });
  });
  return errors;
}
