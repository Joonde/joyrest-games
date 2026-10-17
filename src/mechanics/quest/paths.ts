// «Активная настолка»: дорожки на нарисованных полях (Figma AI, `public/quest/art/`). Точки — центры камней и
// кругов на картинке 1536×864 по порядку от старта к финишу; `null` — разрыв (мост, поворот за декорацией):
// по нему клетки не ставятся. Клетки игры (40–100) раскладываются по дорожке равномерно — `placeCells`.
import type { QuestStyle } from "./content";

export type Pt = { x: number; y: number };

export const ART_W = 1536;
export const ART_H = 864;

const P = (...xy: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < xy.length; i += 2) out.push({ x: xy[i] ?? 0, y: xy[i + 1] ?? 0 });
  return out;
};

export interface FieldArt {
  /** Картинка поля (WebP 1920 и 1280 по ширине). */
  image: string;
  /** Дорожка: точки и разрывы. */
  path: Array<Pt | null>;
  /** Где подписи «Старт» и «Финиш» (центр плашки). */
  startLabel: Pt;
  finishLabel: Pt;
}

export const FIELDS: Record<QuestStyle, FieldArt> = {
  // Лес, водопад, озеро, деревянный мост, замок на скале.
  classic: {
    image: "classic",
    path: [
      ...P(230, 772, 305, 738, 352, 688, 402, 646, 472, 624, 548, 616, 624, 616, 700, 604, 760, 600, 820, 602, 888, 584, 894, 537, 848, 495, 806, 458),
      ...P(826, 415, 890, 404, 957, 406, 1024, 416, 1090, 423, 1156, 421, 1210, 398, 1214, 357, 1172, 326, 1118, 303, 1072, 276),
      ...P(1098, 238, 1160, 224, 1222, 221, 1286, 219, 1338, 203, 1348, 166),
    ],
    startLabel: { x: 150, y: 640 },
    finishLabel: { x: 1240, y: 128 },
  },
  // Ночная крыша: неоновая дорожка от арки до диско-шара.
  party: {
    image: "party",
    path: [
      ...P(290, 708, 365, 708, 445, 730, 530, 730, 605, 692, 645, 632, 645, 573, 615, 518, 590, 465, 585, 412, 575, 360, 548, 315, 510, 278),
      ...P(478, 242, 478, 206, 505, 178, 560, 172, 612, 180, 650, 208, 662, 246, 682, 286, 738, 306, 805, 312, 872, 320, 933, 341, 988, 372),
      ...P(1035, 410, 1093, 450, 1168, 460, 1235, 438, 1252, 390, 1225, 346, 1202, 303, 1212, 270, 1255, 248, 1315, 227),
    ],
    startLabel: { x: 215, y: 640 },
    finishLabel: { x: 1170, y: 192 },
  },
  // Сладкая страна: от радуги по нижней дорожке, через вафельный мост, к замку.
  kids: {
    image: "kids",
    path: [
      ...P(258, 740, 355, 752, 468, 756, 565, 746, 634, 712, 640, 660),
      null,
      ...P(780, 568, 845, 590, 920, 598, 1003, 598, 1085, 590, 1168, 580, 1245, 565, 1318, 542, 1378, 510, 1415, 470, 1405, 420),
      ...P(1365, 382, 1310, 355, 1250, 335, 1212, 302, 1212, 265, 1250, 240, 1295, 228),
    ],
    startLabel: { x: 120, y: 620 },
    finishLabel: { x: 1180, y: 200 },
  },
  // Красный бархат: от занавеса по нижнему ряду и вверх к бокалу с короной.
  adult: {
    image: "adult",
    path: [
      ...P(230, 733, 300, 752, 375, 765, 452, 770, 530, 770, 605, 757, 668, 733),
      null,
      ...P(793, 790, 845, 750, 915, 715, 948, 684, 1005, 656, 1054, 620, 1095, 582, 1103, 535, 1077, 492, 1032, 462, 980, 436, 928, 412, 887, 378),
      ...P(893, 331, 938, 300, 993, 280, 1052, 267, 1113, 262, 1172, 268, 1227, 270, 1285, 268, 1337, 244, 1344, 203),
    ],
    startLabel: { x: 130, y: 610 },
    finishLabel: { x: 1210, y: 175 },
  },
};

/** Клетки 0…n−1 равномерно по длине дорожки; разрывы длины не имеют. Первая — начало, последняя — конец. */
export function placeCells(path: Array<Pt | null>, n: number): Pt[] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of path) {
    if (p === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) runs.push(cur);
  // Отрезки по порядку: внутри серии — длина, между сериями — прыжок без длины.
  const segs: Array<{ a: Pt; b: Pt; len: number }> = [];
  for (const run of runs) {
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i] as Pt;
      const b = run[i + 1] as Pt;
      segs.push({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y) });
    }
  }
  const total = segs.reduce((s, g) => s + g.len, 0);
  const first = runs[0]?.[0] ?? { x: 0, y: 0 };
  if (n <= 1 || total <= 0) return Array.from({ length: Math.max(0, n) }, () => ({ ...first }));
  const out: Pt[] = [];
  let si = 0;
  let before = 0;
  for (let i = 0; i < n; i++) {
    const d = (total * i) / (n - 1);
    while (si < segs.length - 1 && before + (segs[si]?.len ?? 0) < d) {
      before += segs[si]?.len ?? 0;
      si += 1;
    }
    const g = segs[si];
    if (!g) {
      out.push({ ...first });
      continue;
    }
    const t = g.len > 0 ? Math.min(1, Math.max(0, (d - before) / g.len)) : 0;
    out.push({ x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t });
  }
  return out;
}

/** Шаг между клетками (по дорожке) — от него размер клеток и фишек. */
export function pathLength(path: Array<Pt | null>): number {
  let len = 0;
  let prev: Pt | null = null;
  for (const p of path) {
    if (p && prev) len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}
