/**
 * Пульт ведущего «Бубликатора» (Блок 2d): поток `host` игровой комнаты и её команды. Все решения игры — на сервере; пульт
 * показывает этап, экипажи, кто без связи и задержку цикла и шлёт команды с этапом (`expect` = `moment`): игра ушла дальше
 * (второй пульт, двойное касание) — отказ `moved`, пульт молча ждёт свежую сводку. Необратимое — через «Вы уверены?».
 * Логика без React — `model.ts`.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { GAME_TITLE, wordsOf } from "../lexicon";
import { CAPTAIN_STARS_MAX, ORDER_SHIFT_STEP_S } from "../rules/constants";
import type { EventKind, HostView } from "../rules/types";
import { errorParts, type HostLink } from "./link";
import {
  applyHost,
  commandError,
  emptyHost,
  EVENT_HINTS,
  EVENT_TITLES,
  flightLeftOf,
  hostBoardOf,
  leftOf,
  legTitle,
  mergePick,
  mergeText,
  moveText,
  OFFLINE_SHOWN,
  mmss,
  nextLabel,
  offlineText,
  pausedMomentOf,
  type HostBoard,
  type HostModel,
} from "./model";
import "./host.css";

export interface HostProps {
  link: HostLink;
  /** Сессия платформы уже завершена. */
  sessionFinished?: boolean;
  /** Местные часы (стенд подставляет свои). */
  now?: () => number;
  /** Каждая свежая сводка (обёртка платформы пишет по ней таблицу лидеров). */
  onView?: (view: HostView) => void;
  /** «Завершить игру» на пьедестале: итоги — в «Историю игр», сессия платформы закрывается. */
  onFinish?: () => void;
}

interface Confirm {
  title: string;
  text: string;
  label: string;
  cmd: string;
  args?: unknown;
}

/** Окно подтверждения с этапом, который ведущий видел, когда окно открылось (аудит 2d, №6). */
interface OpenConfirm extends Confirm {
  moment: string;
}

const crewStyle = (color: number): CSSProperties => ({ "--bkh-crew": `var(--team-${(color % 5) + 1}, var(--color-highlight))` }) as CSSProperties;

function useTick(ms: number, on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const h = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(h);
  }, [ms, on]);
}

export function BublikatorHost({ link, sessionFinished = false, now = () => Date.now(), onView, onFinish }: HostProps) {
  const [m, setM] = useState<HostModel>(emptyHost);
  const [gen, setGen] = useState(0);
  const [take, setTake] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Команда ушла: кнопки стоят, пока комната не ответила (`inFlight`), и потом — до следующей сводки (до 3 с). Сводка, пришедшая
  // раньше ответа, кнопки не отпускает: она могла быть ещё до команды, и второе касание получило бы отказ (аудит 2d, №7).
  const [pending, setPending] = useState<{ seq: number; until: number; inFlight: boolean } | null>(null);
  const [confirm, setConfirm] = useState<OpenConfirm | null>(null);
  const receivedAt = useRef(now());
  const model = useRef(m);
  model.current = m;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  useEffect(() => {
    setProblem(null);
    const stop = link.subscribe(
      (event) => {
        receivedAt.current = now();
        setM((x) => applyHost(x, event, receivedAt.current));
      },
      (err) => {
        const { reason } = errorParts(err);
        if (reason === "busy" || reason === "replaced") setM((x) => ({ ...x, closed: reason }));
        else if (reason === "finished") setM((x) => ({ ...x, closed: "finished" }));
        else setProblem("Связь с игрой прервалась.");
      },
      take,
    );
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новая подписка — только «Открыть здесь» и «Переподключить»
  }, [link, gen]);

  useEffect(() => {
    if (m.view) onViewRef.current?.(m.view);
  }, [m.view]);

  useEffect(() => {
    if (pending && !pending.inFlight && m.seq > pending.seq) setPending(null);
  }, [m.seq, pending]);
  useEffect(() => {
    if (!pending) return;
    const h = setTimeout(() => setPending(null), Math.max(0, pending.until - now()));
    return () => clearTimeout(h);
  }, [pending, now]);

  const board: HostBoard = hostBoardOf(m, sessionFinished);
  const v = m.view;
  const timed = board === "drill" || board === "launch" || board === "fly" || board === "vote" || board === "dock";
  useTick(500, timed && pausedMomentOf(m) === null);
  const serverNow = now() + m.skew;
  const pausedAt = pausedMomentOf(m);
  const busy = pending !== null;

  /**
   * Команда комнате. `expect`: true — этап из последней сводки, false — без этапа (пауза, «Продолжить»), строка — этап, который
   * ведущий видел раньше (окно подтверждения: открыли на «Привале», нажали «Да» уже в полёте — отказ `moved`, молча).
   */
  const run = useCallback(
    async (cmd: string, args?: unknown, expect: boolean | string = true) => {
      const before = model.current;
      setError(null);
      // Пока ответа нет — не дольше 10 с (запрос сам сдаётся раньше), потом кнопки отпустит следующая сводка.
      setPending({ seq: before.seq, until: now() + 10_000, inFlight: true });
      const moment = typeof expect === "string" ? expect : expect ? before.moment : undefined;
      try {
        await link.command(cmd, args, moment);
        setPending({ seq: model.current.seq, until: now() + 3000, inFlight: false });
        return true;
      } catch (e) {
        const { code, reason } = errorParts(e);
        const text = commandError(code, reason);
        if (text) {
          setError(text);
          setPending(null);
        } else setPending({ seq: model.current.seq, until: now() + 3000, inFlight: false });
        return false;
      }
    },
    [link, now],
  );

  const ask = (c: Confirm) => setConfirm({ ...c, moment: model.current.moment });
  const doConfirm = async () => {
    const c = confirm;
    if (!c) return;
    setConfirm(null);
    await run(c.cmd, c.args, c.moment);
  };

  if (board === "tab")
    return (
      <Notice
        title={m.closed === "replaced" ? "Пульт открыли в другой вкладке" : "Пульт уже открыт в других вкладках"}
        text={
          m.closed === "replaced"
            ? "Эта вкладка больше не получает игру: управление забрала другая вкладка. Можно вернуть его сюда — та вкладка отключится."
            : "На этом устройстве уже открыты три пульта этой игры — четвёртый не подключается. Закройте лишнюю вкладку или откройте пульт здесь — самая старая вкладка отключится."
        }
      >
        <button
          type="button"
          className="btn btn--block"
          onClick={() => {
            setM(emptyHost());
            setTake(true);
            setGen((g) => g + 1);
          }}
        >
          Открыть здесь
        </button>
      </Notice>
    );
  if (board === "abandoned")
    return (
      <Notice title="Игра долго стояла" text="Больше 12 часов не было ни нажатий, ни команд — игра уснула. Можно продолжить с того же места.">
        <button
          type="button"
          className="btn btn--block"
          disabled={busy}
          onClick={async () => {
            await run("resume", undefined, false);
            setM(emptyHost());
            setGen((g) => g + 1);
          }}
        >
          Продолжить игру
        </button>
      </Notice>
    );
  if (board === "over") return <Notice title="Игра завершена" text="Итоги сохранены в «Истории игр»." />;
  if (problem && !v)
    return (
      <Notice title="Нет связи с игрой" text="Проверьте интернет и переподключитесь.">
        <button type="button" className="btn btn--block" onClick={() => setGen((g) => g + 1)}>
          Переподключить
        </button>
      </Notice>
    );
  if (!v || board === "connecting")
    return (
      <div className="bkh" aria-busy="true">
        <p className="muted">Подключаемся к игре…</p>
      </div>
    );

  const w = wordsOf(v.theme);
  const between = board === "dock" || board === "vote" || board === "voted";
  const lag = m.loop ? Math.round(m.loop.maxLagMs) : null;

  return (
    <div className="bkh" data-board={board}>
      <header className="bkh-head">
        <p className="eyebrow">{GAME_TITLE}</p>
        <h2 className="bkh-head__title">{titleOf(board, v)}</h2>
        <p className="bkh-status" aria-live="polite">
          <span>
            на связи {m.online} из {m.players}
          </span>
          {lag !== null && <span className={lag > 100 ? "is-warn" : undefined}>цикл {lag} мс</span>}
          {m.paused && <span className="is-warn">пауза</span>}
        </p>
      </header>

      {problem && (
        <p className="error" role="alert">
          {problem}{" "}
          <button type="button" className="btn btn--quiet" onClick={() => setGen((g) => g + 1)}>
            Переподключить
          </button>
        </p>
      )}

      {m.paused && board !== "lobby" && board !== "finished" && (
        <section className="bkh-pause" role="status">
          <b>{m.restored ? "Сервер перезапускался — игра на паузе" : "Игра на паузе — время стоит"}</b>
          <p className="small">Приказы, события и отсчёты стоят у всех. Нажмите, когда зал готов.</p>
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run("resume", undefined, false)}>
            ▶ Продолжить
          </button>
        </section>
      )}

      {/* Пауза — сверху: в полёте с 10 экипажами до неё не надо листать (тост, опоздание, сбой экрана). */}
      {!m.paused && board !== "lobby" && board !== "podium" && board !== "finished" && (
        <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run("pause", undefined, false)}>
          ⏸ Пауза — остановить время
        </button>
      )}

      <Board
        board={board}
        v={v}
        m={m}
        busy={busy}
        run={run}
        ask={ask}
        serverNow={serverNow}
        pausedAt={pausedAt}
        since={now() - receivedAt.current}
        shipWord={w.ship}
        onFinish={onFinish}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {between && v.canBack && (
        <button
          type="button"
          className="btn btn--quiet btn--block"
          disabled={busy || board === "vote"}
          onClick={() =>
            ask({
              title: "Переиграть перелёт?",
              text: `Вернёмся к моменту перед стартом перелёта ${v.leg + 1}: очки за него пропадут, приборы раздадутся заново. Гости, вошедшие за перелёт, останутся. Дальше — снова «Старт перелёта ${v.leg + 1}».`,
              label: "Переиграть",
              cmd: "back",
            })
          }
        >
          ↶ Назад — переиграть перелёт
        </button>
      )}

      <CrewTools v={v} board={board} busy={busy} ask={ask} />

      <ConfirmDialog open={confirm !== null} title={confirm?.title ?? ""} confirmLabel={confirm?.label ?? "Да"} onConfirm={() => void doConfirm()} onCancel={() => setConfirm(null)}>
        <p>{confirm?.text}</p>
      </ConfirmDialog>
    </div>
  );
}

function titleOf(board: HostBoard, v: HostView): string {
  switch (board) {
    case "lobby":
      return "Ждём гостей";
    case "crews":
      return "Экипажи собраны";
    case "drill":
      return "Тренировка";
    case "launch":
      return `${legTitle(v)} · взлёт`;
    case "fly":
      return `${legTitle(v)} · полёт`;
    case "dock":
      return `${legTitle(v)} · привал`;
    case "vote":
      return "Кто диверсант?";
    case "voted":
      return `${legTitle(v)} · итоги голосования`;
    case "podium":
      return "Награждение";
    case "finished":
      return "Игра окончена";
    default:
      return "";
  }
}

function Notice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="bkh" role="status">
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

interface BoardProps {
  board: HostBoard;
  v: HostView;
  m: HostModel;
  busy: boolean;
  run: (cmd: string, args?: unknown, withMoment?: boolean) => Promise<boolean>;
  ask: (c: Confirm) => void;
  serverNow: number;
  pausedAt: number | null;
  since: number;
  shipWord: string;
  onFinish?: () => void;
}

function Board(p: BoardProps) {
  const { board, v, busy, run, ask } = p;
  switch (board) {
    case "lobby":
      return (
        <section className="bkh-sec">
          <p className="small muted">Экипаж — это команда. Когда все команды на месте, соберите экипажи: экран зала покажет корабли.</p>
          {v.lobbyCrews.length > 0 && (
            <ul className="bkh-list">
              {v.lobbyCrews.map((c) => (
                <li key={c.id} className="bkh-row">
                  <span className="bkh-row__name">{c.name}</span>
                  <span className="bkh-row__meta">{c.count} чел.</span>
                </li>
              ))}
            </ul>
          )}
          {v.waiting.length > 0 && <p className="small">Без команды: {v.waiting.map((w) => w.name).join(", ")}</p>}
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run("gather")}>
            Собрать экипажи
          </button>
        </section>
      );
    case "crews":
      return (
        <section className="bkh-sec">
          <CrewList v={v} />
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run("start")}>
            Старт перелёта 1
          </button>
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run("drill")}>
            Тренировка 30 секунд (без очков)
          </button>
        </section>
      );
    case "drill": {
      const left = leftOf(v.endsAt, p.serverNow, p.pausedAt);
      return (
        <section className="bkh-sec">
          <p className="bkh-big">{left === null || left === 0 ? "Тренировка кончилась" : mmss(left)}</p>
          <p className="small muted">Приказы идут, но корпус не страдает и {p.shipWord} не летит. Объясните залу пульт.</p>
          <CrewList v={v} />
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run("start")}>
            Старт перелёта 1
          </button>
        </section>
      );
    }
    case "launch":
    case "fly":
      return <Flight {...p} />;
    case "dock":
    case "voted":
      return (
        <section className="bkh-sec">
          {board === "dock" && v.voteOpensAt !== null && (
            <p className="small">Голосование «Кто диверсант?» откроется само через {mmss(leftOf(v.voteOpensAt, p.serverNow, p.pausedAt) ?? 0)}.</p>
          )}
          {board === "voted" && <RevealSummary v={v} />}
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run("next")}>
            {nextLabel(v)}
          </button>
          {v.leg + 1 < v.legs && (
            <button
              type="button"
              className="btn btn--quiet btn--block"
              disabled={busy}
              onClick={() =>
                ask({
                  title: "Сразу к награждению?",
                  text: `Оставшиеся перелёты${board === "dock" && v.voteOpensAt !== null ? " и голосование" : ""} пропустим — пьедестал по общему счёту сейчас.`,
                  label: "К награждению",
                  cmd: "podium",
                })
              }
            >
              Сразу к награждению
            </button>
          )}
          <Ratings v={v} busy={busy} run={run} />
          {board === "voted" && <Reveal v={v} />}
          <DockTable v={v} />
        </section>
      );
    case "vote": {
      const left = leftOf(v.vote?.endsAt ?? null, p.serverNow, p.pausedAt);
      return (
        <section className="bkh-sec">
          <p className="bkh-big">{left === null ? "" : mmss(left)}</p>
          <p>
            Проголосовали {v.vote?.voted ?? 0} из {v.vote?.voters ?? 0}
          </p>
          <p className="small muted">Голосуют экипажи, где был диверсант. Голос можно поменять до конца отсчёта.</p>
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void run("vote-end")}>
            Закончить голосование
          </button>
        </section>
      );
    }
    case "podium":
      return (
        <section className="bkh-sec">
          <ol className="bkh-list">
            {(v.podium ?? []).map((r) => (
              <li key={r.crew} className="bkh-row">
                <span className="bkh-row__place">{r.place}</span>
                <span className="bkh-row__name">{r.name}</span>
                <span className="bkh-row__meta">{Math.round(r.total).toLocaleString("ru-RU")}</span>
              </li>
            ))}
          </ol>
          <p className="small muted">На экране зала — пьедестал, у гостей — карточка экипажа. Завершите игру, когда наградите.</p>
          <button type="button" className="btn btn--block" disabled={busy || !p.onFinish} onClick={() => p.onFinish?.()}>
            Завершить игру
          </button>
        </section>
      );
    case "finished":
      return (
        <section className="bkh-sec">
          <p>Игра в комнате окончена.</p>
          <button type="button" className="btn btn--block" disabled={!p.onFinish} onClick={() => p.onFinish?.()}>
            Сохранить итоги и закрыть игру
          </button>
        </section>
      );
    default:
      return null;
  }
}

function CrewList({ v }: { v: HostView }) {
  return (
    <ul className="bkh-list">
      {v.crews.map((c) => (
        <li key={c.id} className="bkh-row" style={crewStyle(c.color)}>
          <span className="bkh-dot" aria-hidden="true" />
          <span className="bkh-row__name">{c.name}</span>
          <span className="bkh-row__meta">
            {c.players} {c.doubles > 0 ? `+ ${c.doubles} дубл.` : ""} · на связи {c.online}
            {c.small ? " · мало людей" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Flight(p: BoardProps) {
  const { v, busy, run } = p;
  const [captainOpen, setCaptainOpen] = useState(false);
  const [task, setTask] = useState(0);
  const [own, setOwn] = useState("");
  const left = flightLeftOf(v, p.since, p.pausedAt !== null);
  const ev = v.event;
  const launch = v.stage === "launch";
  const allDone = v.crews.length > 0 && v.crews.every((c) => c.finished);
  const evLeft = ev ? leftOf(ev.warn ? ev.startsAt : ev.endsAt, p.serverNow, p.pausedAt) : null;
  return (
    <section className="bkh-sec">
      <div className="bkh-timers">
        <p>
          <span className="small muted">{launch ? "Взлёт" : "До конца перелёта"}</span>
          <b className="bkh-big">{launch ? mmss(leftOf(v.endsAt, p.serverNow, p.pausedAt) ?? 0) : left === null ? "—" : mmss(left)}</b>
          {v.flight?.stopped && !launch && <span className="small"> время стоит</span>}
        </p>
        <p>
          <span className="small muted">На приказ</span>
          <b className="bkh-big">{v.orderSeconds} с</b>
        </p>
      </div>
      <div className="bkh-pair">
        <button type="button" className="btn btn--secondary" disabled={busy || !v.slower} onClick={() => void run("time", { delta: ORDER_SHIFT_STEP_S, from: v.shift })}>
          Медленнее +{ORDER_SHIFT_STEP_S} с
        </button>
        <button type="button" className="btn btn--secondary" disabled={busy || !v.faster} onClick={() => void run("time", { delta: -ORDER_SHIFT_STEP_S, from: v.shift })}>
          Быстрее −{ORDER_SHIFT_STEP_S} с
        </button>
      </div>

      {ev ? (
        <div className="bkh-event" role="status">
          <b>
            {EVENT_TITLES[ev.kind]} · {ev.warn ? `через ${mmss(evLeft ?? 0)}` : `ещё ${mmss(evLeft ?? 0)}`}
          </b>
          {ev.task && <p className="small">Задание: {ev.task}</p>}
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void run("event-end", { id: ev.id })}>
            Закончить событие (без урона)
          </button>
        </div>
      ) : (
        !launch && (
          <div className="bkh-sec">
            <p className="eyebrow">Событие сейчас</p>
            {v.next && (
              <p className="small muted">
                По расписанию: {EVENT_TITLES[v.next.kind]} через {mmss(v.next.inMs)}
              </p>
            )}
            {v.enabled.length === 0 && <p className="small muted">Все события выключены в настройках игры.</p>}
            <div className="bkh-grid">
              {v.enabled.map((k: EventKind) => (
                <button
                  key={k}
                  type="button"
                  className={k === "captain" && captainOpen ? "btn" : "btn btn--secondary"}
                  disabled={busy || p.m.paused || allDone}
                  title={EVENT_HINTS[k]}
                  onClick={() => (k === "captain" ? setCaptainOpen((o) => !o) : void run("event", { kind: k }))}
                >
                  {EVENT_TITLES[k]}
                </button>
              ))}
            </div>
            {allDone && <p className="small muted">Все экипажи у цели — событий больше нет.</p>}
            {captainOpen && (
              <div className="bkh-sec bkh-captain">
                <p className="small">Задание на экран зала — 60 секунд, приказы стоят. Потом поставьте звёзды экипажам.</p>
                {v.tasks.map((t, i) => (
                  <label key={i} className="choice">
                    <input type="radio" name="bkh-task" checked={task === i && own.trim() === ""} onChange={() => (setTask(i), setOwn(""))} />
                    <span className="choice__text">
                      <span className="choice__title">{t}</span>
                    </span>
                  </label>
                ))}
                <label className="field">
                  Своё задание
                  <input value={own} maxLength={120} onChange={(e) => setOwn(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn btn--block"
                  disabled={busy || p.m.paused || allDone}
                  onClick={async () => {
                    const text = own.trim() || v.tasks[task] || "";
                    if (await run("event", { kind: "captain", task: text })) setCaptainOpen(false);
                  }}
                >
                  Начать «Все на палубу!»
                </button>
              </div>
            )}
          </div>
        )
      )}

      <FlightTable v={v} />
      <Ratings v={v} busy={busy} run={run} />
    </section>
  );
}

function FlightTable({ v }: { v: HostView }) {
  const crews = [...v.crews].sort((a, b) => a.place - b.place || a.id - b.id);
  return (
    <ul className="bkh-list" aria-label="Экипажи в полёте">
      {crews.map((c) => (
        <li key={c.id} className="bkh-row bkh-row--flight" style={crewStyle(c.color)}>
          <span className="bkh-row__place">{c.place}</span>
          <span className="bkh-row__name">{c.name}</span>
          <span className="bkh-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, c.dist / 10)}%` }} />
          </span>
          <span className="bkh-row__meta">
            {c.finished ? "у цели ✓" : c.repair ? "ремонт" : `${Math.round(c.dist / 10)}%`} · корпус {Math.max(0, Math.round(c.hull * 10) / 10).toLocaleString("ru-RU")} · {c.rate.toLocaleString("ru-RU")} / мин
            {c.online < c.players ? ` · без связи ${c.players - c.online}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DockTable({ v }: { v: HostView }) {
  const rows = v.dock?.rows ?? [];
  if (rows.length === 0) return null;
  return (
    <ol className="bkh-list" aria-label="Итоги перелёта">
      {rows.map((r) => (
        <li key={r.crew} className="bkh-row">
          <span className="bkh-row__place">{r.place}</span>
          <span className="bkh-row__name">{r.name}</span>
          <span className="bkh-row__meta">
            +{Math.round(r.total).toLocaleString("ru-RU")} · всего {Math.round(v.crews.find((c) => c.id === r.crew)?.total ?? 0).toLocaleString("ru-RU")}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RevealSummary({ v }: { v: HostView }) {
  const list = v.reveal ?? [];
  if (list.length === 0) return <p className="small muted">Диверсантов в этом перелёте не было.</p>;
  return (
    <p>
      Диверсантов раскусили: {list.filter((r) => r.guessed).length} из {list.length}
    </p>
  );
}

/** Кто был диверсантом — свёрнуто (на экране зала раскрытие идёт по одному). */
function Reveal({ v }: { v: HostView }) {
  const list = v.reveal ?? [];
  if (list.length === 0) return null;
  return (
    <details className="bkh-fold">
      <summary>Кто был диверсантом</summary>
      <ul className="bkh-list" aria-label="Диверсанты">
      {list.map((r, i) => {
        const crew = v.crews.find((c) => c.id === r.crew);
        return (
          <li key={i} className="bkh-row">
            <span className="bkh-row__name">
              {crew?.name ?? "Экипаж"}: {r.name}
            </span>
            <span className="bkh-row__meta">{r.guessed ? "раскусили, +50" : "«Мастер обмана»"}</span>
          </li>
        );
      })}
      </ul>
    </details>
  );
}

/** Звёзды «Все на палубу!»: каждому экипажу 0–5, звезда = +10; повторное «Начислить» заменяет прошлые. */
function Ratings({ v, busy, run }: { v: HostView; busy: boolean; run: BoardProps["run"] }) {
  const [draft, setDraft] = useState<Record<string, Record<string, number>>>({});
  if (v.captain.length === 0) return null;
  return (
    <details className="bkh-fold" open={v.event?.kind === "captain" || undefined}>
      <summary>Звёзды за «Все на палубу!» ({v.captain.length})</summary>
      {v.captain.map((c) => {
        const stars = { ...c.stars, ...(draft[c.id] ?? {}) };
        return (
          <div key={c.id} className="bkh-sec">
            <p className="small">«{c.task}»</p>
            {v.crews.map((crew) => (
              <div key={crew.id} className="bkh-stars" style={crewStyle(crew.color)}>
                <span className="bkh-row__name">{crew.name}</span>
                <div className="seg" role="group" aria-label={`Звёзды: ${crew.name}`}>
                  {Array.from({ length: CAPTAIN_STARS_MAX + 1 }, (_, n) => (
                    <button
                      key={n}
                      type="button"
                      className={(stars[String(crew.id)] ?? 0) === n ? "seg__btn is-on" : "seg__btn"}
                      aria-pressed={(stars[String(crew.id)] ?? 0) === n}
                      onClick={() => setDraft((d) => ({ ...d, [c.id]: { ...(d[c.id] ?? {}), [String(crew.id)]: n } }))}
                    >
                      {n === 0 ? "0" : `${n}★`}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--secondary btn--block"
              disabled={busy}
              onClick={async () => {
                if (await run("rate", { event: c.id, stars })) setDraft((d) => ({ ...d, [c.id]: {} }));
              }}
            >
              Начислить звёзды
            </button>
          </div>
        );
      })}
    </details>
  );
}

/**
 * Экипажи: объединить и пересадить (свёрнуто, сверху — до него не листать), ниже — «Давно без связи» (первые трое и «Показать
 * всех»). Всё необратимое — через «Вы уверены?» (аудит 2d, №2, №5, №9).
 */
function CrewTools({ v, board, busy, ask }: { v: HostView; board: HostBoard; busy: boolean; ask: (c: Confirm) => void }) {
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [who, setWho] = useState("");
  const [where, setWhere] = useState<number | null>(null);
  const [allOffline, setAllOffline] = useState(false);
  if (board === "podium" || board === "finished" || board === "lobby") return null;
  const crews = v.crews;
  const small = crews.filter((c) => c.small);
  const between = board === "dock" || board === "vote" || board === "voted";
  const canMerge = v.merge === null && crews.length >= 2;
  const canMove = v.move === null && crews.length >= 2;
  const members = crews.flatMap((c) => c.members.filter((x) => x.role !== "out").map((x) => ({ ...x, crew: c.id, crewName: c.name })));
  const { fromId, toId } = mergePick(crews, from, to);
  const fromCrew = crews.find((c) => c.id === fromId);
  const toCrew = crews.find((c) => c.id === toId);
  const target = members.find((x) => x.pid === who) ?? members[0];
  const whereCrew = crews.find((c) => c.id === where && c.id !== target?.crew) ?? crews.find((c) => c.id !== target?.crew);
  const offline = allOffline ? v.removable : v.removable.slice(0, OFFLINE_SHOWN);
  return (
    <>
      {(canMerge || canMove || small.length > 0) && (
        <details className="bkh-fold" open={small.length > 0 && canMerge ? true : undefined}>
          <summary>Экипажи: объединить, пересадить{small.length > 0 ? ` · мало людей: ${small.length}` : ""}</summary>
          {small.length > 0 && <p className="small">В экипаже меньше 3 человек — ему трудно. Объедините его с другим.</p>}
          {!canMerge && v.merge === "vote-pending" && <p className="small muted">Объединять — после голосования «Кто диверсант?».</p>}
          {!canMerge && v.merge === "busy" && <p className="small muted">Объединять можно, пока экипажи на старте и на «Привале».</p>}
          {canMerge && fromCrew && toCrew && (
            <div className="bkh-sec">
              <label className="field">
                Кого влить
                <select value={fromCrew.id} onChange={(e) => setFrom(Number(e.target.value))}>
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.players})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                В какой экипаж
                <select value={toCrew.id} onChange={(e) => setTo(Number(e.target.value))}>
                  {crews
                    .filter((c) => c.id !== fromCrew.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.players})
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--secondary btn--block"
                disabled={busy}
                onClick={() =>
                  ask({ title: "Объединить экипажи?", text: mergeText(fromCrew, toCrew, between), label: "Объединить", cmd: "merge", args: { from: fromCrew.id, to: toCrew.id } })
                }
              >
                Объединить
              </button>
            </div>
          )}
          {canMove && target && whereCrew && (
            <div className="bkh-sec">
              <label className="field">
                Кого пересадить
                <select value={target.pid} onChange={(e) => setWho(e.target.value)}>
                  {members.map((x) => (
                    <option key={x.pid} value={x.pid}>
                      {x.name} — {x.crewName}
                      {x.online ? "" : ` (${offlineText(x.offlineMs)})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                В экипаж
                <select value={whereCrew.id} onChange={(e) => setWhere(Number(e.target.value))}>
                  {crews
                    .filter((c) => c.id !== target.crew)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--secondary btn--block"
                disabled={busy}
                onClick={() =>
                  ask({ title: `Пересадить «${target.name}»?`, text: moveText(target.name, target.crewName, whereCrew.name), label: "Пересадить", cmd: "move", args: { pid: target.pid, crew: whereCrew.id } })
                }
              >
                Пересадить
              </button>
              <p className="small muted">Пересадка — до смены команды: сменит команду на телефоне — окажется в её экипаже.</p>
            </div>
          )}
          {!canMove && v.move === "busy" && <p className="small muted">Пересаживать можно до перелёта и на «Привале».</p>}
        </details>
      )}
      {v.removable.length > 0 && (
        <section className="bkh-sec" aria-label="Давно без связи">
          <p className="eyebrow">Давно без связи · {v.removable.length}</p>
          {offline.map((r) => (
            <div key={r.pid} className="bkh-row">
              <span className="bkh-row__name">{r.name}</span>
              <span className="bkh-row__meta">{offlineText(r.offlineMs)}</span>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() =>
                  ask({
                    title: `Убрать «${r.name}» из игры?`,
                    text: "Гость минуту без связи. Приказов ему больше не будет, «Притяжение» его не ждёт, его приборы со следующего перелёта — товарищам.",
                    label: "Убрать",
                    cmd: "remove",
                    args: { pid: r.pid },
                  })
                }
              >
                Убрать
              </button>
            </div>
          ))}
          {v.removable.length > OFFLINE_SHOWN && (
            <button type="button" className="btn btn--quiet btn--block" aria-expanded={allOffline} onClick={() => setAllOffline((x) => !x)}>
              {allOffline ? "Свернуть список" : `Показать всех (${v.removable.length})`}
            </button>
          )}
        </section>
      )}
    </>
  );
}
