/**
 * Экран зала «Игр Матрёшки» (Блок 3c): поток `screen` игровой комнаты → модель → экран по макетам второй версии. Двор — фон
 * Figma AI своего стиля (гжель днём, хохлома ночью), матрёшка — роспись в коде (`art/`). Музыка игры — синтез под назначенные
 * моменты (песенка «Замри!», плясовая «Стульев», барабан «Каната»), звуки — синтез; всё — только если момент наступил при
 * открытом экране; «уменьшить движение» — без анимаций.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSoundReady } from "../../../components/live/sound";
import { playSound } from "../../../components/live/sound";
import { folkDefsInner } from "../art/folk";
import { paletteVars } from "../art/palette";
import type { Style } from "../rules/types";
import { playMat, Sequencer, type MatSound } from "./audio";
import { BoardOf, type BoardProps } from "./boards";
import { Overlays } from "./overlays";
import type { ScreenLink } from "./link";
import { applyScreen, boardOf, emptyScreen, momentsOf, serverNow, type Board, type ScreenModel } from "./model";
import { chantNotes, danceNotes, heartNotes, ropeNotes, type Note } from "./music";
import "./screen.css";

export interface ScreenProps {
  link: ScreenLink;
  code: string;
  sessionFinished?: boolean;
  /** Итоги платформы — если комнаты уже нет. */
  fallbackBoard?: ReadonlyArray<{ id: string; name: string; score: number; place?: number }>;
  fallbackStyle?: Style;
  /** Местные часы (по умолчанию `performance`). */
  now?: () => number;
  /** Сдвиг сверенных часов «сервер − местные» (`GET /api/time`) или null, пока не сверили. */
  synced?: () => number | null;
  reduced?: boolean;
}

export function localNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.timeOrigin + performance.now();
  return Date.now();
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function reasonOf(error: unknown): string | null {
  const r = (error as { reason?: unknown } | null)?.reason;
  return typeof r === "string" ? r : null;
}

/** Как часто перерисовывать доску (отсчёты, «Табло» листается само раз в 6 с). */
function tickOf(board: Board, paused: boolean, scoreboard: boolean): number | null {
  if (paused) return null;
  if (["rules", "countdown", "freeze", "ginger", "chairs", "rope", "hop", "chance", "dobivka", "duel", "open", "bestFan"].includes(board)) return 250;
  return scoreboard ? 1000 : null;
}

function useTick(ms: number | null): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (ms === null) return;
    const h = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(h);
  }, [ms]);
}

/** Ноты окна [t, t + 0,8 с] для доски: песенка, сердце взгляда, плясовая, барабан, шкатулка лобби. */
function notesFor(m: ScreenModel, board: Board, t: number, lobbyFrom: number): Note[] {
  const v = m.view;
  if (!v || m.paused) return [];
  const to = t + 800;
  const p = v.trial?.play;
  if (board === "freeze" && p?.kind === "freeze" && p.phrase) return [...chantNotes(p.phrase), ...heartNotes(p.phrase)].filter((n) => n.t >= t - 50 && n.t < to);
  if (board === "chairs" && p?.kind === "chairs" && p.sub === "music" && p.musicAt !== null) return danceNotes(t, to, p.musicAt, p.stopAt, p.decoyAt);
  if (board === "rope" && p?.kind === "rope" && p.sub === "pull" && p.attemptAt !== null && p.attemptEnds !== null) return ropeNotes(t, to, p.attemptAt, p.attemptEnds);
  if (board === "lobby") return danceNotes(t, to, lobbyFrom, null, null, { box: true, speed: 0.55 });
  return [];
}

export function MatryoshkaScreen({ link, code, sessionFinished = false, fallbackBoard = [], fallbackStyle = "sunny", now = localNow, synced, reduced }: ScreenProps) {
  const [m, setM] = useState<ScreenModel>(() => emptyScreen(now()));
  const model = useRef(m);
  const [take, setTake] = useState(false);
  const [gen, setGen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [champSince, setChampSince] = useState<number | null>(null);
  /** Когда экран сам увидел вход в этап (для анимаций «при открытом экране»): ключ этапа → местное время. */
  const [liveAt, setLiveAt] = useState<Record<string, number>>({});
  const still = reduced ?? reduceMotion();
  const stillRef = useRef(still);
  stillRef.current = still;
  const offset = () => synced?.() ?? null;
  const getNow = () => serverNow(model.current, now(), offset());
  const getNowRef = useRef(getNow);
  getNowRef.current = getNow;

  const onModel = (before: ScreenModel, next: ScreenModel) => {
    const mo = momentsOf(next.fresh ? null : before.view, next.view);
    const sounds: Array<MatSound | "drumroll" | "fanfare" | "applause" | "sparkle" | "ding" | "pop" | "correct" | "tick" | "whoosh"> = [];
    if (mo.open) sounds.push("sparkle");
    if (mo.countdown) sounds.push("tick");
    if (mo.judging) sounds.push("drumroll");
    if (mo.caught) sounds.push("caught");
    if (mo.box) sounds.push("pop");
    if (mo.crack) sounds.push("krak");
    else if (mo.whole) sounds.push("ding");
    if (mo.seated) sounds.push("ding");
    if (mo.ropeWin) sounds.push("correct");
    if (mo.ice) sounds.push("ice");
    if (mo.door) sounds.push("sparkle");
    if (mo.back) sounds.push("correct");
    if (mo.show) sounds.push("whoosh");
    if (mo.duelWon) sounds.push("correct");
    if (mo.champion) sounds.push("fanfare");
    if (mo.podium) sounds.push("fanfare");
    for (const s of new Set(sounds)) {
      if (s === "drumroll" || s === "fanfare" || s === "applause" || s === "sparkle" || s === "ding" || s === "pop" || s === "correct" || s === "tick" || s === "whoosh") playSound(s);
      else playMat(s);
    }
    if (mo.reveal > 0) {
      const k = Math.min(8, mo.reveal);
      for (let i = 0; i < k; i += 1) {
        playMat("puff", 0.5 + i * 0.22);
        playMat("clink", 1.3 + i * 0.22);
      }
    }
    if (mo.champion) {
      setChampSince(now());
      window.setTimeout(() => playSound("applause"), 900);
    }
    const v = next.view;
    if (!next.fresh && v) {
      const keys: string[] = [];
      if (mo.open && v.trial) keys.push(`open${v.trial.index}`);
      if (mo.reveal > 0 && v.trial) keys.push(`reveal${v.trial.index}`);
      if (mo.champion) keys.push("champion");
      if (mo.door) keys.push("door");
      if (keys.length > 0) setLiveAt((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, now()])) }));
    }
  };
  const onModelRef = useRef(onModel);
  onModelRef.current = onModel;

  useEffect(() => {
    setError(null);
    const update = (change: (x: ScreenModel) => ScreenModel) => {
      const before = model.current;
      const next = change(before);
      model.current = next;
      setM(next);
      if (next.view !== before.view) onModelRef.current(before, next);
    };
    return link.subscribe(
      (event) => update((x) => applyScreen(x, event, now())),
      (problem) => {
        const reason = reasonOf(problem);
        if (reason === "finished") return update((x) => ({ ...x, closed: "finished" }));
        if (reason === "replaced" || reason === "busy" || reason === "removed") return;
        setError("Связь с игрой прервалась — обновите страницу.");
      },
      take,
    );
  }, [link, now, take, gen]);

  const local = now();
  const board: Board = sessionFinished && !m.view ? "over" : boardOf(m, local, champSince);
  useTick(tickOf(board, m.paused, m.view?.scoreboard !== null && m.view?.board === true));

  // Музыка игры: ноты наперёд по часам сервера (раз в 100 мс), пауза и смена доски снимают запланированное.
  const soundOn = useSoundReady();
  const seq = useMemo(() => new Sequencer(), []);
  const boardRef = useRef(board);
  boardRef.current = board;
  const lobbyFrom = useRef(local);
  const musicKey = `${board}|${m.paused ? 1 : 0}|${m.view?.trial?.index ?? -1}|${(m.view?.trial?.play?.kind === "chairs" && m.view.trial.play.round) || 0}`;
  useEffect(() => {
    seq.clear();
    if (!soundOn || m.paused) return;
    const h = window.setInterval(() => {
      seq.feed(notesFor(model.current, boardRef.current, getNowRef.current(), lobbyFrom.current), getNowRef.current());
    }, 100);
    return () => {
      window.clearInterval(h);
      seq.clear();
    };
  }, [musicKey, soundOn, seq]);
  // Фраза сменилась (пауза сдвинула моменты, «Назад») — запланированное по старым моментам снять.
  const phraseKey = m.view?.trial?.play?.kind === "freeze" ? `${m.view.trial.play.phrase?.start ?? ""}:${m.view.trial.play.phrase?.at ?? ""}` : "";
  useEffect(() => {
    if (phraseKey) seq.clear();
  }, [phraseKey, seq]);
  useEffect(() => () => seq.clear(), [seq]);

  const v = m.view;
  const style: Style = v?.style ?? fallbackStyle;
  const props: BoardProps | null = v ? { m, v, local, code, getNow, still, liveAt, champSince } : null;
  let content: ReactNode;
  switch (board) {
    case "tab":
      content = (
        <Info title="Экран открыт в другой вкладке" text="Здесь он остановлен, чтобы не мешать. Нужен этот — нажмите «Открыть здесь».">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTake(true);
              setGen((g) => g + 1);
            }}
          >
            Открыть здесь
          </button>
        </Info>
      );
      break;
    case "abandoned":
      content = <Info title="Ждём ведущего" text="Игра давно стоит. Как только ведущий продолжит, экран оживёт сам." />;
      break;
    case "removed":
      content = <Info title="Экран отключён" text="Обновите страницу, чтобы подключиться снова." />;
      break;
    case "connecting":
      content = <Info title="Подключаемся к игре…" text={error ?? "Секунду — Матрёшка уже идёт во двор."} />;
      break;
    case "over":
      content = <Over board={fallbackBoard} />;
      break;
    default:
      content = props ? <BoardOf board={board} props={props} /> : null;
  }
  const vars = { ...paletteVars(style), "--yard": `url("/matryoshka/art/web/${style}-1280.webp")`, "--yard-hd": `url("/matryoshka/art/web/${style}.webp")` } as CSSProperties;
  return (
    <div className={`mts mts--${style}${still ? " is-still" : ""}${m.paused ? " is-paused" : ""}`} style={vars} data-board={board}>
      <FolkDefs />
      <div className="mts__bg" aria-hidden="true" />
      <div className="mts__stage">
        {content}
        {props && <Overlays {...props} board={board} />}
      </div>
      {error && board !== "connecting" && (
        <p className="mts-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Определения SVG росписи (градиенты, узоры, свечение банки и льда) — один раз на экран. */
function FolkDefs() {
  const html = useMemo(() => folkDefsInner(), []);
  return (
    <svg className="mts-defs" width="0" height="0" aria-hidden="true">
      <defs dangerouslySetInnerHTML={{ __html: html }} />
    </svg>
  );
}

function Info({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="mts-info">
      <div className="mts-plate mts-info__card">
        <div className="mts-title">{title}</div>
        <p className="mts-body">{text}</p>
        {children}
      </div>
    </div>
  );
}

function Over({ board }: { board: ReadonlyArray<{ id: string; name: string; score: number; place?: number }> }) {
  return (
    <div className="mts-info">
      <div className="mts-plate mts-info__card">
        <div className="mts-eyebrow">Игры Матрёшки</div>
        <div className="mts-title">Игра окончена</div>
        {board.length > 0 && (
          <ol className="mts-over">
            {board.slice(0, 8).map((r, i) => (
              <li key={r.id}>
                <b className="mts-num">{r.place ?? i + 1}</b>
                <span>{r.name}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
