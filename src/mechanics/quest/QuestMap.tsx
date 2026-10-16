// «Активная настолка»: поле — тропинка из клеток змейкой, флаг старта и финиш. Вид — по стилю поля
// (`content.style`): «Классика» — лес, озеро и замок; «Вечеринка» — ночной танцпол, прожекторы, неон и
// диско-шар; «Детская» — небо, сладкие холмы, леденцы и торт; «18+» — ночной город, золото и бокалы. Фишки команд шагают по клеткам после броска (со стуком), бонус
// подбрасывает вперёд с искрами, ловушка утаскивает назад. Всё — SVG и CSS transform/opacity; при
// «уменьшить движение» фишка сразу встаёт на место.
import { useEffect, useMemo, useRef, useState } from "react";
import { playSound } from "../../components/live/sound";
import type { Session } from "../../data/types";
import { QUEST_EMOJI, type QuestContent, type QuestStyle } from "./content";
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

type Decoration = { v: number; x: number; y: number; s: number };

/** Украшения между рядами — на одном и том же месте при каждом показе; что именно рисовать, решает стиль поля. */
function decorations(l: Layout): Decoration[] {
  const out: Decoration[] = [];
  for (let row = 0; row < l.rows - 1; row++) {
    for (let col = 1; col < l.cols - 1; col++) {
      const seed = (row * 31 + col * 17) % 13;
      if (seed > 5) continue;
      out.push({ v: (row * 3 + col) % 7, x: PAD_X + col * STEP_X - STEP_X / 2 + ((seed * 7) % 30) - 15, y: l.height - PAD_Y - row * STEP_Y - STEP_Y / 2 + ((seed * 5) % 16) - 8, s: 0.8 + (seed % 3) * 0.15 });
    }
  }
  return out;
}

const CLASSIC_KINDS = ["pine", "tree", "bush", "rock", "flowers", "pine", "bush"] as const;

/** Классика: лес — ёлки, деревья, кусты, камни, цветы. */
function ForestDecor({ v }: { v: number }) {
  const kind = CLASSIC_KINDS[v % CLASSIC_KINDS.length] ?? "bush";
  if (kind === "pine")
    return (
      <>
        <rect x="-2.5" y="6" width="5" height="9" fill="var(--qm-trunk)" />
        <path d="M0 -22 L13 -2 L6 -2 L15 9 L-15 9 L-6 -2 L-13 -2 Z" fill="var(--qm-pine)" />
      </>
    );
  if (kind === "tree")
    return (
      <>
        <rect x="-2.5" y="2" width="5" height="12" fill="var(--qm-trunk)" />
        <circle cx="0" cy="-6" r="12" fill="var(--qm-leaf)" />
        <circle cx="-8" cy="0" r="8" fill="var(--qm-leaf)" />
        <circle cx="8" cy="0" r="8" fill="var(--qm-leaf)" />
      </>
    );
  if (kind === "bush")
    return (
      <>
        <circle cx="-7" cy="4" r="7" fill="var(--qm-bush)" />
        <circle cx="5" cy="3" r="8" fill="var(--qm-bush)" />
        <circle cx="-1" cy="-3" r="7" fill="var(--qm-bush)" />
      </>
    );
  if (kind === "rock")
    return (
      <>
        <path d="M-14 8 L-9 -4 L1 -9 L11 -3 L14 8 Z" fill="var(--qm-rock)" />
        <path d="M-9 -4 L1 -9 L0 2 Z" fill="var(--qm-rock-light)" />
      </>
    );
  return (
    <>
      <circle cx="-6" cy="2" r="3" fill="var(--qm-flower-a)" />
      <circle cx="3" cy="-2" r="3" fill="var(--qm-flower-b)" />
      <circle cx="8" cy="5" r="2.5" fill="var(--qm-flower-a)" />
    </>
  );
}

/** Звёздочка-блик (4 луча). */
function Sparkle({ r, fill }: { r: number; fill: string }) {
  const k = r * 0.28;
  return <path d={`M0 ${-r} L${k} ${-k} L${r} 0 L${k} ${k} L0 ${r} L${-k} ${k} L${-r} 0 L${-k} ${-k} Z`} fill={fill} className="qm-twinkle" />;
}

/** Зеркальный шар диско. */
function MirrorBall({ r }: { r: number }) {
  return (
    <>
      <circle r={r} fill="var(--qm-ball)" />
      {[-0.55, 0, 0.55].map((k) => (
        <ellipse key={`h${k}`} cy={k * r} rx={r * Math.sqrt(1 - k * k)} ry={r * 0.12} fill="none" stroke="var(--qm-ball-line)" strokeWidth="1.4" />
      ))}
      {[-0.5, 0.5].map((k) => (
        <ellipse key={`v${k}`} rx={r * 0.5} ry={r} fill="none" stroke="var(--qm-ball-line)" strokeWidth="1.4" transform={`translate(${k * r * 0.4} 0)`} />
      ))}
      <line x1="0" y1={-r} x2="0" y2={r} stroke="var(--qm-ball-line)" strokeWidth="1.4" />
      <circle cx={-r * 0.35} cy={-r * 0.4} r={r * 0.22} fill="#fff" opacity="0.75" />
    </>
  );
}

/** Вечеринка: диско-шары, ноты, неоновые блики, конфетти. */
function PartyDecor({ v }: { v: number }) {
  const k = v % 4;
  if (k === 0)
    return (
      <>
        <line x1="0" y1="-30" x2="0" y2="-12" stroke="var(--qm-ball-line)" strokeWidth="1.5" />
        <MirrorBall r={12} />
      </>
    );
  if (k === 1)
    return <path d="M-6 10 a6 5 0 1 1 0.1 0 Z M0 10 L0 -16 L12 -12 L12 -6 L2 -9 L2 10 Z" fill="var(--qm-neon-b)" className="qm-twinkle" />;
  if (k === 2) return <Sparkle r={13} fill="var(--qm-neon-a)" />;
  return (
    <>
      <rect x="-12" y="-6" width="6" height="3" rx="1" fill="var(--qm-neon-a)" transform="rotate(25)" />
      <rect x="2" y="-10" width="6" height="3" rx="1" fill="var(--qm-neon-b)" transform="rotate(-30)" />
      <circle cx="-2" cy="8" r="3" fill="var(--qm-neon-c)" />
      <circle cx="10" cy="6" r="2.5" fill="var(--qm-neon-a)" />
    </>
  );
}

/** Детская: леденцы, конфеты, облака, капкейки. */
function SweetDecor({ v }: { v: number }) {
  const k = v % 4;
  if (k === 0)
    return (
      <>
        <rect x="-1.5" y="2" width="3" height="16" rx="1.5" fill="#fffaf3" stroke="#d9a0b0" strokeWidth="1" />
        <circle cy="-6" r="11" fill="var(--qm-candy-a)" />
        <path d="M0 -6 m-7 0 a7 7 0 1 1 7 7 a4.5 4.5 0 1 1 -4.5 -4.5" fill="none" stroke="#fffaf3" strokeWidth="2.5" strokeLinecap="round" />
      </>
    );
  if (k === 1)
    return (
      <>
        <path d="M-17 -6 L-9 0 L-17 6 Z M17 -6 L9 0 L17 6 Z" fill="var(--qm-candy-b)" />
        <ellipse rx="10" ry="7" fill="var(--qm-candy-b)" />
        <path d="M-4 -6 L-4 6 M2 -7 L2 7" stroke="#fffaf3" strokeWidth="2" opacity="0.8" />
      </>
    );
  if (k === 2)
    return (
      <g opacity="0.95">
        <circle cx="-9" cy="3" r="8" fill="#ffffff" />
        <circle cx="2" cy="-2" r="10" fill="#ffffff" />
        <circle cx="12" cy="4" r="7" fill="#ffffff" />
        <rect x="-9" y="3" width="21" height="8" fill="#ffffff" />
      </g>
    );
  return (
    <>
      <path d="M-11 0 L11 0 L8 14 L-8 14 Z" fill="var(--qm-candy-c)" />
      <path d="M-7 0 L-5 14 M0 0 L0 14 M7 0 L5 14" stroke="#ffffff" strokeWidth="1.2" opacity="0.7" />
      <path d="M-13 1 Q-13 -9 -4 -10 Q0 -17 5 -10 Q13 -9 13 1 Z" fill="var(--qm-candy-a)" />
      <circle cy="-15" r="3" fill="#d94a5f" />
    </>
  );
}

/** Бокал шампанского. */
function Flute({ fill }: { fill: string }) {
  return (
    <>
      <path d="M-5 -16 L5 -16 L4 -2 Q0 3 -4 -2 Z" fill={fill} opacity="0.9" />
      <rect x="-0.8" y="1" width="1.6" height="11" fill={fill} />
      <rect x="-5" y="12" width="10" height="2" rx="1" fill={fill} />
      <circle cx="-1" cy="-10" r="1" fill="#fff8e6" />
      <circle cx="1.5" cy="-6" r="0.8" fill="#fff8e6" />
    </>
  );
}

/** 18+: бокалы, бутылки, мартини, золотые блики. */
function NightDecor({ v }: { v: number }) {
  const k = v % 4;
  if (k === 0) return <Flute fill="var(--qm-gold)" />;
  if (k === 1) return <Sparkle r={11} fill="var(--qm-gold-light)" />;
  if (k === 2)
    return (
      <>
        <path d="M-5 -6 Q-5 -10 -2 -12 L-2 -20 L2 -20 L2 -12 Q5 -10 5 -6 L5 14 L-5 14 Z" fill="var(--qm-bottle)" />
        <rect x="-5" y="-2" width="10" height="7" fill="var(--qm-gold)" />
        <rect x="-2.5" y="-23" width="5" height="4" fill="var(--qm-gold)" />
      </>
    );
  return (
    <>
      <path d="M-12 -12 L12 -12 L0 2 Z" fill="var(--qm-wine)" opacity="0.9" />
      <path d="M-12 -12 L12 -12" stroke="var(--qm-gold)" strokeWidth="1.5" />
      <rect x="-0.8" y="1" width="1.6" height="11" fill="var(--qm-gold)" />
      <rect x="-6" y="12" width="12" height="2" rx="1" fill="var(--qm-gold)" />
      <circle cx="5" cy="-14" r="3" fill="#a3c2aa" />
    </>
  );
}

function Decor({ style, v, x, y, s }: Decoration & { style: QuestStyle }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${style === "classic" ? s : s * 1.35})`} className="qm-decor">
      {style === "party" ? <PartyDecor v={v} /> : style === "kids" ? <SweetDecor v={v} /> : style === "adult" ? <NightDecor v={v} /> : <ForestDecor v={v} />}
    </g>
  );
}

/** Фон под тропинкой: у каждого стиля свой. Солнце и луна — в верхнем углу, где нет финиша. */
function Backdrop({ style, l }: { style: QuestStyle; l: Layout }) {
  const { width: w, height: h } = l;
  const finishRight = (l.points.at(-1)?.x ?? 0) > w / 2;
  const skyX = finishRight ? 0.1 : 0.9;
  if (style === "party")
    return (
      <>
        <polygon points={`${w * 0.08},0 ${w * 0.16},0 ${w * 0.42},${h} ${w * 0.18},${h}`} className="qm-beam qm-beam--a" />
        <polygon points={`${w * 0.84},0 ${w * 0.92},0 ${w * 0.82},${h} ${w * 0.58},${h}`} className="qm-beam qm-beam--b" />
        {Array.from({ length: Math.ceil(w / 60) }, (_, i) => i).flatMap((i) =>
          [0, 1].map((r) => <rect key={`${i}-${r}`} x={i * 60} y={h - 60 + r * 30} width="58" height="28" className={(i + r) % 2 ? "qm-floor qm-floor--b" : "qm-floor"} />),
        )}
      </>
    );
  if (style === "kids")
    return (
      <>
        <circle cx={w * skyX} cy={h * 0.1} r={Math.min(w, h) * 0.07} className="qm-sun" />
        <path d={`M0 ${h} L0 ${h * 0.88} Q${w * 0.15} ${h * 0.8} ${w * 0.3} ${h * 0.88} T${w * 0.6} ${h * 0.87} T${w} ${h * 0.86} L${w} ${h} Z`} className="qm-hill" />
        <path d={`M0 ${h} L0 ${h * 0.94} Q${w * 0.25} ${h * 0.9} ${w * 0.5} ${h * 0.95} T${w} ${h * 0.93} L${w} ${h} Z`} className="qm-hill qm-hill--front" />
      </>
    );
  if (style === "adult") {
    const blocks = Math.ceil(w / 46);
    return (
      <>
        <path d={`M${w * skyX} ${h * 0.06} a${h * 0.05} ${h * 0.05} 0 1 0 ${h * 0.03} ${h * 0.09} a${h * 0.04} ${h * 0.04} 0 1 1 ${-h * 0.03} ${-h * 0.09} Z`} className="qm-moon" />
        {Array.from({ length: blocks }, (_, i) => {
          const bh = 40 + ((i * 37) % 7) * 14;
          return (
            <g key={i}>
              <rect x={i * 46} y={h - bh} width="44" height={bh} className="qm-city" />
              {Array.from({ length: Math.floor(bh / 18) }, (_, j) =>
                (i + j) % 3 !== 0 ? <rect key={j} x={i * 46 + 8 + ((i + j) % 2) * 16} y={h - bh + 8 + j * 18} width="6" height="6" className="qm-window" /> : null,
              )}
            </g>
          );
        })}
      </>
    );
  }
  return (
    <>
      <ellipse cx={w * 0.82} cy={h * 0.18} rx={w * 0.12} ry={h * 0.07} className="qm-lake" />
      <path d={`M0 ${h} L0 ${h * 0.86} Q${w * 0.2} ${h * 0.78} ${w * 0.42} ${h * 0.9} T${w} ${h * 0.84} L${w} ${h} Z`} className="qm-hill" />
    </>
  );
}

/** Финиш: замок, диско-шар над сценой, торт или большой бокал. */
function FinishMark({ style }: { style: QuestStyle }) {
  if (style === "party")
    return (
      <>
        <rect x="-34" y="8" width="68" height="12" rx="3" className="qm-stage" />
        <line x1="0" y1="-52" x2="0" y2="-34" stroke="var(--qm-ball-line)" strokeWidth="2" />
        <g transform="translate(0 -14)" className="qm-ball-spin">
          <MirrorBall r={20} />
        </g>
      </>
    );
  if (style === "kids")
    return (
      <>
        <rect x="-30" y="0" width="60" height="18" rx="4" fill="var(--qm-candy-a)" stroke="#b9677d" strokeWidth="2" />
        <rect x="-20" y="-16" width="40" height="17" rx="4" fill="#fffaf3" stroke="#b9677d" strokeWidth="2" />
        <path d="M-30 4 Q-22 10 -15 4 Q-7 10 0 4 Q7 10 15 4 Q22 10 30 4" fill="none" stroke="#fffaf3" strokeWidth="3" />
        <rect x="-2" y="-30" width="4" height="14" fill="var(--qm-candy-c)" />
        <path d="M0 -40 Q4 -34 0 -30 Q-4 -34 0 -40 Z" className="qm-flame" />
      </>
    );
  if (style === "adult")
    return (
      <g transform="scale(2.2) translate(0 -2)">
        <path d="M-12 -12 L12 -12 L0 2 Z" fill="var(--qm-wine)" />
        <path d="M-12 -12 L12 -12" stroke="var(--qm-gold-light)" strokeWidth="1.6" />
        <rect x="-0.9" y="1" width="1.8" height="10" fill="var(--qm-gold)" />
        <rect x="-6" y="11" width="12" height="2" rx="1" fill="var(--qm-gold)" />
        <circle cx="6" cy="-14" r="3" fill="#a3c2aa" />
      </g>
    );
  return (
    <>
      <path d="M-30 18 L-30 -18 L-22 -18 L-22 -10 L-14 -10 L-14 -18 L-6 -18 L-6 -26 L6 -26 L6 -18 L14 -18 L14 -10 L22 -10 L22 -18 L30 -18 L30 18 Z" className="qm-castle" />
      <path d="M-6 18 L-6 4 Q0 -4 6 4 L6 18 Z" className="qm-castle__door" />
      <rect x="-1.5" y="-46" width="3" height="20" className="qm-pole" />
      <path d="M1.5 -46 L22 -40 L1.5 -34 Z" className="qm-flag qm-flag--finish" />
    </>
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
  const style = content.style;

  return (
    <div className={`quest-map quest-map--${size} qm--${style}`}>
      <svg viewBox={`0 0 ${l.width} ${l.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Игровое поле">
        <defs>
          <radialGradient id="qm-glow">
            <stop offset="0%" stopColor="var(--qm-glow)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--qm-glow)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Фон стиля: озеро и холмы, танцпол и прожекторы, сладкие холмы, ночной город */}
        <Backdrop style={style} l={l} />
        {decor.map((d, i) => (
          <Decor key={i} style={style} {...d} />
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
        {/* Финиш: у каждого стиля свой, со свечением */}
        {finish && (
          <g transform={`translate(${finish.x} ${finish.y})`} className="qm-finish">
            <circle r="62" fill="url(#qm-glow)" className="qm-finish__glow" />
            <FinishMark style={style} />
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
