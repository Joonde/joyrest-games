import { useEffect, useRef } from "react";
import { tracksRepo } from "../../data";
import { playFragment, stopFragment } from "../live/sound";

const cache = new Map<string, Promise<string | null>>();

/** Адрес трека в памяти; одна загрузка на трек, даже если его просят сразу несколько мест. */
function trackUrl(trackId: string): Promise<string | null> {
  const known = cache.get(trackId);
  if (known) return known;
  const loading = (async () => {
    const blob = tracksRepo ? await tracksRepo.file(trackId).catch(() => null) : null;
    if (!blob) {
      // Не получилось — в следующий раз попробуем снова.
      cache.delete(trackId);
      return null;
    }
    return URL.createObjectURL(blob);
  })();
  cache.set(trackId, loading);
  // Слабому телевизору хватит нескольких треков в памяти.
  for (const [id, old] of cache) {
    if (cache.size <= 4) break;
    if (id === trackId) continue;
    cache.delete(id);
    void old.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  return loading;
}

/** Заранее скачать трек следующего шага: вопрос откроется без паузы. */
export function preloadTrack(trackId: string | null | undefined): void {
  if (trackId) void trackUrl(trackId);
}

/**
 * Фрагмент трека на экране зала: играет, когда меняется `playKey` (вопрос открыт, ведущий нажал
 * «Повторить»), и не играет при открытии экрана посреди вопроса. `playKey = null` — тишина.
 */
export function useFragment(trackId: string | null, startSec: number, lengthSec: number, playKey: string | null): void {
  const last = useRef<string | null>(playKey);
  useEffect(() => {
    if (playKey === last.current) return;
    last.current = playKey;
    if (!trackId || playKey === null) {
      stopFragment();
      return;
    }
    let cancelled = false;
    void trackUrl(trackId).then((url) => {
      if (!cancelled && url) void playFragment(url, startSec, lengthSec);
    });
    return () => {
      cancelled = true;
    };
  }, [trackId, startSec, lengthSec, playKey]);
  // При уходе с экрана вопроса (таблица или слайд поверх) фрагмент доигрывает свой кусок: он сам
  // замолкает по времени, а заново его включит только новый `playKey`.
}
