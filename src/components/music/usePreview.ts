import { useEffect, useRef, useState } from "react";
import { tracksRepo } from "../../data";

/**
 * Прослушивание трека на этом устройстве (студия, проверка у владельца). Одновременно играет один
 * трек; файл качается один раз за открытие экрана.
 */
export function usePreview(): { playing: string | null; loading: string | null; toggle: (id: string) => void; error: boolean } {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const cache = urls.current;
    return () => {
      audio.current?.pause();
      cache.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  async function toggle(id: string) {
    setError(false);
    const el = (audio.current ??= new Audio());
    if (playing === id) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.pause();
    try {
      let url = urls.current.get(id);
      if (!url) {
        setLoading(id);
        const blob = tracksRepo ? await tracksRepo.file(id) : null;
        if (!blob) throw new Error("no file");
        url = URL.createObjectURL(blob);
        urls.current.set(id, url);
      }
      el.src = url;
      el.onended = () => setPlaying(null);
      await el.play();
      setPlaying(id);
    } catch {
      setError(true);
      setPlaying(null);
    } finally {
      setLoading(null);
    }
  }

  return { playing, loading, toggle: (id) => void toggle(id), error };
}

/** Длительность файла по его метаданным; не удалось — null. */
export function audioDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null);
    el.onerror = () => done(null);
    window.setTimeout(() => done(null), 8000);
    el.src = url;
  });
}
