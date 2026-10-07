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
  const level = mix ?? DEFAULT_MIX;

  useEffect(() => {
    setMix(level);
  }, [level]);

  const trackId = music?.trackId ?? null;
  const rev = music?.rev ?? null;
  const playing = music?.playing ?? false;

  useEffect(() => {
    let cancelled = false;
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
        const blob = tracksRepo ? await tracksRepo.file(trackId).catch(() => null) : null;
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        urls.current.set(trackId, url);
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
    };
  }, [trackId, rev, playing]);

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
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
    return () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
    };
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
