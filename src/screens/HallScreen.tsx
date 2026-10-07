import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { snapshotContent } from "../core/games";
import { rankedLeaderboard, sortedLeaderboard } from "../core/leaderboard";
import { clock, useGuestSignIn, useSessionByCode, type Session, type SoundCue } from "../data";
import { BoardView } from "../components/live/BoardView";
import { Podium } from "../components/live/Podium";
import { Scene } from "../components/live/Scene";
import { SlideView } from "../components/live/SlideView";
import { useHallMusic } from "../components/music/useHallMusic";
import { playSound, setMuted, setSoundSet, stopAllSounds, unlockSound, useMuted, useSoundReady } from "../components/live/sound";
import { useWakeLock } from "../components/live/useWakeLock";
import { Logo } from "../components/Logo";
import { VPN_HINT } from "../core/texts";
import { QrCode } from "../components/QrCode";
import { ScreenSkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { joinHint, playUrl } from "../components/links";
import { getMechanic } from "../mechanics/registry";
import { getTheme, teamColorVar, useTheme } from "../themes/registry";

export function HallScreen() {
  const { code = "" } = useParams();
  const [auth, retryAuth] = useGuestSignIn();
  const [state, retry] = useSessionByCode(code, { enabled: auth.status === "ready" });

  if (auth.status === "error") return <LoadFailed onRetry={retryAuth} />;
  if (auth.status === "loading" || state.status === "loading") {
    return <Pending skeleton={<ScreenSkeleton />} label="Подключаем экран" />;
  }
  if (state.status === "notFound") return <Message title="Сессия не найдена">Проверьте код: {code}</Message>;
  if (state.status === "error") return <LoadFailed onRetry={retry}>{state.message}</LoadFailed>;
  return <Screen session={state.session} />;
}

function teamStyle(colorIndex: number | undefined): CSSProperties {
  return { "--team-color": teamColorVar(colorIndex) } as CSSProperties;
}

const CURSOR_HIDE_MS = 3000;

/** Курсор и кнопки экрана прячутся, если мышь не двигалась 3 секунды. */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), CURSOR_HIDE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), CURSOR_HIDE_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);
  return idle;
}

/** Полноэкранный режим, звук: кнопки в углу экрана зала. */
function ScreenControls() {
  const muted = useMuted();
  const [full, setFull] = useState(() => document.fullscreenElement !== null);
  const canFullscreen = typeof document.documentElement.requestFullscreen === "function";

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    unlockSound();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }

  return (
    <div className="screen-controls">
      <button
        type="button"
        className="btn btn--secondary"
        aria-pressed={!muted}
        onClick={() => {
          unlockSound();
          setMuted(!muted);
        }}
      >
        {muted ? "Включить звук" : "Звук включён"}
      </button>
      {canFullscreen && (
        <button type="button" className="btn btn--secondary" onClick={toggleFullscreen}>
          {full ? "Выйти из полного экрана" : "Во весь экран"}
        </button>
      )}
    </div>
  );
}

/** Звук по кнопке ведущего: играет, когда пришёл новый id (не при открытии экрана). */
function useCueSound(cue: SoundCue | null | undefined): void {
  const last = useRef(cue?.id ?? null);
  useEffect(() => {
    const id = cue?.id ?? null;
    if (id === last.current) return;
    last.current = id;
    if (!cue) return;
    if (cue.sound === "stop") stopAllSounds();
    else playSound(cue.sound);
  }, [cue]);
}

function Screen({ session }: { session: Session }) {
  useTheme(session.themeId);
  useEffect(() => setSoundSet(getTheme(session.themeId).effects?.soundSet ?? "classic"), [session.themeId]);
  useCueSound(session.state.cue);
  const musicBlocked = useHallMusic(session.state.music, session.state.mix);
  const soundReady = useSoundReady();
  const muted = useMuted();
  // Таймер экрана идёт по часам сервера: смещение измеряем один раз.
  useEffect(() => {
    void clock.sync();
  }, []);
  const phase = session.state.phase;
  useWakeLock(true);
  const idle = useIdle();

  // Браузер разрешит звук после первого касания экрана или нажатия клавиши.
  useEffect(() => {
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  return (
    <div className={idle ? "hall is-idle" : "hall"}>
      <Scene themeId={session.themeId} />
      <ScreenControls />
      {!muted && (!soundReady || musicBlocked) && (
        <p className="screen-tap" role="status">
          {musicBlocked ? "Коснитесь экрана, чтобы включить музыку" : "Коснитесь экрана, чтобы включить звук"}
        </p>
      )}
      {session.state.slide ? (
        <main className="quiz-stage">
          <SlideView slide={session.state.slide} />
        </main>
      ) : (
        <>
          {phase === "lobby" && <Lobby session={session} />}
          {phase === "playing" && <Playing session={session} />}
          {phase === "finished" && <Final session={session} />}
        </>
      )}
    </div>
  );
}

function Lobby({ session }: { session: Session }) {
  const board = sortedLeaderboard(session.leaderboard);
  const teams = session.playMode === "teams";
  return (
    <main className="screen">
      <div className="screen__brand">
        <Logo kind="emblem" className="logo--splash" />
      </div>
      <div className="screen__join">
        <h1 className="screen-title">Присоединяйтесь к игре</h1>
        <p className="screen-text">Отсканируйте QR-код или откройте {joinHint()} и введите код</p>
        <div className="screen__code">
          <div className="big-code">{formatSessionCode(session.code)}</div>
          <QrCode value={playUrl(session.code)} label={`QR-код для входа в игру ${formatSessionCode(session.code)}`} />
        </div>
        <p className="screen-note">{VPN_HINT}</p>
        <p className="screen-text">
          {teams ? "Команд" : "Игроков"}: {board.length}
        </p>
        <div className="chips" aria-live="polite">
          {board.map((e) => (
            <span
              key={e.id}
              className={e.kind === "team" ? "chip chip--team" : "chip"}
              style={e.kind === "team" ? teamStyle(e.colorIndex) : undefined}
            >
              {e.name}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}

function Playing({ session }: { session: Session }) {
  const mechanic = getMechanic(session.mechanic);
  const content = useMemo(
    () => (mechanic ? mechanic.parse(snapshotContent(session.gameSnapshot)) : null),
    [mechanic, session.gameSnapshot],
  );
  const ScreenView = mechanic?.ScreenView;
  return (
    <main className="quiz-stage">
      <Logo kind="monogram" className="logo--corner" title="" />
      {session.state.stage === "podium" ? (
        <Podium session={session} />
      ) : ScreenView && content !== null ? (
        <ScreenView session={session} content={content} />
      ) : (
        <div className="screen-center">
          <h1 className="screen-title">Игра идёт</h1>
        </div>
      )}
      <p className="stage-code">
        Вход: {joinHint()} · код {formatSessionCode(session.code)}
      </p>
    </main>
  );
}

/** Финал: пьедестал (всё открыто), под ним таблица. */
function Final({ session }: { session: Session }) {
  const ranked = rankedLeaderboard(session.leaderboard);
  const winners = ranked.filter((e) => e.place === 1 && e.score > 0);
  // После награждения фанфары уже прозвучали на первом месте.
  const afterPodium = session.state.stage === "podium";
  const played = useRef(afterPodium);

  useEffect(() => {
    // Фанфары — один раз, когда финал наступил при открытом экране.
    if (played.current) return;
    played.current = true;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => playSound("fanfare"), 300);
    return () => {
      if (Date.now() - startedAt < 300) played.current = false;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <main className="quiz-stage">
      <Logo kind="monogram" className="logo--corner" title="" />
      <div className="final">
        <p className="final__eyebrow">{winners.length > 1 ? "Победители" : winners.length === 1 ? "Победитель" : "Игра завершена"}</p>
        {winners.length > 0 && <Podium session={session} final />}
        <div className="final__board">
          <BoardView leaderboard={session.leaderboard} title="Итоговая таблица" showLast={false} limit={ranked.length > 3 ? 7 : 3} />
        </div>
      </div>
    </main>
  );
}
