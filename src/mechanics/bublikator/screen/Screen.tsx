/**
 * Экран зала «Бубликатора» (Блок 2c): поток `screen` игровой комнаты → модель → экран по макетам `scr-*`. Звуки (синтез
 * платформы, `sound.ts`) и салют — только если момент наступил при открытом экране; при «уменьшить движение» — без анимаций.
 * Связь — `ScreenLink` (настоящая — `roomsRepo`, на стенде — комната в памяти).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { playSound, type SoundName } from "../../../components/live/sound";
import { localNow, reasonOf } from "../phone/model";
import type { ScreenView, Theme } from "../rules/types";
import { PauseIcon } from "../phone/art";
import {
  CaptainBoard,
  CrewsBoard,
  DockBoard,
  DrillBoard,
  FlightBoard,
  InfoBoard,
  LaunchBoard,
  LobbyBoard,
  OverBoard,
  PodiumBoard,
  PullBoard,
  RevealBoard,
  SosBoard,
  VoteBoard,
  type BoardProps,
} from "./boards";
import type { ScreenLink } from "./link";
import { applyScreen, boardOf, emptyScreen, lanesOf, momentsFor, nextBumps, revealedCount, soundsOf, sosLit, sosToneOf, tickOf, type Board, type Bumps, type ScreenModel } from "./model";
import "./screen.css";

export interface ScreenProps {
  link: ScreenLink;
  code: string;
  /** Сессия уже завершена (комната ответит «finished»): без вида — «Игра окончена». */
  sessionFinished?: boolean;
  /** Итоги платформы — если комнаты уже нет (перезагрузили экран после завершения). */
  fallbackBoard?: ReadonlyArray<{ id: string; name: string; score: number }>;
  fallbackTheme?: Theme;
  /** Часы для стенда (по умолчанию — монотонные `localNow`). */
  now?: () => number;
  /** Стенд: «уменьшить движение» без медиазапроса. */
  reduced?: boolean;
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Перерисовка по часам — только у досок с отсчётом (аудит 2c, №13); null — без тика (лобби, привал, пьедестал…). */
function useTick(ms: number | null): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (ms === null) return;
    const h = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(h);
  }, [ms]);
}

interface Burst {
  id: number;
  x: number;
  y: number;
  color: number;
  big: boolean;
}

const BURSTS_MAX = 24;
const BURST_MS = 1300;

/** Где салют экипажа: у финишной черты его дорожки (на полёте), иначе — в верхней половине кадра. */
function burstPlace(v: ScreenView, crew: number, n: number): { x: number; y: number } {
  const { lanes } = lanesOf(v.crews);
  const i = lanes.findIndex((c) => c.id === crew);
  const jitter = (k: number) => ((Math.sin(crew * 7.3 + n * 3.1 + k) + 1) / 2) * 6 - 3;
  if (i >= 0) {
    const top = 18;
    const height = 66;
    return { x: 74 + jitter(1), y: top + ((i + 0.5) / lanes.length) * height + jitter(2) };
  }
  return { x: 20 + ((crew * 37 + n * 13) % 60), y: 18 + ((crew * 11 + n * 7) % 30) };
}

export function BublikatorScreen({ link, code, sessionFinished = false, fallbackBoard = [], fallbackTheme = "space", now = localNow, reduced }: ScreenProps) {
  const [m, setM] = useState<ScreenModel>(() => emptyScreen(now()));
  const [take, setTake] = useState(false);
  const [gen, setGen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [revealSeen, setRevealSeen] = useState<number | null>(null);
  const [bumps, setBumps] = useState<Bumps>({});
  const prevView = useRef<ScreenView | null>(null);
  const burstSeq = useRef(0);
  const lastPop = useRef(0);
  const lastBeep = useRef(-Infinity);
  const lastLit = useRef<number | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const board: Board = sessionFinished && !m.view ? "over" : boardOf(m);
  const revealing = board === "reveal" && revealSeen !== null && revealedCount(m.view?.reveal?.length ?? 0, now() - revealSeen) < (m.view?.reveal?.length ?? 0);
  useTick(tickOf(board, revealing, m.paused));
  // Таймеры салюта снимаются вместе с экраном (аудит 2c, №19).
  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const h of set) clearTimeout(h);
      set.clear();
    };
  }, []);

  useEffect(() => {
    setError(null);
    return link.subscribe(
      (event) => setM((x) => applyScreen(x, event, now())),
      (problem) => {
        const reason = reasonOf(problem);
        if (reason === "finished") return setM((x) => ({ ...x, closed: "finished" }));
        if (reason === "replaced" || reason === "busy" || reason === "removed") return;
        setError("Связь с игрой прервалась — обновите страницу.");
      },
      take,
    );
  }, [link, now, take, gen]);

  // Моменты: звук и салют — только то, что наступило при открытом экране.
  useEffect(() => {
    // Снимок (первая сводка, переподключение, опрос, после «закрыто») — без моментов: ни запоздалых аплодисментов, ни фанфар,
    // ни салюта (аудит 2c, №6).
    const prev = m.fresh ? null : prevView.current;
    const next = m.view;
    prevView.current = next;
    if (!next) return;
    const mo = momentsFor(prev, m);
    setBumps((b) => nextBumps(prev, next, m.fresh, b));
    const glitch = prev !== null && next.glitchUntil !== null && prev.glitchUntil === null;
    const picked = soundsOf(mo, glitch, now(), lastBeep.current);
    lastBeep.current = picked.beepAt;
    const sounds: SoundName[] = picked.sounds.filter((x) => x !== "pop");
    if (mo.reveal) setRevealSeen(now());
    if (next.stage !== "voted") setRevealSeen(null);
    const fresh: Burst[] = [];
    const still = reduced ?? reduceMotion();
    if (!still) {
      for (const crew of mo.finish) {
        const c = next.crews.find((x) => x.id === crew);
        fresh.push({ id: ++burstSeq.current, ...burstPlace(next, crew, burstSeq.current), color: c?.color ?? 0, big: true });
      }
      for (const s of mo.salutes) {
        const c = next.crews.find((x) => x.id === s.crew);
        for (let k = 0; k < Math.min(3, s.n); k += 1) fresh.push({ id: ++burstSeq.current, ...burstPlace(next, s.crew, burstSeq.current), color: c?.color ?? 0, big: false });
      }
    }
    if (picked.sounds.includes("pop") && now() - lastPop.current > 300) {
      lastPop.current = now();
      sounds.push("pop");
    }
    for (const s of new Set(sounds)) playSound(s);
    if (fresh.length > 0) {
      setBursts((b) => [...b, ...fresh].slice(-BURSTS_MAX));
      const ids = new Set(fresh.map((f) => f.id));
      const h = setTimeout(() => {
        timers.current.delete(h);
        setBursts((b) => b.filter((x) => !ids.has(x.id)));
      }, BURST_MS);
      timers.current.add(h);
    }
  }, [m.view, now, reduced]);

  // Тон на каждый огонёк SOS — свой на цвет (решение владельца 11 ноября 2026), только пока экран открыт и игра идёт.
  const sosEv = board === "sos" && !m.paused ? m.view?.event ?? null : null;
  const sosSeq = sosEv?.seq ?? [];
  const lit = sosEv ? sosLit(sosSeq.length, sosEv.startsAt, now() + (m.offset ?? 0)) : null;
  useEffect(() => {
    const tone = sosToneOf(sosSeq, lit, lastLit.current);
    lastLit.current = lit;
    if (tone) playSound(tone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lit, sosEv?.id]);

  const local = now();
  const theme: Theme = m.view?.theme ?? fallbackTheme;
  const v = m.view;
  const props: BoardProps | null = v ? { m, v, local, code, revealSeen, bumps } : null;

  let content: ReactNode;
  switch (board) {
    case "tab":
      content = (
        <InfoBoard theme={theme} title="Экран открыт в другой вкладке" text="Здесь он остановлен, чтобы не мешать. Нужен этот — нажмите «Открыть здесь».">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setM((x) => ({ ...x, closed: null }));
              setTake(true);
              setGen((g) => g + 1);
            }}
          >
            Открыть здесь
          </button>
        </InfoBoard>
      );
      break;
    case "abandoned":
      content = <InfoBoard theme={theme} title="Ждём ведущего" text="Игра давно стоит. Как только ведущий продолжит, экран оживёт сам." />;
      break;
    case "removed":
      content = <InfoBoard theme={theme} title="Экран отключён" text="Обновите страницу, чтобы подключиться снова." />;
      break;
    case "connecting":
      content = <InfoBoard theme={theme} title="Подключаемся к игре…" text={error ?? "Секунду — загружаем экипажи."} />;
      break;
    case "over":
      content = <OverBoard theme={theme} board={fallbackBoard} />;
      break;
    default:
      content = props ? <BoardOf board={board} props={props} /> : null;
  }

  return (
    <div className={`bks bks--${theme}${(reduced ?? false) ? " is-still" : ""}${m.paused ? " is-paused" : ""}${v?.event?.warn && v.phase === "leg" ? " is-alarm" : ""}`} data-board={board}>
      <div className="bks__bg" aria-hidden="true" />
      <div className="bks__stage">{content}</div>
      {bursts.length > 0 && (
        <div className="bks-fx" aria-hidden="true">
          {bursts.map((b) => (
            <span key={b.id} className={b.big ? "bks-burst is-big" : "bks-burst"} style={{ left: `${b.x}%`, top: `${b.y}%`, "--bk-crew": `var(--team-${(b.color % 5) + 1}, #e3aa9c)` } as CSSProperties}>
              {Array.from({ length: 12 }, (_, i) => (
                <i key={i} style={{ "--a": `${i * 30}deg` } as CSSProperties} />
              ))}
            </span>
          ))}
        </div>
      )}
      {m.paused && v && board !== "tab" && board !== "abandoned" && (
        <div className="bks-pause" role="status">
          <PauseIcon />
          <b>Пауза</b>
          <span>Ведущий остановил игру — время стоит. Сейчас продолжим.</span>
        </div>
      )}
      {error && board !== "connecting" && (
        <p className="bks-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function BoardOf({ board, props }: { board: Board; props: BoardProps }) {
  switch (board) {
    case "lobby":
      return <LobbyBoard {...props} />;
    case "crews":
      return <CrewsBoard {...props} />;
    case "drill":
      return <DrillBoard {...props} />;
    case "launch":
      return <LaunchBoard {...props} />;
    case "pull":
      return <PullBoard {...props} />;
    case "sos":
      return <SosBoard {...props} />;
    case "captain":
      return <CaptainBoard {...props} />;
    case "dock":
      return <DockBoard {...props} />;
    case "vote":
      return <VoteBoard {...props} />;
    case "reveal":
      return <RevealBoard {...props} />;
    case "podium":
      return <PodiumBoard {...props} />;
    default:
      return <FlightBoard {...props} />;
  }
}
