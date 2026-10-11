/**
 * Отрезок трека для экрана зала (решение владельца 11 октября 2026): таймлайн всего трека с двумя ползунками
 * (начало и конец), громкость, плавное начало и затухание, прослушивание отрезка. Сохраняется у трека и
 * действует везде, где трек включают с пульта.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CLIP_FADES, DEFAULT_TRACK_CLIP, tracksRepo, type Track, type TrackClip } from "../../data";

function clockLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TrackClipEditor({ track, onSave, onClose }: { track: Track; onSave: (clip: TrackClip) => Promise<void>; onClose: () => void }) {
  const total = Math.max(5, (track.durationMs ?? 240_000) / 1000);
  const [clip, setClip] = useState<TrackClip>(track.clip ?? DEFAULT_TRACK_CLIP);
  const [drag, setDrag] = useState<"start" | "end" | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wave = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const end = clip.end ?? total;

  useEffect(() => () => audio.current?.pause(), []);

  function secAt(x: number): number {
    const box = wave.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.min(total, Math.max(0, ((x - box.left) / box.width) * total));
  }

  function move(e: ReactPointerEvent) {
    if (!drag) return;
    const s = Math.round(secAt(e.clientX));
    setClip((c) => {
      const cEnd = c.end ?? total;
      if (drag === "start") return { ...c, start: Math.min(s, cEnd - 2) };
      const nextEnd = Math.max(s, c.start + 2);
      return { ...c, end: nextEnd >= total - 0.5 ? null : nextEnd };
    });
  }

  function listen() {
    if (!tracksRepo) return;
    const el = (audio.current ??= new Audio());
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.src = `${tracksRepo.fileUrl(track.id)}#t=${clip.start},${end}`;
    el.volume = clip.volume / 100;
    el.ontimeupdate = () => {
      if (el.currentTime >= end) {
        el.pause();
        setPlaying(false);
      }
    };
    el.onended = () => setPlaying(false);
    setPlaying(true);
    void el.play().catch(() => setPlaying(false));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(clip);
      onClose();
    } catch {
      setError("Не удалось сохранить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  const pct = (s: number) => `${(s / total) * 100}%`;
  return (
    <div className="stack stack--tight clip-editor">
      <p className="small">
        Отрезок: <strong>{clockLabel(clip.start)}</strong> — <strong>{clockLabel(end)}</strong> · {clockLabel(end - clip.start)} по кругу
      </p>
      <div className="clip-editor__wave" ref={wave} onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        <span className="clip-editor__range" style={{ left: pct(clip.start), width: pct(end - clip.start) }} />
        {(["start", "end"] as const).map((h) => (
          <button
            key={h}
            type="button"
            className={`clip-editor__handle clip-editor__handle--${h}`}
            style={{ left: pct(h === "start" ? clip.start : end) }}
            aria-label={h === "start" ? `Начало: ${clockLabel(clip.start)}` : `Конец: ${clockLabel(end)}`}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              setDrag(h);
            }}
            onPointerMove={move}
            onPointerUp={() => setDrag(null)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
              if (!d) return;
              e.preventDefault();
              setClip((c) => (h === "start" ? { ...c, start: Math.max(0, Math.min(c.start + d, (c.end ?? total) - 2)) } : { ...c, end: Math.min(total, Math.max(c.start + 2, (c.end ?? total) + d)) }));
            }}
          />
        ))}
      </div>
      <label className="field">
        Громкость: {clip.volume}%
        <input type="range" min={10} max={100} step={5} value={clip.volume} onChange={(e) => setClip((c) => ({ ...c, volume: Number(e.target.value) }))} />
      </label>
      <div className="row clip-editor__fades">
        <span className="small">Начало:</span>
        {CLIP_FADES.map((f) => (
          <button key={`in${f}`} type="button" className="pick-chip" aria-pressed={clip.fadeIn === f} onClick={() => setClip((c) => ({ ...c, fadeIn: f }))}>
            {f === 0 ? "сразу" : `плавно ${f} с`}
          </button>
        ))}
      </div>
      <div className="row clip-editor__fades">
        <span className="small">Конец:</span>
        {CLIP_FADES.map((f) => (
          <button key={`out${f}`} type="button" className="pick-chip" aria-pressed={clip.fadeOut === f} onClick={() => setClip((c) => ({ ...c, fadeOut: f }))}>
            {f === 0 ? "без затухания" : `затухание ${f} с`}
          </button>
        ))}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--secondary" onClick={listen}>
          {playing ? "■ Стоп" : "▶ Прослушать отрезок"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
        <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => setClip({ ...DEFAULT_TRACK_CLIP })}>
          Весь трек как есть
        </button>
        <button type="button" className="btn btn--quiet" disabled={busy} onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
