/**
 * Обводка «Пряника» на телефоне (docs/matryoshka.md, «Пряник»; L11): касания — по правилам `rules/shapes.ts` (те же 200
 * кусочков и трещина, что в тестах правил), обводка хранится в `sessionStorage` — перезагрузка страницы не теряет работу. Один
 * палец: обводит первый коснувшийся, остальные (ладонь) не в счёт.
 */
import { PIECES } from "../rules/constants";
import { newTrace, shapeOf, traceLift, traceTouch, type Point, type Trace } from "../rules/shapes";
import type { ShapeId } from "../rules/types";

export interface TraceSave {
  shape: ShapeId;
  trace: Trace;
}

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Ключ обводки: игра, испытание (номер в плане) и фигура. */
export function traceKey(base: string, trial: number, shape: ShapeId): string {
  return `${base}.trace.${trial}.${shape}`;
}

function isTrace(v: unknown): v is Trace {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return Array.isArray(t.covered) && t.covered.length === PIECES && typeof t.count === "number" && typeof t.cracked === "boolean";
}

/** Сохранённая обводка или новая. Палец после перезагрузки поднят. */
export function loadTrace(key: string): Trace {
  const s = store();
  try {
    const raw = s?.getItem(key);
    if (raw) {
      const v: unknown = JSON.parse(raw);
      if (isTrace(v)) {
        const count = v.covered.filter(Boolean).length;
        return traceLift({ ...v, count, outLog: [] });
      }
    }
  } catch {
    // Испорченная запись — с чистого листа.
  }
  return newTrace();
}

export function saveTrace(key: string, t: Trace): void {
  try {
    store()?.setItem(key, JSON.stringify({ ...t, outLog: [] }));
  } catch {
    // Нет места или приватный режим — обводка живёт в памяти.
  }
}

/** Касание в точке поля: доли ширины квадрата поля (полоса допуска — тоже в долях ширины). */
export function fieldPoint(rect: { left: number; top: number; width: number }, x: number, y: number): Point {
  const w = rect.width > 0 ? rect.width : 1;
  return [(x - rect.left) / w, (y - rect.top) / w];
}

/** Обводка одним касанием (копия: React видит новое значение). */
export function touch(shape: ShapeId, t: Trace, p: Point, at: number, band: number): Trace {
  const copy: Trace = { ...t, covered: [...t.covered], outLog: [...(t.outLog ?? [])] };
  return traceTouch(shapeOf(shape), copy, p, at, band);
}

export function lift(t: Trace): Trace {
  return traceLift({ ...t, covered: [...t.covered], outLog: [...(t.outLog ?? [])] });
}
