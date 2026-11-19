/**
 * Матрёшка в React (Блок 3c; телефон 3b берёт отсюда же): роспись — `folk.ts` (перенос утверждённого листа персонажа один в один),
 * здесь — картинки. Каждый вид рисуется один раз в самостоятельный SVG (с определениями градиентов внутри) и показывается
 * `<img>` по адресу `blob:` — браузер растрирует его один раз и дальше только двигает слоем (поворот головы и раскрытие — только
 * transform и opacity, без перерисовки ~1000 мазков на кадр).
 */
import { forwardRef, type CSSProperties } from "react";
import { folkDefsInner, folkDollInner, folkOpenParts, NEST, OPEN_VIEWBOX, type DollOptions, type DollView, type EyeState, type Folk, type NestKind } from "./folk";

const DOLL_VIEWBOX = "-12 -12 424 624";
const cache = new Map<string, string>();
let defs: string | null = null;

function svgUrl(key: string, viewBox: string, body: () => string): string {
  const known = cache.get(key);
  if (known) return known;
  defs ??= folkDefsInner();
  const [, , w, h] = viewBox.split(" ").map(Number);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}"><defs>${defs}</defs>${body()}</svg>`;
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  } catch {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  cache.set(key, url);
  return url;
}

/** Адрес картинки матрёшки (кэш на страницу). */
export function dollUrl(o: DollOptions): string {
  const key = `d|${o.folk ?? "gzhel"}|${o.view ?? "face"}|${o.eyes ?? "open"}|${o.nest?.icon ?? ""}|${o.glow ? 1 : 0}|${o.door ? 1 : 0}|${o.motion ? 1 : 0}`;
  return svgUrl(key, DOLL_VIEWBOX, () => folkDollInner(o));
}

/** Адреса двух половинок раскрытой матрёшки: снятый верх и низ с вложенной. */
export function openUrls(folk: Folk, inner: NestKind, glow: boolean, sparks: boolean): { top: string; bottom: string } {
  const key = `o|${folk}|${inner}|${glow ? 1 : 0}|${sparks ? 1 : 0}`;
  let parts: ReturnType<typeof folkOpenParts> | null = null;
  const get = () => (parts ??= folkOpenParts({ folk, inner: NEST[folk][inner], glow, sparks }));
  return {
    top: svgUrl(`${key}|t`, OPEN_VIEWBOX, () => get().top),
    bottom: svgUrl(`${key}|b`, OPEN_VIEWBOX, () => get().sparks + get().bottom),
  };
}

export interface DollProps extends DollOptions {
  className?: string;
  style?: CSSProperties;
}

/** Матрёшка одним видом. Ширину задаёт CSS (высота — по пропорции 424 × 624). */
export function Doll({ className, style, ...o }: DollProps) {
  return <img className={className ? `mt-doll ${className}` : "mt-doll"} style={style} src={dollUrl(o)} alt="" aria-hidden="true" draggable={false} decoding="async" />;
}

export const TURN_VIEWS: readonly DollView[] = ["back", "profile", "tq", "face"];

export interface TurningProps {
  folk: Folk;
  glow?: boolean;
  /** Вложенная (её роспись) — у большой матрёшки null. */
  nest?: NestKind | null;
  className?: string;
  style?: CSSProperties;
  /** Начальный вид (дальше вид ставит экран атрибутами `data-pose`, `data-look`, `data-eyes` без перерисовки React). */
  pose?: DollView;
  look?: boolean;
  /** Глаза закрыты (пауза: «Матрёшка дремлет»). */
  eyes?: EyeState;
}

/**
 * Поворачивающаяся матрёшка: четыре вида одного рисунка (спина, профиль, три четверти, лицо) и лицо «смотрит» стопкой — видим
 * один (`data-pose`), глаза «смотрят» — `data-look="1"` (гжель — холодная синь, хохлома — тёплый янтарь). Экран меняет атрибуты
 * сам по своим часам (точно к T, без React).
 */
export const TurningDoll = forwardRef<HTMLDivElement, TurningProps>(function TurningDoll({ folk, glow = false, nest = null, className, style, pose = "face", look = false, eyes = "open" }, ref) {
  const n = nest ? NEST[folk][nest] : null;
  return (
    <div ref={ref} className={className ? `mt-turn ${className}` : "mt-turn"} style={style} data-pose={pose} data-look={look ? "1" : "0"} data-eyes={eyes} aria-hidden="true">
      {TURN_VIEWS.map((v) => (
        <img key={v} className={`mt-turn__v mt-turn__v--${v}`} src={dollUrl({ folk, view: v, glow, nest: n })} alt="" draggable={false} decoding="async" />
      ))}
      <img className="mt-turn__v mt-turn__v--look" src={dollUrl({ folk, view: "face", eyes: "look", glow, nest: n, motion: true })} alt="" draggable={false} decoding="async" />
      <img className="mt-turn__v mt-turn__v--closed" src={dollUrl({ folk, view: "face", eyes: "closed", glow, nest: n })} alt="" draggable={false} decoding="async" />
    </div>
  );
});

/** Раскрытая матрёшка: верх отлетает (CSS-анимация `is-opening`), внутри — вложенная матрёшка следующего испытания. */
export function OpenDoll({ folk, inner, glow = false, sparks = true, className, opening = false }: { folk: Folk; inner: NestKind; glow?: boolean; sparks?: boolean; className?: string; opening?: boolean }) {
  const u = openUrls(folk, inner, glow, sparks);
  return (
    <div className={`mt-open${opening ? " is-opening" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true">
      <img className="mt-open__bottom" src={u.bottom} alt="" draggable={false} decoding="async" />
      <img className="mt-open__top" src={u.top} alt="" draggable={false} decoding="async" />
    </div>
  );
}
