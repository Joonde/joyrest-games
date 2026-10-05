const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** «5 октября 2026». */
export function formatDate(ms: number): string {
  return dateFormat.format(new Date(ms)).replace(/\s*г\.$/, "");
}
