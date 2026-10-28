// Конструктор лото, у песни с треком (решение владельца 27 октября 2026): прослушать трек и выбрать, откуда он
// начинается, сколько секунд звучит, и текст песни для караоке — вставить или загрузить .lrc, разметить строки
// касанием под музыку, поправить время, проверить, как будет на экране зала.
import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import { useTrackList } from "../../components/music/TrackPicker";
import { tracksRepo } from "../../data";
import { KaraokeLines } from "./karaoke";
import { clockOf, LOTTO_LIMITS, lyricIndex, lyricsFromText, parseLrc, seconds, songLength, toLrc, type LottoContent, type LottoSong } from "./content";

const LENGTHS = [15, 30, 45, 60, 90, 120];

interface Player {
  playing: boolean;
  t: number;
  duration: number | null;
  play(from: number): void;
  stop(): void;
  /** Секунда трека сейчас (точнее, чем `t` в состоянии). */
  now(): number;
}

/** Трек песни в конструкторе: одно аудио на песню, позиция обновляется ~10 раз в секунду. */
function usePlayer(trackId: string | null, knownDuration: number | null): Player {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState<number | null>(knownDuration);

  useEffect(() => setDuration(knownDuration), [knownDuration]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setT(audio.current?.currentTime ?? 0), 100);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );

  useEffect(() => {
    // Другой трек — старый замолкает.
    audio.current?.pause();
    audio.current = null;
    setPlaying(false);
    setT(0);
  }, [trackId]);

  return {
    playing,
    t,
    duration,
    play(from: number) {
      if (!trackId || !tracksRepo) return;
      const el = (audio.current ??= new Audio(tracksRepo.fileUrl(trackId)));
      el.onended = () => setPlaying(false);
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration)) setDuration(el.duration);
      };
      const start = () => {
        el.currentTime = Math.max(0, from);
        setT(el.currentTime);
        void el
          .play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false));
      };
      // Перемотка до загрузки описания файла не срабатывает — ждём его (Safari).
      if (el.readyState >= 1) start();
      else {
        el.addEventListener("loadedmetadata", start, { once: true });
        el.load();
        // iPhone пускает звук только из касания: play() сразу, перемотка — когда файл ответит.
        void el.play().catch(() => undefined);
      }
    },
    stop() {
      audio.current?.pause();
      setPlaying(false);
    },
    now() {
      return audio.current?.currentTime ?? t;
    },
  };
}

/**
 * Прослушать трек, «Отсюда начинать», сколько звучит. Показываем, только если у песни трек и нет видео (звук видео —
 * свой).
 */
export function SongTrackTools({ song, content, editable, onChange }: { song: LottoSong; content: LottoContent; editable: boolean; onChange: (patch: Partial<LottoSong>) => void }) {
  const { tracks } = useTrackList();
  const track = tracks?.find((x) => x.id === song.trackId) ?? null;
  const player = usePlayer(song.trackId, track?.durationMs ? track.durationMs / 1000 : null);
  if (!song.trackId || !tracksRepo) return null;
  const length = songLength(content, song);
  const duration = player.duration;
  const end = length > 0 ? song.trackStart + length : (duration ?? song.trackStart + 60);
  const total = Math.max(duration ?? 0, end + 5, 30);
  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / total) * 100))}%`;

  function seekFromBar(clientX: number, box: DOMRect) {
    const sec = ((clientX - box.left) / Math.max(1, box.width)) * total;
    player.play(Math.max(0, Math.min(total - 1, sec)));
  }

  return (
    <div className="stack stack--tight lotto-tools">
      <fieldset className="stack stack--tight">
        <legend>Послушать трек</legend>
        <div
          className="lotto-wave"
          role="slider"
          aria-label="Позиция трека — коснитесь, чтобы слушать отсюда"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(player.t)}
          tabIndex={0}
          onPointerDown={(e) => seekFromBar(e.clientX, e.currentTarget.getBoundingClientRect())}
        >
          <span className="lotto-wave__clip" style={{ left: pct(song.trackStart), width: `calc(${pct(end)} - ${pct(song.trackStart)})` }} />
          <span className="lotto-wave__pos" style={{ left: pct(player.t) }} />
        </div>
        <p className="lotto-tools__time">
          <span>{clockOf(player.t)}</span>
          <span className="muted small">
            звучит в игре: {clockOf(song.trackStart)} — {length > 0 ? clockOf(end) : "до конца"}
          </span>
          <span className="muted">{duration ? clockOf(duration) : ""}</span>
        </p>
        <div className="lotto-player">
          <button type="button" className="btn btn--secondary" onClick={() => player.play(Math.max(0, player.now() - 5))} aria-label="Назад на 5 секунд">
            −5 с
          </button>
          <button type="button" className="btn" onClick={() => (player.playing ? player.stop() : player.play(player.t > 0 && player.t < total - 1 ? player.t : song.trackStart))}>
            {player.playing ? "■ Стоп" : "▶ Слушать"}
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => player.play(player.now() + 5)} aria-label="Вперёд на 5 секунд">
            +5 с
          </button>
        </div>
        <div className="actions">
          <button type="button" className="btn btn--secondary btn--block" onClick={() => player.play(song.trackStart)}>
            ▶ Как в игре — с {clockOf(song.trackStart)}
          </button>
          {editable && (
            <button type="button" className="btn btn--secondary btn--block" disabled={player.t === 0 && !player.playing} onClick={() => onChange({ trackStart: Math.floor(player.now()) })}>
              ⤓ Начинать отсюда — {clockOf(player.playing ? player.now() : player.t)}
            </button>
          )}
        </div>
      </fieldset>
      <fieldset className="stack stack--tight" disabled={!editable}>
        <legend>Сколько звучит эта песня</legend>
        <div className="pick-chips">
          <button type="button" className="pick-chip" aria-pressed={song.length === null} onClick={() => onChange({ length: null })}>
            Как у всех · {content.fragment} с
          </button>
          {LENGTHS.map((n) => (
            <button key={n} type="button" className="pick-chip" aria-pressed={song.length === n} onClick={() => onChange({ length: n })}>
              {n} с
            </button>
          ))}
          <button type="button" className="pick-chip" aria-pressed={song.length === 0} onClick={() => onChange({ length: 0 })}>
            До конца
          </button>
        </div>
        {song.length !== null && song.length > 0 && !LENGTHS.includes(song.length) && <p className="muted small">Сейчас: {song.length} с.</p>}
        <p className="muted small">Для караоке выберите «До конца» или подольше — зал успеет спеть.</p>
      </fieldset>
      <LyricsEditor song={song} editable={editable} onChange={onChange} player={player} />
    </div>
  );
}

/** Текст песни: вставить, .lrc, когда показывать, разметка строк под музыку, правка времени, проверка. */
function LyricsEditor({ song, editable, onChange, player }: { song: LottoSong; editable: boolean; onChange: (patch: Partial<LottoSong>) => void; player: Player }) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "mark" | "check">("idle");
  const [dialog, confirm] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const latest = useRef(song);
  latest.current = song;
  const marked = song.times.length;
  const total = song.lyrics.length;
  const markFrom = song.lyricsShow === "at" ? song.lyricsAt : song.trackStart;

  // Музыка остановилась (кончился трек, «Стоп») — разметка и проверка заканчиваются. Только при переходе «играло → нет»:
  // сразу после «Разметить» трек ещё не успел заиграть.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !player.playing) setMode("idle");
    wasPlaying.current = player.playing;
  }, [player.playing]);

  function mark() {
    const s = latest.current;
    if (s.times.length >= s.lyrics.length) return;
    const t = seconds(player.now());
    onChange({ times: [...s.times, Math.max(t, s.times[s.times.length - 1] ?? 0)] });
  }

  // Пробел или Enter — «Следующая строка», пока идёт разметка.
  useEffect(() => {
    if (mode !== "mark") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      mark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mark читает свежую песню из latest
  }, [mode]);

  function applyText() {
    const lyrics = lyricsFromText(draft);
    if (lyrics.length === 0) return;
    const lrc = parseLrc(draft);
    if (lrc) {
      onChange(lrc);
      setNote(`Текст со временем: ${lrc.lyrics.length} строк — разметка уже есть.`);
    } else {
      onChange({ lyrics, times: [] });
      setNote(`Добавлено строк: ${lyrics.length}${lyrics.length >= LOTTO_LIMITS.lyricsLines ? ` (больше ${LOTTO_LIMITS.lyricsLines} не берём)` : ""}. Теперь разметьте их под музыку.`);
    }
    setDraft("");
  }

  async function loadFile(file: File) {
    const textIn = await file.text().catch(() => "");
    const lrc = parseLrc(textIn);
    if (lrc) {
      onChange(lrc);
      setNote(`Файл «${file.name}»: ${lrc.lyrics.length} строк со временем.`);
      return;
    }
    const lyrics = lyricsFromText(textIn);
    if (lyrics.length === 0) {
      setNote("В файле нет текста. Нужен .lrc или обычный текст по строкам.");
      return;
    }
    onChange({ lyrics, times: [] });
    setNote(`Файл «${file.name}»: ${lyrics.length} строк без времени — разметьте их под музыку.`);
  }

  function download() {
    const blob = new Blob([toLrc(song)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(song.title || "песня").replace(/[\\/:*?"<>|]/g, " ").trim() || "песня"}.lrc`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function shift(i: number, delta: number) {
    const times = [...song.times];
    const prev = times[i - 1] ?? 0;
    const next = times[i + 1] ?? Number.POSITIVE_INFINITY;
    times[i] = seconds(Math.min(next, Math.max(prev, (times[i] ?? 0) + delta)));
    onChange({ times });
  }

  function startMark() {
    setMode("mark");
    player.play(Math.max(0, marked > 0 ? (song.times[marked - 1] ?? markFrom) - 2 : markFrom));
  }

  function undoMark() {
    const times = song.times.slice(0, -1);
    onChange({ times });
    const back = times[times.length - 1] ?? markFrom;
    if (mode === "mark") player.play(Math.max(0, back - 1));
  }

  const current = lyricIndex(song.times, player.t);
  const value = total === 0 ? "нет" : marked === total ? `${total} строк, размечено` : `${total} строк, размечено ${marked}`;

  return (
    <Fold title="🎤 Текст песни (караоке)" value={value} open={total > 0}>
      {dialog}
      <div className="stack stack--tight">
        <p className="muted small">
          Текст вы добавляете сами — как и треки, ответственность за него на ведущем. На экране зала текущая строка крупно, слова заливаются цветом под
          музыку.
        </p>
        {editable && (
          <>
            <label className="field">
              Вставить текст песни (по строкам) или содержимое .lrc
              <textarea rows={5} value={draft} placeholder={"Первая строка песни\nВторая строка…"} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <div className="actions">
              <button
                type="button"
                className="btn btn--secondary btn--block"
                disabled={!draft.trim()}
                onClick={() =>
                  total > 0
                    ? confirm({ title: "Заменить текст песни?", text: "Прежний текст и разметка уберутся.", confirmLabel: "Заменить", run: applyText })
                    : applyText()
                }
              >
                {total > 0 ? "Заменить текст" : "Добавить текст"}
              </button>
              <button type="button" className="btn btn--quiet btn--block" onClick={() => fileRef.current?.click()}>
                Загрузить файл .lrc или .txt
              </button>
              {marked > 0 && (
                <button type="button" className="btn btn--quiet btn--block" onClick={download}>
                  Скачать .lrc
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".lrc,.txt,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void loadFile(file);
              }}
            />
          </>
        )}
        {note && (
          <p className="muted small" role="status">
            {note}
          </p>
        )}
        {total > 0 && (
          <>
            <fieldset className="stack stack--tight" disabled={!editable}>
              <legend>Когда показывать текст на экране зала</legend>
              <label className="choice">
                <input type="radio" name={`lyr-${song.id}`} checked={song.lyricsShow === "reveal"} onChange={() => onChange({ lyricsShow: "reveal" })} />
                <span className="choice__text">
                  <span className="choice__title">После названия</span>
                  <span className="choice__hint">Угадывают на слух, после «Показать название» зал поёт по тексту.</span>
                </span>
              </label>
              <label className="choice">
                <input type="radio" name={`lyr-${song.id}`} checked={song.lyricsShow === "at"} onChange={() => onChange({ lyricsShow: "at" })} />
                <span className="choice__text">
                  <span className="choice__title">С секунды трека: {clockOf(song.lyricsAt)}</span>
                  <span className="choice__hint">Текст появится сам с этого места (например, с припева). Ведущий может включить или убрать его и с пульта.</span>
                </span>
              </label>
              {song.lyricsShow === "at" && (
                <button type="button" className="btn btn--secondary btn--block" disabled={player.t === 0 && !player.playing} onClick={() => onChange({ lyricsAt: seconds(player.now()) })}>
                  ⤓ Показывать текст отсюда — {clockOf(player.playing ? player.now() : player.t, true)}
                </button>
              )}
            </fieldset>

            <div className="stack stack--tight lotto-mark">
              <p className="small">
                <strong>Разметка:</strong> включите музыку и касайтесь «Следующая строка» в тот момент, когда строка начинает звучать (на компьютере — пробел).
                Размечено {marked} из {total}.
              </p>
              {mode === "mark" ? (
                <>
                  <button type="button" className="btn btn--block lotto-mark__big" disabled={marked >= total} onClick={mark}>
                    {marked < total ? (
                      <>
                        Следующая строка
                        <span className="lotto-mark__line">«{song.lyrics[marked]}»</span>
                      </>
                    ) : (
                      "Все строки размечены ✓"
                    )}
                  </button>
                  <div className="actions">
                    <button type="button" className="btn btn--secondary btn--block" disabled={marked === 0} onClick={undoMark}>
                      ↶ Строка назад
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet btn--block"
                      onClick={() => {
                        player.stop();
                        setMode("idle");
                      }}
                    >
                      ■ Остановить
                    </button>
                  </div>
                </>
              ) : (
                <div className="actions">
                  {editable && (
                    <button type="button" className="btn btn--block" disabled={marked >= total} onClick={startMark}>
                      {marked === 0 ? `▶ Разметить строки — с ${clockOf(markFrom)}` : marked < total ? `▶ Продолжить разметку — строка ${marked + 1}` : "Все строки размечены ✓"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--secondary btn--block"
                    disabled={marked === 0}
                    onClick={() => {
                      setMode("check");
                      player.play(Math.max(0, (song.times[0] ?? markFrom) - 4));
                    }}
                  >
                    ▶ Проверить, как на экране
                  </button>
                  {editable && marked > 0 && (
                    <button
                      type="button"
                      className="btn btn--quiet btn--block"
                      onClick={() => confirm({ title: "Разметить заново?", text: "Время всех строк уберётся, текст останется.", confirmLabel: "Разметить заново", run: () => onChange({ times: [] }) })}
                    >
                      Разметить заново
                    </button>
                  )}
                  {editable && (
                    <button
                      type="button"
                      className="btn btn--quiet btn--block"
                      onClick={() => confirm({ title: "Убрать текст песни?", text: "Текст и разметка уберутся.", confirmLabel: "Убрать текст", run: () => onChange({ lyrics: [], times: [] }) })}
                    >
                      Убрать текст
                    </button>
                  )}
                </div>
              )}
              {(mode === "check" || mode === "mark") && marked > 0 && (
                <div className="lotto-karaoke-preview" aria-label="Как будет на экране зала">
                  <KaraokeLines lyrics={song.lyrics} times={song.times} t={player.playing ? player.t : null} />
                </div>
              )}
            </div>

            <ol className="lotto-lines" aria-label="Строки и время">
              {song.lyrics.map((line, i) => {
                const time = song.times[i];
                return (
                  <li key={i} className={i === current && player.playing ? "is-now" : time === undefined ? "is-unmarked" : ""}>
                    <span className="lotto-lines__time">{time === undefined ? "—:—" : clockOf(time, true)}</span>
                    <span className="lotto-lines__text">{line}</span>
                    {time !== undefined && (
                      <span className="lotto-lines__tools">
                        <button type="button" className="btn btn--quiet" aria-label={`Строка ${i + 1}: послушать`} onClick={() => player.play(Math.max(0, time - 1))}>
                          ▶
                        </button>
                        {editable && (
                          <>
                            <button type="button" className="btn btn--quiet" aria-label={`Строка ${i + 1}: раньше на 0,2 с`} onClick={() => shift(i, -0.2)}>
                              −0,2
                            </button>
                            <button type="button" className="btn btn--quiet" aria-label={`Строка ${i + 1}: позже на 0,2 с`} onClick={() => shift(i, 0.2)}>
                              +0,2
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {marked > 0 && marked < total && <p className="muted small">Строки без времени на экран не попадут — доразметьте их.</p>}
          </>
        )}
      </div>
    </Fold>
  );
}
