/** Сколько дней хранятся сессии с участниками и ответами. Итоги для истории остаются. */
export const SESSION_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Сессии, созданные раньше этого момента, удаляются при входе admin в /admin. */
export function retentionCutoff(now: number, days = SESSION_RETENTION_DAYS): number {
  return now - days * DAY_MS;
}

export function isExpired(createdAt: number | null, now: number, days = SESSION_RETENTION_DAYS): boolean {
  return createdAt !== null && createdAt < retentionCutoff(now, days);
}
