/**
 * Трек в вопросе: выбор трека, таймлайн всего трека с участками «угадывание» и «припев при верном»,
 * ползунки (не заходят друг за друга и за края), прослушивание каждого участка, начало и конец
 * звучания, переход к припеву и конфетти. Логика ползунков — `moveHandle` в `src/core/clip.ts`.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CHORUS_LENGTHS, clock, FADE_IN, FADE_OUT, moveHandle, type Clip, type ClipJoin } from "../../core/clip";
import { tracksRepo, type Track } from "../../data";
import { ClampedNumber } from "../ClampedNumber";
import { loadTracks } from "./TrackPicker";

const BARS = 72;
const peaksCache = new Map<string, Promise<number[] | null>>();

/** Громкость по участкам трека для рисунка волны (один раз за открытие студии). */
function loadPeaks(trackId: string): Promise<number[] | null> {
  const known = peaksCache.get(trackId);
  if (known) return known;
  const loading = (async () => {
    if (!tracksRepo || typeof AudioContext === "undefined") return null;
    const blob = await tracksRepo.file(trackId).catch(() => null);
    if (!blob) return null;
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
      const data = audio.getChannelData(0);
      const size = Math.floor(data.length / BARS);
      const peaks: number[] = [];
      for (let i = 0; i < BARS; i++) {
        let max = 0;
        for (let j = i * size; j < (i + 1) * size; j += 64) max = Math.max(max, Math.abs(data[j] ?? 0));
        peaks.push(max);
      }
      const top = Math.max(0.01, ...peaks);
      return peaks.map((p) => p / top);
    } catch {
      return null;
    } finally {
      void ctx.close().catch(() => undefined);
    }
  })();
  peaksCache.set(trackId, loading);
  return loading;
}

/** Ровная «волна», пока настоящая не посчиталась. */
function placeholderPeaks(seed: string): number[] {
  let h = 7;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: BARS }, (_, i) => 0.3 + 0.6 * Math.abs(Math.sin(i * 0.9 + h) * Math.sin(i * 0.37 + h / 7)));
}

const FADE_IN_LABELS: Record<number, string> = { 0: "Сразу громко", 2: "Плавно 2 с", 5: "Плавно 5 с" };
const FADE_OUT_LABELS: Record<number, string> = { 0: "Обрыв", 3: "Затухание 3 с", 6: "Затухание 6 с" };
const JOIN_LABELS: Record<ClipJoin, string> = { cut: "Сразу", cross: "Склейка", sting: "Отбивка" };

type Handle = "start" | "end" | "chorus";

export function TrackTimeline({ clip, onChange, disabled }: { clip: Clip; onChange: (clip: Clip) => void; disabled?: boolean }) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [drag, setDrag] = useState<Handle | null>(null);
  const [listening, setListening] = useState<"guess" | "chorus" | null>(null);
  const wave = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef(0);
  const latest = useRef(clip);
  latest.current = clip;

  useEffect(() => {
    let cancelled = false;
    loadTracks()
      .then((list) => !cancelled && setTracks(list))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPeaks(null);
    if (!clip.trackId) return;
    let cancelled = false;
    void loadPeaks(clip.trackId).then((p) => !cancelled && setPeaks(p));
    return () => {
      cancelled = true;
    };
  }, [clip.trackId]);

  useEffect(() => () => audio.current?.pause(), []);

  const track = tracks?.find((t) => t.id === clip.trackId) ?? null;
  const duration = track?.durationMs ? track.durationMs / 1000 : Math.max(240, clip.start + clip.length + 30, (clip.chorusStart ?? 0) + clip.chorusLength + 30);
  const bars = useMemo(() => peaks ?? placeholderPeaks(clip.trackId ?? "x"), [peaks, clip.trackId]);
  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / duration) * 100))}%`;
  const guessEnd = clip.start + clip.length;
  const chorusEnd = (clip.chorusStart ?? 0) + clip.chorusLength;

  if (!tracksRepo) return null;

  function secondsAt(clientX: number): number {
    const box = wave.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return ((clientX - box.left) / box.width) * duration;
  }

  function onPointerDown(which: Handle, event: ReactPointerEvent) {
    if (disabled) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag(which);
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!drag) return;
    const sec = secondsAt(event.clientX);
    // Припев тянут за середину: ползунок — его начало, длина выбирается кнопками.
    onChange(moveHandle(latest.current, drag, drag === "chorus" ? sec - latest.current.chorusLength / 2 : sec, track?.durationMs ? track.durationMs / 1000 : null));
  }

  /** Прослушать участок: играет прямо по касанию (iPhone), конец — по таймеру позиции. */
  function listen(which: "guess" | "chorus") {
    if (!tracksRepo || !clip.trackId) return;
    const el = (audio.current ??= new Audio());
    if (listening === which) {
      el.pause();
      setListening(null);
      return;
    }
    const from = which === "guess" ? clip.start : (clip.chorusStart ?? 0);
    const to = which === "guess" ? guessEnd : chorusEnd;
    stopAt.current = to;
    // Фрагмент медиа-адреса «#t=начало,конец» — браузер сам начнёт с нужной секунды.
    el.src = `${tracksRepo.fileUrl(clip.trackId)}#t=${from},${to}`;
    el.ontimeupdate = () => {
      if (el.currentTime >= stopAt.current) {
        el.pause();
        setListening(null);
      }
    };
    el.onended = () => setListening(null);
    setListening(which);
    void el.play().catch(() => setListening(null));
  }

  const set = (patch: Partial<Clip>) => onChange({ ...clip, ...patch });

  return (
    <div className="timeline">
      <label className="field">
        <span>Трек на экране зала</span>
        {failed ? (
          <span className="muted small">Не удалось загрузить музыку. Проверьте интернет.</span>
        ) : (
          <select value={clip.trackId ?? ""} disabled={disabled || tracks === null} onChange={(e) => set({ trackId: e.target.value || null })}>
            <option value="">{tracks === null ? "Загружаем треки…" : "Без музыки"}</option>
            {(tracks ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
                {t.scope === "agency" ? " · общая" : ""}
                {t.durationMs ? ` · ${clock(t.durationMs / 1000)}` : ""}
              </option>
            ))}
            {clip.trackId && tracks !== null && !track && <option value={clip.trackId}>Трек недоступен</option>}
          </select>
        )}
      </label>
      {tracks !== null && tracks.length === 0 && <p className="muted small">Треков пока нет — загрузите их в студии на вкладке «Музыка».</p>}

      {clip.trackId && (
        <>
          <div className="timeline__wave" ref={wave} onPointerMove={onPointerMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
            <div className="timeline__bars" aria-hidden="true">
              {bars.map((h, i) => {
                const sec = ((i + 0.5) / BARS) * duration;
                const zone = sec >= clip.start && sec <= guessEnd ? "is-guess" : clip.chorusStart !== null && sec >= clip.chorusStart && sec <= chorusEnd ? "is-chorus" : "";
                return <i key={i} className={zone} style={{ height: `${Math.max(8, h * 100)}%` }} />;
              })}
            </div>
            <button
              type="button"
              className="timeline__handle timeline__handle--guess"
              style={{ left: pct(clip.start) }}
              aria-label={`Начало угадывания: ${clock(clip.start)}`}
              disabled={disabled}
              onPointerDown={(e) => onPointerDown("start", e)}
            />
            <button
              type="button"
              className="timeline__handle timeline__handle--guess"
              style={{ left: pct(guessEnd) }}
              aria-label={`Конец угадывания: ${clock(guessEnd)}`}
              disabled={disabled}
              onPointerDown={(e) => onPointerDown("end", e)}
            />
            {clip.chorusStart !== null && (
              <button
                type="button"
                className="timeline__handle timeline__handle--chorus"
                style={{ left: pct(clip.chorusStart + clip.chorusLength / 2) }}
                aria-label={`Припев: ${clock(clip.chorusStart)}–${clock(chorusEnd)}`}
                disabled={disabled}
                onPointerDown={(e) => onPointerDown("chorus", e)}
              />
            )}
          </div>
          <p className="timeline__scale muted small">
            <span>0:00</span>
            <span>{track?.durationMs ? clock(duration) : "длина трека неизвестна"}</span>
          </p>

          <div className="timeline__legend">
            <span className="timeline__dot timeline__dot--guess" aria-hidden="true" />
            <span>
              Угадывание · {clock(clip.start)}–{clock(guessEnd)}
            </span>
            <strong>{clip.length} с</strong>
          </div>
          <div className="q-numbers">
            <label className="field">
              С секунды
              <ClampedNumber value={clip.start} min={0} max={3600} fallback={0} disabled={disabled} onChange={(v) => onChange(moveHandle(clip, "start", v, track?.durationMs ? track.durationMs / 1000 : null))} />
            </label>
            <label className="field">
              Играть, секунд
              <ClampedNumber value={clip.length} min={3} max={120} fallback={15} disabled={disabled} onChange={(v) => onChange(moveHandle(clip, "end", clip.start + v, track?.durationMs ? track.durationMs / 1000 : null))} />
            </label>
          </div>

          <div className="timeline__legend">
            <span className="timeline__dot timeline__dot--chorus" aria-hidden="true" />
            <span>{clip.chorusStart === null ? "Припев при верном ответе — нет" : `Припев при верном · ${clock(clip.chorusStart)}–${clock(chorusEnd)}`}</span>
            {clip.chorusStart !== null && <strong>{clip.chorusLength} с</strong>}
          </div>
          <div className="seg" role="group" aria-label="Припев при верном ответе">
            <button type="button" className={clip.chorusStart === null ? "seg__btn is-on" : "seg__btn"} disabled={disabled} onClick={() => set({ chorusStart: null })}>
              Без припева
            </button>
            {CHORUS_LENGTHS.map((n) => (
              <button
                key={n}
                type="button"
                className={clip.chorusStart !== null && clip.chorusLength === n ? "seg__btn is-on" : "seg__btn"}
                disabled={disabled}
                onClick={() => set({ chorusLength: n, chorusStart: clip.chorusStart ?? Math.min(Math.max(0, duration - n), guessEnd + 10) })}
              >
                {n} с
              </button>
            ))}
          </div>

          <div className="actions actions--row">
            <button type="button" className="btn btn--secondary" aria-pressed={listening === "guess"} onClick={() => listen("guess")}>
              {listening === "guess" ? "■ Стоп" : "▶ Угадывание"}
            </button>
            {clip.chorusStart !== null && (
              <button type="button" className="btn btn--secondary" aria-pressed={listening === "chorus"} onClick={() => listen("chorus")}>
                {listening === "chorus" ? "■ Стоп" : "▶ Припев"}
              </button>
            )}
          </div>

          <fieldset className="timeline__sound" disabled={disabled}>
            <legend>Звучание</legend>
            <span className="muted small">Начало фрагмента</span>
            <div className="seg">
              {FADE_IN.map((n) => (
                <button key={n} type="button" className={clip.fadeIn === n ? "seg__btn is-on" : "seg__btn"} onClick={() => set({ fadeIn: n })}>
                  {FADE_IN_LABELS[n]}
                </button>
              ))}
            </div>
            <span className="muted small">Конец фрагмента</span>
            <div className="seg">
              {FADE_OUT.map((n) => (
                <button key={n} type="button" className={clip.fadeOut === n ? "seg__btn is-on" : "seg__btn"} onClick={() => set({ fadeOut: n })}>
                  {FADE_OUT_LABELS[n]}
                </button>
              ))}
            </div>
            {clip.chorusStart !== null && (
              <>
                <span className="muted small">Переход к припеву после «Верно»</span>
                <div className="seg">
                  {(Object.keys(JOIN_LABELS) as ClipJoin[]).map((j) => (
                    <button key={j} type="button" className={clip.join === j ? "seg__btn is-on" : "seg__btn"} onClick={() => set({ join: j })}>
                      {JOIN_LABELS[j]}
                    </button>
                  ))}
                </div>
              </>
            )}
            <label className="choice">
              <input type="checkbox" checked={clip.confetti} onChange={(e) => set({ confetti: e.target.checked })} />
              <span className="choice__text">
                <span className="choice__title">Конфетти на экране при верном ответе</span>
              </span>
            </label>
          </fieldset>
        </>
      )}
    </div>
  );
}
