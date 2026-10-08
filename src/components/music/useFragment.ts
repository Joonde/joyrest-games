import { useEffect, useRef } from "react";
import { tracksRepo } from "../../data";
import { pauseFragment, playChorus, playFragment, resumeFragment, stopFragment, type FragmentOptions } from "../live/sound";

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

/** Что играть: угадывание (с началом и затуханием) или припев после верного ответа. */
export interface FragmentPlay {
  trackId: string | null;
  start: number;
  length: number;
  options?: FragmentOptions;
  /** Припев: переход от угадывания. */
  chorus?: "cut" | "cross" | "sting";
}

/**
 * Фрагмент трека на экране зала: играет, когда меняется `playKey` (вопрос открыт, ведущий нажал
 * «Повторить», верный ответ — припев), и не играет при открытии экрана посреди вопроса.
 * `playKey = null` — тишина. `paused` — пауза, пока гость отвечает (кнопка «кто первый»).
 */
export function useFragment(trackId: string | null, startSec: number, lengthSec: number, playKey: string | null, extra?: { options?: FragmentOptions; chorus?: "cut" | "cross" | "sting"; paused?: boolean }): void {
  const last = useRef<string | null>(playKey);
  const options = extra?.options;
  const chorus = extra?.chorus;
  const fadeIn = options?.fadeIn ?? 0;
  const fadeOut = options?.fadeOut ?? 0;
  useEffect(() => {
    if (playKey === last.current) return;
    last.current = playKey;
    if (!trackId || playKey === null) {
      stopFragment();
      return;
    }
    let cancelled = false;
    void trackUrl(trackId).then((url) => {
      if (cancelled || !url) return;
      if (chorus) void playChorus(url, startSec, lengthSec, chorus);
      else void playFragment(url, startSec, lengthSec, { fadeIn, fadeOut });
    });
    return () => {
      cancelled = true;
    };
  }, [trackId, startSec, lengthSec, playKey, chorus, fadeIn, fadeOut]);
  const paused = extra?.paused ?? false;
  useEffect(() => {
    if (paused) pauseFragment();
    else resumeFragment();
  }, [paused]);
  // При уходе с экрана вопроса (таблица или слайд поверх) фрагмент доигрывает свой кусок: он сам
  // замолкает по времени, а заново его включит только новый `playKey`.
}
