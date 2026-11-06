/**
 * Телефон гостя «Бубликатора» (Блок 2b): личный поток комнаты → экран по макетам, касания → пачки комнаты.
 * Связь — `PhoneLink` (настоящая — `roomLink`, на стенде — комната в памяти). Телефон не подписывается на поток экрана.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { GLITCH_SHOW_MS } from "../rules/constants";
import type { PanelControlView } from "../rules/types";
import { PauseIcon, ShieldCheck } from "./art";
import type { PhoneLink, PhoneSender } from "./link";
import { applyReply, applyStream, emptyModel, flashOf, leftUntil, orderLeft, screenOf, serverNow, silent, type PhoneModel } from "./model";
import { useMotion } from "./motion";
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
  /** Часы для стенда (по умолчанию — `Date.now`). */
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

export function BublikatorPhone({ link, name, code, now = Date.now }: PhoneProps) {
  const [m, setM] = useState<PhoneModel>(() => emptyModel(now()));
  const [take, setTake] = useState(false);
  const [gen, setGen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sender = useRef<PhoneSender | null>(null);
  const online = useOnline();
  useTick(200);

  useEffect(() => {
    const s = link.sender(
      (reply) => setM((x) => applyReply(x, reply, now())),
      () => setError("Не получилось отправить нажатия — обновите страницу."),
    );
    sender.current = s;
    return () => {
      s.stop();
      sender.current = null;
    };
  }, [link, now]);

  useEffect(() => {
    setError(null);
    return link.subscribe(
      (event) => setM((x) => applyStream(x, event, now())),
      (problem) => {
        const reason = (problem as { reason?: unknown }).reason;
        if (reason === "removed" || reason === "replaced" || reason === "busy") return;
        setError("Связь с игрой прервалась — обновите страницу.");
      },
      take,
    );
  }, [link, take, gen, now]);

  const push = useCallback((event: Record<string, unknown> & { t: string }, nowFlag = false) => sender.current?.push(event, nowFlag), []);

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
  const onMove = useCallback(
    (c: PanelControlView, s: number) => {
      setLocal((x) => ({ ...x, [c.id]: { s, at: now() } }));
      push({ t: "move", c: c.id, s: c.type === "button" ? 0 : s }, true);
      try {
        navigator.vibrate?.(12);
      } catch {
        /* вибрации нет */
      }
    },
    [push, now],
  );

  // Нажатия — копим и шлём пачкой.
  const taps = useRef<{ t: string; n: number }>({ t: "tap", n: 0 });
  useEffect(() => {
    const h = setInterval(() => {
      const t = taps.current;
      if (t.n > 0) {
        push({ t: t.t, n: t.n }, true);
        taps.current = { t: t.t, n: 0 };
      }
    }, TAP_FLUSH_MS);
    return () => clearInterval(h);
  }, [push]);
  const tap = useCallback((kind: "tap" | "salute") => {
    if (taps.current.t !== kind && taps.current.n > 0) push({ t: taps.current.t, n: taps.current.n }, true);
    taps.current = { t: kind, n: (taps.current.t === kind ? taps.current.n : 0) + 1 };
  }, [push]);

  const v = m.view;
  const screen = screenOf(m);
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
            shake={screen === "drill" ? <MotionStep state={motion.state} live={motion.live} onAllow={() => void motion.ask()} /> : undefined}
          />
        );
      }
      case "meteor":
        return <MeteorScreen v={v} crew={crew} left={leftUntil(m, v.event?.endsAt, t)} onTap={() => tap("tap")} motion={{ state: motion.state, live: motion.live, onAllow: () => void motion.ask() }} />;
      case "pull":
        return <PullScreen v={v} crew={crew} left={leftUntil(m, v.event?.endsAt, t)} holding={holding} onHold={onHold} />;
      case "sos":
        return <SosScreen v={v} crew={crew} left={leftUntil(m, v.event?.endsAt, t)} now={sNow} onColor={(color) => push({ t: "sos", color }, true)} />;
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
        return <VoteScreen v={v} crew={crew} left={leftUntil(m, v.vote?.endsAt ?? v.endsAt, t)} onVote={(pid) => push({ t: "vote", pid }, true)} />;
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
      {body}
    </div>
  );
}
