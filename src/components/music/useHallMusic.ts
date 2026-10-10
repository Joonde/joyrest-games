import { useEffect, useRef, useState } from "react";
import { DEFAULT_MIX, tracksRepo, type MixState, type MusicState } from "../../data";
import { pauseMusic, playBuiltinMusic, playMusic, setMix, stopBuiltinMusic, stopMusic, unlockSound } from "../live/sound";

/** Встроенная музыка момента (перерыв, представление команд): ключ и список треков по кругу. */
export interface BuiltinMusic {
  key: string;
  urls: string[];
  /** Громкость 0–1 (нет — 1): фон за столом тише обычного. */
  volume?: number;
}

/**
 * Фоновая музыка на экране зала по командам пульта (CLAUDE.md, раздел 7, «Музыка»): файл трека
 * качается один раз, новый `rev` — трек с начала, `playing` — пауза и продолжение.
 * Возвращает true, если браузер не дал включить звук (нужно коснуться экрана).
 */
/**
 * `builtin` — встроенная музыка момента (перерыв, представление команд) с плавным началом, наплывом
 * между треками и плавным концом. Играет, пока музыка ведущего не играет; трек ведущего всегда главнее.
 */
export function useHallMusic(music: MusicState | null | undefined, mix: MixState | null | undefined, builtin: BuiltinMusic | null = null): boolean {
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

  const builtinKey = builtin && builtin.urls.length > 0 ? builtin.key : null;
  const builtinUrls = useRef<string[]>([]);
  builtinUrls.current = builtin?.urls ?? [];
  const builtinVolume = useRef(1);
  builtinVolume.current = builtin?.volume ?? 1;
  const hostPlaying = Boolean(trackId && rev && playing);

  // Встроенная музыка: только пока своя музыка ведущего не играет.
  useEffect(() => {
    if (!builtinKey || hostPlaying) {
      stopBuiltinMusic();
      return;
    }
    let cancelled = false;
    void playBuiltinMusic(builtinKey, builtinUrls.current, builtinVolume.current).then((ok) => {
      if (!cancelled) setBlocked(!ok);
    });
    return () => {
      cancelled = true;
    };
  }, [builtinKey, hostPlaying, attempt]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;
    async function run() {
      if (!trackId || !rev) {
        if (builtinKey) return;
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
  }, [trackId, rev, playing, attempt, builtinKey]);

  // Касание экрана разрешает звук — пробуем включить ещё раз.
  useEffect(() => {
    if (!blocked) return;
    const retry = () => {
      unlockSound();
      // Браузер включает звук не мгновенно — пробуем чуть позже.
      window.setTimeout(() => {
        const own = trackId && rev && playing ? urls.current.get(trackId) : undefined;
        if (!own && builtinKey) {
          void playBuiltinMusic(builtinKey, builtinUrls.current, builtinVolume.current).then((ok) => ok && setBlocked(false));
          return;
        }
        if (!own) return;
        const key = `${trackId}:${rev}`;
        void playMusic(own, started.current !== key).then((ok) => {
          if (ok) {
            started.current = key;
            setBlocked(false);
          }
        });
      }, 200);
    };
    // Браузер разрешает звук на отпускание пальца или клик, не на нажатие.
    const events = ["pointerup", "click", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, retry));
    return () => events.forEach((e) => window.removeEventListener(e, retry));
  }, [blocked, trackId, rev, playing, builtinKey]);

  useEffect(() => {
    const cache = urls.current;
    return () => {
      stopMusic();
      stopBuiltinMusic(0.3);
      cache.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return blocked;
}
