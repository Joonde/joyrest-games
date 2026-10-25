// Экран зала «Боя с драконом» в новом виде (решение владельца 15 октября 2026, макет «Бой с драконом — экран
// зала»): кадр 16:9, сверху имя дракона и шкала здоровья с «тенью», в центре живой дракон, по бокам карточки
// команд (герой, жизни, урон), снизу задание. Два вида по `content.style`: «classic» — взрослый (тёмная сцена,
// угли, удар команды — катана, атаки дракона — луч из третьего глаза и дыхание), «kids» — детский (небо,
// Дракоша, удар — самолётик или воздушный змей, атаки — радужный луч и облако бабочек).
// Логика игры не меняется: экран только показывает переход reveal/victory/defeat анимацией, пока экран открыт.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { HallTimer } from "../../../components/live/HallTimer";
import { Confetti } from "../../../components/live/Confetti";
import { playSample, playSound, preloadSamples } from "../../../components/live/sound";
import { useCountdownSounds } from "../../../components/live/useCountdownSounds";
import { useServerNow } from "../../../components/live/useServerNow";
import { NameText } from "../../../components/NameText";
import { secondsLeft } from "../../../core/session";
import type { Session } from "../../../data/types";
import type { ViewProps } from "../../types";
import { DICE_LUCK, heroOf, STAT_POINTS, STATS, taskText, type DragonContent, type DragonTask } from "../content";
import { dragonKind, type DragonKind } from "../DragonArt";
import { battleOf, maxLives, parseDragonResult, taskOf, type DragonResult } from "../logic";
import { AdultDragon, BROW_Y, KidDragon, MOUTH_Y } from "./dragons";
import { banner, beam, breath, butterflies, charge, fly, floatText, katana, Particles, stars, wait, type FxCtx, type Point, type Target } from "./fx";
import "./dragon.css";

const LETTERS = ["А", "Б", "В", "Г"];
const HUE: Record<DragonKind, number> = { fire: 22, ice: 196, gold: 96, shadow: 282 };
const ADULT_COLORS = ["#ff8a2b", "#6fc3ff", "#c7d36b", "#e36be0", "#ffd166", "#7ee0c3", "#ff6b6b", "#a78bfa", "#f4a261", "#94d2bd"];
const KID_COLORS = ["#ff6fae", "#3fb4ff", "#ffb020", "#3fd39b", "#9b6bff", "#ff8a5c", "#2ec4b6", "#f15bb5", "#00bbf9", "#8ac926"];
const BREATH_NAME: Record<DragonKind, string> = { fire: "Огненное дыхание", ice: "Ледяное дыхание", gold: "Дыхание древних", shadow: "Дыхание тьмы" };

type Attack = "beam" | "breath";
/** Какой атакой дракон бьёт на этом задании: чередуются, чтобы зал видел обе. */
export function attackOf(r: Pick<DragonResult, "battle" | "task">): Attack {
  return (r.battle + r.task) % 2 === 0 ? "beam" : "breath";
}

interface Shown {
  hp: number;
  lives: Record<string, number>;
  dead: string[];
}

const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "") : "");
const reduceMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function restart(el: Element | null, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

function Hearts({ lives, max, compact = false }: { lives: number; max: number; compact?: boolean }) {
  // Компактная карточка (9+ команд): одно сердце и число — ряд из 3–5 мелких сердец не читался с задних рядов.
  if (compact)
    return (
      <span className="dg-hearts dg-hearts--n" aria-label={`Жизни: ${lives} из ${max}`}>
        <span className={lives > 0 ? "is-on" : ""} aria-hidden="true">
          ♥
        </span>
        <b aria-hidden="true">{lives}</b>
      </span>
    );
  return (
    <span className="dg-hearts" aria-label={`Жизни: ${lives} из ${max}`}>
      {Array.from({ length: Math.min(max, 12) }, (_, i) => (
        <span key={i} className={i < lives ? "is-on" : ""} aria-hidden="true">
          ♥
        </span>
      ))}
    </span>
  );
}

function TaskBox({ task, r, reveal, left, kids, session, content }: { task: DragonTask | null; r: DragonResult; reveal: boolean; left: number | null; kids: boolean; session: Session; content: DragonContent }) {
  const battle = battleOf(content, r);
  const stat = task ? STATS.find((s) => s.id === task.stat) : null;
  const timer =
    left !== null ? (
      <div className="dg-timer">
        <HallTimer left={left} total={session.state.timeLimit ?? task?.seconds ?? null} size="calc(4.4 * var(--u))" />
      </div>
    ) : null;
  if (r.order.length === 0 || r.phase === "heroes") {
    return (
      <div className="dg-q dg-q--center">
        <div className="dg-q__eye">Бой с драконом</div>
        <div className="dg-q__text">{r.phase === "heroes" ? (session.playMode === "solo" ? "Игроки выбирают героев" : "Капитаны выбирают героев") : "Скоро в бой!"}</div>
        <p className="dg-q__note">
          У каждого героя своя сила. {session.playMode === "solo" ? "Игрок раскладывает" : "Капитан раскладывает"} {STAT_POINTS} очков по свойствам: Сила, Ум, Ловкость, Удача, Харизма.
          {r.phase === "heroes" && session.state.answered > 0 ? ` Выбрали: ${session.state.answered} из ${r.order.length}.` : ""}
        </p>
      </div>
    );
  }
  if (r.phase === "over") {
    return (
      <div className="dg-q dg-q--center">
        <div className="dg-q__text">Битвы окончены!</div>
      </div>
    );
  }
  if (r.phase === "victory" || r.phase === "defeat") {
    const killer = nameOf(session, r.killer);
    const mvp = [...r.order].sort((a, b) => (r.dmg[b] ?? 0) - (r.dmg[a] ?? 0))[0] ?? null;
    return (
      <div className="dg-q dg-q--center">
        <div className="dg-q__text dg-q__text--big">{r.phase === "victory" ? (kids ? "Дракоша сдаётся! 🏆" : "Дракон повержен! 🏆") : kids ? "Дракоша победил!" : "Дракон победил 🔥"}</div>
        {r.phase === "victory" && killer && (
          <p className="dg-q__note">
            Последний удар — <NameText name={killer} /> (+{content.killBonus})
          </p>
        )}
        {r.phase === "defeat" && <p className="dg-q__note">Очки этого боя сгорели. Следующий бой — новый шанс!</p>}
        {r.phase === "victory" && mvp && (r.dmg[mvp] ?? 0) > 0 && (
          <p className="dg-q__note">
            Больше всех урона: <NameText name={nameOf(session, mvp)} /> — {r.dmg[mvp]}
          </p>
        )}
      </div>
    );
  }
  if (!task) return null;
  if (r.phase === "intro") {
    return (
      <div className="dg-q dg-q--center">
        <div className="dg-q__eye">
          Бой {r.battle + 1} · задание {r.task + 1} из {battle?.tasks.length ?? 0}
        </div>
        <div className="dg-q__text dg-q__text--big">
          {stat?.icon} {stat?.title}
        </div>
        <p className="dg-q__note">{task.kind === "dice" ? `${session.playMode === "solo" ? "Игроки бросают" : "Капитаны бросают"} кубик: ${DICE_LUCK} и больше — удар, меньше — промах` : task.kind === "task" ? "Активное задание — засчитывает ведущий" : session.playMode === "solo" ? "Вопрос — отвечает каждый" : "Вопрос — отвечает капитан"}</p>
      </div>
    );
  }
  return (
    <div className="dg-q">
      <div className="dg-q__eye">
        Задание {r.task + 1} · {stat?.icon} {stat?.title}
      </div>
      {timer}
      <div className={`dg-q__text${timer ? " has-timer" : ""}`}>{taskText(task, session.playMode)}</div>
      {task.kind === "choice" && (
        <ol className="dg-q__ans">
          {task.options.map((o, i) =>
            o ? (
              <li key={i} className={reveal && i === task.correct ? "is-ok" : ""}>
                <b>{LETTERS[i]}</b>
                <span>{o}</span>
              </li>
            ) : null,
          )}
        </ol>
      )}
      {task.kind === "dice" && <p className="dg-q__note">{session.playMode === "solo" ? "🎲 Бросайте кубик на телефоне — число увидите на своей карточке" : "🎲 Капитаны бросают кубик на телефоне — число увидите на карточке команды"}</p>}
      {task.kind === "task" && <p className="dg-q__note">Выполняйте — ведущий засчитает удар</p>}
    </div>
  );
}

export function DragonStage({ session, content }: ViewProps<DragonContent>) {
  const r = parseDragonResult(session.state.result);
  const { stage, step } = session.state;
  const kids = content.style === "kids";
  const battle = battleOf(content, r);
  const task = taskOf(content, r);
  const first = content.battles[0];
  const kind: DragonKind = battle ? dragonKind(battle.name, r.battle) : first ? dragonKind(first.name, 0) : "fire";
  const now = useServerNow(250, stage === "question");
  const left = stage === "question" && task && task.kind === "choice" && task.seconds > 0 ? secondsLeft(session.state, now) : null;
  useCountdownSounds(left);

  const frameRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragonRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const particles = useRef<Particles | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [atk, setAtk] = useState<"charge" | "fire" | null>(null);
  const [confetti, setConfetti] = useState<string | null>(null);
  const run = useRef(0);
  const seen = useRef<string | null>(null);

  // Частицы фона и эффектов — один раз на экран; вид и окрас меняются на ходу.
  useEffect(() => {
    const b = backRef.current;
    const t = topRef.current;
    if (!b || !t || typeof b.getContext !== "function") return;
    const p = new Particles(b, t, kids, HUE[kind], reduceMotion());
    particles.current = p;
    const onResize = () => p.resize();
    window.addEventListener("resize", onResize);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    if (frameRef.current) ro?.observe(frameRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      p.stop();
      particles.current = null;
    };
  }, []);
  useEffect(() => particles.current?.setLook(kids, HUE[kind]), [kids, kind]);
  useEffect(() => preloadSamples(["dragonAttack", "dragonHurt"]), [step]);
  // Ушли с экрана посреди анимации — остановить.
  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  const ctx = (): FxCtx | null => {
    const frame = frameRef.current;
    const layer = layerRef.current;
    const svg = svgRef.current;
    if (!frame || !layer || !svg) return null;
    svg.setAttribute("viewBox", `0 0 ${frame.clientWidth} ${frame.clientHeight}`);
    return { layer, svg, u: frame.clientWidth / 100, particles: particles.current, kids };
  };
  const rel = (el: Element | null | undefined): { x: number; y: number; w: number; h: number } | null => {
    const frame = frameRef.current;
    if (!el || !frame) return null;
    const f = frame.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { x: b.left - f.left + b.width / 2, y: b.top - f.top + b.height / 2, w: b.width, h: b.height };
  };
  const dragonBox = () => {
    const svg = dragonRef.current?.querySelector("svg");
    const frame = frameRef.current;
    if (!svg || !frame) return null;
    const f = frame.getBoundingClientRect();
    const b = svg.getBoundingClientRect();
    return { left: b.left - f.left, top: b.top - f.top, w: b.width, h: b.height, x: b.left - f.left + b.width / 2, y: b.top - f.top + b.height * 0.5 };
  };

  const key = `${step}:${r.phase}`;
  useEffect(() => {
    const before = seen.current;
    seen.current = key;
    if (before === null || before === key) return;
    const id = ++run.current;
    const alive = () => id === run.current;
    setShown(null);
    setAtk(null);

    if (r.phase === "intro") {
      restart(dragonRef.current, "is-roar");
      if (r.task === 0) playSample("dragonAttack", "roar");
      else playSound("gong");
      return;
    }
    const fx = ctx();
    const db = dragonBox();
    const strikers = r.phase === "reveal" || r.phase === "victory" ? r.order.filter((p) => (r.last[p]?.damage ?? 0) > 0) : [];
    const hitBack =
      r.phase === "reveal"
        ? r.order.filter((p) => {
            const h = r.last[p];
            return !!h && (h.lost > 0 || h.saved !== null);
          })
        : [];
    if (reduceMotion() || !fx || !db) {
      // Без анимации — только звуки, как раньше.
      if (r.phase === "defeat") playSample("dragonAttack", "flame");
      if (r.phase === "reveal" || r.phase === "victory") {
        if (strikers.length > 0) playSample("dragonHurt", "roar");
        if (hitBack.length > 0) window.setTimeout(() => playSample("dragonAttack", "flame"), strikers.length > 0 ? 1400 : 0);
        if (r.phase === "victory") {
          window.setTimeout(() => playSound("fanfare"), 1500);
          setConfetti(key);
        }
        if (strikers.length === 0 && hitBack.length === 0) playSound("wrong");
      }
      return;
    }

    const attackTargets = (ids: string[], onHit: (p: string) => void): Promise<void> => {
      if (ids.length === 0) return Promise.resolve();
      const targets: Target[] = ids.flatMap((p) => {
        const b = rel(cards.current.get(p));
        return b ? [{ id: p, x: b.x, y: b.y }] : [];
      });
      if (targets.length === 0) return Promise.resolve();
      const groundY = targets.reduce((s, t) => s + t.y, 0) / targets.length;
      const a = attackOf(r);
      const origin: Point = { x: db.x, y: db.top + (db.h * (a === "beam" ? BROW_Y : kids ? MOUTH_Y.kid : MOUTH_Y.adult)) / 400 };
      return (async () => {
        setAtk("charge");
        const c = charge(fx, origin, 1200);
        if (!kids && a === "breath") restart(dragonRef.current, "is-inhale");
        await wait(1300);
        if (!alive()) return c.done();
        dragonRef.current?.classList.remove("is-inhale");
        restart(dragonRef.current, "is-roar");
        setAtk("fire");
        c.fire();
        playSample("dragonAttack", "flame");
        banner(fx, kids ? (a === "beam" ? "Радужный чих!" : "Облако бабочек!") : a === "beam" ? "Луч третьего глаза" : BREATH_NAME[kind]);
        if (a === "beam") await beam(fx, origin, targets, groundY, onHit);
        else if (kids) await butterflies(fx, origin, targets, onHit);
        else await breath(fx, origin, targets, groundY, onHit);
        c.done();
        if (alive()) setAtk(null);
      })();
    };

    if ((r.phase === "reveal" || r.phase === "victory") && r.prev) {
      const prev = r.prev;
      setShown({ hp: prev.hp, lives: { ...prev.lives }, dead: [...prev.dead] });
      void (async () => {
        await wait(350);
        const gap = strikers.length > 0 ? Math.min(380, 2600 / strikers.length) : 0;
        let roared = false;
        const half = Math.ceil(r.order.length / 2);
        await Promise.all(
          strikers.map(async (p, i) => {
            await wait(i * gap);
            if (!alive()) return;
            const hit = r.last[p];
            if (!hit) return;
            const crit = hit.damage >= (task?.power ?? 100) * 3;
            const card = rel(cards.current.get(p));
            const fromLeft = r.order.indexOf(p) < half;
            const color = (kids ? KID_COLORS : ADULT_COLORS)[r.order.indexOf(p) % 10] ?? "#ff8a2b";
            const at = kids
              ? await fly(fx, (r.order.indexOf(p) + r.task) % 2 === 0 ? "plane" : "kite", card ? { x: card.x, y: card.y - card.h / 2 } : { x: db.x, y: db.y * 2 }, { x: db.x + (Math.random() - 0.5) * db.w * 0.18, y: db.y + (Math.random() - 0.3) * db.h * 0.25 }, color, frameRef.current?.clientHeight ?? 500)
              : await katana(fx, fromLeft, db, crit);
            if (!alive()) return;
            if (!roared) {
              roared = true;
              playSample("dragonHurt", "roar");
            }
            restart(dragonRef.current, "is-hit");
            if (kids) stars(fx, at.x, at.y);
            fx.particles?.spark(at.x, at.y, crit ? 40 : 22);
            setShown((s) => (s ? { ...s, hp: Math.max(r.hp, s.hp - hit.damage) } : s));
            floatText(fx, at.x + (Math.random() - 0.5) * 8 * fx.u, at.y - 4 * fx.u, `<small>${escapeHtml(nameOf(session, p))}${hit.roll ? ` · 🎲${hit.roll}` : ""}</small>−${hit.damage.toLocaleString("ru-RU")}`, crit ? "is-crit" : "");
          }),
        );
        if (!alive()) return;
        if (hitBack.length > 0) {
          await wait(450);
          if (!alive()) return;
          await attackTargets(hitBack, (p) => {
            const h = r.last[p];
            const el = cards.current.get(p);
            const b = rel(el);
            if (!h || !b) return;
            if (h.lost > 0) {
              setShown((s) => (s ? { ...s, lives: { ...s.lives, [p]: r.lives[p] ?? 0 }, dead: r.dead.includes(p) ? [...s.dead, p] : s.dead } : s));
              restart(el ?? null, "is-hurt");
              floatText(fx, b.x, b.y - b.h * 0.6, "−1 ♥", "is-small is-bad");
            } else {
              restart(el ?? null, h.saved === "dodge" ? "is-dodge" : "is-shield");
              floatText(fx, b.x, b.y - b.h * 0.6, h.saved === "shield" ? "🛡 Щит!" : "💨 Увернулись!", "is-small is-good");
            }
            fx.particles?.spark(b.x, b.y, 18);
          });
        }
        if (!alive()) return;
        for (const p of r.order) {
          if (!r.last[p]?.healed) continue;
          const b = rel(cards.current.get(p));
          if (b) floatText(fx, b.x, b.y - b.h * 0.6, "+1 ♥", "is-small is-good");
        }
        if (strikers.length === 0 && hitBack.length === 0) playSound("wrong");
        if (r.phase === "victory") {
          playSample("dragonHurt", "roar");
          window.setTimeout(() => playSound("fanfare"), 1500);
          banner(fx, kids ? "Дракоша сдаётся!" : "Дракон повержен!");
          fx.particles?.burst(120);
          setConfetti(key);
        }
        await wait(250);
        if (alive()) setShown(null);
      })();
      return;
    }

    if (r.phase === "defeat") {
      const all = r.order.filter((p) => !r.dead.includes(p));
      void attackTargets(all, (p) => {
        const el = cards.current.get(p);
        const b = rel(el);
        if (!b) return;
        restart(el ?? null, "is-hurt");
        const lost = r.deltas[p] ?? 0;
        if (lost < 0) floatText(fx, b.x, b.y - b.h * 0.6, `−${Math.abs(lost).toLocaleString("ru-RU")}`, "is-small is-bad");
      });
    }
  }, [key]);

  const hp = shown?.hp ?? r.hp;
  const max = battle?.hp ?? 1;
  const share = Math.max(0, Math.min(1, hp / Math.max(1, max)));
  const livesOf = (p: string) => shown?.lives[p] ?? r.lives[p] ?? 0;
  const isDead = (p: string) => (shown ? shown.dead.includes(p) : r.dead.includes(p));
  const down = r.phase === "victory" && shown === null;
  const rage = !kids && battle !== null && share < 0.5 && r.phase !== "heroes";
  const fighting = r.order.length > 0 && r.phase !== "heroes" && r.phase !== "over";
  const reveal = stage === "reveal" || r.phase === "reveal" || r.phase === "victory";
  const a = attackOf(r);

  const half = Math.ceil(r.order.length / 2);
  const columns = [r.order.slice(0, half), r.order.slice(half)];
  const rows = Math.max(1, half);
  const rowH = Math.min(9.6, (38 - 0.8 * (rows - 1)) / rows);
  // Полная карточка (имя, герой, жизни и урон крупным шрифтом) помещается от ~8.2 --u; ниже — без строки героя.
  const compact = rowH < 8.2;
  // 17–25 команд: карточка в одну строку — значок, имя, ♥ и урон; 13–16 — две строки плотнее.
  const tiny = rowH < 3.6;
  const cramped = !tiny && rowH < 4.8;
  const colStyle = { "--row": rowH } as CSSProperties;

  const intent = useMemo(() => {
    if (!fighting || r.phase === "victory" || r.phase === "defeat") return null;
    if (kids) return a === "beam" ? "Копит радугу — не справитесь, чихнёт!" : "Прячет бабочек — не справитесь, выпустит!";
    return a === "beam" ? "Открывает третий глаз — не справитесь, ударит лучом" : `Набирает пламя — не справитесь, ${BREATH_NAME[kind].toLocaleLowerCase("ru")}`;
  }, [fighting, r.phase, kids, a, kind]);

  return (
    <div className={`dg-stage dg-stage--${kids ? "kid" : "adult"} dg-kind--${kind}${rage ? " is-rage" : ""}${atk ? ` is-${atk}` : ""}${down ? " is-down" : ""}`}>
      <div className="dg-frame" ref={frameRef}>
        <canvas className="dg-fx" ref={backRef} aria-hidden="true" />
        {kids && (
          <>
            <div className="dg-sun" aria-hidden="true" />
            <div className="dg-cloud dg-cloud--1" aria-hidden="true" />
            <div className="dg-cloud dg-cloud--2" aria-hidden="true" />
            <div className="dg-hills" aria-hidden="true" />
          </>
        )}
        <div className="dg-tint" aria-hidden="true" />
        <div className="dg-dim" aria-hidden="true" />

        <div className="dg-boss">
          <div className="dg-boss__rank">{kids ? "Сказочный дракон" : battle ? `Бой ${r.battle + 1} из ${content.battles.length}` : "Бой с драконом"}</div>
          <div className="dg-boss__name">{battle?.name ?? first?.name ?? "Дракон"}</div>
        </div>
        {battle && fighting && (
          <>
            <div className="dg-round">
              {kids ? `Бой ${r.battle + 1} из ${content.battles.length}` : "Задание"}
              <b>
                {r.task + 1} / {battle.tasks.length}
              </b>
            </div>
            <div className="dg-hp" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp} aria-label={`${battle.name}: здоровье ${hp} из ${max}`}>
              <div className="dg-hp__ghost" style={{ width: `${share * 100}%` }} />
              <div className="dg-hp__fill" style={{ width: `${share * 100}%` }} />
              <i className="dg-hp__mark" style={{ left: "50%" }} />
              <i className="dg-hp__mark" style={{ left: "25%" }} />
              <div className="dg-hp__num">{kids ? `Сила дракона ${hp.toLocaleString("ru-RU")} из ${max.toLocaleString("ru-RU")}` : `${hp.toLocaleString("ru-RU")} / ${max.toLocaleString("ru-RU")}`}</div>
            </div>
            {intent && <div className="dg-intent">{atk === "charge" ? (kids ? "Сейчас что-то будет!" : "Сейчас ударит!") : intent}</div>}
          </>
        )}

        <div className="dg-dragon" ref={dragonRef}>
          {kids ? <KidDragon /> : <AdultDragon />}
        </div>

        {columns.map((col, ci) => (
          <ul key={ci} className={`dg-teams dg-teams--${ci === 0 ? "l" : "r"}${compact ? " is-compact" : ""}${tiny ? " is-tiny" : ""}${cramped ? " is-cramped" : ""}`} style={colStyle} aria-label={ci === 0 ? "Команды слева" : "Команды справа"}>
            {col.map((p) => {
              const h = r.heroes[p];
              const hero = heroOf(h?.hero);
              const dead = isDead(p);
              const color = (kids ? KID_COLORS : ADULT_COLORS)[r.order.indexOf(p) % 10] ?? "#ff8a2b";
              const roll = reveal ? r.last[p]?.roll : null;
              return (
                <li
                  key={p}
                  ref={(el) => {
                    if (el) cards.current.set(p, el);
                    else cards.current.delete(p);
                  }}
                  className={`dg-team${dead ? " is-dead" : ""}${r.killer === p && r.phase === "victory" ? " is-killer" : ""}`}
                  style={{ "--c": color } as CSSProperties}
                >
                  <span className="dg-team__em" aria-hidden="true">
                    {dead ? "💀" : (hero?.icon ?? "❔")}
                  </span>
                  <span className="dg-team__nm">
                    <NameText name={nameOf(session, p)} />
                  </span>
                  {!compact && <span className="dg-team__hero">{hero ? `${hero.name} · ${hero.ability}` : "Герой выбирается"}</span>}
                  <span className="dg-team__row">
                    {fighting ? <Hearts lives={livesOf(p)} max={maxLives(content, h)} compact={compact} /> : <span />}
                    <span className="dg-team__dm">
                      {roll ? <span className="dg-team__roll">🎲 {roll}</span> : null}
                      {fighting ? (
                        <>
                          {compact ? "" : kids ? "помогли " : "урон "}
                          {compact && <span aria-hidden="true">{kids ? "✨ " : "⚔ "}</span>}
                          <b>{(r.dmg[p] ?? 0).toLocaleString("ru-RU")}</b>
                        </>
                      ) : null}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ))}

        <TaskBox task={task} r={r} reveal={reveal} left={left} kids={kids} session={session} content={content} />

        <svg className="dg-ov" ref={svgRef} aria-hidden="true">
          <defs>
            <linearGradient id="dgTrail" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--dg-hot)" stopOpacity="0" />
              <stop offset=".5" stopColor="var(--dg-core)" />
              <stop offset="1" stopColor="#ffffff" />
            </linearGradient>
          </defs>
        </svg>
        <div className="dg-layer" ref={layerRef} aria-hidden="true" />
        <canvas className="dg-fx dg-fx--top" ref={topRef} aria-hidden="true" />
        {confetti && <Confetti burst={`dg:${confetti}`} />}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
