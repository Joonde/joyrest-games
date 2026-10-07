const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** «5 октября 2026». */
export function formatDate(ms: number): string {
  return dateFormat.format(new Date(ms)).replace(/\s*г\.$/, "");
}

/** «19:05» по местному времени устройства. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Сколько шла игра: «47 мин», «1 ч 12 мин». Меньше минуты — «меньше минуты». */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "меньше минуты";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} ч${m > 0 ? ` ${m} мин` : ""}` : `${m} мин`;
}
