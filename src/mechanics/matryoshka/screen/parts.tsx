/**
 * Общие части экрана зала «Игр Матрёшки»: плашки, шапка испытания, счётчики, таймер, фишки, нижняя полоса (вход, трибуна и
 * сугроб — одна полоса вдоль всей кромки, решение владельца 14 ноября 2026). Координаты — как в макетах (кадр 1920×1080):
 * `px(n)` = n/1920 ширины кадра 16:9 (`--px`), поэтому раскладка макета переносится числами.
 */
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { HallTimer } from "../../../components/live/HallTimer";
import { joinHint } from "../../../components/links";
import { formatSessionCode } from "../../../core/code";
import type { Style } from "../rules/types";
import { chipColor, markOf, numText, plainName, type ScreenModel } from "./model";

/** Длина в «пикселях макета» (кадр 1920×1080). */
export const px = (n: number): string => `calc(var(--px) * ${n})`;

/** Положение в кадре макета: x, y (от верха кадра 16:9), ширина и высота — тоже в пикселях макета. */
export function at(x: number, y: number, w?: number, h?: number): CSSProperties {
  const s: CSSProperties = { left: px(x), top: px(y) };
  if (w !== undefined) s.width = px(w);
  if (h !== undefined) s.height = px(h);
  return s;
}
/** Привязка к верху экрана (на 4:3 — к настоящему верху, не к кадру 16:9). */
export function atTop(x: number, y: number, w?: number): CSSProperties {
  const s: CSSProperties = { left: px(x), top: `calc(var(--px) * ${y} - var(--band))` };
  if (w !== undefined) s.width = px(w);
  return s;
}
/** Привязка к верху справа. */
export function atTopRight(r: number, y: number, w?: number): CSSProperties {
  const s: CSSProperties = { right: px(r), top: `calc(var(--px) * ${y} - var(--band))` };
  if (w !== undefined) s.width = px(w);
  return s;
}

export function Plate({ style, className, children }: { style?: CSSProperties; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `mts-plate ${className}` : "mts-plate"} style={style}>
      {children}
    </div>
  );
}

/** Шапка: «Испытание 2 из 5» и название. */
export function Head({ eyebrow, title, sub, style }: { eyebrow: string; title: string; sub?: string; style?: CSSProperties }) {
  return (
    <Plate className="mts-head" style={style ?? atTop(40, 36)}>
      <div className="mts-eyebrow">{eyebrow}</div>
      <div className="mts-title">{title}</div>
      {sub && <div className="mts-cap">{sub}</div>}
    </Plate>
  );
}

export interface Count {
  n: number | string;
  text: string;
  tone?: "bad" | "good" | "gold";
}

export function Counters({ items, style }: { items: Count[]; style?: CSSProperties }) {
  return (
    <Plate className="mts-counters" style={style ?? atTopRight(40, 36)}>
      {items.map((c) => (
        <div key={c.text} className={c.tone ? `mts-cnt is-${c.tone}` : "mts-cnt"}>
          <b className="mts-num">{c.n}</b>
          <span>{c.text}</span>
        </div>
      ))}
    </Plate>
  );
}

/** Таймер экрана зала платформы (вид — от темы), в правом верхнем углу. */
export function Timer({ left, total, style }: { left: number | null; total: number | null; style?: CSSProperties }) {
  return (
    <div className="mts-timer" style={style ?? atTopRight(40, 36)}>
      <HallTimer left={left} total={total} size={px(120)} look="ring" />
    </div>
  );
}

/** Фишка игрока: кружок со смайликом (решение владельца). */
export function Chip({ n, m, size, style, className }: { n: number; m: ScreenModel; size: number; style?: CSSProperties; className?: string }) {
  return (
    <span className={className ? `mts-chip ${className}` : "mts-chip"} style={{ width: px(size), height: px(size), fontSize: px(Math.round(size * 0.56)), "--chip": chipColor(n), ...style } as CSSProperties}>
      {markOf(n, m.marks)}
    </span>
  );
}

/** Мини-фишка в строке текста. */
export function Mini({ n, m, big }: { n: number; m: ScreenModel; big?: "big" | "huge" }) {
  return (
    <span className={big ? `mts-mini is-${big}` : "mts-mini"} style={{ "--chip": chipColor(n) } as CSSProperties} aria-hidden="true">
      {markOf(n, m.marks)}
    </span>
  );
}

/** «№ 004 Лёша» с жирным номером. */
export function Who({ n, m }: { n: number; m: ScreenModel }) {
  const name = m.view?.names[n];
  return (
    <span className="mts-who">
      <b>{numText(n)}</b>
      {name ? ` ${plainName(name)}` : ""}
    </span>
  );
}

/** Список «№ 001 Сева, № 031 Ксюша и ещё 4». */
export function WhoList({ nums, m, max = 3 }: { nums: readonly number[]; m: ScreenModel; max?: number }) {
  const shown = nums.slice(0, max);
  return (
    <>
      {shown.map((n, i) => (
        // Запятая с пробелом — вне имени: строка переносится между именами, само имя — одним куском (`.mts-who`).
        <Fragment key={n}>
          {i > 0 ? ", " : ""}
          <Who n={n} m={m} />
        </Fragment>
      ))}
      {nums.length > shown.length ? ` и ещё ${nums.length - shown.length}` : ""}
    </>
  );
}

/** Сугроб и трибуна: волна снега вдоль всей нижней кромки. */
function Bank({ style }: { style: Style }) {
  let top = "M0 124 V44";
  let back = "M0 124 V30";
  for (let x = 0; x < 1920; x += 160) {
    top += ` C${x + 40} ${22 + (x % 320 ? 6 : 0)} ${x + 120} ${22 + (x % 320 ? 0 : 8)} ${x + 160} 40`;
    back += ` C${x + 50} 10 ${x + 110} 14 ${x + 160} 26`;
  }
  return (
    <svg className="mts-strip__bank" viewBox="0 0 1920 124" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${back} V124Z`} fill="var(--g-snow-shade)" />
      <path d={`${top} V124Z`} fill="var(--g-snow)" />
      <path d={top.replace("M0 124 V44", "M0 44")} fill="none" stroke="var(--g-snow-rim)" strokeWidth={style === "night" ? 2.5 : 3} opacity={style === "night" ? 0.75 : 1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Нижняя полоса (124 px макета): «Вход: адрес · код», трибуна болельщиков, сугроб выбывших. `fans` — фишки на скамейке (последние
 * болельщики), `out` — только что в сугробе (номера), `star` — подсвеченный болельщик («Лучший болельщик»).
 */
export function Strip({ m, code, fans = true, out = true, star = null, peek = false, note }: { m: ScreenModel; code: string; fans?: boolean; out?: boolean; star?: number | null; peek?: boolean; note?: string }) {
  const v = m.view;
  if (!v) return null;
  const bench = m.outSeen.slice(-6).reverse();
  const fanTotal = v.fans;
  const drift = (v.justOut.length > 0 ? v.justOut : m.outSeen.slice(-10)).slice(0, 8);
  const outTotal = v.out;
  return (
    <div className="mts-strip">
      <Bank style={v.style} />
      <div className="mts-strip__row">
        <Foot code={code} />
        {fans && (
          <div className="mts-strip__sec">
            <span className="mts-strip__lbl">
              Трибуна · <b>{fanTotal}</b>
            </span>
            {bench.length > 0 && (
              <div className="mts-strip__bench">
                {bench.map((n, i) => (
                  <span key={n} className={star === n ? "mts-strip__fan is-star" : "mts-strip__fan"} style={{ "--chip": chipColor(n) } as CSSProperties}>
                    {markOf(n, m.marks)}
                    <i className="mts-pom" style={{ background: chipColor(n + i + 2) }} />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {out && (
          <div className="mts-strip__sec">
            <span className="mts-strip__lbl">
              В сугробе · <b>{outTotal > 0 ? outTotal : "пока никого"}</b>
              {note ? ` ${note}` : ""}
            </span>
            {outTotal > 0 && drift.length > 0 && (
              <div className="mts-strip__drift">
                {drift.map((n) => (
                  <span key={n} className={peek ? "mts-strip__out is-peek" : "mts-strip__out"} style={{ "--chip": chipColor(n) } as CSSProperties}>
                    {markOf(n, m.marks)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** «Вход: games.joy-rest.ru/j · код 482 915» с монограммой. */
export function Foot({ code }: { code: string }) {
  return (
    <div className="mts-foot">
      <span className="mts-mono" aria-hidden="true">
        J✦R
      </span>
      <span>
        Вход: <b>{joinHint()}</b> · код <b>{formatSessionCode(code)}</b>
      </span>
    </div>
  );
}

/** Подпись-бирка над фишкой. */
export function Tag({ children, style, tone }: { children: ReactNode; style?: CSSProperties; tone?: "lead" | "bad" }) {
  return (
    <span className={tone ? `mts-tag is-${tone}` : "mts-tag"} style={style}>
      {children}
    </span>
  );
}

/** Склонение: «1 игрок», «2 игрока», «5 игроков». */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
