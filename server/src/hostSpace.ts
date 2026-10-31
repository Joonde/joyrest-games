/**
 * Место ведущего под свою музыку и видео (решение владельца 31 октября 2026): одно на двоих, 2 ГБ.
 * Музыка — личные треки (файл один раз, треки из общей музыки не считаются), видео — загруженные им видео JoyRest
 * (готовые — по файлу один раз, недогруженные — заявленным размером: место бронируется на всю загрузку).
 * Владелец агентства и заместитель ведут общую библиотеку — их загрузки в это место не входят.
 */
import type { Sql, TransactionSql } from "postgres";

/** 2 ГБ на ведущего: музыка и видео вместе. */
export const HOST_SPACE_BYTES = 2 * 1024 * 1024 * 1024;

export interface HostSpace {
  musicBytes: number;
  videoBytes: number;
  usedBytes: number;
}

export async function hostSpace(db: Sql | TransactionSql, ownerId: string): Promise<HostSpace> {
  const [row] = await db<{ music: string; video: string }[]>`
    select
      (select coalesce(sum(size), 0) from (
        select distinct on (t.sha256) t.size from tracks t
        where t.owner_id = ${ownerId} and t.sha256 is not null and t.scope = 'personal'
          and not exists (select 1 from tracks a where a.scope = 'agency' and a.sha256 = t.sha256)
      ) music_files)::text as music,
      (
        (select coalesce(sum(size), 0) from (
          select distinct on (v.sha256) v.size from videos v where v.owner_id = ${ownerId} and v.sha256 is not null
        ) video_files)
        + (select coalesce(sum(v.size), 0) from videos v where v.owner_id = ${ownerId} and v.sha256 is null)
      )::text as video`;
  const musicBytes = Number(row?.music ?? 0);
  const videoBytes = Number(row?.video ?? 0);
  return { musicBytes, videoBytes, usedBytes: musicBytes + videoBytes };
}
