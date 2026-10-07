/** Квалификация и стаж ведущих (CLAUDE.md, «Квалификация, стаж и баллы»). */
import type { HostLevel } from "../data/types";

export const HOST_LEVELS: Array<{ id: HostLevel; title: string; hint: string }> = [
  { id: "intern", title: "Стажёр", hint: "Учится, проводит игры вместе с опытным ведущим" },
  { id: "novice", title: "Новичок", hint: "До 1 года опыта" },
  { id: "host", title: "Ведущий", hint: "Больше года опыта" },
  { id: "top", title: "Топ-ведущий", hint: "Больше 3 лет опыта" },
];

export function levelTitle(level: HostLevel | null | undefined): string | null {
  return HOST_LEVELS.find((l) => l.id === level)?.title ?? null;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m = n % 100;
  const last = n % 10;
  if (m >= 11 && m <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Стаж от даты «опыт с»: «2 года 3 мес.», «8 мес.», «меньше месяца». */
export function experienceLabel(since: number, now: number): string {
  const a = new Date(since);
  const b = new Date(now);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  if (months < 1) return "меньше месяца";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${plural(years, "год", "года", "лет")}`);
  if (rest > 0) parts.push(`${rest} мес.`);
  return parts.join(" ");
}
