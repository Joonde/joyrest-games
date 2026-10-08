import { useEffect, useRef, useState } from "react";
import { tracksRepo } from "../../data";

/**
 * Прослушивание трека на этом устройстве (студия, проверка у владельца). Одновременно играет один
 * трек; файл качается один раз за открытие экрана.
 */
export function usePreview(): { playing: string | null; loading: string | null; toggle: (id: string) => void; error: boolean } {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => () => audio.current?.pause(), []);

  // Всё — синхронно в обработчике касания: iPhone разрешает play() только прямо по касанию, поэтому
  // файл не скачивается заранее, а играет по адресу (браузер сам качает и начинает, как только может).
  function toggle(id: string) {
    setError(false);
    const el = (audio.current ??= new Audio());
    if (playing === id || loading === id) {
      el.pause();
      setPlaying(null);
      setLoading(null);
      return;
    }
    el.pause();
    if (!tracksRepo) {
      setError(true);
      return;
    }
    el.src = tracksRepo.fileUrl(id);
    el.onended = () => setPlaying(null);
    el.onerror = () => {
      setError(true);
      setPlaying(null);
      setLoading(null);
    };
    setLoading(id);
    el.play().then(
      () => {
        setPlaying(id);
        setLoading(null);
      },
      (e: unknown) => {
        // Пауза до начала (нажали другой трек) — не ошибка.
        if (!(e instanceof DOMException && e.name === "AbortError")) setError(true);
        setLoading(null);
      },
    );
  }

  return { playing, loading, toggle, error };
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
