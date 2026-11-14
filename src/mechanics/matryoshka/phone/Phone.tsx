/**
 * Телефон гостя «Игр Матрёшки» (Блок 3b, docs/matryoshka.md «3b — телефон»): личный поток комнаты → экран по макетам,
 * касания → пачки комнаты с отметкой `st` (часы сервера по `GET /api/time`, замер раз в 2 минуты). Связь — `PhoneLink`
 * (настоящая — `roomLink`, на стенде — комната в памяти). Телефон не подписывается на поток экрана, звука нет — вибрация.
 * Экран не гаснет (`useWakeLock`). Перезагрузка, обрыв и пауза восстанавливают вид из снимка личного потока.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWakeLock } from "../../../components/live/useWakeLock";
import type { RoomInputEvent } from "../../../data/types";
import type { PhoneLink, PhoneSender } from "./link";
import { applyReply, applyStream, closeFinished, emptyModel, offsetOf, problemOf, screenOf, silent, type PhoneModel } from "./model";
import { PhoneScreen, type PhoneCtx } from "./screens";
import "./phone.css";

/** Часы сервера сверяются раз в 2 минуты (часы телефона уходят, а окно «Замри!» — 0,3 с). */
export const CLOCK_RESYNC_MS = 120_000;

export interface PhoneProps {
  link: PhoneLink;
  name: string;
  code: string;
  /** Местные часы (стенд подставляет свои). */
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

/** «Войти снова» — вход гостя по коду игры. */
export function rejoinHref(code: string): string {
  const digits = code.replace(/\D/g, "");
  return digits.length > 0 ? `/play/${digits}` : "/j";
}

export function MatryoshkaPhone({ link, name, code, now = Date.now }: PhoneProps) {
  const [m, setM] = useState<PhoneModel>(() => emptyModel(now()));
  const [take, setTake] = useState(false);
  const [gen, setGen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sender = useRef<PhoneSender | null>(null);
  const [senderGen, setSenderGen] = useState(0);
  const senderDown = useRef(false);
  const online = useOnline();
  useTick(200);

  // Часы сервера: замер сразу и раз в 2 минуты.
  useEffect(() => {
    link.clock.sync(CLOCK_RESYNC_MS);
    const h = setInterval(() => link.clock.sync(CLOCK_RESYNC_MS - 5000), 30_000);
    return () => clearInterval(h);
  }, [link]);

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
        if (kind === "error") setError("Не получилось отправить нажатия — обнови страницу.");
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
        if (kind === "finished") return finished();
        if (kind === "error") setError("Связь с игрой прервалась — обнови страницу.");
      },
      take,
    );
  }, [link, take, gen, now, finished]);

  // Часы сервера сейчас: замер `GET /api/time`, а если его нет или он неверный — граница по потоку.
  const mRef = useRef(m);
  mRef.current = m;
  const serverNow = useCallback(() => now() + offsetOf(mRef.current, link.clock.offset()), [now, link]);

  /** Событие комнате с отметкой `st` — моментом по сверенным часам сервера (окно «Замри!» и реакция — по ней). */
  const send = useCallback(
    (event: RoomInputEvent, nowFlag = false) => {
      sender.current?.push({ ...event, st: Math.round(serverNow()) }, nowFlag);
    },
    [serverNow],
  );

  const local = now();
  const sNow = serverNow();
  const screen = screenOf(m, sNow);
  useWakeLock(screen !== "over" && screen !== "podium");
  const quiet = m.me !== null && silent(m, local, online);
  const banner = error ?? (quiet ? "Нет связи — возвращаем тебя в игру…" : null);

  const ctx: PhoneCtx = useMemo(
    () => ({ m, me: m.me, screen, sNow, serverNow, send, offline: quiet, store: link.key, name, code }),
    [m, screen, sNow, serverNow, send, quiet, link.key, name, code],
  );

  const style = m.me?.style ?? "sunny";
  const sideAttr = (() => {
    const rope = m.me?.trial?.rope;
    if (!rope || rope.side === null || (screen !== "rope" && screen !== "rope-wait")) return undefined;
    return rope.side === 0 ? "coral" : "sage";
  })();

  return (
    <div className="mtp" data-style={style} data-screen={screen} data-side={sideAttr}>
      {banner && (
        <div className="mtp-offline" role="alert">
          {banner}
        </div>
      )}
      <PhoneScreen
        ctx={ctx}
        onTake={() => {
          setM((x) => ({ ...x, closed: null }));
          setTake(true);
          setGen((g) => g + 1);
        }}
      />
    </div>
  );
}
