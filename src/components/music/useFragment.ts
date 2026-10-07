import { useEffect, useRef } from "react";
import { tracksRepo } from "../../data";
import { playFragment, stopFragment } from "../live/sound";

const cache = new Map<string, string>();

async function trackUrl(trackId: string): Promise<string | null> {
  const known = cache.get(trackId);
  if (known) return known;
  const blob = tracksRepo ? await tracksRepo.file(trackId).catch(() => null) : null;
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  cache.set(trackId, url);
  // Слабому телевизору хватит нескольких треков в памяти.
  for (const [id, old] of cache) {
    if (cache.size <= 4) break;
    if (id === trackId) continue;
    URL.revokeObjectURL(old);
    cache.delete(id);
  }
  return url;
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
  useEffect(() => () => stopFragment(), []);
}
