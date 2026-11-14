/**
 * Экраны телефона «Игр Матрёшки» по согласованным макетам (ph-*, fan-*, 14 ноября 2026): игрок и болельщик, все этапы игры.
 * Обращение — на «ты». Главное действие — одно на экран, кнопки не ниже 52 px (плитки выбора — 44). Всё, что телефон шлёт
 * комнате, — через `ctx.send` с отметкой времени `st`; реакция — от назначенного момента по сверенным часам.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { Logo } from "../../../components/Logo";
import { BATCH_MS, PIECES } from "../rules/constants";
import { bandOf } from "../rules/shapes";
import type { Gesture, Side, TrialKind } from "../rules/types";
import { Coin, Cookie, Doll, Drift, GESTURE_TITLES, GestureArt, Hearts, IceArrow, KnotArt, Ring, Stool, TinBox } from "./art";
import { buzz } from "./haptics";
import { holding, holdStep, newHold, SLEEP_GAP_MS, type HoldInput, type HoldState } from "./hold";
import { avatarOf, gazeNow, leftUntil, numText, reactionMs, type Me, type MeChairs, type MeFreeze, type MeGinger, type MeHop, type MeRope, type MeTrial, type PhoneModel, type Screen } from "./model";
import { GUESS_HINTS, GUESS_TITLES, GUESS_UNITS, plural, SIDE_NAMES, TRIAL_RULES, TRIAL_TITLES } from "./texts";
import { fieldPoint, lift, loadTrace, saveTrace, touch, traceKey } from "./trace";
import type { RoomInputEvent } from "../../../data/types";

export interface PhoneCtx {
  m: PhoneModel;
  me: Me | null;
  screen: Screen;
  /** Часы сервера на момент отрисовки и функция «сейчас» (для отметок и реакции). */
  sNow: number;
  serverNow: () => number;
  send: (event: RoomInputEvent, now?: boolean) => void;
  offline: boolean;
  store: string;
  name: string;
  code: string;
}

// ------------------------------------------------------------------ общее

function useLeft(ctx: PhoneCtx, at: number | null | undefined): number | null {
  return leftUntil(ctx.m, at, ctx.sNow);
}

/** Полный отсчёт для кольца: наибольший остаток, увиденный у этого момента. */
function useTotal(key: string, left: number | null): number | null {
  const ref = useRef<{ key: string; total: number }>({ key: "", total: 0 });
  if (left === null) return null;
  if (ref.current.key !== key || left > ref.current.total) ref.current = { key, total: Math.max(left, ref.current.key === key ? ref.current.total : 0) };
  return ref.current.total;
}

function Timer({ ctx, at, id }: { ctx: PhoneCtx; at: number | null | undefined; id: string }) {
  const left = useLeft(ctx, at);
  const total = useTotal(`${id}:${at ?? ""}`, left);
  return <Ring left={left} total={total} />;
}

function Top({ me, fan }: { me: Me; fan?: boolean }) {
  const av = avatarOf(me.name);
  return (
    <div className="mtp-top">
      <div className="mtp-me">
        <span className="mtp-chip" aria-hidden="true">
          {av.mark}
        </span>
        <div className="mtp-me__txt">
          <div className="mtp-no">{numText(me.num)}</div>
          <div className="mtp-name">{av.rest}</div>
        </div>
      </div>
      {fan || me.role !== "player" ? <span className="mtp-pill">📣 Болельщик{me.fanScore > 0 ? ` · ${me.fanScore}` : ""}</span> : <Hearts n={me.hearts} total={me.lives} style={me.style} />}
    </div>
  );
}

function Head({ eyebrow, title, right, live }: { eyebrow?: string; title: string; right?: ReactNode; live?: boolean }) {
  return (
    <div className="mtp-head">
      <div className="mtp-head__txt">
        {eyebrow && <div className="mtp-eyebrow">{eyebrow}</div>}
        <h1 className="mtp-title" aria-live={live ? "polite" : undefined}>
          {title}
        </h1>
      </div>
      {right}
    </div>
  );
}

function Body({ children, center }: { children: ReactNode; center?: boolean }) {
  return <div className={`mtp-body${center ? " mtp-body--center" : ""}`}>{children}</div>;
}

function Frame({ me, children, fan }: { me: Me | null; children: ReactNode; fan?: boolean }) {
  return (
    <>
      {me && <Top me={me} fan={fan} />}
      {children}
      <span className="mtp-mono" aria-hidden="true">
        <Logo kind="monogram" />
      </span>
    </>
  );
}

function trialEyebrow(t: MeTrial, extra?: string): string {
  return `Испытание ${t.index + 1} · «${TRIAL_TITLES[t.kind]}»${extra ? ` · ${extra}` : ""}`;
}

function Info({ me, title, text, icon, children, eyebrow }: { me: Me | null; title: string; text?: string; icon?: ReactNode; children?: ReactNode; eyebrow?: string }) {
  return (
    <Frame me={me}>
      <Body center>
        {icon}
        {eyebrow && <div className="mtp-eyebrow">{eyebrow}</div>}
        <h1 className="mtp-title">{title}</h1>
        {text && <p className="mtp-text">{text}</p>}
        {children}
      </Body>
    </Frame>
  );
}

function Card({ children, tone }: { children: ReactNode; tone?: "bad" | "good" | "gold" }) {
  return <div className={`mtp-card${tone ? ` mtp-card--${tone}` : ""}`}>{children}</div>;
}

// ------------------------------------------------------------------ «Замри!»

function FreezePlay({ ctx, me, t, f }: { ctx: PhoneCtx; me: Me; t: MeTrial; f: MeFreeze }) {
  const sNow = ctx.sNow;
  const runLeft = leftUntil(ctx.m, f.runEnds, sNow);
  const enabled = !ctx.m.paused && !ctx.offline && !f.finished && runLeft !== null && runLeft > 0 && t.stage === "play";
  const [hold, setHold] = useState<HoldState>(() => newHold(false));
  const holdRef = useRef(hold);
  const sendRef = useRef(ctx.send);
  sendRef.current = ctx.send;
  const zone = useRef<HTMLDivElement | null>(null);

  const dispatch = useCallback((input: HoldInput) => {
    const r = holdStep(holdRef.current, input);
    if (r.state === holdRef.current) return;
    holdRef.current = r.state;
    setHold(r.state);
    if (r.send !== null) {
      // «Держу» и «отпустил» — сразу отдельным запросом, с отметкой времени (L5).
      sendRef.current({ t: "h", on: r.send }, true);
      if (r.send) buzz("run");
    }
  }, []);

  useEffect(() => dispatch({ type: "enable", on: enabled }), [enabled, dispatch]);

  // Любой сбой — «отпустил / стою» (решение владельца 14 ноября 2026).
  useEffect(() => {
    const glitch = (reason: "hidden" | "blur" | "scroll" | "offline" | "sleep") => () => dispatch({ type: "glitch", reason });
    const vis = () => {
      if (document.visibilityState !== "visible") dispatch({ type: "glitch", reason: "hidden" });
    };
    const blur = glitch("blur");
    const scroll = glitch("scroll");
    const off = glitch("offline");
    const hide = glitch("hidden");
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("blur", blur);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("offline", off);
    window.addEventListener("pagehide", hide);
    let last = performance.now();
    const beat = setInterval(() => {
      const x = performance.now();
      if (x - last > SLEEP_GAP_MS) dispatch({ type: "glitch", reason: "sleep" });
      last = x;
    }, 250);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("blur", blur);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("offline", off);
      window.removeEventListener("pagehide", hide);
      clearInterval(beat);
      dispatch({ type: "glitch", reason: "unmount" });
    };
  }, [dispatch]);

  // Пока держит — «держу» в каждой пачке (раз в секунду): без пачек комната считает, что стоит (L6).
  const isHolding = holding(hold);
  useEffect(() => {
    if (!isHolding) return;
    const h = setInterval(() => sendRef.current({ t: "h", on: true }), BATCH_MS);
    return () => clearInterval(h);
  }, [isHolding]);

  // Поворот — в назначенный момент по сверенным часам телефона: вибрация и вспышка зоны (ошибка часов экрана не добавляется).
  const gazeAt = f.gaze?.at ?? null;
  const [flashed, setFlashed] = useState<number | null>(null);
  const serverNow = ctx.serverNow;
  const paused = ctx.m.paused;
  useEffect(() => {
    if (gazeAt === null || paused) return;
    const wait = gazeAt - serverNow();
    if (wait < -400) return;
    const h = setTimeout(() => {
      buzz("gaze");
      setFlashed(gazeAt);
    }, Math.max(0, wait));
    return () => clearTimeout(h);
  }, [gazeAt, paused, serverNow]);
  const looking = gazeNow(f, sNow) || (flashed !== null && flashed === gazeAt && f.gaze !== null && sNow < f.gaze.end);

  // Поймали — вибрация и плашка на 3 с (после перезагрузки плашка видна снова, без вибрации).
  const [caughtAt, setCaughtAt] = useState<number | null>(() => (f.caughtNow !== null ? Date.now() : null));
  const seenCatch = useRef<number | null>(f.caughtNow);
  useEffect(() => {
    if (f.caughtNow !== null && f.caughtNow !== seenCatch.current) {
      seenCatch.current = f.caughtNow;
      buzz("caught");
      setCaughtAt(Date.now());
    }
  }, [f.caughtNow]);
  const showCaught = caughtAt !== null && Date.now() - caughtAt < 3000;

  // Путь — с сервера раз в 0,5 с; между сводками дорисовываем, пока держит и Матрёшка не смотрит.
  const base = useRef({ path: f.path, at: sNow });
  if (base.current.path !== f.path) base.current = { path: f.path, at: sNow };
  const shown = f.finished ? 1000 : isHolding && !looking ? Math.min(1000, base.current.path + (f.speed * Math.max(0, sNow - base.current.at)) / 1000) : base.current.path;
  const pct = Math.round(shown / 10);
  const av = avatarOf(me.name);

  const zoneState = f.finished ? "done" : !enabled ? "off" : looking ? (isHolding ? "caught-risk" : "look") : isHolding ? "run" : "stand";
  const ev = (e: RPointerEvent<HTMLDivElement>, type: "down" | "up" | "cancel" | "leave") => {
    if (type === "down") {
      e.preventDefault();
      // Касание сенсора само «прилипает» к элементу — отпускаем, чтобы «палец съехал с зоны» был виден.
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Не было захвата — ничего.
      }
    }
    dispatch({ type, id: e.pointerId });
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const el = zone.current;
    if (!el || holdRef.current.pointer !== e.pointerId) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dispatch({ type: "leave", id: e.pointerId });
  };

  const title = f.finished ? "Ты у цели!" : looking ? "Стой!" : showCaught ? "Поймали!" : isHolding ? "Беги!" : "Держи — и беги!";
  return (
    <Frame me={me}>
      <Body>
        <Head eyebrow={trialEyebrow(t)} title={title} right={<Timer ctx={ctx} at={f.runEnds} id="run" />} live />
        {looking ? (
          <div className="mtp-banner" role="alert">
            Замри!
          </div>
        ) : showCaught ? (
          <Card tone="bad">
            <div className="mtp-card__big">Матрёшка тебя увидела</div>
            <div className="mtp-hint">Назад на треть пути — беги дальше, ещё можно добежать</div>
          </Card>
        ) : null}
        <div className="mtp-card">
          <div className="mtp-row">
            <span className="mtp-hint">Твой путь</span>
            <b>{pct}%</b>
          </div>
          <div className="mtp-path" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Твой путь">
            <i style={{ transform: `scaleX(${shown / 1000})` }} />
            <span className="mtp-path__me" style={{ left: `${shown / 10}%` }} aria-hidden="true">
              {av.mark}
            </span>
            {shown < 1000 && (
              <span className="mtp-path__flag" aria-hidden="true">
                🏁
              </span>
            )}
          </div>
        </div>
        <div
          ref={zone}
          className="mtp-zone"
          data-state={zoneState}
          role="button"
          aria-pressed={isHolding}
          aria-disabled={!enabled}
          aria-label={isHolding ? "Держу — бегу" : "Держи палец здесь, чтобы бежать"}
          onPointerDown={(e) => ev(e, "down")}
          onPointerUp={(e) => ev(e, "up")}
          onPointerCancel={(e) => ev(e, "cancel")}
          onPointerLeave={(e) => ev(e, "leave")}
          onPointerMove={move}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="mtp-zone__big">{zoneState === "done" ? "Добежал!" : zoneState === "off" ? (ctx.m.paused ? "Пауза" : "Жди…") : looking ? "Не держи!" : isHolding ? "Держу — бегу" : "Держи — побежишь"}</span>
          <span className="mtp-zone__small">{zoneState === "done" ? "Жди остальных" : looking ? "Матрёшка смотрит" : isHolding ? "Отпусти, когда Матрёшка обернётся" : "Палец на этой половине экрана — бежишь"}</span>
        </div>
        <p className="mtp-hint mtp-center">Не смотришь на экран? Телефон вздрогнет и вспыхнет, когда замереть</p>
      </Body>
    </Frame>
  );
}

// ------------------------------------------------------------------ «Пряник»

function GingerPick({ ctx, me, t, g }: { ctx: PhoneCtx; me: Me; t: MeTrial; g: MeGinger }) {
  const [mine, setMine] = useState<number | null>(g.box);
  useEffect(() => setMine(g.box), [g.box]);
  const pick = (n: number) => {
    setMine(n);
    ctx.send({ t: "box", n }, true);
    buzz("ok");
  };
  return (
    <Frame me={me}>
      <Body>
        <Head eyebrow={trialEyebrow(t)} title="Выбери коробку" right={<Timer ctx={ctx} at={g.pickEnds} id="pick" />} />
        <p className="mtp-hint">В каждой — пряник с фигурой. Что где — не видно, у всех одинаково</p>
        <div className="mtp-boxes" role="radiogroup" aria-label="Коробки">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={mine === n} className={`mtp-box${mine === n ? " is-on" : ""}`} onClick={() => pick(n)}>
              <TinBox n={n + 1} />
              <span>Коробка {n + 1}</span>
            </button>
          ))}
        </div>
        <Card>
          <p className="mtp-text mtp-center">{mine === null ? "Не выберешь — коробка выпадет сама" : `Выбрана коробка ${mine + 1} · можно передумать, пока идёт время`}</p>
        </Card>
      </Body>
    </Frame>
  );
}

function GingerUnbox({ ctx, me, t, g }: { ctx: PhoneCtx; me: Me; t: MeTrial; g: MeGinger }) {
  return (
    <Frame me={me}>
      <Body center>
        <div className="mtp-eyebrow">{trialEyebrow(t)}</div>
        <h1 className="mtp-title">{g.shapeTitle ? `У тебя — ${g.shapeTitle.toLowerCase()}` : "Открываем коробки…"}</h1>
        {g.shape ? <Cookie shape={g.shape} band={bandOf(me.style)} className="mtp-cookie--small" /> : <TinBox n={(g.box ?? 0) + 1} />}
        <p className="mtp-text">
          Коробка {(g.box ?? 0) + 1}
          {g.auto ? " — выпала сама" : ""}. Обводить — через <b>{Math.ceil((leftUntil(ctx.m, g.unboxEnds, ctx.sNow) ?? 0) / 1000)} с</b>
        </p>
        <p className="mtp-hint">Смотри на экран: Матрёшка открывает коробки</p>
      </Body>
    </Frame>
  );
}

function GingerTrace({ ctx, me, t, g }: { ctx: PhoneCtx; me: Me; t: MeTrial; g: MeGinger }) {
  const shape = g.shape ?? "circle";
  const band = bandOf(me.style);
  const key = traceKey(ctx.store, t.index, shape);
  const [tr, setTr] = useState(() => loadTrace(key));
  const trRef = useRef(tr);
  const active = useRef<number | null>(null);
  const field = useRef<HTMLDivElement | null>(null);
  const [finger, setFinger] = useState<readonly [number, number] | null>(null);
  const sendRef = useRef(ctx.send);
  sendRef.current = ctx.send;
  const left = leftUntil(ctx.m, g.traceEnds, ctx.sNow);
  const locked = tr.cracked || tr.doneAt !== null || g.cracked || g.done || ctx.m.paused || (left !== null && left <= 0);

  const commit = useCallback(
    (next: typeof tr) => {
      const prev = trRef.current;
      trRef.current = next;
      setTr(next);
      if (!prev.cracked && next.cracked) {
        sendRef.current({ t: "g", c: next.count, crack: true }, true);
        buzz("crack");
        saveTrace(key, next);
      } else if (prev.doneAt === null && next.doneAt !== null) {
        sendRef.current({ t: "g", c: PIECES }, true);
        buzz("win");
        saveTrace(key, next);
      }
    },
    [key],
  );

  // После перезагрузки — обводка из `sessionStorage` сразу уходит комнате (сервер берёт наибольшее).
  useEffect(() => {
    const t0 = trRef.current;
    if (t0.cracked) sendRef.current({ t: "g", c: t0.count, crack: true }, true);
    else if (t0.count > 0) sendRef.current({ t: "g", c: t0.count }, true);
  }, []);

  // Кусочки — в каждой пачке (L11) и сохраняем обводку.
  useEffect(() => {
    const h = setInterval(() => {
      const x = trRef.current;
      if (!x.cracked && x.doneAt === null) sendRef.current({ t: "g", c: x.count });
      saveTrace(key, x);
    }, BATCH_MS);
    return () => clearInterval(h);
  }, [key]);

  // Пауза или конец — палец снят.
  useEffect(() => {
    if (locked && active.current !== null) {
      active.current = null;
      commit(lift(trRef.current));
      setFinger(null);
    }
  }, [locked, commit]);

  const at = (e: { clientX: number; clientY: number }) => {
    const el = field.current;
    return el ? fieldPoint(el.getBoundingClientRect(), e.clientX, e.clientY) : ([0, 0] as const);
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Обводит один палец: второй палец и ладонь не в счёт.
    if (locked || active.current !== null) return;
    active.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Без захвата — палец за полем просто не придёт.
    }
    const p = at(e);
    setFinger(p);
    commit(touch(shape, lift(trRef.current), p, e.timeStamp, band));
  };
  const moveTo = (e: RPointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId || locked) return;
    const native = e.nativeEvent;
    const list = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const events = list.length > 0 ? list : [native];
    let next = trRef.current;
    let p = at(native);
    for (const x of events) {
      p = at(x);
      next = touch(shape, next, p, x.timeStamp, band);
      if (next.cracked || next.doneAt !== null) break;
    }
    setFinger(p);
    commit(next);
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    setFinger(null);
    const next = lift(trRef.current);
    commit(next);
    saveTrace(key, next);
  };

  const pct = Math.round((tr.count / PIECES) * 100);
  return (
    <Frame me={me}>
      <Body>
        <Head eyebrow={trialEyebrow(t)} title={`Обведи: ${(g.shapeTitle ?? "фигура").toLowerCase()}`} right={<Timer ctx={ctx} at={g.traceEnds} id="trace" />} />
        <span className="mtp-pill mtp-pill--start">
          Коробка {(g.box ?? 0) + 1}: {(g.shapeTitle ?? "").toLowerCase()}
        </span>
        <div ref={field} className="mtp-field" data-points={shape} onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()} role="img" aria-label={`Пряник: ${g.shapeTitle ?? ""}, обведено ${pct}%`}>
          <Cookie shape={shape} band={band} covered={tr.covered} finger={finger} />
        </div>
        <div className="mtp-card">
          <div className="mtp-row">
            <span className="mtp-hint">Обведено</span>
            <b>{pct}%</b>
          </div>
          <div className="mtp-path mtp-path--thin" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Обведено">
            <i style={{ transform: `scaleX(${tr.count / PIECES})` }} />
          </div>
        </div>
        <p className="mtp-hint mtp-center">Веди пальцем по светлой полосе. Палец можно отрывать</p>
      </Body>
    </Frame>
  );
}

function GingerEnd({ me, t, g }: { me: Me; t: MeTrial; g: MeGinger }) {
  const shape = g.shape ?? "circle";
  const pct = Math.round((g.c / PIECES) * 100);
  if (g.cracked)
    return (
      <Frame me={me}>
        <Body center>
          <div className="mtp-eyebrow">{trialEyebrow(t)}</div>
          <div className="mtp-crack-word" role="alert">
            Крак!
          </div>
          <Cookie shape={shape} band={0} cracked className="mtp-cookie--small" />
          <Card tone="bad">
            <div className="mtp-card__big">Пряник треснул</div>
            <div className="mtp-hint">Успел обвести {pct}% — это пойдёт в зачёт. Кто теряет сердечко, Матрёшка скажет в конце</div>
          </Card>
          <p className="mtp-text">Смотри на экран — там треснувшие пряники</p>
        </Body>
      </Frame>
    );
  return (
    <Frame me={me}>
      <Body center>
        <div className="mtp-eyebrow">{trialEyebrow(t)}</div>
        <h1 className="mtp-title">{g.done ? "Пряник целый!" : "Время вышло"}</h1>
        <Cookie shape={shape} band={0} covered={Array.from({ length: PIECES }, (_, i) => i < g.c)} className="mtp-cookie--small" />
        <p className="mtp-text">{g.done ? "Обведён целиком — молодец" : `Обведено ${pct}%`}</p>
        <p className="mtp-hint">Жди итогов на экране</p>
      </Body>
    </Frame>
  );
}

// ------------------------------------------------------------------ «Стулья»

/** Места стульев — центры клеток сетки 3×3 с небольшим сдвигом, свои у каждого захода (любой стул годится). */
function chairSpots(round: number, n: number): Array<{ x: number; y: number }> {
  const cells = Array.from({ length: 9 }, (_, i) => i);
  let a = 1103 + round * 7919;
  const rand = () => ((a = (a * 48271) % 2147483647) / 2147483647);
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j] ?? 0, cells[i] ?? 0];
  }
  return cells.slice(0, Math.max(1, Math.min(6, n))).map((c) => ({ x: ((c % 3) + 0.5) * 33.3 + (rand() - 0.5) * 3, y: (Math.floor(c / 3) + 0.5) * 33.3 + (rand() - 0.5) * 4 }));
}

function ChairsPlay({ ctx, me, t, c }: { ctx: PhoneCtx; me: Me; t: MeTrial; c: MeChairs }) {
  const [tapped, setTapped] = useState<{ round: number; rt: number } | null>(null);
  const roundLabel = `заход ${c.round + 1} из 3`;
  const sit = () => {
    if (c.appearAt === null || tapped?.round === c.round) return;
    // Реакция — от назначенного появления стульев по сверенным часам, а не от отрисовки (3a).
    const rt = reactionMs(c.appearAt, ctx.serverNow());
    setTapped({ round: c.round, rt });
    ctx.send({ t: "sit", rt }, true);
    buzz("ok");
  };
  const screen = ctx.screen;
  if (screen === "chairs-music")
    return (
      <Frame me={me}>
        <Body center>
          <div className="mtp-eyebrow">{trialEyebrow(t, roundLabel)}</div>
          <h1 className="mtp-title">Танцуй!</h1>
          <div className="mtp-dance">
            <Doll style={me.style} width={130} />
          </div>
          <div className="mtp-notes" aria-hidden="true">
            ♪ ♫ ♪
          </div>
          <p className="mtp-text">Танцуй по-настоящему — ведущий смотрит!</p>
          <Card>
            <p className="mtp-hint">Музыка оборвётся — появятся стулья. Касайся любого: кто быстрее — тот сел. Стульев {c.chairs}</p>
          </Card>
        </Body>
      </Frame>
    );
  if (screen === "chairs-stop")
    return (
      <Frame me={me}>
        <Body center>
          <div className="mtp-eyebrow">{trialEyebrow(t, roundLabel)}</div>
          <h1 className="mtp-title mtp-title--huge" role="alert">
            Стоп!
          </h1>
          <p className="mtp-text">Жди… стулья сейчас появятся</p>
        </Body>
      </Frame>
    );
  if (screen === "chairs-tap") {
    const spots = chairSpots(c.round, c.chairs);
    return (
      <Frame me={me}>
        <Body>
          <Head eyebrow={trialEyebrow(t, roundLabel)} title="Садись!" right={<Timer ctx={ctx} at={c.closeAt} id="sit" />} />
          <div className="mtp-chairs">
            {spots.map((s, i) => (
              <button key={i} type="button" className="mtp-chair" style={{ left: `${s.x}%`, top: `${s.y}%` }} aria-label="Сесть на стул" onPointerDown={(e) => {
                  e.preventDefault();
                  sit();
                }}>
                <Stool size={60} style={me.style} />
              </button>
            ))}
          </div>
          <p className="mtp-hint mtp-center">Коснись любого стула — у тебя 3 секунды</p>
        </Body>
      </Frame>
    );
  }
  if (screen === "chairs-wait")
    return (
      <Info me={me} eyebrow={trialEyebrow(t, roundLabel)} title={c.tapped || tapped?.round === c.round ? "Сел? Считаем…" : "Не успел коснуться"} text={tapped?.round === c.round ? `Реакция ${(tapped.rt / 1000).toFixed(2).replace(".", ",")} с — Матрёшка рассаживает` : "Матрёшка рассаживает по стульям"} />
    );
  if (screen === "chairs-seated")
    return (
      <Frame me={me}>
        <Body center>
          <div className="mtp-eyebrow">{trialEyebrow(t, roundLabel)}</div>
          <h1 className="mtp-title">Ты сел!</h1>
          <div className="mtp-seat">
            <Stool size={150} style={me.style} />
          </div>
          <div className="mtp-bignum">Стул № {c.chair ?? "?"}</div>
          <p className="mtp-hint">{c.round < 2 ? "Жди следующего захода — снова танцуй" : "Последний заход позади — жди итогов"}</p>
        </Body>
      </Frame>
    );
  if (screen === "chairs-missed")
    return (
      <Frame me={me}>
        <Body center>
          <div className="mtp-eyebrow">{trialEyebrow(t, roundLabel)}</div>
          <h1 className="mtp-title">Стула не хватило</h1>
          <div className="mtp-seat is-dim">
            <Stool size={130} style={me.style} />
          </div>
          <Card tone="bad">
            <p className="mtp-text">В следующие заходы идут только севшие. Кто теряет сердечко — Матрёшка скажет в конце</p>
          </Card>
        </Body>
      </Frame>
    );
  return <Info me={me} eyebrow={trialEyebrow(t, roundLabel)} title="Смотри на экран" text={`Сидел в ${c.rounds} ${plural(c.rounds, "заходе", "заходах", "заходах")} — теперь болей за остальных`} />;
}

// ------------------------------------------------------------------ «Канат»

const TAP_FLUSH_MS = 300;

function RopePlay({ ctx, me, r }: { ctx: PhoneCtx; me: Me; r: MeRope }) {
  const pending = useRef(0);
  // Свои нажатия видно сразу; сервер присылает итог раз в 0,5 с (и срезает лишние сверх 15 в секунду).
  const [local, setLocal] = useState(0);
  const atMount = useRef(r.taps);
  const sendRef = useRef(ctx.send);
  sendRef.current = ctx.send;
  useEffect(() => {
    const h = setInterval(() => {
      if (pending.current > 0) {
        sendRef.current({ t: "tap", n: pending.current }, true);
        pending.current = 0;
      }
    }, TAP_FLUSH_MS);
    return () => clearInterval(h);
  }, []);
  const pull = r.sub === "pull" && !ctx.m.paused;
  const tap = (e: RPointerEvent) => {
    e.preventDefault();
    if (!pull) return;
    pending.current += 1;
    setLocal((n) => n + 1);
  };
  const side = r.side ?? 0;
  const ours = Math.round(((side === 0 ? 100 + r.knot : 100 - r.knot) / 200) * 100);
  const sideName = SIDE_NAMES[side];
  const title = r.sub === "pull" ? (r.fan ? "Помогай!" : "Тяни!") : r.sub === "split" ? "Делимся на стороны" : r.sub === "rest" ? "Передышка" : "Канат перетянут";
  const attempt = r.attempt >= 0 ? `попытка ${r.attempt + 1} из 3` : "";
  const myWins = side === 0 ? r.wins[0] : r.wins[1];
  const theirWins = side === 0 ? r.wins[1] : r.wins[0];
  return (
    <Frame me={me} fan={r.fan}>
      <Body>
        <Head eyebrow={`«Канат»${attempt ? ` · ${attempt}` : ""}`} title={title} right={<Timer ctx={ctx} at={r.sub === "pull" ? r.attemptEnds : r.restEnds} id="rope" />} />
        <div className="mtp-card mtp-card--side">
          <div className="mtp-eyebrow mtp-eyebrow--ink">
            {side === 0 ? "← " : ""}
            {sideName}
            {r.fan ? " · ты болеешь за них" : " · твоя сторона"} · счёт {myWins} : {theirWins}
            {side === 1 ? " →" : ""}
          </div>
          <div className={`mtp-tug mtp-tug--${side === 0 ? "coral" : "sage"}`} role="img" aria-label={`Наши ${ours}%, их ${100 - ours}%`}>
            <i style={{ transform: `scaleX(${ours / 100})` }} />
          </div>
          <div className="mtp-row mtp-row--ink">
            <span>наши {ours}%</span>
            <span>их {100 - ours}%</span>
          </div>
        </div>
        <div className="mtp-knot-wrap">
          <button type="button" className="mtp-knot" disabled={!pull} onPointerDown={tap} onContextMenu={(e) => e.preventDefault()}>
            <KnotArt size={110} />
            <span>{pull ? "Жми на узел часто-часто!" : r.sub === "split" ? "Сейчас начнём" : "Отдышись"}</span>
          </button>
          <div className="mtp-bignum">{Math.max(r.taps, atMount.current + local)}</div>
          <p className="mtp-hint">{r.fan ? "нажатий · у болельщика рывок вполсилы" : "твоих нажатий"}</p>
        </div>
      </Body>
    </Frame>
  );
}

// ------------------------------------------------------------------ «Классики» и «Добивка»

function LeftRight({ pick, onPick, disabled }: { pick: Side | null; onPick: (s: Side) => void; disabled?: boolean }) {
  return (
    <div className="mtp-lr" role="radiogroup" aria-label="Куда прыгаешь">
      {(["L", "R"] as const).map((s) => (
        <button key={s} type="button" role="radio" aria-checked={pick === s} disabled={disabled} className={`mtp-cell${pick === s ? " is-on" : ""}`} onClick={() => onPick(s)}>
          <IceArrow dir={s} />
          {s === "L" ? "Влево" : "Вправо"}
        </button>
      ))}
    </div>
  );
}

function sideWord(s: Side | null): string {
  return s === "L" ? "влево" : s === "R" ? "вправо" : "не выбрал";
}

function HopPlay({ ctx, me, t, h }: { ctx: PhoneCtx; me: Me; t: MeTrial; h: MeHop }) {
  const [brave, setBrave] = useState<{ row: number } | null>(null);
  const [pick, setPick] = useState<{ row: number; side: Side } | null>(null);
  const myPick = pick?.row === h.row ? pick.side : h.pick;
  const choose = (side: Side) => {
    setPick({ row: h.row, side });
    ctx.send({ t: "cell", side }, true);
    buzz("ok");
  };
  const rowLabel = `ряд ${h.row + 1}`;
  const screen = ctx.screen;
  if (screen === "hop-brave") {
    const tapped = h.braveTapped || brave?.row === h.row;
    const over = leftUntil(ctx.m, h.braveEnds, ctx.sNow) === 0;
    const go = () => {
      if (h.braveAt === null || tapped) return;
      // Реакция — от назначенного появления кнопки по сверенным часам.
      setBrave({ row: h.row });
      ctx.send({ t: "brave", rt: reactionMs(h.braveAt, ctx.serverNow()) }, true);
      buzz("ok");
    };
    return (
      <Frame me={me}>
        <Body>
          <Head eyebrow={trialEyebrow(t, rowLabel)} title="Кто смелый?" right={<Timer ctx={ctx} at={h.braveEnds} id="brave" />} />
          <button type="button" className="btn btn--block mtp-brave" disabled={tapped || over || !h.jumper} onPointerDown={(e) => {
              e.preventDefault();
              go();
            }}>
            {tapped ? "Ты вызвался!" : "Прыгаю первым!"}
          </button>
          <p className="mtp-hint mtp-center">Первые трое — смельчаки: прыгают раньше всех. Выдержал лёд — +3 монеты в свою копилку</p>
          <LeftRight pick={null} onPick={() => undefined} disabled />
          <p className="mtp-hint mtp-center">{over ? "Смельчаки определяются…" : "Остальные выберут клетку после смельчаков"}</p>
        </Body>
      </Frame>
    );
  }
  if (screen === "hop-jump") {
    if (h.brave)
      return (
        <Frame me={me}>
          <Body>
            <Head eyebrow={trialEyebrow(t, rowLabel)} title="Ты смельчак — прыгай!" right={<Timer ctx={ctx} at={h.jumpEnds} id="jump" />} />
            <LeftRight pick={myPick} onPick={choose} />
            <p className="mtp-hint mtp-center">Все увидят, куда ты прыгнул. Чем кончилось — узнаем вместе</p>
          </Body>
        </Frame>
      );
    return <Info me={me} eyebrow={trialEyebrow(t, rowLabel)} title="Смельчаки прыгают…" text="Смотри на экран: куда они прыгнут? Потом выберешь ты" />;
  }
  if (screen === "hop-choose") {
    const braves = (h.braves ?? []).map(sideWord);
    return (
      <Frame me={me}>
        <Body>
          <Head eyebrow={trialEyebrow(t, rowLabel)} title={h.brave ? "Ты прыгнул" : "Куда прыгаешь?"} right={<Timer ctx={ctx} at={h.chooseEnds} id="choose" />} />
          <Card>
            <p className="mtp-hint">
              <b className="mtp-ink">Смельчаки прыгнули:</b> {braves.length > 0 ? braves.join(", ") : "смельчаков нет"}. Выдержал ли лёд — узнаем вместе
            </p>
          </Card>
          <LeftRight pick={myPick} onPick={choose} disabled={h.brave} />
          <p className="mtp-hint mtp-center">{h.brave ? `Ты прыгнул ${sideWord(myPick)}` : "Не выберешь — клетка выпадет сама. Передумать можно, пока идёт время"}</p>
        </Body>
      </Frame>
    );
  }
  if (screen === "hop-fell") return <Info me={me} eyebrow={trialEyebrow(t, rowLabel)} title="Ты провалился" text="В этом испытании ты больше не прыгаешь — смотри, как прыгают другие" icon={<Drift style={me.style} width={220} />} />;
  // Лёд трескается.
  const solid = h.solid;
  const fell = h.fell;
  return (
    <Frame me={me}>
      <Body center>
        <div className="mtp-eyebrow">{trialEyebrow(t, rowLabel)}</div>
        <h1 className="mtp-title" role="alert">
          {solid === null ? "Лёд трещит…" : fell ? "Лёд треснул!" : "Лёд выдержал!"}
        </h1>
        {solid !== null && <p className="mtp-text">Крепкая клетка — {solid === "L" ? "слева" : "справа"}. Ты прыгнул {sideWord(myPick)}</p>}
        {fell ? <Drift style={me.style} width={220} /> : solid !== null && h.brave ? <p className="mtp-text">+3 монеты смельчаку <Coin /></p> : null}
      </Body>
    </Frame>
  );
}

// ------------------------------------------------------------------ болельщик: прогноз

function GuessScreen({ ctx, me, t }: { ctx: PhoneCtx; me: Me; t: MeTrial }) {
  const g = t.guess ?? { open: false, max: 0, mine: null };
  const max = Math.max(1, g.max);
  const [val, setVal] = useState(() => g.mine ?? Math.round(max / 3));
  const [sent, setSent] = useState<number | null>(g.mine);
  useEffect(() => setSent(g.mine), [g.mine]);
  const set = (n: number) => setVal(Math.max(0, Math.min(max, Math.round(n))));
  const put = () => {
    setSent(val);
    ctx.send({ t: "guess", n: val }, true);
    buzz("ok");
  };
  const kind: TrialKind = t.kind;
  return (
    <Frame me={me} fan>
      <Body>
        <Head eyebrow={`Перед «${TRIAL_TITLES[kind]}»${kind === "chairs" ? " · заход 1" : ""}`} title={GUESS_TITLES[kind]} right={<Timer ctx={ctx} at={t.stageEnds} id="guess" />} />
        <p className="mtp-hint">
          Сейчас в игре <b className="mtp-ink">{g.max}</b>. {GUESS_HINTS[kind]}
        </p>
        <div className="mtp-guess">
          <div className="mtp-bignum mtp-bignum--xl" aria-live="polite">
            {val}
          </div>
          <div className="mtp-hint">{GUESS_UNITS[kind]}</div>
        </div>
        <input className="mtp-slider" type="range" min={0} max={max} step={1} value={val} onChange={(e) => set(Number(e.target.value))} aria-label="Сколько ошибутся" style={{ "--fill": `${(val / max) * 100}%` } as CSSProperties} />
        <div className="mtp-pair">
          <button type="button" className="btn btn--secondary" onClick={() => set(val - 1)} aria-label="Меньше на один">
            − 1
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => set(val + 1)} aria-label="Больше на один">
            + 1
          </button>
        </div>
        <button type="button" className="btn btn--block" onClick={put} disabled={sent === val}>
          {sent === val ? `Прогноз принят: ${val} ✓` : sent === null ? `Поставить: ${val}` : `Изменить прогноз: ${val}`}
        </button>
        <p className="mtp-hint mtp-center">Точнее всех — +3, ошибся не больше чем на 10% — +1</p>
      </Body>
    </Frame>
  );
}

// ------------------------------------------------------------------ итоги испытания

function ResultScreen({ me, t }: { me: Me; t: MeTrial }) {
  const r = t.result;
  if (!r) return <Info me={me} title="Матрёшка всматривается…" />;
  if (me.role !== "player" && !r.out) {
    // Болельщик: прогноз.
    return (
      <Frame me={me} fan>
        <Body center>
          <div className="mtp-eyebrow">{trialEyebrow(t)} · итоги</div>
          {r.fails !== null && <div className="mtp-bignum mtp-bignum--xl">{r.fails}</div>}
          {r.fails !== null && <p className="mtp-text">{plural(r.fails, "игрок ошибся", "игрока ошиблись", "игроков ошиблись")}</p>}
          {r.guess !== null ? (
            <Card tone={r.guessPoints > 0 ? "good" : undefined}>
              <p className="mtp-text mtp-center">
                Твой прогноз — {r.guess}. {r.guessPoints === 3 ? "Точнее всех: +3!" : r.guessPoints === 1 ? "Почти угадал: +1" : "В этот раз мимо"}
              </p>
            </Card>
          ) : (
            <p className="mtp-hint">Ты не ставил прогноз в этот раз</p>
          )}
          <p className="mtp-hint">Очки болельщика: {me.fanScore}</p>
        </Body>
      </Frame>
    );
  }
  if (r.out)
    return (
      <Frame me={me} fan>
        <Body center>
          <Drift style={me.style} width={260} />
          <h1 className="mtp-title">Ты в сугробе — теперь ты болельщик</h1>
          {r.place !== null && (
            <p className="mtp-text">
              Место {r.place} из {r.of} · твоя монета улетела в Копилку <Coin />
            </p>
          )}
          <Card>
            <p className="mtp-hint mtp-left">
              Игра продолжается:
              <br />• угадывай, сколько игроков ошибутся
              <br />• помогай своей стороне в «Канате»
              <br />• ставь на дуэлянтов в финале
              <br />Ещё может быть «Второй шанс»!
            </p>
          </Card>
        </Body>
      </Frame>
    );
  if (r.lostHeart)
    return (
      <Frame me={me}>
        <Body center>
          <div className="mtp-eyebrow">{trialEyebrow(t)} · итоги</div>
          <h1 className="mtp-title">Минус сердечко — ты ещё в игре</h1>
          <Hearts n={me.hearts} total={me.lives} size={52} style={me.style} />
          {r.place !== null && (
            <p className="mtp-text">
              Место {r.place} из {r.of}
            </p>
          )}
          <p className="mtp-hint">Следующая матрёшка уже ждёт — не зевай!</p>
        </Body>
      </Frame>
    );
  return (
    <Frame me={me}>
      <Body center>
        <div className="mtp-eyebrow">{trialEyebrow(t)} · итоги</div>
        <h1 className="mtp-title">{t.seeding ? "Ты в финале — это испытание на посев" : "Ты прошёл дальше!"}</h1>
        {r.place !== null && <div className="mtp-bignum">{r.place} место</div>}
        {r.place !== null && <p className="mtp-text">из {r.of} · сердечек: {me.hearts}</p>}
        <p className="mtp-hint">Смотри на экран — кто сегодня в сугробе</p>
      </Body>
    </Frame>
  );
}

// ------------------------------------------------------------------ «Второй шанс»

function ChanceQuestion({ ctx, me }: { ctx: PhoneCtx; me: Me }) {
  const c = me.chance;
  const [mine, setMine] = useState<number | null>(null);
  if (!c) return null;
  const answered = c.answered ?? mine;
  const answer = (i: number) => {
    if (answered !== null || c.stageAt === null) return;
    setMine(i);
    // Реакция — от назначенного показа вопроса по сверенным часам.
    ctx.send({ t: "ans", i, rt: reactionMs(c.stageAt, ctx.serverNow()) }, true);
    buzz("ok");
  };
  return (
    <Frame me={me} fan>
      <Body>
        <Head eyebrow="Второй шанс · один раз за игру" title="Вернись в игру!" right={<Timer ctx={ctx} at={c.stageEnds} id="chance" />} />
        <div className="mtp-card">
          <p className="mtp-question">{c.q}</p>
        </div>
        <div className="mtp-options" role="radiogroup" aria-label="Варианты ответа">
          {(c.options ?? []).map((o, i) => (
            <button key={i} type="button" role="radio" aria-checked={answered === i} disabled={answered !== null && answered !== i} className={`mtp-option${answered === i ? " is-on" : ""}`} onClick={() => answer(i)}>
              <b>{"АБВГ"[i]}</b>
              <span>{o}</span>
            </button>
          ))}
        </div>
        <p className="mtp-hint mtp-center">{answered !== null ? "Ответ принят — ответить можно один раз" : "Вернутся самые быстрые с верным ответом — с 1 сердечком"}</p>
      </Body>
    </Frame>
  );
}

function ChanceBack({ me }: { me: Me }) {
  const c = me.chance;
  if (!c) return null;
  const right = c.correct !== null && c.answered === c.correct;
  const correctText = c.correct !== null && c.options ? c.options[c.correct] : null;
  if (c.returned)
    return (
      <Frame me={me}>
        <Body center>
          <div className="mtp-eyebrow">Второй шанс</div>
          <h1 className="mtp-title">Ты вернулся в игру!</h1>
          <Hearts n={Math.max(1, me.hearts)} total={Math.max(1, me.lives)} size={52} style={me.style} />
          <p className="mtp-text">Одно сердечко — береги его</p>
        </Body>
      </Frame>
    );
  return (
    <Info me={me} eyebrow="Второй шанс" title={c.stage === "back" || c.stage === "done" ? (right ? "Верно, но были быстрее" : "В этот раз не вышло") : "Ждём ответов…"} text={correctText ? `Верный ответ: ${correctText}` : undefined}>
      <p className="mtp-hint">Болеешь дальше — прогнозы, «Канат», ставки в финале</p>
    </Info>
  );
}

// ------------------------------------------------------------------ финал

function DuelScreen({ ctx, me }: { ctx: PhoneCtx; me: Me }) {
  const d = me.final?.duel;
  const [mine, setMine] = useState<{ key: string; g: Gesture } | null>(null);
  if (!d) return null;
  const key = `${d.roundNo}:${d.stageEnds ?? ""}`;
  const pick = mine?.key === key ? mine.g : d.pick;
  const choose = (g: Gesture) => {
    setMine({ key, g });
    ctx.send({ t: "rps", g }, true);
    buzz("ok");
  };
  const other = avatarOf(d.opponent.name).rest;
  const head = `Финал · ты против ${numText(d.opponent.num)} ${other}`;
  const score = (
    <div className="mtp-card mtp-score">
      <div>
        <div className="mtp-bignum">{d.wins[d.me]}</div>
        <div className="mtp-hint">ты</div>
      </div>
      <div className="mtp-hint">до двух побед</div>
      <div>
        <div className="mtp-bignum">{d.wins[d.me === 0 ? 1 : 0]}</div>
        <div className="mtp-hint mtp-clip">{other}</div>
      </div>
    </div>
  );
  if (d.stage === "bets") return <Info me={me} eyebrow={head} title="Готовься!" text="Болельщики ставят на вас. Сейчас выбирать жест — 5 секунд" />;
  if (d.stage === "pick")
    return (
      <Frame me={me}>
        <Body>
          <Head eyebrow={head} title="Твой жест" right={<Timer ctx={ctx} at={d.stageEnds} id="pick" />} />
          {score}
          <div className="mtp-gestures" role="radiogroup" aria-label="Жест">
            {(["r", "s", "p"] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={pick === g} className={`mtp-gesture${pick === g ? " is-on" : ""}`} onClick={() => choose(g)}>
                <GestureArt g={g} size={64} />
                {GESTURE_TITLES[g]}
              </button>
            ))}
          </div>
          <p className="mtp-hint mtp-center">Не выберешь — Матрёшка выберет за тебя. Передумать можно, пока идёт время</p>
        </Body>
      </Frame>
    );
  const gs = d.gestures;
  const myG = gs ? gs[d.me] : null;
  const theirG = gs ? gs[d.me === 0 ? 1 : 0] : null;
  return (
    <Frame me={me}>
      <Body center>
        <div className="mtp-eyebrow">{head}</div>
        <h1 className="mtp-title" role="alert">
          {d.stage === "over" ? (d.winner ? "Ты победил в дуэли!" : "Дуэль проиграна") : myG && theirG && myG === theirG ? "Ничья — ещё раз!" : "Раз, два, три!"}
        </h1>
        {myG && theirG && (
          <div className="mtp-vs">
            <div>
              <GestureArt g={myG} size={84} />
              <div className="mtp-hint">ты{d.auto ? " · выбрала Матрёшка" : ""}</div>
            </div>
            <b>против</b>
            <div>
              <GestureArt g={theirG} size={84} />
              <div className="mtp-hint mtp-clip">{other}</div>
            </div>
          </div>
        )}
        {score}
      </Body>
    </Frame>
  );
}

function BetScreen({ ctx, me }: { ctx: PhoneCtx; me: Me }) {
  const w = me.final?.watch;
  const [mine, setMine] = useState<{ key: string; side: 0 | 1 } | null>(null);
  if (!w) return null;
  const key = `${w.a.num}:${w.b.num}`;
  const bet = mine?.key === key ? mine.side : w.bet;
  const put = (side: 0 | 1) => {
    setMine({ key, side });
    ctx.send({ t: "bet", side }, true);
    buzz("ok");
  };
  return (
    <Frame me={me} fan>
      <Body>
        <Head eyebrow="Финал · ставка" title="На кого ставишь?" right={<Timer ctx={ctx} at={w.stageEnds} id="bet" />} />
        <div className="mtp-options" role="radiogroup" aria-label="Дуэлянты">
          {([w.a, w.b] as const).map((p, i) => {
            const av = avatarOf(p.name);
            const side = i === 0 ? 0 : 1;
            return (
              <button key={i} type="button" role="radio" aria-checked={bet === side} className={`mtp-option mtp-option--who${bet === side ? " is-on" : ""}`} onClick={() => put(side)}>
                <span className="mtp-chip mtp-chip--big" aria-hidden="true">
                  {av.mark}
                </span>
                <span>
                  <b className="mtp-who">{av.rest}</b>
                  <span className="mtp-hint">{numText(p.num)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mtp-card mtp-row">
          <span className="mtp-hint">Твои очки болельщика</span>
          <b className="mtp-bignum mtp-bignum--sm">{me.fanScore}</b>
        </div>
        <p className="mtp-hint mtp-center">{bet !== null ? "Ставка принята — передумать можно, пока идёт время" : "Угадал победителя дуэли — +1"}</p>
      </Body>
    </Frame>
  );
}

function DuelWatch({ me }: { me: Me }) {
  const w = me.final?.watch;
  if (!w) return null;
  const a = avatarOf(w.a.name).rest;
  const b = avatarOf(w.b.name).rest;
  const won = w.winner !== null && w.bet !== null ? w.winner === w.bet : null;
  return (
    <Info me={me} eyebrow="Финал · дуэль" title={`${a} — ${b}`} text={`Счёт ${w.wins[0]} : ${w.wins[1]}`}>
      {w.bet !== null && <p className="mtp-text">Твоя ставка — на {w.bet === 0 ? a : b}</p>}
      {won !== null && <Card tone={won ? "good" : undefined}>{won ? "Угадал! +1" : "В этот раз мимо"}</Card>}
      <p className="mtp-hint">Смотри на экран: руки уже в рукавах матрёшки</p>
    </Info>
  );
}

// ------------------------------------------------------------------ экран

function Countdown({ ctx, me, t }: { ctx: PhoneCtx; me: Me; t: MeTrial }) {
  const left = useLeft(ctx, t.stageEnds) ?? 0;
  const n = Math.max(1, Math.ceil(left / 1000));
  return (
    <Frame me={me} fan={me.role !== "player"}>
      <Body center>
        <div className="mtp-eyebrow">{trialEyebrow(t)}</div>
        <div className="mtp-count" key={n} aria-live="assertive">
          {n}
        </div>
        <p className="mtp-text">{me.role === "player" ? (t.kind === "freeze" ? "Приготовь палец — держи нижнюю половину экрана" : "Приготовься!") : "Сейчас начнётся — болей!"}</p>
      </Body>
    </Frame>
  );
}

function Intro({ ctx, me, t }: { ctx: PhoneCtx; me: Me; t: MeTrial }) {
  const player = me.role === "player";
  return (
    <Frame me={me} fan={!player}>
      <Body>
        <Head eyebrow={`Испытание ${t.index + 1}`} title={`«${TRIAL_TITLES[t.kind]}»`} right={<Timer ctx={ctx} at={t.stageEnds} id="intro" />} />
        <div className="mtp-doll-row">
          <Doll style={me.style} width={96} />
        </div>
        <Card>
          <p className="mtp-text">{TRIAL_RULES[t.kind]}</p>
        </Card>
        {t.seeding && player && <p className="mtp-hint mtp-center">Ты уже в финале: это испытание — на посев, никто не теряет сердечко</p>}
        <p className="mtp-hint mtp-center">{player ? "Слушай ведущего и смотри на экран" : t.kind === "rope" ? "В «Канате» болельщики тоже тянут — жми на узел за свою сторону" : "Смотри на экран и болей"}</p>
      </Body>
    </Frame>
  );
}

function Lobby({ ctx, me }: { ctx: PhoneCtx; me: Me }) {
  const av = avatarOf(me.name || ctx.name);
  const late = me.role === "fan" || me.late;
  return (
    <>
      <Body center>
        <div className="mtp-eyebrow">Ты во дворе Матрёшки</div>
        <div className="mtp-bignum mtp-bignum--no">{numText(me.num)}</div>
        <div className="mtp-text mtp-lead">
          <span aria-hidden="true">{av.mark}</span> <b>{av.rest}</b>
        </div>
        <Card>
          <div className="mtp-eyebrow mtp-center">{late ? "Ты болельщик" : "Твои сердечки"}</div>
          {!late && (
            <div className="mtp-center">
              <Hearts n={me.hearts > 0 ? me.hearts : me.lives} total={me.lives} size={44} style={me.style} />
            </div>
          )}
          <p className="mtp-hint mtp-center">{late ? "Игра уже идёт — угадывай, тяни канат за свою сторону и ставь на финалистов" : "Ошибся — минус сердечко. Нет сердечек — в сугроб, но игра не кончается: станешь болельщиком"}</p>
        </Card>
        <Doll style={me.style} width={110} />
        <p className="mtp-text">
          <b>Ждём начала</b>
          {me.lobbyCount !== null ? ` · во дворе уже ${me.lobbyCount} ${plural(me.lobbyCount, "игрок", "игрока", "игроков")}` : ""}
        </p>
        <p className="mtp-hint">Смотри на большой экран — там Матрёшка</p>
      </Body>
      <span className="mtp-mono" aria-hidden="true">
        <Logo kind="monogram" />
      </span>
    </>
  );
}

export function PhoneScreen({ ctx, onTake }: { ctx: PhoneCtx; onTake: () => void }) {
  const me = ctx.me;
  switch (ctx.screen) {
    case "connecting":
      return <Info me={null} title="Подключаемся…" text="Ищем тебя во дворе. Если интернет медленный — подожди, всё вернётся само." />;
    case "tab":
      return (
        <Info me={null} title="Открыто в другой вкладке" text="Игра уже открыта на этом телефоне в другой вкладке или окне. Играть можно в одной.">
          <div className="actions mtp-actions">
            <button type="button" className="btn btn--block" onClick={onTake}>
              Открыть здесь
            </button>
          </div>
        </Info>
      );
    case "abandoned":
      return <Info me={null} title="Ждём ведущего" text="Игра давно стоит. Как только ведущий вернётся к пульту, двор появится здесь сам." />;
    case "removed":
      return (
        <Info me={null} title="Тебя нет в игре" text="Ведущий убрал тебя из игры или за тебя вошли с другого телефона. Если это ошибка — войди снова по коду.">
          <div className="actions mtp-actions">
            <a className="btn btn--block" href={`/play/${ctx.code.replace(/\D/g, "")}`}>
              Войти снова
            </a>
          </div>
        </Info>
      );
    case "over":
      return <Info me={me} title="Игра окончена" text="Спасибо за игру! Итоги — на большом экране." />;
  }
  if (!me) return null;
  const t = me.trial;
  switch (ctx.screen) {
    case "pause":
      return <Info me={me} title="Пауза" text="Отпусти палец и жди — игра продолжится с того же места" icon={<Doll style={me.style} width={110} eyes="closed" />} />;
    case "lobby":
      return <Lobby ctx={ctx} me={me} />;
    case "intro":
      return t ? <Intro ctx={ctx} me={me} t={t} /> : null;
    case "guess":
      return t ? <GuessScreen ctx={ctx} me={me} t={t} /> : null;
    case "countdown":
      return t ? <Countdown ctx={ctx} me={me} t={t} /> : null;
    case "freeze":
      return t?.freeze ? <FreezePlay ctx={ctx} me={me} t={t} f={t.freeze} /> : null;
    case "ginger-pick":
      return t?.ginger ? <GingerPick ctx={ctx} me={me} t={t} g={t.ginger} /> : null;
    case "ginger-unbox":
      return t?.ginger ? <GingerUnbox ctx={ctx} me={me} t={t} g={t.ginger} /> : null;
    case "ginger-trace":
      return t?.ginger ? <GingerTrace key={`${t.index}:${t.ginger.shape ?? ""}`} ctx={ctx} me={me} t={t} g={t.ginger} /> : null;
    case "ginger-end":
      return t?.ginger ? <GingerEnd me={me} t={t} g={t.ginger} /> : null;
    case "chairs-music":
    case "chairs-stop":
    case "chairs-tap":
    case "chairs-wait":
    case "chairs-seated":
    case "chairs-missed":
    case "chairs-off":
      return t?.chairs ? <ChairsPlay ctx={ctx} me={me} t={t} c={t.chairs} /> : null;
    case "rope":
    case "rope-wait":
      return t?.rope ? <RopePlay ctx={ctx} me={me} r={t.rope} /> : null;
    case "hop-brave":
    case "hop-jump":
    case "hop-choose":
    case "hop-crack":
    case "hop-fell":
      return t?.hop ? <HopPlay ctx={ctx} me={me} t={t} h={t.hop} /> : null;
    case "watch":
      return t ? <Info me={me} eyebrow={trialEyebrow(t)} title={me.role === "player" ? "Смотри на экран" : "Болей!"} text={me.role === "player" ? "В этом испытании ты не участвуешь" : "Смотри на экран — следующий прогноз перед новой матрёшкой"} icon={<Doll style={me.style} width={110} />} /> : null;
    case "judging":
      return <Info me={me} eyebrow={t ? trialEyebrow(t) : undefined} title="Матрёшка всматривается…" text="Кто ошибся — сейчас узнаем" icon={<Doll style={me.style} width={110} eyes="look" />} />;
    case "result":
      return t ? <ResultScreen me={me} t={t} /> : null;
    case "chance-offer":
      return <Info me={me} eyebrow="Второй шанс" title="Дверца открывается…" text="Сейчас будет вопрос. Ответишь верно и быстрее других — вернёшься в игру" icon={<Doll style={me.style} width={110} />} />;
    case "chance-question":
      return <ChanceQuestion ctx={ctx} me={me} />;
    case "chance-back":
      return <ChanceBack me={me} />;
    case "chance-wait":
      return <Info me={me} eyebrow="Второй шанс" title="Ждём выбывших" text={me.role === "player" ? "Выбывшие отвечают на вопрос — кто-то вернётся в игру" : "Вопрос — тем, кого выбила игра. Жди следующую матрёшку"} />;
    case "dob-intro":
      return <Info me={me} eyebrow="Перед финалом" title="Добивка: лёд вслепую" text="Смельчаков нет — прыгают все. Пока не останется столько, сколько выйдет в финал" icon={<Drift style={me.style} width={220} />} />;
    case "dob-choose": {
      const d = me.dobivka;
      return d ? <DobChoose ctx={ctx} me={me} /> : null;
    }
    case "dob-crack": {
      const d = me.dobivka;
      return d ? <Info me={me} eyebrow={`Добивка · ряд ${d.row + 1}`} title={d.fell ? "Лёд треснул!" : "Лёд выдержал!"} text={d.solid !== null ? `Крепкая клетка — ${d.solid === "L" ? "слева" : "справа"}. Ты прыгнул ${sideWord(d.pick)}` : undefined} /> : null;
    }
    case "dob-fell":
      return <Info me={me} eyebrow="Добивка" title="Ты провалился" text="Кто выйдет в финал — решится после рядов" icon={<Drift style={me.style} width={220} />} />;
    case "dob-wait":
      return <Info me={me} eyebrow="Добивка" title="Болей!" text="Игроки прыгают по льду вслепую" />;
    case "dob-results": {
      const d = me.dobivka;
      if (d?.out) return <Info me={me} eyebrow="Добивка" title="Ты в сугробе — теперь ты болельщик" text="Финал без тебя, но ставки — твои: угадывай победителей дуэлей" icon={<Drift style={me.style} width={240} />} />;
      return <Info me={me} eyebrow="Добивка" title={me.role === "player" ? "Ты в финале!" : "Финалисты определены"} text="Смотри на экран — сетка финала" />;
    }
    case "bracket": {
      const f = me.final;
      return f?.finalist ? <Info me={me} eyebrow="Финал" title="Ты в финале!" text={`Посев ${f.seed ?? "?"}. «Камень, ножницы, бумага» до двух побед`} icon={<Doll style={me.style} width={110} />} /> : <Info me={me} eyebrow="Финал" title="Финал начинается" text="Перед каждой дуэлью болельщики ставят на одного из двоих — угадал, +1" />;
    }
    case "duel":
      return <DuelScreen ctx={ctx} me={me} />;
    case "bet":
      return <BetScreen ctx={ctx} me={me} />;
    case "duel-watch":
      return <DuelWatch me={me} />;
    case "champion": {
      const f = me.final;
      if (f?.champion) return <Info me={me} eyebrow="Финал" title="Ты чемпион двора!" text="Самая маленькая матрёшка открыта — Копилка твоя!" icon={<Doll style={me.style} width={130} />} />;
      if (f?.bestFan) return <Info me={me} eyebrow="Финал" title="Ты лучший болельщик!" text={`Очки болельщика: ${me.fanScore}`} icon={<Coin size={64} />} />;
      return <Info me={me} eyebrow="Финал" title="Чемпион определён!" text="Смотри на экран — Копилка взрывается" />;
    }
    case "podium": {
      const p = me.podium;
      return (
        <Info me={me} eyebrow="Итоги игры" title={p ? `${p.place} место` : "Игра окончена"} text={p ? `${p.points} ${plural(p.points, "очко", "очка", "очков")} в таблице` : undefined}>
          {me.fanScore > 0 && <p className="mtp-text">Очки болельщика: {me.fanScore}</p>}
          <p className="mtp-hint">Смотри на экран — пьедестал</p>
        </Info>
      );
    }
  }
  return null;
}

function DobChoose({ ctx, me }: { ctx: PhoneCtx; me: Me }) {
  const d = me.dobivka;
  const [pick, setPick] = useState<{ row: number; side: Side } | null>(null);
  if (!d) return null;
  const mine = pick?.row === d.row ? pick.side : d.pick;
  const choose = (side: Side) => {
    setPick({ row: d.row, side });
    ctx.send({ t: "cell", side }, true);
    buzz("ok");
  };
  return (
    <Frame me={me}>
      <Body>
        <Head eyebrow={`Добивка · ряд ${d.row + 1} из 3`} title="Куда прыгаешь?" right={<Timer ctx={ctx} at={d.chooseEnds} id="dob" />} />
        <p className="mtp-hint">Смельчаков нет — лёд вслепую. Не выберешь — клетка выпадет сама</p>
        <LeftRight pick={mine} onPick={choose} />
      </Body>
    </Frame>
  );
}
