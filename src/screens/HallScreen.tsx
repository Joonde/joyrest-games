import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ClientLogo } from "../components/ClientLogo";
import { setHallBusy } from "../components/UpdateBanner";
import { EVENING_MECHANIC } from "../core/program";
import { EveningTable } from "../mechanics/evening/views";
import { useNavigate, useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { snapshotContent } from "../core/games";
import { rankedLeaderboard, sortedLeaderboard } from "../core/leaderboard";
import { roundLeaderboard } from "../core/rounds";
import { maskedName, teamNameVisible, teamOrder, teamsReveal } from "../core/teams";
import { clock, useGuestSignIn, useSessionByCode, type Session, type SoundCue } from "../data";
import { BoardView } from "../components/live/BoardView";
import { Podium } from "../components/live/Podium";
import { Scene } from "../components/live/Scene";
import { SlideView } from "../components/live/SlideView";
import { useServerNow } from "../components/live/useServerNow";
import { useHallMusic } from "../components/music/useHallMusic";
import { builtinMusicOf } from "../components/music/builtinMusic";
import { useScreenReport } from "../components/live/screenStatus";
import {
  playSound,
  preloadSamples,
  setMuted,
  setSoundSet,
  stopAllSounds,
  unlockSound,
  useMuted,
  useSoundReady,
  useSoundUnlock,
} from "../components/live/sound";
import { useWakeLock } from "../components/live/useWakeLock";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Logo } from "../components/Logo";
import { NameText } from "../components/NameText";
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
  // Ведущий открыл экран зала на своём устройстве — ему нужна дорога обратно в студию.
  return <Screen session={state.session} isHost={auth.uid === state.session.hostId} />;
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

/** iPhone и iPad (iPadOS выдаёт себя за Mac, но с касаниями): подсказка про беззвучный режим. */
const IS_APPLE_TOUCH =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Динамик с крестиком: звук на экране зала ещё не включён. */
function SoundOffIcon() {
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 19h7l10-8v26l-10-8H8z" fill="currentColor" fillOpacity="0.15" />
      <path d="M32 19l9 10M41 19l-9 10" />
    </svg>
  );
}

/** Полноэкранный режим, звук и (ведущему) «В студию»: кнопки в углу экрана зала. */
function ScreenControls({ toStudio }: { toStudio: (() => void) | null }) {
  const muted = useMuted();
  const ready = useSoundReady();
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
        onClick={() => {
          if (muted) setMuted(false);
          else if (!ready) unlockSound();
          else setMuted(true);
        }}
      >
        {/* Подпись — что сделает кнопка, а не что сейчас: «Звук включён» путало ведущих. */}
        {muted || !ready ? "Включить звук" : "Выключить звук"}
      </button>
      {canFullscreen && (
        <button type="button" className="btn btn--secondary" onClick={toggleFullscreen}>
          {full ? "Выйти из полного экрана" : "Во весь экран"}
        </button>
      )}
      {toStudio && (
        <button type="button" className="btn btn--secondary" onClick={toStudio}>
          В студию
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

function Screen({ session, isHost }: { session: Session; isHost: boolean }) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  useTheme(session.themeId, session.branding);
  useEffect(() => setSoundSet(getTheme(session.themeId).effects?.soundSet ?? "classic"), [session.themeId]);
  useCueSound(session.state.cue);
  // Аплодисменты — файл: качаем заранее, чтобы на пьедестале звучали сразу.
  useEffect(() => preloadSamples(["applause"]), []);
  // Встроенная музыка момента (если ведущий не включил свою): перерыв и представление команд.
  const mechanic = getMechanic(session.mechanic);
  const content = useMemo(() => (mechanic?.music ? mechanic.parse(snapshotContent(session.gameSnapshot)) : null), [mechanic, session.gameSnapshot]);
  // Пока идёт таймер вопроса — раз в секунду пересчитать музыку момента («Миллионер» стихает за 10 секунд до конца).
  useServerNow(1000, session.state.stage === "question" && session.state.timeLimit !== null);
  const moment = mechanic?.music && content !== null ? mechanic.music(session, content) : null;
  const musicBlocked = useHallMusic(session.state.music, session.state.mix, builtinMusicOf(session, moment));
  const soundReady = useSoundReady();
  const muted = useMuted();
  // Таймер экрана идёт по часам сервера: смещение измеряем один раз.
  useEffect(() => {
    void clock.sync();
  }, []);
  const phase = session.state.phase;
  useWakeLock(true);
  const idle = useIdle();

  // Браузер разрешит звук после касания экрана или нажатия клавиши — в любой момент, сколько угодно раз.
  useSoundUnlock();
  // Видел ли этот экран игру: финальные фанфары — только при переходе к финалу, не при открытии.
  const sawGame = useRef(phase === "playing");
  if (phase === "playing") sawGame.current = true;
  // Идёт игра — экран не перезагружается сам при обновлении платформы (иначе снова просит коснуться для звука);
  // обновится в лобби, в перерыве вечера или после финала.
  const playingNow = phase === "playing" && session.mechanic !== EVENING_MECHANIC;
  useEffect(() => {
    setHallBusy(playingNow);
    return () => setHallBusy(false);
  }, [playingNow]);
  // Пульт видит, что экран на связи и звук разрешён.
  useScreenReport(session.id, { soundReady, muted, musicBlocked }, phase !== "finished");
  // QR для опоздавших после завершения не нужен (код уже не работает) — показываем финал.
  const slide = session.state.slide ?? null;
  const standalone = Boolean(mechanic?.standalone);
  const shownSlide = slide && !standalone && !(slide.kind === "join" && phase === "finished") ? slide : null;

  return (
    <div className={idle ? "hall is-idle" : "hall"}>
      {/* У самостоятельной игры свой фон — общий живой фон темы не рисуем. */}
      {!standalone && <Scene themeId={session.themeId} />}
      {/* После игры «В студию» — отдельная кнопка слева сверху, здесь её не дублируем. */}
      <ScreenControls toStudio={isHost && phase !== "finished" ? () => setLeaving(true) : null} />
      {isHost && (
        <ConfirmDialog
          open={leaving}
          title="Уйти с экрана зала?"
          confirmLabel="В студию"
          cancelLabel="Остаться"
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            navigate("/studio");
          }}
        >
          <p>Игра продолжится. Экран зала можно снова открыть из студии: «Идёт игра» → «Экран зала».</p>
        </ConfirmDialog>
      )}
      {/* Звук выключен или браузер ждёт касания — круглый значок в правом нижнем углу, не поверх игры. */}
      {muted ? (
        <button type="button" className="screen-tap" onClick={() => setMuted(false)} title="Звук выключен на этом экране — включить" aria-label="Звук выключен на этом экране — включить">
          <SoundOffIcon />
        </button>
      ) : (
        (!soundReady || musicBlocked) && (
          <button
            type="button"
            className="screen-tap is-waiting"
            onClick={unlockSound}
            title={`${musicBlocked ? "Коснитесь, чтобы включить музыку" : "Коснитесь, чтобы включить звук"}${IS_APPLE_TOUCH ? ". Нет звука — выключите беззвучный режим" : ""}`}
            aria-label={musicBlocked ? "Коснитесь, чтобы включить музыку" : "Коснитесь, чтобы включить звук"}
          >
            <SoundOffIcon />
          </button>
        )
      )}
      {shownSlide ? (
        <>
          <main className="quiz-stage">
            <SlideView slide={shownSlide} code={session.code} sessionId={session.id} branding={session.branding} />
          </main>
          {/* «Спасибо» после игры лежит поверх итогов — выход всё равно виден. */}
          {phase === "finished" && <ScreenExit isHost={isHost} />}
        </>
      ) : (
        <>
          {standalone && mechanic && (
            // Самостоятельная игра («Олимп») рисует все этапы сама: лобби, игру, награждение, финал.
            <main className="quiz-stage">
              <StandaloneScreen session={session} />
            </main>
          )}
          {!standalone && phase === "lobby" && <Lobby session={session} />}
          {!standalone && phase === "playing" && <Playing session={session} />}
          {!standalone && phase === "finished" && <Final session={session} sawGame={sawGame.current} />}
          {/* Игра окончена: выход сверху слева, виден всегда (не прячется вместе с кнопками экрана и не уходит под плашку звука). */}
          {phase === "finished" && <ScreenExit isHost={isHost} />}
        </>
      )}
    </div>
  );
}

/** Игра окончена: выход сверху слева, виден всегда (не прячется вместе с кнопками экрана и не уходит под плашку звука). */
function ScreenExit({ isHost }: { isHost: boolean }) {
  const navigate = useNavigate();
  return (
    <a
      className="btn screen-exit"
      href={isHost ? "/studio" : "/"}
      onClick={(e) => {
        e.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        navigate(isHost ? "/studio" : "/");
      }}
    >
      {isHost ? "В студию" : "На главную"}
    </a>
  );
}

function StandaloneScreen({ session }: { session: Session }) {
  const mechanic = getMechanic(session.mechanic);
  const content = useMemo(() => (mechanic ? mechanic.parse(snapshotContent(session.gameSnapshot)) : null), [mechanic, session.gameSnapshot]);
  const ScreenView = mechanic?.ScreenView;
  return ScreenView && content !== null ? <ScreenView session={session} content={content} /> : null;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const teamWord = (n: number) => plural(n, "команда", "команды", "команд");
const playerWord = (n: number) => plural(n, "игрок", "игрока", "игроков");

/** Сколько ждём гостей: «4:12» с открытия сессии, обновляется раз в секунду. */
function useWaitClock(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.floor((now - (since || now)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

function Lobby({ session }: { session: Session }) {
  const teams = session.playMode === "teams";
  const reveal = teamsReveal(session.state);
  const waitLabel = useWaitClock(session.createdAt);
  if (teams && reveal.shown !== null) return <TeamsPresentation session={session} />;
  const board = sortedLeaderboard(session.leaderboard);
  const ordered = teams ? teamOrder(session.leaderboard) : [];
  const phonesTotal = teams ? Object.values(reveal.sizes ?? {}).reduce((a, b) => a + b, 0) : 0;
  return (
    <main className="screen screen--lobby">
      <div className="screen__qr">
        <QrCode value={playUrl(session.code)} label={`QR-код для входа в игру ${formatSessionCode(session.code)}`} />
      </div>
      <div className="screen__join">
        <ClientLogo branding={session.branding} className="client-logo--lobby" />
        <Logo kind="full" className={session.branding?.logo ? "logo--lobby logo--lobby-small" : "logo--lobby"} />
        <h1 className="screen-title">Присоединяйтесь к игре</h1>
        <p className="screen-text">Наведите камеру на QR-код или откройте {joinHint()} и введите код</p>
        <div className="big-code">{formatSessionCode(session.code)}</div>
        <p className="screen-note">{VPN_HINT}</p>
      </div>
      <aside className="lobby-joined" aria-label="Кто присоединился">
        <div className="lobby-joined__head">
          <span className="lobby-joined__label">Присоединились</span>
          <span className="lobby-joined__count">{board.length}</span>
          <span className="lobby-joined__sub">
            {teams ? `${teamWord(board.length)}${phonesTotal > 0 ? ` · телефонов ${phonesTotal}` : ""}` : playerWord(board.length)} · ждём {waitLabel}
          </span>
        </div>
        <div className={`chips lobby-joined__list${board.length > 40 ? " is-dense" : board.length > 14 ? " is-compact" : ""}`} aria-live="polite">
          {teams
            ? ordered.map((team) => {
                const hidden = !teamNameVisible(session.state, team.number);
                const phones = reveal.sizes?.[team.id] ?? 0;
                return (
                  <span key={team.id} className="chip chip--team" style={teamStyle(team.entry.colorIndex)}>
                    {hidden ? (
                      <>
                        Команда {team.number} <span className="chip__mask" aria-label="название скрыто">{maskedName(team.entry.name)}</span>
                        {phones > 0 && <span className="chip__stars" aria-label={`телефонов: ${phones}`}> · {"★".repeat(Math.min(phones, 8))}</span>}
                      </>
                    ) : (
                      <NameText name={team.entry.name} />
                    )}
                  </span>
                );
              })
            : board.map((e) => (
                <span key={e.id} className="chip">
                  <NameText name={e.name} />
                </span>
              ))}
        </div>
      </aside>
    </main>
  );
}

/** «Представить команды»: по одной, крупно, в порядке подключения; в конце — все вместе. */
function TeamsPresentation({ session }: { session: Session }) {
  const ordered = teamOrder(session.leaderboard);
  const shown = teamsReveal(session.state).shown ?? 0;
  const current = ordered[shown];
  const sound = current ? `team:${shown}` : "all";
  const last = useRef(sound);
  useEffect(() => {
    if (last.current === sound) return;
    last.current = sound;
    playSound(current ? "whoosh" : "fanfare");
  }, [sound, current]);

  if (!current) {
    return (
      <main className="screen-center teams-intro">
        <p className="eyebrow teams-intro__eyebrow">Сегодня играют</p>
        <ol className="teams-intro__all">
          {ordered.map((team) => (
            <li key={team.id} className="chip chip--team teams-intro__chip" style={teamStyle(team.entry.colorIndex)}>
              <span className="teams-intro__num">{team.number}</span> <NameText name={team.entry.name} />
            </li>
          ))}
        </ol>
      </main>
    );
  }
  return (
    <main className="screen-center teams-intro" key={current.id}>
      <p className="eyebrow teams-intro__eyebrow">
        Команда {current.number} из {ordered.length}
      </p>
      <div className="teams-intro__card" style={teamStyle(current.entry.colorIndex)}>
        <span className="teams-intro__name">
          <NameText name={current.entry.name} />
        </span>
      </div>
      {shown > 0 && (
        <ol className="teams-intro__before">
          {ordered.slice(0, shown).map((team) => (
            <li key={team.id} className="chip chip--team" style={teamStyle(team.entry.colorIndex)}>
              <NameText name={team.entry.name} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

/** Базовые темы JoyRest: в них у игр с нарисованным фоном (`Mechanic.art`) — картина вместо живого фона темы. */
const BASE_THEMES = new Set(["joyrest", "joyrest-day"]);

function Playing({ session }: { session: Session }) {
  const mechanic = getMechanic(session.mechanic);
  const content = useMemo(
    () => (mechanic ? mechanic.parse(snapshotContent(session.gameSnapshot)) : null),
    [mechanic, session.gameSnapshot],
  );
  const ScreenView = mechanic?.ScreenView;
  const { stage } = session.state;
  const peek = session.state.peek ?? null;
  // QR для опоздавших сам больше не всплывает (закрывал поле игры): его показывает и убирает ведущий —
  // «QR для опоздавших на экран» на пульте. Внизу остаётся только строка с адресом и кодом.
  // Нарисованный фон игры — только в базовых темах JoyRest (сезонные и праздничные — со своим живым фоном).
  const art = content !== null && !peek && stage !== "podium" && BASE_THEMES.has(session.themeId) ? (mechanic?.art?.(content) ?? null) : null;
  return (
    <main
      className={art ? "quiz-stage show-stage show-stage--evening hall-art" : "quiz-stage"}
      style={art ? ({ ["--hall-art" as string]: `url("/covers/art/web/${art}-1280.webp")`, ["--hall-art-hd" as string]: `url("/covers/art/web/${art}.webp")` } as CSSProperties) : undefined}
    >
      <Logo kind="monogram" className="logo--corner" title="" />
      <ClientLogo branding={session.branding} className="client-logo--corner" />
      {peek ? (
        <div className="quiz-screen quiz-screen--board">
          <BoardView
            leaderboard={peek === "round" ? roundLeaderboard(session.leaderboard) : session.leaderboard}
            title={peek === "round" ? "Счёт текущего раунда" : "Таблица сейчас"}
            showLast={false}
            showMoves={peek === "total"}
          />
        </div>
      ) : stage === "podium" ? (
        <Podium session={session} />
      ) : ScreenView && content !== null ? (
        <ScreenView key={programKey(session)} session={session} content={content} />
      ) : (
        <div className="screen-center">
          <h1 className="screen-title">Игра идёт</h1>
        </div>
      )}
      <p className="stage-code">
        Вход: {joinHint()} · код {formatSessionCode(session.code)}
        {session.program?.at === "block" && (
          <span className="stage-code__block"> · блок {session.program.index + 1} из {session.program.blocks.length}: {session.program.blocks[session.program.index]?.title ?? ""}</span>
        )}
      </p>
    </main>
  );
}

/** Финал: пьедестал (всё открыто), под ним таблица. */
function Final({ session, sawGame }: { session: Session; sawGame: boolean }) {
  const ranked = rankedLeaderboard(session.leaderboard);
  const winners = ranked.filter((e) => e.place === 1 && e.score > 0);
  // После награждения фанфары уже прозвучали на первом месте; открытый после игры экран молчит.
  const afterPodium = session.state.stage === "podium";
  const played = useRef(afterPodium || !sawGame);

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
      <ClientLogo branding={session.branding} className="client-logo--corner" />
      <div className="final">
        <p className="final__eyebrow">{winners.length > 1 ? "Победители" : winners.length === 1 ? "Победитель" : "Игра завершена"}</p>
        {winners.length > 0 && <Podium session={session} final />}
        <div className="final__board">
          {session.program ? (
            // Вечер из блоков: в конце — очки каждого по блокам и «Всего».
            <div className="ev-final">
              <h2 className="board-view__title">Очки по блокам</h2>
              <EveningTable program={session.program} board={session.leaderboard} limit={winners.length > 0 ? 4 : 7} />
            </div>
          ) : (
            <BoardView leaderboard={session.leaderboard} title="Итоговая таблица" showLast={false} limit={winners.length > 0 ? Math.min(ranked.length, 4) : 7} />
          )}
        </div>
      </div>
    </main>
  );
}

/** Мероприятие из блоков: новый блок — вид игры с чистого листа, даже если механика та же. */
function programKey(session: Session): string {
  return session.program ? `${session.program.at}-${session.program.index}` : "game";
}
