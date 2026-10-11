/**
 * Выбор трека из своей музыки и общей библиотеки (вкладка «Музыка» студии) для вопроса «Угадай
 * мелодию» или песни лото: с какой секунды и сколько играть на экране зала.
 */
import { ClampedNumber } from "../ClampedNumber";
import { useEffect, useState } from "react";
import { tracksRepo, type Track } from "../../data";
import { UploadTrackButton } from "./uploadTrack";

let cached: Promise<Track[]> | null = null;

/** Загрузили новый трек прямо из игры — список перечитается. */
export function forgetTracks(): void {
  cached = null;
}

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
      {tracks !== null && tracks.length === 0 && <p className="muted small">Треков пока нет — загрузите свой прямо здесь.</p>}
      <UploadTrackButton
        disabled={disabled}
        onUploaded={(t) => {
          forgetTracks();
          setTracks((list) => [t, ...(list ?? [])]);
          onChange({ trackId: t.id });
        }}
      />
      {trackId && (
        <div className="q-numbers">
          <label className="field">
            С какой секунды
            <ClampedNumber value={start} min={0} max={3600} fallback={0} disabled={disabled} onChange={(v) => onChange({ trackStart: v })} />
          </label>
          {showLength && (
          <label className="field">
            Сколько секунд играть
            <ClampedNumber value={length} min={3} max={120} fallback={15} disabled={disabled} onChange={(v) => onChange({ trackLength: v })} />
          </label>
          )}
        </div>
      )}
    </div>
  );
}
