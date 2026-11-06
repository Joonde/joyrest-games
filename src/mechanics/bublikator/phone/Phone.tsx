/**
 * Телефон гостя «Бубликатора» (Блок 2b): личный поток комнаты → экран по макетам, касания → пачки комнаты.
 * Связь — `PhoneLink` (настоящая — `roomLink`, на стенде — комната в памяти). Телефон не подписывается на поток экрана.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { GLITCH_SHOW_MS } from "../rules/constants";
import type { PanelControlView } from "../rules/types";
import { PauseIcon, ShieldCheck } from "./art";
import type { PhoneLink, PhoneSender } from "./link";
import { applyReply, applyStream, closeFinished, emptyModel, flashOf, leftUntil, localNow, orderLeft, problemOf, screenOf, serverNow, silent, type PhoneModel } from "./model";
import { buzz } from "./haptics";
import { loadVibration, saveVibration } from "./prefs";
import { useMotion } from "./motion";
import { MoveGate } from "./moves";
import { SHAKE_EVERY_MS, shakeReport, type ShakeSent } from "./shake";
import {
  CardScreen,
  CrewsScreen,
  DeckScreen,
  DockScreen,
  FinishScreen,
  InfoScreen,
  LaunchScreen,
  LobbyScreen,
  MeteorScreen,
  MotionStep,
  NoSabScreen,
  PanelScreen,
  PauseScreen,
  PullScreen,
  RepairScreen,
  RoleScreen,
  SosCrewScreen,
  SosScreen,
  VotedScreen,
  VibrationContext,
  VoteScreen,
} from "./screens";
import "./phone.css";

/** Своё касание прибора показываем сразу; сервер не подтвердил за это время — снова его положение. */
const LOCAL_MS = 1500;
/** Нажатия (дождь, ремонт, салют) копим и шлём не чаще. */
const TAP_FLUSH_MS = 300;

/** Цвет экипажа — цвета команд платформы (`--team-N`). */
function crewStyle(color: number | undefined): CSSProperties | undefined {
  return color === undefined ? undefined : ({ "--bk-crew": `var(--team-${(color % 5) + 1}, var(--bk-coral))` } as CSSProperties);
}

export interface PhoneProps {
  link: PhoneLink;
  name: string;
  code: string;
  /** Часы для стенда (по умолчанию — монотонные `localNow`: перевод часов телефона не сбивает отсчёты). */
  now?: () => number;
}

function useTick(ms: number): void {
  const [, set] = useState(0);
  useEffect(() => {
    const h = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(h);
  }, [ms]);
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function BublikatorPhone({ link, name, code, now = localNow }: PhoneProps) {
  const [m, setM] = useState<PhoneModel>(() => emptyModel(now()));
  const [take, setTake] = useState(false);
  const [gen, setGen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sender = useRef<PhoneSender | null>(null);
  // Отправитель остановился на «забытой» комнате: новый — как только подписка снова получит снимок.
  const [senderGen, setSenderGen] = useState(0);
  const senderDown = useRef(false);
  const online = useOnline();
  useTick(200);

  const finished = useCallback(() => setM(closeFinished), []);

  useEffect(() => {
    senderDown.current = false;
    const s = link.sender(
      (reply) => setM((x) => applyReply(x, reply, now())),
      (problem) => {
        const kind = problemOf(problem);
        if (kind === "finished") return finished();
        if (kind === "abandoned") {
          senderDown.current = true;
          return;
        }
        if (kind === "error") setError("Не получилось отправить нажатия — обновите страницу.");
      },
    );
    sender.current = s;
    return () => {
      s.stop();
      sender.current = null;
    };
  }, [link, now, senderGen, finished]);

  useEffect(() => {
    setError(null);
    return link.subscribe(
      (event) => {
        setM((x) => applyStream(x, event, now()));
        if (event.type === "snapshot" && senderDown.current) {
          senderDown.current = false;
          setSenderGen((g) => g + 1);
        }
      },
      (problem) => {
        const kind = problemOf(problem);
        // После перезагрузки завершённой игры подписка получает отказ «finished» — это «Игра окончена», а не «Подключаемся».
        if (kind === "finished") return finished();
        if (kind === "error") setError("Связь с игрой прервалась — обновите страницу.");
      },
      take,
    );
  }, [link, take, gen, now, finished]);

  const push = useCallback((event: Record<string, unknown> & { t: string }, nowFlag = false, beforeMs?: number) => sender.current?.push(event, nowFlag, beforeMs), []);

  // Своё положение приборов до ответа сервера.
  const [local, setLocal] = useState<Record<string, { s: number; at: number }>>({});
  const shown = useCallback(
    (c: PanelControlView) => {
      const l = local[c.id];
      if (!l || now() - l.at > LOCAL_MS) return c.state;
      if (c.type === "button") return Math.max(l.s, c.state);
      return l.s;
    },
    [local, now],
  );
  // Движения не чаще, чем принимает комната: лишние придерживаем и шлём последнее положение (аудит 2b, №14).
  const gate = useRef(new MoveGate());
  const gateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseMoves = useCallback(() => {
    gateTimer.current = null;
    const t0 = now();
    for (const [c, s] of gate.current.release(t0)) {
      // Пока ждало — показывали своё положение; продлеваем его до ответа сервера.
      setLocal((x) => (x[c] ? { ...x, [c]: { s: x[c].s, at: t0 } } : x));
      push({ t: "move", c, s }, true);
    }
    if (gate.current.pending.size > 0) gateTimer.current = setTimeout(releaseMoves, Math.max(20, gate.current.waitMs(now())));
  }, [push, now]);
  useEffect(() => () => void (gateTimer.current !== null && clearTimeout(gateTimer.current)), []);
  const onMove = useCallback(
    (c: PanelControlView, s: number) => {
      const t0 = now();
      setLocal((x) => ({ ...x, [c.id]: { s, at: t0 } }));
      // На движение прибора не вибрируем (решение владельца 6 ноября 2026): вибрация — только итог приказа.
      const state = c.type === "button" ? 0 : s;
      if (gate.current.move(t0, c.id, state)) push({ t: "move", c: c.id, s: state }, true);
      else if (gateTimer.current === null) gateTimer.current = setTimeout(releaseMoves, Math.max(20, gate.current.waitMs(t0)));
    },
    [push, now, releaseMoves],
  );

  // SOS: весь набор с последнего сброса и метка сброса — повтор сорвавшегося запроса не сбивает порядок (аудит 2b, №14).
  const sosRef = useRef<{ event: string | null; b: number; seq: number[] }>({ event: null, b: 0, seq: [] });
  const sosEvent = m.view?.event?.id ?? null;
  const sosAttempt = m.view?.event?.sos?.attempt ?? 0;
  const sosProgress = m.view?.event?.sos?.progress ?? 0;
  const onSos = useCallback(
    (color: number) => {
      const cur = sosRef.current;
      // Новое событие или набор сброшен ошибкой — с чистого листа; уже засчитанные сервером места — заглушками (−1).
      const fresh = cur.event !== sosEvent || cur.b !== sosAttempt;
      const seq = fresh ? Array.from({ length: sosProgress }, () => -1) : cur.seq;
      const next = { event: sosEvent, b: sosAttempt, seq: [...seq, color] };
      sosRef.current = next;
      push({ t: "sos", color, seq: next.seq, b: sosAttempt }, true);
    },
    [push, sosEvent, sosAttempt, sosProgress],
  );

  // Итог приказа — вибрацией (звука на телефоне нет): выполнен — одна короткая, не успели — две.
  const [vibration, setVibration] = useState(loadVibration);
  const vibrationRef = useRef(vibration);
  vibrationRef.current = vibration;
  const vib = useMemo(
    () => ({
      on: vibration,
      toggle: () =>
        setVibration((x) => {
          saveVibration(!x);
          return !x;
        }),
    }),
    [vibration],
  );
  const flashAt = m.flash?.at ?? null;
  const flashKind = m.flash?.kind ?? null;
  useEffect(() => {
    if (flashAt !== null && flashKind !== null && vibrationRef.current) buzz(flashKind);
  }, [flashAt, flashKind]);

  // Нажатия — копим и шлём пачкой.
  const taps = useRef<{ t: string; n: number; first: number }>({ t: "tap", n: 0, first: 0 });
  useEffect(() => {
    const h = setInterval(() => {
      const t = taps.current;
      if (t.n > 0) {
        // `ago` — по первому нажатию пачки: последние доли секунды дождя и ремонта не теряются (аудит 2b, №14).
        push({ t: t.t, n: t.n }, true, now() - t.first);
        taps.current = { t: t.t, n: 0, first: 0 };
      }
    }, TAP_FLUSH_MS);
    return () => clearInterval(h);
  }, [push, now]);
  const tap = useCallback(
    (kind: "tap" | "salute") => {
      const cur = taps.current;
      if (cur.t !== kind && cur.n > 0) push({ t: cur.t, n: cur.n }, true, now() - cur.first);
      const same = cur.t === kind && cur.n > 0;
      taps.current = { t: kind, n: (same ? cur.n : 0) + 1, first: same ? cur.first : now() };
    },
    [push, now],
  );

  const v = m.view;
  const screen = screenOf(m, now());
  const t = now();
  const sNow = serverNow(m, t);

  // Тряска «Метеоритного дождя»: сила за событие (наибольшая) — каждые 0,4 с, пока трясут.
  const motion = useMotion(screen === "meteor");
  const eventId = v?.event?.id ?? null;
  const sentPower = useRef<ShakeSent>({ id: null, p: 0 });
  useEffect(() => {
    if (screen !== "meteor" || eventId === null) return;
    const h = setInterval(() => {
      const { next, send } = shakeReport(sentPower.current, eventId, motion.peak());
      sentPower.current = next;
      if (send !== null) push({ t: "shake", p: send }, true);
    }, SHAKE_EVERY_MS);
    return () => clearInterval(h);
  }, [screen, eventId, motion, push]);
  useEffect(() => {
    if (screen !== "meteor") motion.reset();
  }, [screen, motion]);
  const shakeControls = useMemo(
    () => ({ state: motion.state, live: motion.live, choice: motion.choice, onAllow: () => void motion.ask(), onTaps: () => motion.taps() }),
    [motion],
  );

  // «Тяга»: держу — отпустил.
  const [holding, setHolding] = useState(false);
  const holdRef = useRef(false);
  const onHold = useCallback(
    (on: boolean) => {
      if (holdRef.current === on) return;
      holdRef.current = on;
      setHolding(on);
      push({ t: "hold", on }, true);
    },
    [push],
  );
  useEffect(() => {
    if (screen !== "pull" && holding) onHold(false);
  }, [screen, holding, onHold]);

  const crew = m.crew;
  const banner = useMemo(() => {
    if (error) return error;
    if (m.view && silent(m, t, online)) return "Нет связи — возвращаем вас в игру…";
    return null;
  }, [error, m, t, online]);

  const body = (() => {
    switch (screen) {
      case "connecting":
        return <InfoScreen title="Подключаемся…" text="Ищем ваш экипаж. Если интернет медленный — подождите, всё вернётся само." />;
      case "tab":
        return (
          <InfoScreen title="Открыто в другой вкладке" text="Эта игра уже открыта на этом телефоне в другой вкладке или окне. Играть можно в одной.">
            <div className="actions">
              <button
                type="button"
                className="btn btn--block"
                onClick={() => {
                  setM((x) => ({ ...x, closed: null }));
                  setTake(true);
                  setGen((g) => g + 1);
                }}
              >
                Открыть здесь
              </button>
            </div>
          </InfoScreen>
        );
      case "abandoned":
        return <InfoScreen title="Ждём ведущего" text="Игра давно стоит. Как только ведущий вернётся к пульту, экипаж появится здесь сам." icon={<PauseIcon />} />;
      case "removed":
        return <InfoScreen title="Вас нет в игре" text="Ведущий убрал вас из игры или за вас вошли с другого телефона. Если это ошибка — войдите снова по коду." />;
      case "over":
        return <InfoScreen title="Игра окончена" text="Спасибо за игру! Итоги — на большом экране." icon={<ShieldCheck />} />;
    }
    if (!v) return null;
    const kids = v.difficulty === "kids";
    switch (screen) {
      case "lobby":
        return <LobbyScreen v={v} name={name} crew={crew} code={code} />;
      case "crews":
        return <CrewsScreen v={v} crew={crew} />;
      case "out":
        return <InfoScreen kids={kids} title="Вас не было на связи" text="Ведущий убрал вас из экипажа, пока вас не было. Вы снова на связи — сейчас вернём вас дублёром." />;
      case "pause":
        return <PauseScreen v={v} crew={crew} />;
      case "role":
        return <RoleScreen v={v} crew={crew} onSeen={() => push({ t: "role-ok" }, true)} />;
      case "launch":
        return <LaunchScreen v={v} crew={crew} left={leftUntil(m, v.endsAt, t)} />;
      case "drill":
      case "panel": {
        const ev = v.event;
        const glitchLeft = v.glitchAt !== null ? v.glitchAt + GLITCH_SHOW_MS - sNow : null;
        return (
          <PanelScreen
            v={v}
            crew={crew}
            shown={shown}
            onMove={onMove}
            orderLeft={orderLeft(m, t)}
            flash={flashOf(m, t)}
            flipLeft={v.flipUntil !== null ? leftUntil(m, v.flipUntil, t) : null}
            glitchLeft={glitchLeft !== null && glitchLeft <= GLITCH_SHOW_MS ? glitchLeft : null}
            warnLeft={ev?.warn ? leftUntil(m, ev.startsAt, t) : null}
            drillLeft={screen === "drill" ? leftUntil(m, v.endsAt, t) : undefined}
            shake={screen === "drill" ? <MotionStep m={shakeControls} /> : undefined}
          />
        );
      }
      case "meteor":
        return <MeteorScreen v={v} crew={crew} left={leftUntil(m, v.event?.endsAt, t)} onTap={() => tap("tap")} motion={shakeControls} />;
      case "pull":
        return <PullScreen v={v} crew={crew} left={leftUntil(m, v.event?.endsAt, t)} holding={holding} onHold={onHold} />;
      case "sos":
        return <SosScreen v={v} crew={crew} left={leftUntil(m, v.event?.endsAt, t)} now={sNow} onColor={onSos} />;
      case "sos-crew":
        return <SosCrewScreen v={v} crew={crew} left={leftUntil(m, v.event?.endsAt, t)} />;
      case "deck":
        return <DeckScreen v={v} crew={crew} left={leftUntil(m, v.event?.endsAt, t)} />;
      case "repair":
        return <RepairScreen v={v} crew={crew} left={leftUntil(m, v.repair?.until, t)} onTap={() => tap("tap")} />;
      case "finish":
        return <FinishScreen v={v} crew={crew} onSalute={() => tap("salute")} />;
      case "dock":
        return <DockScreen v={v} crew={crew} />;
      case "vote":
        return <VoteScreen v={v} crew={crew} left={leftUntil(m, v.vote?.endsAt ?? v.endsAt, t)} key={v.vote?.endsAt ?? 0} onVote={(pid) => push({ t: "vote", pid }, true)} />;
      case "nosab":
        return <NoSabScreen v={v} crew={crew} />;
      case "voted":
        return <VotedScreen v={v} crew={crew} />;
      case "card":
        return <CardScreen v={v} crew={crew} />;
      default:
        return null;
    }
  })();

  return (
    <div className={`bkp-root${banner ? " has-banner" : ""}`} data-screen={screen} data-theme-bk={v?.theme ?? "space"} style={crewStyle(crew?.color)}>
      {banner && (
        <div className="bkp-offline" role="alert">
          {banner}
        </div>
      )}
      <VibrationContext.Provider value={vib}>{body}</VibrationContext.Provider>
    </div>
  );
}
