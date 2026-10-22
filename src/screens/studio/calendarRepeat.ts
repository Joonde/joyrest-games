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

/** Текст после частичной ошибки: сколько сохранилось и сколько нет. */
export function partialText(saved: number, total: number): string {
  const left = total - saved;
  return saved === 0
    ? "Не получилось сохранить. Проверьте интернет и попробуйте ещё раз."
    : `Сохранено ${saved} из ${total}, не сохранилось ${left}. Проверьте интернет и нажмите ещё раз — сохранённые недели не повторятся.`;
}
