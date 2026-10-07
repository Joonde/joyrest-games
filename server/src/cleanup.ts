/**
 * Ночная уборка своего сервера (PR 4.2, CLAUDE.md, «Медиа»):
 * - файлы картинок без ссылок в таблице media старше 7 дней (удалили картинку или игру;
 *   свежие не трогаем — их может как раз записывать загрузка);
 * - недописанные временные файлы картинок старше суток;
 * - то же для музыки (MEDIA_DIR/audio, ссылки — таблица tracks);
 * - устройства гостей старше 180 дней (их cookie уже истекла).
 * Сессии старше 30 дней убирает admin при входе в /admin (`POST /api/sessions/cleanup`).
 */
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "postgres";

const DAY_MS = 24 * 60 * 60_000;
export const MEDIA_ORPHAN_DAYS = 7;
export const DEVICE_DAYS = 180;
const FILE = /^[0-9a-f]{64}$/;
const TEMP = /^[0-9a-f]{64}\.[0-9a-f]+\.tmp$/;

/** Удаляет файлы картинок без ссылок; возвращает число удалённых. */
export async function cleanupMedia(sql: Sql, dir: string, now: number = Date.now()): Promise<number> {
  const referenced = new Set((await sql<{ sha256: string }[]>`select distinct sha256 from media`).map((r) => r.sha256));
  return removeOrphans(dir, referenced, now);
}

/** Удаляет файлы музыки без ссылок в tracks (папка audio может ещё не существовать). */
export async function cleanupAudio(sql: Sql, dir: string, now: number = Date.now()): Promise<number> {
  const audio = join(dir, "audio");
  const info = await stat(audio).catch(() => null);
  if (!info?.isDirectory()) return 0;
  const rows = await sql<{ sha256: string }[]>`select distinct sha256 from tracks where sha256 is not null`;
  return removeOrphans(audio, new Set(rows.map((r) => r.sha256)), now);
}

async function removeOrphans(dir: string, referenced: Set<string>, now: number): Promise<number> {
  const names = await readdir(dir);
  let removed = 0;
  for (const name of names) {
    const isFile = FILE.test(name);
    if (!isFile && !TEMP.test(name)) continue;
    if (isFile && referenced.has(name)) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) continue;
    const maxAge = isFile ? MEDIA_ORPHAN_DAYS * DAY_MS : DAY_MS;
    if (now - info.mtimeMs < maxAge) continue;
    await unlink(path).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

/** Удаляет устройства гостей, чья cookie (180 дней) уже истекла. */
export async function cleanupDevices(sql: Sql, now: number = Date.now()): Promise<number> {
  const rows = await sql`delete from devices where created_at < ${new Date(now - DEVICE_DAYS * DAY_MS)} returning id`;
  return rows.length;
}

interface Log {
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
}

/** Раз в сутки (первый раз — через 10 минут после запуска). Таймеры не держат процесс. */
export function scheduleCleanup(sql: Sql, mediaDir: string | null, log: Log, intervalMs = DAY_MS): () => void {
  const run = async () => {
    try {
      const files = mediaDir ? (await cleanupMedia(sql, mediaDir)) + (await cleanupAudio(sql, mediaDir)) : 0;
      const devices = await cleanupDevices(sql);
      log.info({ files, devices }, "cleanup");
    } catch (error) {
      // Таблиц ещё нет (миграции не прошли) или нет папки — попробуем завтра.
      log.warn({ reason: error instanceof Error ? error.name : "unknown" }, "cleanup failed");
    }
  };
  const first = setTimeout(() => void run(), 10 * 60_000);
  const every = setInterval(() => void run(), intervalMs);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
