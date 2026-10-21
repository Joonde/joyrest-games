// «Активная настолка»: поле — нарисованная картина Figma AI на весь экран (стиль поля: Классика, Вечеринка,
// Детская, 18+ — `paths.ts`), клетки игры стоят на нарисованной дорожке. Фишки команд шагают по клеткам после броска
// (стук, клетка под фишкой вспыхивает), клетка, куда встала фишка, светится и мигает, от неё расходятся круги и искры;
// бонус подбрасывает вперёд, ловушка утаскивает назад. Всё — SVG и CSS transform/opacity; при «уменьшить движение»
// фишка сразу встаёт на место, без мигания.
import { useEffect, useMemo, useRef, useState } from "react";
import { playSound } from "../../components/live/sound";
import type { Session } from "../../data/types";
import type { QuestContent, QuestKind } from "./content";
import { cellAt, finishOf, type QuestResult } from "./logic";
import { ART_H, ART_W, FIELDS, pathLength, pathRuns, placeCells } from "./paths";

const TEAM_COLORS = ["#E3AA9C", "#E3C68C", "#A3C2AA", "#D2A0AC", "#B3AADD", "#9FC3D6", "#E0B3A0", "#C9C08F"];
const STEP_MS = 320;

/** Цвет и значок клетки — как на макете Figma. */
const KIND_LOOK: Record<QuestKind, { color: string; icon: string }> = {
  task: { color: "#e8b64c", icon: "★" },
  question: { color: "#3fb6b0", icon: "?" },
  dance: { color: "#e46fa5", icon: "♪" },
  karaoke: { color: "#9b6fe0", icon: "🎤" },
  bonus: { color: "#4cb86a", icon: "" },
  trap: { color: "#d9534f", icon: "" },
  skip: { color: "#8a8f98", icon: "II" },
  empty: { color: "#2a2333", icon: "" },
};

function tokenOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? "?";
  return /\p{Extended_Pictographic}/u.test(first) ? first : first.toUpperCase();
}

export function teamColor(session: Session, r: QuestResult, pid: string): string {
  const entry = session.leaderboard[pid];
  const index = entry?.colorIndex ?? Math.max(0, r.order.indexOf(pid));
  return TEAM_COLORS[index % TEAM_COLORS.length] ?? "#E3C68C";
}

/** Плашка «СТАРТ» / «ФИНИШ · 200 очков» (как на макете). */
function Label({ x, y, text }: { x: number; y: number; text: string }) {
  const w = Math.round(text.length * 15 + 36);
  return (
    <g transform={`translate(${x} ${y})`} className="qm-label">
      <rect x={-w / 2} y={-22} width={w} height={44} rx={22} />
      <text y={9} textAnchor="middle">
        {text}
      </text>
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
  const field = FIELDS[content.style] ?? FIELDS.classic;
  const total = finishOf(content) + 1;
  const points = useMemo(() => placeCells(field.path, total), [field, total]);
  const runs = useMemo(() => pathRuns(field.path).map((run) => run.map((p) => `${p.x},${p.y}`).join(" ")), [field]);
  const spacing = useMemo(() => pathLength(field.path) / Math.max(1, total - 1), [field, total]);
  // Клетка — круг чуть меньше шага по дорожке (40 клеток — крупные со значками, 100 — мелкие, только цветом).
  const R = Math.max(10, Math.min(24, spacing * 0.46));
  const tokenScale = Math.max(0.62, Math.min(1.05, R / 22));
  // На экране зала шаги начинаются после того, как докрутится кубик.
  const { shown, burst } = useAnimatedPositions(r, size === "screen", size === "screen" ? 1100 : 300);
  const groups = new Map<number, string[]>();
  for (const p of r.order) {
    const at = Math.min(total - 1, shown[p] ?? 0);
    groups.set(at, [...(groups.get(at) ?? []), p]);
  }
  const moverAt = r.mover ? shown[r.mover] : undefined;
  // Фишка встала на клетку хода — клетка светится, мигает, расходятся круги.
  const landed = r.mode !== "roll" && r.mover && moverAt === r.at ? r.at : null;
  // Пока фишка шагает — вспышка под ней на каждой клетке.
  const walking = r.mover && moverAt !== undefined && moverAt !== r.at && r.mode !== "roll" ? moverAt : null;
  const start = points[0];
  const finish = points.at(-1);
  const src = `/quest/art/web/${field.image}${size === "phone" ? "-1280" : ""}.webp`;

  return (
    <div className={`quest-map quest-map--${size} qm--${content.style}`}>
      <svg viewBox={`0 0 ${ART_W} ${ART_H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Игровое поле">
        <defs>
          <radialGradient id="qm-glow">
            <stop offset="0%" stopColor="#fff3c4" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#ffd36a" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffd36a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <image href={src} x="0" y="0" width={ART_W} height={ART_H} preserveAspectRatio="xMidYMid slice" />
        {/* Полоса дорожки закрывает нарисованные камни: клеток игры больше или меньше камней — без неё клетки наезжают на камни. */}
        <g className="qm-lane" aria-hidden="true">
          {runs.map((pts, k) => (
            <polyline key={`e${k}`} points={pts} fill="none" stroke={field.lane.edge} strokeWidth={field.lane.width + 8} strokeLinecap="round" strokeLinejoin="round" opacity={0.94} />
          ))}
          {runs.map((pts, k) => (
            <polyline key={`f${k}`} points={pts} fill="none" stroke={field.lane.color} strokeWidth={field.lane.width} strokeLinecap="round" strokeLinejoin="round" opacity={0.96} />
          ))}
        </g>
        {/* Клетки на нарисованной дорожке */}
        {points.map((p, i) => {
          if (i === 0 || i === total - 1) return null;
          const cell = cellAt(content, i);
          const kind: QuestKind = cell?.kind ?? "empty";
          const look = KIND_LOOK[kind];
          const icon = kind === "bonus" || kind === "trap" ? (cell && cell.move > 0 ? `+${cell.move}` : `${cell?.move ?? ""}`.replace("-", "−")) : look.icon;
          const isLanded = landed === i;
          return (
            <g key={i} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} className={`qm-cell qm-cell--${kind}${isLanded ? " is-landed" : ""}`} style={{ ["--qm-c" as string]: look.color }}>
              {isLanded && (
                <g key={`land-${r.mover}-${r.at}`} className="qm-land">
                  <circle r={R * 3} fill="url(#qm-glow)" className="qm-land__glow" />
                  <circle r={R * 1.1} className="qm-land__ring" />
                  <circle r={R * 1.1} className="qm-land__ring qm-land__ring--2" />
                  <circle r={R * 1.1} className="qm-land__ring qm-land__ring--3" />
                  {Array.from({ length: 12 }, (_, k) => (
                    <circle key={k} r={Math.max(2.5, R * 0.16)} className="qm-land__spark" style={{ ["--a" as string]: `${k * 30}deg`, ["--d" as string]: `${R * 2.6}px` }} />
                  ))}
                </g>
              )}
              <circle r={R} className="qm-cell__disc" />
              {icon && R >= 13 && (
                <text y={R * 0.36} textAnchor="middle" className="qm-cell__icon" style={{ fontSize: `${Math.round(R * (icon.length > 1 ? 0.78 : 1.05))}px` }}>
                  {icon}
                </text>
              )}
              {isLanded && (
                <text y={-R - 8} textAnchor="middle" className="qm-cell__n">
                  {i}
                </text>
              )}
            </g>
          );
        })}
        {walking !== null && points[walking] && (
          <circle key={`touch-${walking}`} cx={points[walking]?.x} cy={points[walking]?.y} r={R * 1.25} className="qm-touch" />
        )}
        {/* Старт и финиш */}
        {start && (
          <g transform={`translate(${start.x} ${start.y})`} className="qm-end qm-end--start">
            <circle r={R * 1.2} />
            <text y={R * 0.4} textAnchor="middle" style={{ fontSize: `${Math.round(R * 1.1)}px` }}>
              ⚑
            </text>
          </g>
        )}
        {finish && (
          <g transform={`translate(${finish.x} ${finish.y})`} className="qm-end qm-end--finish">
            <circle r={R * 2.6} fill="url(#qm-glow)" className="qm-end__glow" />
            <circle r={R * 1.3} />
            <text y={R * 0.42} textAnchor="middle" style={{ fontSize: `${Math.round(R * 1.15)}px` }}>
              🏁
            </text>
          </g>
        )}
        <Label x={field.startLabel.x} y={field.startLabel.y} text="СТАРТ" />
        <Label x={field.finishLabel.x} y={field.finishLabel.y} text={content.finishPoints > 0 ? `ФИНИШ · ${content.finishPoints} очков` : "ФИНИШ"} />
        {/* Бонус — искры, ловушка — пыль */}
        {burst && points[burst.at] && (
          <g transform={`translate(${points[burst.at]?.x ?? 0} ${points[burst.at]?.y ?? 0})`} className={`qm-burst qm-burst--${burst.kind}`}>
            {Array.from({ length: 10 }, (_, k) => (
              <circle key={k} r={burst.kind === "bonus" ? 5 : 8} style={{ ["--a" as string]: `${k * 36}deg` }} />
            ))}
          </g>
        )}
        {/* Фишки */}
        {[...groups.entries()].flatMap(([at, pids]) =>
          pids.map((p, k) => {
            const pt = points[at] ?? { x: 0, y: 0 };
            const spread = pids.length > 1 ? R * 0.9 : 0;
            const angle = (k / pids.length) * Math.PI * 2 - Math.PI / 2;
            const x = pt.x + Math.cos(angle) * spread;
            const y = pt.y + Math.sin(angle) * spread - R * 0.9;
            const name = session.leaderboard[p]?.name ?? "?";
            const color = teamColor(session, r, p);
            return (
              <g key={p} className={`qm-token${p === r.mover ? " is-mover" : ""}`} style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${tokenScale})` }}>
                <g key={`${at}`} className="qm-token__hop">
                  {p === r.mover && <path d="M-12 -46 L12 -46 L0 -32 Z" className="qm-token__arrow" />}
                  <ellipse cy="27" rx="18" ry="5.5" className="qm-token__shadow" />
                  <circle r="24" style={{ fill: color }} className="qm-token__head" />
                  <ellipse cx="-7" cy="-11" rx="10" ry="5" className="qm-token__shine" />
                  <text y="8" textAnchor="middle" className="qm-token__emoji">
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
