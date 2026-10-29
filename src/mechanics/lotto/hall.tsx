// Экран зала музыкального лото (решение владельца 27 октября 2026, согласованные макеты «Музлото — табло и видео»):
// 3D-барабан с бочонками ещё не сыгранных песен и табло всех номеров справа → выпал бочонок, номер 3 секунды →
// страница песни на весь экран: большая пластинка с номером (без видео) или зона видео 16:9 с маленькой пластинкой
// сверху, караоке-строки, правильный ответ плашкой. Знак JR — в шапке, на табло, на пластинке, на видео и на ответе.
// Кадр 16:9, размеры — в --u (1% ширины кадра), стили — lotto-hall.css.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Logo } from "../../components/Logo";
import { NameText } from "../../components/NameText";
import { preloadTrack, useFragment } from "../../components/music/useFragment";
import { drumRattle, fadeOutFragment, fragmentLevel, fragmentTime, playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { clock } from "../../data";
import type { Session } from "../../data/types";
import { StageVideo, WarmVideo } from "../stage/video";
import { AFTER_VOLUME, DRUM_MS, hasLyrics, hasVideo, songLength, type LottoContent } from "./content";
import { KaraokeLines } from "./karaoke";
import { lottoMusicOn, orderOf, parseLottoResult, playedNumbers, songAt, songIndexAt, type LottoResult } from "./logic";
import "./lotto-hall.css";

const DrumCanvas = lazy(() => import("./drum/DrumCanvas"));

/** Моменты барабана для разметки поверх 3D (секунды), как в `DRUM_TIMELINES` сцены. */
const MARKS = {
  full: { stop: 6.8, pop: 9.4, big: 9.9, end: 12.9 },
  quick: { stop: 2.3, pop: 3.7, big: 4.2, end: 7.2 },
} as const;

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function Mono({ className }: { className?: string }) {
  return (
    <span className={`lh-mono${className ? ` ${className}` : ""}`} aria-hidden="true">
      <Logo kind="monogram" title="" />
    </span>
  );
}

/** Шапка кадра: знак JR, «JoyRest · Музыкальное лото» и что сейчас. */
function Head({ title, right }: { title: string; right?: string }) {
  return (
    <>
      <div className="lh-head">
        <Mono className="lh-head__mono" />
        <div>
          <p className="lh-head__eb">JoyRest · Музыкальное лото</p>
          <h2 className="lh-head__title">{title}</h2>
        </div>
      </div>
      {right && <p className="lh-count">{right}</p>}
    </>
  );
}

/** Табло: все номера игры — сыгранные золотые, свежий светится; «Последние 5» и сколько сыграно. */
export function Board({ total, played, fresh }: { total: number; played: number[]; fresh: number | null }) {
  const set = new Set(played);
  // Сетка подстраивается под число песен: квадратная, чуть шире, чем выше.
  const cols = Math.max(4, Math.ceil(Math.sqrt(total * 0.86)));
  const rows = Math.ceil(total / cols);
  const last = [...played].reverse().slice(0, 5);
  return (
    <aside className="lh-board" aria-label="Табло номеров" style={{ "--cols": cols, "--rows": rows } as CSSProperties}>
      <div className="lh-board__head">
        <p className="lh-board__title">
          <Mono className="lh-board__mono" />
          Табло
        </p>
        <p className="lh-board__count">
          <b>{played.length}</b> из {total} сыграно
        </p>
      </div>
      <div className="lh-board__bar">
        <i style={{ width: `${(played.length / Math.max(1, total)) * 100}%` }} />
      </div>
      <p className="lh-board__last">
        Последние
        {last.map((n, i) => (
          <b key={n} className={i === 0 ? "is-new" : ""}>
            {n}
          </b>
        ))}
      </p>
      <div className="lh-board__grid">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <i key={n} className={n === fresh ? "is-now" : set.has(n) ? "is-on" : ""}>
            {n}
          </i>
        ))}
      </div>
    </aside>
  );
}

/**
 * Барабан: 3D-сцена (отдельный чанк), сверху — затемнение, вспышка, крупный номер с кольцом-отсчётом. Время — по
 * часам сервера от начала песни: два экрана видят одно и то же, экран, открытый позже, догоняет. Звуки — только если
 * барабан начался при открытом экране. Нет WebGL или «уменьшить движение» — без 3D, сразу номер.
 */
function DrumStage({ content, numbers, pick, startedAt, onTick }: { content: LottoContent; numbers: number[]; pick: number; startedAt: number; onTick: (t: number) => void }) {
  const speed = content.drum === "quick" ? "quick" : "full";
  const M = MARKS[speed];
  const [t, setT] = useState(() => (Date.now() + clock.offset() - startedAt) / 1000);
  const [noGl, setNoGl] = useState(reduced);
  const live = useRef(t < 1);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (ms: number) => {
      raf = window.requestAnimationFrame(loop);
      if (ms - last < 30) return;
      last = ms;
      const now = (Date.now() + clock.offset() - startedAt) / 1000;
      setT(now);
      tickRef.current(now);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [startedAt]);

  // Звук: треск барабана, хлопок крышки, звон номера — по расписанию от начала.
  useEffect(() => {
    if (!live.current) return;
    const start = (Date.now() + clock.offset() - startedAt) / 1000;
    const timers: number[] = [];
    const at = (sec: number, fn: () => void) => timers.push(window.setTimeout(fn, Math.max(0, (sec - start) * 1000)));
    const speedAt = (x: number) => {
      const s = x + start;
      if (s < 0.6) return 0.15 + s / 0.6;
      if (s < M.stop - 1.2) return 1;
      return Math.max(0, (M.stop - s) / 1.2);
    };
    if (!noGl) drumRattle(Math.max(0.5, M.stop - start), speedAt);
    if (!noGl) at(M.pop, () => playSound("pop"));
    at(M.big, () => playSound("ding"));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз на барабан
  }, [startedAt]);

  const big = t >= M.big;
  const showRing = Math.max(0, Math.min(1, (t - M.big - 0.5) / (M.end - M.big - 0.5)));
  const sec = Math.max(1, Math.ceil(M.end - t));
  const flash = Math.max(0, 1 - Math.abs(t - M.pop - 0.05) / 0.35) * 0.9 + Math.max(0, 1 - Math.abs(t - M.big - 0.15) / 0.3) * 0.6;
  const dim = Math.max(Math.min(1, Math.max(0, (t - M.big + 0.2) / 0.7)) * 0.85, Math.min(1, Math.max(0, (t - M.stop - 0.4) / 0.9)) * 0.45);
  const pop = Math.min(1, Math.max(0, (t - M.big) / 0.55));
  const scale = pop < 1 ? 1 + 2.70158 * Math.pow(pop - 1, 3) + 1.70158 * Math.pow(pop - 1, 2) : 1;

  return (
    <div className="lh-drum">
      {!noGl && (
        <Suspense fallback={null}>
          <DrumCanvas numbers={numbers} pick={pick} speed={speed} seed={String(startedAt)} startedAt={startedAt} onFail={() => setNoGl(true)} dim={dim} />
        </Suspense>
      )}
      {noGl && !big && (
        <div className="lh-drum__plain">
          <p>Крутим барабан…</p>
        </div>
      )}
      {!noGl && <div className="lh-drum__flash" style={{ opacity: flash }} />}
      {big && (
        <div className="lh-drum__reveal" style={{ opacity: pop, transform: `scale(${Math.max(0.01, scale)})` }}>
          <svg className="lh-drum__ring" viewBox="0 0 640 640" aria-hidden="true">
            <circle cx="320" cy="320" r="300" fill="none" stroke="rgba(227,198,140,.18)" strokeWidth="6" />
            <circle cx="320" cy="320" r="300" fill="none" stroke="#E3C68C" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 320 320)" strokeDasharray="1885" strokeDashoffset={1885 * showRing} />
          </svg>
          <Mono className="lh-drum__mono" />
          <p className="lh-drum__lbl">Бочонок</p>
          <p className="lh-drum__num">{pick}</p>
          <p className="lh-drum__hold">Песня зазвучит через {sec}</p>
        </div>
      )}
    </div>
  );
}

function Vinyl({ n, small = false, spin }: { n: number; small?: boolean; spin: boolean }) {
  return (
    <div className={`lh-vinyl${small ? " lh-vinyl--small" : ""}${spin ? " is-spin" : ""}`} aria-hidden="true">
      <div className="lh-vinyl__sheen" />
      <div className="lh-vinyl__label">
        <Mono className="lh-vinyl__mono" />
        {!small && <span className="lh-vinyl__l">Песня</span>}
        <span className="lh-vinyl__n">{n}</span>
      </div>
    </div>
  );
}

function Eq({ count, className }: { count: number; className?: string }) {
  return (
    <div className={`lh-eq${className ? ` ${className}` : ""}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ animationDelay: `${((i * 37) % 23) * 0.05}s`, animationDuration: `${0.7 + ((i * 13) % 9) * 0.08}s` }} />
      ))}
    </div>
  );
}

function Winners({ session, result }: { session: Session; result: LottoResult }) {
  if (result.last.length === 0) return null;
  return (
    <ul className="lh-winners" aria-live="polite">
      {result.last.map((pid) => (
        <li key={pid}>
          ЛОТО! <NameText name={session.leaderboard[pid]?.name ?? ""} /> <strong>+{session.leaderboard[pid]?.last ?? 0}</strong>
        </li>
      ))}
    </ul>
  );
}

/** Где играет трек сейчас (для караоке) — 10 раз в секунду, только пока нужно. */
function useTrackTime(enabled: boolean): number | null {
  const [t, setT] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setT(null);
      return;
    }
    const timer = window.setInterval(() => setT(fragmentTime()), 100);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return t;
}

/** Экран зала лото во время игры (заставка «Откройте карточки» — в views.tsx). */
export function LottoHall({ session, content }: { session: Session; content: LottoContent }) {
  const { stage, step } = session.state;
  const result = parseLottoResult(session.state.result);
  const order = useMemo(() => orderOf(content, result.order), [content, result.order]);
  const index = songIndexAt(order, step);
  const song = content.songs[index];
  const number = index + 1;
  const next = songAt(content, order, step + 1);
  const total = content.songs.length;
  const startedAt = session.state.startedAt;
  const drumOn = content.drum !== "off" && result.order.length === total && result.replay === 0 && startedAt !== null;
  const drumEnd = startedAt !== null ? startedAt + DRUM_MS[content.drum] : 0;
  const now = useServerNow(250, stage === "question" && drumOn);
  // Барабан этой песни доиграл (по кадрам анимации) — не ждём следующего тика часов. Запоминаем, для какой песни.
  const [doneFor, setDoneFor] = useState<number | null>(null);
  const inDrum = stage === "question" && drumOn && doneFor !== startedAt && now < drumEnd;
  const withVideo = hasVideo(song);
  const track = song && !withVideo ? song.trackId : null;
  const playing = stage === "question" || stage === "reveal";

  // Музыка: включается после барабана; на названии — тише (играет и после ответа) или затихает; «Стоп» с пульта — тишина.
  // На названии музыка только продолжает то, что уже звучало на вопросе: ведущий открыл название, пока крутился
  // барабан, — песня не начинается с начала на полную громкость (ревью 29 октября 2026). Без «играет после ответа»
  // после затухания ключ уходит совсем: трек, который ещё догружался по слабому Wi‑Fi, не заиграет поздно.
  const songKey = `p:${step}:${startedAt ?? 0}:${result.replay}`;
  const sounded = useRef<string | null>(null);
  const [quietFor, setQuietFor] = useState<string | null>(null);
  // «Назад» на вопрос и «Последний шанс» после затихшего названия песню заново не включают (как и раньше) —
  // для этого на пульте «Повторить песню».
  const musicOn = lottoMusicOn({ stage, inDrum, hush: result.hush, quiet: quietFor === songKey, sounded: sounded.current === songKey });
  if (stage === "question" && musicOn) sounded.current = songKey;
  const playKey = musicOn ? songKey : null;
  useFragment(track, song?.trackStart ?? 0, songLength(content, song), playKey);
  const seenStage = useRef(stage);
  useEffect(() => {
    const was = seenStage.current;
    seenStage.current = stage;
    if (was === "question" && stage === "reveal" && track) {
      if (content.playAfter) fragmentLevel(AFTER_VOLUME, 1);
      else {
        fadeOutFragment(1);
        const key = songKey;
        const timer = window.setTimeout(() => setQuietFor(key), 1100);
        return () => window.clearTimeout(timer);
      }
    }
    return undefined;
  }, [stage, track, content.playAfter, songKey]);

  useEffect(() => {
    preloadTrack(next && !hasVideo(next) ? next.trackId : null);
    if (inDrum) preloadTrack(track);
  }, [next, track, inDrum]);

  // Фанфары победителям (не при открытии экрана).
  const winKey = stage === "reveal" && result.last.length > 0 ? `win:${step}:${result.call}` : "";
  const [heard, setHeard] = useState(winKey);
  useEffect(() => {
    if (winKey && winKey !== heard) playSound("fanfare");
    setHeard(winKey);
  }, [winKey, heard]);

  // Караоке: текст по настройке песни или кнопкой пульта; время — по реальной позиции трека.
  const lyricsPossible = !!song && !!track && hasLyrics(song) && playing && !inDrum && result.lyrics !== "off";
  const t = useTrackTime(lyricsPossible);
  // Название открыто: показ названия или «Последний шанс».
  const opened = stage === "reveal" || (stage === "question" && result.call > 0);
  const lyricsOn =
    lyricsPossible && t !== null && (result.lyrics === "on" || (song?.lyricsShow === "reveal" ? opened : t >= (song?.lyricsAt ?? 0) - 0.5));

  const playedBefore = playedNumbers(order, step - 1);
  const playedNow = playedNumbers(order, step);

  if (!song) return <div className="lh lh--empty">Песен нет</div>;

  if (inDrum && startedAt !== null) {
    const drumNumbers = content.songs.map((_, i) => i + 1).filter((n) => !playedBefore.includes(n));
    const fresh = now >= startedAt + (MARKS[content.drum === "quick" ? "quick" : "full"].big + 0.9) * 1000;
    return (
      <div className="lh">
        <div className="lh-frame">
          <DrumStage
            content={content}
            numbers={drumNumbers}
            pick={number}
            startedAt={startedAt}
            onTick={(tt) => {
              if (tt * 1000 >= DRUM_MS[content.drum] + 100) setDoneFor(startedAt);
            }}
          />
          <Head title={now >= startedAt + MARKS[content.drum === "quick" ? "quick" : "full"].big * 1000 ? "Ваш номер" : now >= startedAt + MARKS[content.drum === "quick" ? "quick" : "full"].stop * 1000 ? "Выпал бочонок!" : "Крутим барабан!"} />
          <Board total={total} played={fresh ? playedNow : playedBefore} fresh={fresh ? number : null} />
        </div>
      </div>
    );
  }

  // «Последний шанс»: название уже открыто, снова принимаем «Лото!».
  const lastCall = stage === "question" && result.call > 0;
  const revealed = stage === "reveal" || lastCall;
  const counter = `${playedNow.length} из ${total} сыграно`;
  const hint = lastCall
    ? "Собрали карточку? Жмите «Лото!» на телефоне"
    : revealed
      ? content.hint
        ? "Подсветилась на карточке? Отметьте · собрали — «Лото!»"
        : "Есть на карточке? Отметьте · собрали — «Лото!»"
      : content.hint
        ? "Узнали? Отметьте — после ответа проверим"
        : "Узнали песню с карточки? Отметьте её";
  const title = lastCall ? "Последний шанс «Лото!»" : revealed ? "Правильный ответ" : withVideo && content.videoHide ? "Угадайте на слух" : "Угадайте песню";
  const guessLine = "Угадайте песню! Как только ведущий откроет ответ, правильное название появится на экране";
  const upcoming = revealed ? next : undefined;
  const warm = upcoming?.video.source === "link" && upcoming.video.url ? <WarmVideo key={upcoming.id} url={upcoming.video.url} /> : null;
  const last = [...playedNow].reverse().slice(0, 5);

  return (
    <div className="lh">
      <div className={`lh-frame lh-song${withVideo ? " lh-song--video" : ""}${lyricsOn ? " lh-song--lyrics" : ""}`}>
        <div className="lh-rays" aria-hidden="true" />
        <Head title={title} />
        {withVideo ? (
          <div className="lh-video">
            <div className="lh-video__zone">
              <StageVideo key={`${step}:${result.replay}`} tile={{ id: song.id, title: song.title, video: song.video, start: song.videoStart }} video={result.video} />
              {!revealed && content.videoHide && (
                <div className="lh-video__cover">
                  <Eq count={22} className="lh-eq--big" />
                  <p className="lh-video__cover-t">Слушаем песню № {number}</p>
                  <p className="lh-video__cover-s">Видео откроется вместе с названием</p>
                </div>
              )}
              {!revealed && <Mono className="lh-video__wm" />}
              {revealed && (
                <div className="lh-answer">
                  <span className="lh-answer__num">{number}</span>
                  <div>
                    <p className="lh-answer__k">Это была песня</p>
                    <p className="lh-answer__title">{song.title || "Песня"}</p>
                    {song.artist && <p className="lh-answer__artist">{song.artist}</p>}
                  </div>
                  <Mono className="lh-answer__mono" />
                </div>
              )}
            </div>
            <Vinyl n={number} small spin={!revealed} />
            {revealed ? <Winners session={session} result={result} /> : (
              <div className="lh-video__cap">
                <p className="lh-video__t">Звучит песня № {number}</p>
                <p className="lh-video__s">Угадайте! Ведущий откроет ответ — название появится на экране</p>
              </div>
            )}
          </div>
        ) : (
          <div className="lh-track">
            <Vinyl n={number} small={lyricsOn} spin={musicOn && !revealed} />
            {lyricsOn ? (
              <KaraokeLines lyrics={song.lyrics} times={song.times} t={t} className="lh-karaoke" />
            ) : revealed ? (
              <div className="lh-track__answer">
                <p className="lh-track__k">Это была песня № {number}</p>
                <p className="lh-track__title">{song.title || "Песня"}</p>
                {song.artist && <p className="lh-track__artist">{song.artist}</p>}
              </div>
            ) : (
              <div className="lh-track__now">
                <p className="lh-track__title">Звучит песня № {number}</p>
                <p className="lh-track__sub">{guessLine}</p>
              </div>
            )}
            {revealed && <Winners session={session} result={result} />}
            {!revealed && <Eq count={56} className="lh-eq--wide" />}
          </div>
        )}
        <p className="lh-last">
          Последние
          {last.map((n, i) => (
            <b key={n} className={i === 0 ? "is-new" : ""}>
              {n}
            </b>
          ))}
          <span className="lh-last__count">{counter}</span>
        </p>
        <p className="lh-hint">{hint}</p>
        {warm}
      </div>
    </div>
  );
}
