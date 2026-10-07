import { useEffect, useRef, useState } from "react";
import { DEFAULT_MIX, tracksRepo, type MixState, type MusicState } from "../../data";
import { pauseMusic, playMusic, setMix, stopMusic, unlockSound } from "../live/sound";

/**
 * Фоновая музыка на экране зала по командам пульта (CLAUDE.md, раздел 7, «Музыка»): файл трека
 * качается один раз, новый `rev` — трек с начала, `playing` — пауза и продолжение.
 * Возвращает true, если браузер не дал включить звук (нужно коснуться экрана).
 */
export function useHallMusic(music: MusicState | null | undefined, mix: MixState | null | undefined): boolean {
  const urls = useRef(new Map<string, string>());
  const started = useRef<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  /** Файл не скачался — пробуем снова через 5 с (номер попытки перезапускает загрузку). */
  const [attempt, setAttempt] = useState(0);
  const level = mix ?? DEFAULT_MIX;

  useEffect(() => {
    setMix(level);
  }, [level]);

  const trackId = music?.trackId ?? null;
  const rev = music?.rev ?? null;
  const playing = music?.playing ?? false;

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;
    async function run() {
      if (!trackId || !rev) {
        stopMusic();
        started.current = null;
        return;
      }
      const key = `${trackId}:${rev}`;
      if (!playing) {
        pauseMusic();
        return;
      }
      let url = urls.current.get(trackId);
      if (!url) {
        // null — трека нет (удалён): не повторяем; ошибка сети — повтор через 5 с.
        let blob: Blob | null = null;
        try {
          blob = tracksRepo ? await tracksRepo.file(trackId) : null;
        } catch {
          if (!cancelled) retryTimer = window.setTimeout(() => setAttempt((a) => a + 1), 5000);
          return;
        }
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        urls.current.set(trackId, url);
        // Слабому телевизору хватит двух треков в памяти: текущего и предыдущего.
        for (const [id, old] of urls.current) {
          if (urls.current.size <= 2) break;
          if (id === trackId) continue;
          URL.revokeObjectURL(old);
          urls.current.delete(id);
        }
      }
      const fromStart = started.current !== key;
      const ok = await playMusic(url, fromStart);
      if (cancelled) return;
      if (ok) started.current = key;
      setBlocked(!ok);
    }
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [trackId, rev, playing, attempt]);

  // Касание экрана разрешает звук — пробуем включить ещё раз.
  useEffect(() => {
    if (!blocked) return;
    const retry = () => {
      unlockSound();
      // Браузер включает звук не мгновенно — пробуем чуть позже.
      window.setTimeout(() => {
        const url = trackId ? urls.current.get(trackId) : undefined;
        if (!url || !playing) return;
        void playMusic(url, started.current !== `${trackId}:${rev}`).then((ok) => {
          if (ok) {
            started.current = `${trackId}:${rev}`;
            setBlocked(false);
          }
        });
      }, 200);
    };
    // Браузер разрешает звук на отпускание пальца или клик, не на нажатие.
    const events = ["pointerup", "click", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, retry));
    return () => events.forEach((e) => window.removeEventListener(e, retry));
  }, [blocked, trackId, rev, playing]);

  useEffect(() => {
    const cache = urls.current;
    return () => {
      stopMusic();
      cache.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return blocked;
}
