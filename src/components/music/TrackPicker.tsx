/**
 * Выбор трека из своей музыки и общей библиотеки (вкладка «Музыка» студии) для вопроса «Угадай
 * мелодию» или песни лото: с какой секунды и сколько играть на экране зала.
 */
import { useEffect, useState } from "react";
import { tracksRepo, type Track } from "../../data";

let cached: Promise<Track[]> | null = null;

/** Треки ведущего и общей библиотеки (один запрос на весь конструктор). */
export function loadTracks(): Promise<Track[]> {
  if (!tracksRepo) return Promise.resolve([]);
  if (!cached) {
    cached = tracksRepo
      .list()
      .then(({ mine, library }) => [...mine, ...library].filter((t) => t.ready))
      .catch((error: unknown) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

function seconds(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TrackPicker({
  trackId,
  start,
  length,
  onChange,
  disabled,
  showLength = true,
}: {
  trackId: string | null;
  start: number;
  length: number;
  onChange: (patch: { trackId?: string | null; trackStart?: number; trackLength?: number }) => void;
  disabled?: boolean;
  /** Длительность задаётся для всей игры (лото) — поле не нужно. */
  showLength?: boolean;
}) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTracks()
      .then((list) => !cancelled && setTracks(list))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!tracksRepo) return null;
  const chosen = tracks?.find((t) => t.id === trackId) ?? null;

  return (
    <div className="field track-picker">
      <span>Музыка на экране зала</span>
      {failed ? (
        <p className="muted small">Не удалось загрузить музыку. Проверьте интернет.</p>
      ) : (
        <select value={trackId ?? ""} disabled={disabled || tracks === null} onChange={(e) => onChange({ trackId: e.target.value || null })}>
          <option value="">{tracks === null ? "Загружаем треки…" : "Без музыки"}</option>
          {(tracks ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
              {t.scope === "agency" ? " · общая" : ""}
              {t.durationMs ? ` · ${seconds(t.durationMs)}` : ""}
            </option>
          ))}
          {trackId && tracks !== null && !chosen && <option value={trackId}>Трек недоступен</option>}
        </select>
      )}
      {tracks !== null && tracks.length === 0 && (
        <p className="muted small">Треков пока нет — загрузите их в студии на вкладке «Музыка».</p>
      )}
      {trackId && (
        <div className="q-numbers">
          <label className="field">
            С какой секунды
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={3600}
              value={start}
              disabled={disabled}
              onChange={(e) => onChange({ trackStart: Math.max(0, Math.min(3600, Number.parseInt(e.target.value, 10) || 0)) })}
            />
          </label>
          {showLength && (
          <label className="field">
            Сколько секунд играть
            <input
              type="number"
              inputMode="numeric"
              min={3}
              max={120}
              value={length}
              disabled={disabled}
              onChange={(e) => onChange({ trackLength: Math.max(3, Math.min(120, Number.parseInt(e.target.value, 10) || 15)) })}
            />
          </label>
          )}
        </div>
      )}
    </div>
  );
}
