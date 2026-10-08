// «Активная настолка»: поле как карта приключений — тропинка из камней-клеток змейкой, деревья, скалы,
// озеро, флаг старта и замок финиша. Фишки команд шагают по клеткам после броска (со стуком), бонус
// подбрасывает вперёд с искрами, ловушка утаскивает назад. Всё — SVG и CSS transform/opacity; при
// «уменьшить движение» фишка сразу встаёт на место.
import { useEffect, useMemo, useRef, useState } from "react";
import { playSound } from "../../components/live/sound";
import type { Session } from "../../data/types";
import { QUEST_EMOJI, type QuestContent } from "./content";
import { cellAt, finishOf, type QuestResult } from "./logic";

const TEAM_COLORS = ["#E3AA9C", "#E3C68C", "#A3C2AA", "#D2A0AC", "#B3AADD", "#9FC3D6", "#E0B3A0", "#C9C08F"];
const STEP_MS = 320;
const STEP_X = 100;
const STEP_Y = 120;
const PAD_X = 70;
const PAD_Y = 80;

function tokenOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? "?";
  return /\p{Extended_Pictographic}/u.test(first) ? first : first.toUpperCase();
}

export function teamColor(session: Session, r: QuestResult, pid: string): string {
  const entry = session.leaderboard[pid];
  const index = entry?.colorIndex ?? Math.max(0, r.order.indexOf(pid));
  return TEAM_COLORS[index % TEAM_COLORS.length] ?? "#E3C68C";
}

interface Layout {
  cols: number;
  rows: number;
  width: number;
  height: number;
  points: Array<{ x: number; y: number }>;
}

/** Где стоит каждая клетка: змейка снизу вверх, камни чуть «гуляют», чтобы тропинка была живой. */
function layout(total: number): Layout {
  const cols = total > 72 ? 12 : total > 50 ? 10 : 8;
  const rows = Math.ceil(total / cols);
  const width = PAD_X * 2 + (cols - 1) * STEP_X;
  const height = PAD_Y * 2 + (rows - 1) * STEP_Y;
  const points = Array.from({ length: total }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = i % cols;
    const col = row % 2 === 0 ? inRow : cols - 1 - inRow;
    const wobbleX = (((i * 37) % 11) - 5) * 2.2;
    const wobbleY = (((i * 53) % 9) - 4) * 3;
    return { x: PAD_X + col * STEP_X + wobbleX, y: height - PAD_Y - row * STEP_Y + wobbleY };
  });
  return { cols, rows, width, height, points };
}

/** Плавная тропинка через центры клеток (сплайн Катмулла — Рома в кривые Безье). */
function roadPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  let d = `M${points[0]?.x ?? 0} ${points[0]?.y ?? 0}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points.at(Math.max(0, i - 1)) ?? { x: 0, y: 0 };
    const p1 = points.at(i) ?? p0;
    const p2 = points.at(i + 1) ?? p1;
    const p3 = points.at(Math.min(points.length - 1, i + 2)) ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Украшения между рядами: деревья, кусты, камни, цветы — на одном и том же месте при каждом показе. */
function decorations(l: Layout): Array<{ kind: "tree" | "pine" | "bush" | "rock" | "flowers"; x: number; y: number; s: number }> {
  const out: Array<{ kind: "tree" | "pine" | "bush" | "rock" | "flowers"; x: number; y: number; s: number }> = [];
  const kinds = ["pine", "tree", "bush", "rock", "flowers", "pine", "bush"] as const;
  for (let row = 0; row < l.rows - 1; row++) {
    for (let col = 1; col < l.cols - 1; col++) {
      const seed = (row * 31 + col * 17) % 13;
      if (seed > 5) continue;
      const kind = kinds[(row * 3 + col) % kinds.length] ?? "bush";
      out.push({ kind, x: PAD_X + col * STEP_X - STEP_X / 2 + ((seed * 7) % 30) - 15, y: l.height - PAD_Y - row * STEP_Y - STEP_Y / 2 + ((seed * 5) % 16) - 8, s: 0.8 + (seed % 3) * 0.15 });
    }
  }
  return out;
}

function Decor({ kind, x, y, s }: { kind: "tree" | "pine" | "bush" | "rock" | "flowers"; x: number; y: number; s: number }) {
  const t = `translate(${x} ${y}) scale(${s})`;
  if (kind === "pine")
    return (
      <g transform={t} className="qm-decor">
        <rect x="-2.5" y="6" width="5" height="9" fill="var(--qm-trunk)" />
        <path d="M0 -22 L13 -2 L6 -2 L15 9 L-15 9 L-6 -2 L-13 -2 Z" fill="var(--qm-pine)" />
      </g>
    );
  if (kind === "tree")
    return (
      <g transform={t} className="qm-decor">
        <rect x="-2.5" y="2" width="5" height="12" fill="var(--qm-trunk)" />
        <circle cx="0" cy="-6" r="12" fill="var(--qm-leaf)" />
        <circle cx="-8" cy="0" r="8" fill="var(--qm-leaf)" />
        <circle cx="8" cy="0" r="8" fill="var(--qm-leaf)" />
      </g>
    );
  if (kind === "bush")
    return (
      <g transform={t} className="qm-decor">
        <circle cx="-7" cy="4" r="7" fill="var(--qm-bush)" />
        <circle cx="5" cy="3" r="8" fill="var(--qm-bush)" />
        <circle cx="-1" cy="-3" r="7" fill="var(--qm-bush)" />
      </g>
    );
  if (kind === "rock")
    return (
      <g transform={t} className="qm-decor">
        <path d="M-14 8 L-9 -4 L1 -9 L11 -3 L14 8 Z" fill="var(--qm-rock)" />
        <path d="M-9 -4 L1 -9 L0 2 Z" fill="var(--qm-rock-light)" />
      </g>
    );
  return (
    <g transform={t} className="qm-decor">
      <circle cx="-6" cy="2" r="3" fill="var(--qm-flower-a)" />
      <circle cx="3" cy="-2" r="3" fill="var(--qm-flower-b)" />
      <circle cx="8" cy="5" r="2.5" fill="var(--qm-flower-a)" />
    </g>
  );
}

/**
 * Куда сейчас нарисовать фишки: после броска фишка ходящей команды идёт по клеткам от `from` до `hit`
 * (стук на каждом шаге), потом бонус или ловушка переносит её на `at`.
 */
function useAnimatedPositions(r: QuestResult, sounds: boolean, delay: number): { shown: Record<string, number>; burst: { at: number; kind: "bonus" | "trap" } | null } {
  const [shown, setShown] = useState<Record<string, number>>(r.pos);
  const [burst, setBurst] = useState<{ at: number; kind: "bonus" | "trap" } | null>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const key = JSON.stringify(r.pos);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const mover = r.mover;
    const was = mover ? shownRef.current[mover] : undefined;
    const target = mover ? r.pos[mover] : undefined;
    // Ходит фишка после броска: шагаем; иначе (Назад, начало игры) — сразу на места.
    if (reduce || !mover || was === undefined || target === undefined || r.mode === "roll" || was === target || r.from !== was) {
      setShown(r.pos);
      setBurst(null);
      return;
    }
    const timers: number[] = [];
    const path: number[] = [];
    for (let i = r.from + 1; i <= r.hit; i++) path.push(i);
    path.forEach((cell, i) => {
      timers.push(
        window.setTimeout(() => {
          setShown((s) => ({ ...s, [mover]: cell }));
          if (sounds) playSound("step");
        }, delay + i * STEP_MS),
      );
    });
    const after = delay + path.length * STEP_MS + 250;
    if (r.moved !== 0) {
      timers.push(
        window.setTimeout(() => {
          setBurst({ at: r.hit, kind: r.moved > 0 ? "bonus" : "trap" });
          if (sounds) playSound(r.moved > 0 ? "bonus" : "trap");
        }, after),
      );
      timers.push(window.setTimeout(() => setShown(r.pos), after + 450));
      timers.push(window.setTimeout(() => setBurst(null), after + 1600));
    } else {
      timers.push(window.setTimeout(() => setShown(r.pos), after));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новая позиция = новая анимация
  }, [key, r.mode]);
  return { shown, burst };
}

export function QuestMap({ session, content, result: r, size = "screen" }: { session: Session; content: QuestContent; result: QuestResult; size?: "screen" | "phone" }) {
  const total = finishOf(content) + 1;
  const l = useMemo(() => layout(total), [total]);
  const road = useMemo(() => roadPath(l.points), [l]);
  const decor = useMemo(() => decorations(l), [l]);
  // На экране зала шаги начинаются после того, как докрутится кубик.
  const { shown, burst } = useAnimatedPositions(r, size === "screen", size === "screen" ? 1100 : 300);
  const groups = new Map<number, string[]>();
  for (const p of r.order) {
    const at = Math.min(total - 1, shown[p] ?? 0);
    groups.set(at, [...(groups.get(at) ?? []), p]);
  }
  const current = r.mode !== "roll" && r.mover && shown[r.mover] === r.at ? r.at : null;
  const start = l.points[0];
  const finish = l.points.at(-1);

  return (
    <div className={`quest-map quest-map--${size}`}>
      <svg viewBox={`0 0 ${l.width} ${l.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Игровое поле">
        <defs>
          <radialGradient id="qm-glow">
            <stop offset="0%" stopColor="var(--qm-glow)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--qm-glow)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Озеро и холмы на фоне */}
        <ellipse cx={l.width * 0.82} cy={l.height * 0.18} rx={l.width * 0.12} ry={l.height * 0.07} className="qm-lake" />
        <path d={`M0 ${l.height} L0 ${l.height * 0.86} Q${l.width * 0.2} ${l.height * 0.78} ${l.width * 0.42} ${l.height * 0.9} T${l.width} ${l.height * 0.84} L${l.width} ${l.height} Z`} className="qm-hill" />
        {decor.map((d, i) => (
          <Decor key={i} {...d} />
        ))}
        {/* Тропинка */}
        <path d={road} className="qm-road" />
        <path d={road} className="qm-road-dash" />
        {/* Клетки-камни */}
        {l.points.map((p, i) => {
          if (i === 0 || i === total - 1) return null;
          const cell = cellAt(content, i);
          const kind = cell?.kind ?? "empty";
          return (
            <g key={i} transform={`translate(${p.x} ${p.y})`} className={`qm-cell qm-cell--${kind}${current === i ? " is-current" : ""}`}>
              {current === i && <circle r="46" className="qm-cell__ring" />}
              <circle r="34" className="qm-cell__stone" />
              <circle r="28" className="qm-cell__face" />
              {QUEST_EMOJI[kind] && (
                <text y="9" textAnchor="middle" className="qm-cell__emoji">
                  {QUEST_EMOJI[kind]}
                </text>
              )}
              {cell && (kind === "bonus" || kind === "trap") && (
                <text y="27" textAnchor="middle" className="qm-cell__move">
                  {cell.move > 0 ? `+${cell.move}` : cell.move}
                </text>
              )}
              <text x="-26" y="-22" className="qm-cell__n">
                {i}
              </text>
            </g>
          );
        })}
        {/* Старт: флаг */}
        {start && (
          <g transform={`translate(${start.x} ${start.y})`} className="qm-start">
            <circle r="40" className="qm-start__stone" />
            <rect x="-2" y="-46" width="4" height="40" className="qm-pole" />
            <path d="M2 -46 L30 -38 L2 -28 Z" className="qm-flag" />
            <text y="16" textAnchor="middle" className="qm-label">
              СТАРТ
            </text>
          </g>
        )}
        {/* Финиш: замок со свечением */}
        {finish && (
          <g transform={`translate(${finish.x} ${finish.y})`} className="qm-finish">
            <circle r="62" fill="url(#qm-glow)" className="qm-finish__glow" />
            <path d="M-30 18 L-30 -18 L-22 -18 L-22 -10 L-14 -10 L-14 -18 L-6 -18 L-6 -26 L6 -26 L6 -18 L14 -18 L14 -10 L22 -10 L22 -18 L30 -18 L30 18 Z" className="qm-castle" />
            <path d="M-6 18 L-6 4 Q0 -4 6 4 L6 18 Z" className="qm-castle__door" />
            <rect x="-1.5" y="-46" width="3" height="20" className="qm-pole" />
            <path d="M1.5 -46 L22 -40 L1.5 -34 Z" className="qm-flag qm-flag--finish" />
            <text y="40" textAnchor="middle" className="qm-label">
              ФИНИШ
            </text>
          </g>
        )}
        {/* Бонус — искры, ловушка — пыль */}
        {burst && l.points[burst.at] && (
          <g transform={`translate(${l.points[burst.at]?.x ?? 0} ${l.points[burst.at]?.y ?? 0})`} className={`qm-burst qm-burst--${burst.kind}`}>
            {Array.from({ length: 10 }, (_, k) => (
              <circle key={k} r={burst.kind === "bonus" ? 5 : 8} style={{ ["--a" as string]: `${k * 36}deg` }} />
            ))}
          </g>
        )}
        {/* Фишки */}
        {[...groups.entries()].flatMap(([at, pids]) =>
          pids.map((p, k) => {
            const pt = l.points[at] ?? { x: 0, y: 0 };
            const spread = pids.length > 1 ? 18 : 0;
            const angle = (k / pids.length) * Math.PI * 2 - Math.PI / 2;
            const x = pt.x + Math.cos(angle) * spread;
            const y = pt.y + Math.sin(angle) * spread - 18;
            const name = session.leaderboard[p]?.name ?? "?";
            return (
              <g key={p} className={`qm-token${p === r.mover ? " is-mover" : ""}`} style={{ transform: `translate(${x}px, ${y}px)` }}>
                <g key={`${at}`} className="qm-token__hop">
                  <ellipse cy="26" rx="16" ry="5" className="qm-token__shadow" />
                  <path d="M-15 22 Q-15 6 -8 0 L8 0 Q15 6 15 22 Z" style={{ fill: teamColor(session, r, p) }} className="qm-token__base" />
                  <circle r="17" style={{ fill: teamColor(session, r, p) }} className="qm-token__head" />
                  <text y="7" textAnchor="middle" className="qm-token__emoji">
                    {tokenOf(name)}
                  </text>
                </g>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

/** Кубик: при новом броске кувыркается ~0,9 с с перебором граней, потом встаёт на выпавшее число. */
export function QuestDie({ value, rolling, sounds }: { value: number | null; rolling: string; sounds: boolean }) {
  const [face, setFace] = useState<number | null>(value);
  const [spinning, setSpinning] = useState(false);
  const last = useRef(rolling);
  useEffect(() => {
    if (last.current === rolling) {
      setFace(value);
      return;
    }
    last.current = rolling;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!value || reduce) {
      setFace(value);
      return;
    }
    if (sounds) playSound("dice");
    setSpinning(true);
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      setFace(((n * 5 + value) % 6) + 1);
    }, 90);
    const stop = window.setTimeout(() => {
      window.clearInterval(timer);
      setFace(value);
      setSpinning(false);
    }, 900);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [rolling, value, sounds]);
  const dots: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return (
    <div className={spinning ? "quest-die is-rolling" : value ? "quest-die is-landed" : "quest-die"} aria-label={value ? `Выпало ${value}` : "Кубик"}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={face && dots[face]?.includes(i) ? "quest-die__dot is-on" : "quest-die__dot"} />
      ))}
    </div>
  );
}
