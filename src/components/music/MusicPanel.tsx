import { useEffect, useMemo, useRef, useState } from "react";
import { categoryTitle, durationLabel, nextInCategory, TRACK_CATEGORIES } from "../../core/music";
import { DEFAULT_MIX, tracksRepo, useLoad, type MixState, type Session, type SessionChange, type Track, type TrackCategory } from "../../data";

const EMPTY = { mine: [] as Track[], library: [] as Track[] };

function rev(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

/**
 * Музыка и микшер на пульте (CLAUDE.md, раздел 7, «Музыка»): выбрали трек — играет на экране
 * зала; пауза, следующий, стоп; громкость музыки и эффектов, «без звука».
 */
export function MusicPanel({ session, onApply }: { session: Session; onApply: (change: SessionChange) => Promise<void> }) {
  const repo = tracksRepo;
  const [state] = useLoad(() => (repo ? repo.list() : Promise.resolve(EMPTY)), [repo]);
  const [filter, setFilter] = useState<TrackCategory | "all">("all");
  const [error, setError] = useState(false);
  const music = session.state.music ?? null;
  const serverMix = session.state.mix ?? DEFAULT_MIX;
  const [mix, setMixLocal] = useState<MixState>(serverMix);
  const sendTimer = useRef(0);

  // Ползунок двигается сразу, на экран уходит не чаще раза в 0,3 с.
  useEffect(() => setMixLocal(serverMix), [serverMix.music, serverMix.effects, serverMix.muted]); // синхронизация с другим пультом

  const tracks = useMemo(() => {
    if (state.status !== "ready") return [];
    const seen = new Set<string>();
    return [...state.data.mine, ...state.data.library].filter((t) => t.ready && !seen.has(t.id) && seen.add(t.id));
  }, [state]);

  if (!repo) return null;

  const current = music ? tracks.find((t) => t.id === music.trackId) : undefined;
  const shown = filter === "all" ? tracks : tracks.filter((t) => t.category === filter);
  const categories = TRACK_CATEGORIES.filter((c) => tracks.some((t) => t.category === c.id));

  function send(change: SessionChange) {
    setError(false);
    onApply(change).catch(() => setError(true));
  }

  const play = (track: Track) => send({ state: { music: { trackId: track.id, playing: true, rev: rev() } } });

  function changeMix(next: MixState) {
    setMixLocal(next);
    window.clearTimeout(sendTimer.current);
    sendTimer.current = window.setTimeout(() => send({ state: { mix: next } }), 300);
  }

  const next = music ? nextInCategory(tracks, music.trackId) : null;

  return (
    <div className="stack">

      {music && (
        <div className="now-playing" aria-live="polite">
          <p className="eyebrow">{music.playing ? "Сейчас играет" : "На паузе"}</p>
          <p className="now-playing__title line-clamp">{current?.title ?? "Трек"}</p>
          <div className="sound-pad">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => send({ state: { music: { ...music, playing: !music.playing } } })}
            >
              {music.playing ? "Пауза" : "Продолжить"}
            </button>
            <button type="button" className="btn btn--secondary" disabled={!next} onClick={() => next && play(next)}>
              Следующий
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => send({ state: { music: null } })}>
              Стоп
            </button>
          </div>
        </div>
      )}

      {state.status === "loading" && <p className="muted">Загружаем треки…</p>}
      {state.status === "ready" && tracks.length === 0 && (
        <p className="muted">Треков пока нет. Загрузите их в студии на вкладке «Музыка».</p>
      )}
      {tracks.length > 0 && (
        <>
          <div className="chips-row" role="group" aria-label="Для чего">
            <button type="button" className="btn btn--quiet chip-btn" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              Все
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn btn--quiet chip-btn"
                aria-pressed={filter === c.id}
                onClick={() => setFilter(c.id)}
              >
                {c.title}
              </button>
            ))}
          </div>
          <ul className="tracks">
            {shown.map((t) => (
              <li key={t.id} className={music?.trackId === t.id ? "track is-current" : "track"}>
                <button type="button" className="btn btn--secondary track__play" aria-label={`Включить «${t.title}» на экране`} onClick={() => play(t)}>
                  ▶
                </button>
                <div className="track__text">
                  <p className="track__title line-clamp">{t.title}</p>
                  <ul className="meta" aria-label="О треке">
                    <li>{categoryTitle(t.category)}</li>
                    {t.durationMs ? <li>{durationLabel(t.durationMs)}</li> : null}
                    {t.scope === "agency" && <li>JoyRest</li>}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mixer" role="group" aria-label="Микшер">
        <label className="field mixer__row">
          <span>Музыка: {mix.music}%</span>
          <input type="range" min={0} max={100} step={5} value={mix.music} onChange={(e) => changeMix({ ...mix, music: Number(e.target.value) })} />
        </label>
        <label className="field mixer__row">
          <span>Эффекты: {mix.effects}%</span>
          <input type="range" min={0} max={100} step={5} value={mix.effects} onChange={(e) => changeMix({ ...mix, effects: Number(e.target.value) })} />
        </label>
        <div className="actions">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            aria-pressed={mix.muted}
            onClick={() => {
              const nextMix = { ...mix, muted: !mix.muted };
              setMixLocal(nextMix);
              send({ state: { mix: nextMix } });
            }}
          >
            {mix.muted ? "Включить звук" : "Без звука"}
          </button>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          Команда не дошла. Проверьте интернет.
        </p>
      )}
      <p className="muted small">Музыка играет на экране зала и сама притихает под гонг и аплодисменты.</p>
    </div>
  );
}
