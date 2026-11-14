import { useEffect, useRef, useSyncExternalStore } from "react";
import { tracksRepo } from "../../data";
import { pauseFragment, playChorus, playFragment, resumeFragment, stopFragment, type FragmentOptions } from "../live/sound";

const cache = new Map<string, Promise<string | null>>();

/** Ключи проигрывания, которые уже звучали на этом устройстве (для `startOnMount`). */
const played = new Set<string>();

/** Треки, которые не удалось скачать (экран зала говорит об этом, а не молчит — паспорт квиза, К-Н-10). */
const failed = new Set<string>();
const listeners = new Set<() => void>();
function markFailed(trackId: string, value: boolean): void {
  if (failed.has(trackId) === value) return;
  if (value) failed.add(trackId);
  else failed.delete(trackId);
  for (const l of listeners) l();
}

/** Трек не скачался на это устройство (удалён, нет связи). Следующая попытка проигрывания попробует снова. */
export function useTrackFailed(trackId: string | null | undefined): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => Boolean(trackId && failed.has(trackId)),
  );
}

/** Адрес трека в памяти; одна загрузка на трек, даже если его просят сразу несколько мест. */
function trackUrl(trackId: string): Promise<string | null> {
  const known = cache.get(trackId);
  if (known) return known;
  const loading = (async () => {
    const blob = tracksRepo ? await tracksRepo.file(trackId).catch(() => null) : null;
    if (!blob) {
      // Не получилось — в следующий раз попробуем снова.
      cache.delete(trackId);
      markFailed(trackId, true);
      return null;
    }
    markFailed(trackId, false);
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
export function useFragment(
  trackId: string | null,
  startSec: number,
  lengthSec: number,
  playKey: string | null,
  extra?: { options?: FragmentOptions; chorus?: "cut" | "cross" | "sting"; paused?: boolean; startOnMount?: boolean },
): void {
  // `startOnMount` — экран вопроса появился заново, а ключ сменился, пока его не было (слайд жребия аукциона поверх игры):
  // играть сразу, если этот ключ на этом устройстве ещё не звучал (паспорт квиза, К-Н-2).
  const last = useRef<string | null>(extra?.startOnMount && playKey !== null && !played.has(playKey) ? null : playKey);
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
    played.add(playKey);
    if (played.size > 50) played.delete(played.values().next().value as string);
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
