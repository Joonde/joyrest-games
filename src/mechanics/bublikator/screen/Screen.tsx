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
import { applyScreen, boardOf, emptyScreen, lanesOf, momentsOf, type Board, type ScreenModel } from "./model";
import "./screen.css";

export interface ScreenProps {
  link: ScreenLink;
  code: string;
  /** Сессия уже завершена (комната ответит «finished»): без вида — «Игра окончена». */
  sessionFinished?: boolean;
  saboteurs?: boolean;
  /** Итоги платформы — если комнаты уже нет (перезагрузили экран после завершения). */
  fallbackBoard?: ReadonlyArray<{ id: string; name: string; score: number }>;
  fallbackTheme?: Theme;
  /** Часы для стенда (по умолчанию — монотонные `localNow`). */
  now?: () => number;
  /** Стенд: «уменьшить движение» без медиазапроса. */
  reduced?: boolean;
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function useTick(ms: number): void {
  const [, set] = useState(0);
  useEffect(() => {
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

export function BublikatorScreen({ link, code, sessionFinished = false, saboteurs = false, fallbackBoard = [], fallbackTheme = "space", now = localNow, reduced }: ScreenProps) {
  const [m, setM] = useState<ScreenModel>(() => emptyScreen(now()));
  const [take, setTake] = useState(false);
  const [gen, setGen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [revealSeen, setRevealSeen] = useState<number | null>(null);
  const prevView = useRef<ScreenView | null>(null);
  const burstSeq = useRef(0);
  const lastPop = useRef(0);
  const board: Board = sessionFinished && !m.view ? "over" : boardOf(m);
  useTick(board === "sos" ? 100 : 250);

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
    const prev = prevView.current;
    const next = m.view;
    prevView.current = next;
    if (!next) return;
    const mo = momentsOf(prev, next);
    const sounds: SoundName[] = [];
    if (mo.launch) sounds.push("whoosh");
    if (mo.event) sounds.push("gong");
    if (mo.dock) sounds.push("applause");
    if (mo.reveal) sounds.push("drumroll");
    if (mo.podium) sounds.push("fanfare");
    if (prev && next.glitchUntil !== null && prev.glitchUntil === null) sounds.push("sparkle");
    if (mo.finish.length > 0) sounds.push("ding");
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
    if (mo.salutes.length > 0 && now() - lastPop.current > 300) {
      lastPop.current = now();
      sounds.push("pop");
    }
    for (const s of new Set(sounds)) playSound(s);
    if (fresh.length > 0) {
      setBursts((b) => [...b, ...fresh].slice(-BURSTS_MAX));
      const ids = new Set(fresh.map((f) => f.id));
      setTimeout(() => setBursts((b) => b.filter((x) => !ids.has(x.id))), BURST_MS);
    }
  }, [m.view, now, reduced]);

  const local = now();
  const theme: Theme = m.view?.theme ?? fallbackTheme;
  const v = m.view;
  const props: BoardProps | null = v ? { m, v, local, code, saboteurs, revealSeen } : null;

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
    <div className={`bks bks--${theme}${(reduced ?? false) ? " is-still" : ""}`} data-board={board}>
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
