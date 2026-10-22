/**
 * «Повторять каждую неделю» без дублей (QA 22 октября 2026, M4). id записей всех недель создаются один раз на попытку
 * и переиспользуются при повторе после обрыва: сервер считает запись с тем же id той же записью. Уже сохранённые недели
 * при повторе не отправляются снова. Поменяли что-то в форме — это новая попытка, id новые.
 */
export interface RepeatPlan {
  /** Что сохраняем (день, вид, время, недели, заметка) — по нему понятно, та же это попытка или новая. */
  key: string;
  /** id записи на каждый день. */
  ids: Record<string, string>;
  /** Дни, которые уже сохранились. */
  saved: string[];
}

export function repeatKey(day: string, kind: string, start: number, end: number, weeks: number, note: string): string {
  return JSON.stringify([day, kind, start, end, weeks, note]);
}

/** План сохранения: прежний (та же попытка) или новый с новыми id. */
export function planRepeat(prev: RepeatPlan | null, key: string, days: string[], makeId: () => string): RepeatPlan {
  if (prev && prev.key === key && days.every((d) => prev.ids[d])) return prev;
  const ids: Record<string, string> = {};
  for (const d of days) ids[d] = makeId();
  return { key, ids, saved: [] };
}

/** Какие дни ещё отправить. */
export function pendingDays(plan: RepeatPlan, days: string[]): string[] {
  return days.filter((d) => !plan.saved.includes(d));
}

/** «2026-11-05» → «05.11.2026». */
function dayText(day: string): string {
  const [y, m, d] = day.split("-");
  return y && m && d ? `${d}.${m}.${y}` : day;
}

/**
 * Текст ошибки сохранения (повторная проверка QA 22 октября 2026): постоянный отказ сервера — понятной причиной, а не
 * «проверьте интернет» (повтор его не исправит). 429 — в этот день уже `PER_DAY_MAX` записей; 400 — дата вне окна
 * календаря (повтор на много недель вперёд). Остальное — сеть: `partialText`.
 */
export function saveErrorText(error: unknown, saved: number, total: number, day: string, perDayMax: number): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const done = saved > 0 ? `Сохранено ${saved} из ${total}. ` : "";
  if (code === "resource-exhausted") {
    return `${done}На ${dayText(day)} у вас уже ${perDayMax} записей — больше в один день нельзя. Уберите лишние отметки этого дня.`;
  }
  if (code === "invalid-argument") {
    return `${done}${dayText(day)} отметить нельзя: календарь принимает даты не дальше двух лет вперёд. Выберите меньше недель или другую дату.`;
  }
  return partialText(saved, total);
}

/** Текст после частичной ошибки: сколько сохранилось и сколько нет. */
export function partialText(saved: number, total: number): string {
  const left = total - saved;
  return saved === 0
    ? "Не получилось сохранить. Проверьте интернет и попробуйте ещё раз."
    : `Сохранено ${saved} из ${total}, не сохранилось ${left}. Проверьте интернет и нажмите ещё раз — сохранённые недели не повторятся.`;
}
