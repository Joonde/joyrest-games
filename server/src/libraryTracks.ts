// Треки игр общей библиотеки — тоже общие (решение владельца 12 октября 2026). Игра ссылается на трек по id;
// если это личный трек ведущего, он мог бы удалить его, и музыка пропала бы в библиотеке и во всех копиях.
// Поэтому, когда игра попадает в библиотеку (владелец принял предложение или сохранил игру библиотеки), её
// личные треки копируются в общую музыку (тот же файл, новая запись `scope = agency`), а ссылки в игре
// переписываются на копии. Уже скопированный трек (`library_track_id`) не копируется второй раз.
import type { Sql, TransactionSql } from "postgres";
import { parseTrackClip } from "../../src/data/trackClip";
import { newUserId } from "./auth";

const ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Все строки содержимого, похожие на id (кандидаты в ссылки на треки). */
function collectIds(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 12 || out.size > 5000) return;
  if (typeof value === "string") {
    if (ID.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectIds(item, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectIds(item, out, depth + 1);
  }
}

/** Заменяет строки-ссылки по таблице замен (ключи объектов не трогает). */
export function replaceIds(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceIds(item, map));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = replaceIds(item, map);
    return out;
  }
  return value;
}

interface TrackRow {
  id: string;
  title: string;
  category: string;
  license: string;
  license_note: string;
  sha256: string | null;
  mime: string | null;
  size: number;
  duration_ms: number | null;
  clip: unknown;
  library_track_id: string | null;
}

/**
 * Личные треки, на которые ссылается игра, — в общую музыку; возвращает содержимое со ссылками на общие копии
 * (то же самое, если менять нечего). `ownerId` — владелец общих копий (владелец агентства).
 */
export async function promoteGameTracks(db: Sql | TransactionSql, content: unknown, ownerId: string): Promise<{ content: unknown; changed: boolean }> {
  const ids = new Set<string>();
  collectIds(content, ids);
  if (ids.size === 0) return { content, changed: false };
  const sql = db as Sql;
  const personal = await sql<TrackRow[]>`
    select id, title, category, license, license_note, sha256, mime, size, duration_ms, clip, library_track_id
    from tracks where id = any(${[...ids]}) and scope = 'personal' and sha256 is not null`;
  if (personal.length === 0) return { content, changed: false };
  const map = new Map<string, string>();
  for (const track of personal) {
    // Уже копировали (принят в общую раньше) — та же копия, если её не удалили.
    const [existing] = track.library_track_id
      ? await sql<{ id: string }[]>`select id from tracks where id = ${track.library_track_id} and scope = 'agency'`
      : [];
    let target = existing?.id;
    if (!target) {
      target = newUserId();
      await sql`
        insert into tracks (id, owner_id, scope, title, category, license, license_note, sha256, mime, size, duration_ms, clip)
        values (${target}, ${ownerId}, 'agency', ${track.title}, ${track.category}, ${track.license}, ${track.license_note},
                ${track.sha256}, ${track.mime}, ${track.size}, ${track.duration_ms}, ${sql.json(parseTrackClip(track.clip) as never)})`;
      await sql`
        update tracks set share_status = 'accepted', share_reason = null, library_track_id = ${target}, updated_at = now()
        where id = ${track.id}`;
    }
    map.set(track.id, target);
  }
  return { content: replaceIds(content, map), changed: true };
}

/**
 * Игры библиотеки, сохранённые до этого правила (или с треками, добавленными в обход), — раз в сутки треки в
 * общую музыку. Возвращает, сколько игр поправлено.
 */
export async function promoteLibraryTracks(sql: Sql): Promise<number> {
  const games = await sql<{ id: string; owner_id: string }[]>`select id, owner_id from games where scope = 'agency' limit 2000`;
  let fixed = 0;
  for (const game of games) {
    const changed = await sql.begin(async (tx) => {
      const [row] = await tx<{ content: unknown }[]>`select content from games where id = ${game.id} for update`;
      if (!row) return false;
      const promoted = await promoteGameTracks(tx, row.content, game.owner_id);
      if (!promoted.changed) return false;
      await tx`update games set content = ${tx.json(promoted.content as Parameters<typeof tx.json>[0])}, updated_at = now() where id = ${game.id}`;
      return true;
    });
    if (changed) fixed += 1;
  }
  return fixed;
}
