/**
 * Выбор трека из своей музыки и общей библиотеки (вкладка «Музыка» студии) для вопроса «Угадай
 * мелодию» или песни лото: с какой секунды и сколько играть на экране зала.
 */
import { ClampedNumber } from "../ClampedNumber";
import { useEffect, useState } from "react";
import { tracksRepo, type Track } from "../../data";
import { UploadTrackButton } from "./uploadTrack";
import { groupByFolder } from "../../core/music";

/**
 * Общий список треков для всех выборов трека в студии (один запрос на конструктор). Список свежий:
 * загрузили трек в игре или на вкладке «Музыка», удалили, переименовали — все открытые выборы
 * обновляются сразу (`forgetTracks`, `addTrack`), а старше минуты список перечитывается при открытии
 * и при возврате на вкладку.
 */
const FRESH_MS = 60_000;
let cached: { at: number; list: Promise<Track[]> } | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Музыка изменилась — все выборы трека перечитают список. */
export function forgetTracks(): void {
  cached = null;
  notify();
}

/** Новый трек сразу виден во всех выборах трека, без нового запроса. */
export function addTrack(track: Track): void {
  if (!cached || !track.ready) return forgetTracks();
  const prev = cached.list;
  cached = { at: cached.at, list: prev.then((list) => [track, ...list.filter((t) => t.id !== track.id)]) };
  notify();
}

/** Треки ведущего и общей библиотеки. */
export function loadTracks(): Promise<Track[]> {
  if (!tracksRepo) return Promise.resolve([]);
  if (!cached || Date.now() - cached.at > FRESH_MS) {
    const list = tracksRepo
      .list()
      .then(({ mine, library }) => [...mine, ...library].filter((t) => t.ready))
      .catch((error: unknown) => {
        if (cached?.list === list) cached = null;
        throw error;
      });
    cached = { at: Date.now(), list };
  }
  return cached.list;
}

/** Список треков для выбора: `null` — загружается; обновляется сам, когда музыка меняется. */
export function useTrackList(): { tracks: Track[] | null; failed: boolean } {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      loadTracks()
        .then((list) => {
          if (!alive) return;
          setTracks(list);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true));
    };
    load();
    listeners.add(load);
    // Вернулись на вкладку (например, загрузили трек в другой вкладке) — проверим, не устарел ли список.
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      listeners.delete(load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return { tracks, failed };
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
  const { tracks, failed } = useTrackList();

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
          {/* Папки «Музыки» — группами списка (решение владельца 15 октября 2026). */}
          {groupByFolder(tracks ?? []).map(({ folder, items }) => {
            const options = items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
                {t.scope === "agency" ? " · общая" : ""}
                {t.durationMs ? ` · ${seconds(t.durationMs)}` : ""}
              </option>
            ));
            return folder ? (
              <optgroup key={folder} label={`📁 ${folder}`}>
                {options}
              </optgroup>
            ) : (
              options
            );
          })}
          {trackId && tracks !== null && !chosen && <option value={trackId}>Трек недоступен</option>}
        </select>
      )}
      {tracks !== null && tracks.length === 0 && <p className="muted small">Треков пока нет — загрузите свой прямо здесь.</p>}
      <UploadTrackButton
        disabled={disabled}
        onUploaded={(t) => {
          // Сразу выбран в этой песне и виден во всех остальных выборах трека.
          addTrack(t);
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
