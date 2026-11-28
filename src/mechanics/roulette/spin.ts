// Случайность «Рулетки судьбы» — чистые функции (паспорт, Р-13…Р-18). Случайность считает пульт: из зерна генератор
// выдаёт последовательность чисел — тема, редкость, задание, угол, кривая замедления. Зерно вращения капитана —
// id ответа и время сервера, поэтому любой открытый пульт получит тот же результат; вращение ведущего — случайное зерно.
// Анимация колеса — функция только от (angle, durationMs, curve, время): экраны и перезагрузка показывают одно и то же.
import { availableTasks, RARITIES, themeById, type Rarity, type RouletteContent, type RouletteTask, type RouletteTheme } from "./content";

/** Причины отступления от обычного отбора — пишутся в журнал хода (Р-17). */
export type Fallback = "deckReset" | "extraSpinFallback" | "legendaryFallback" | "rarityFallback";

/** Пауза перед открытием задания после остановки колеса — входит в durationMs (Р-15). */
export const REVEAL_PAUSE_MS = 1000;

// ------------------------------------------------------------------ генератор

/** Четыре 32-битных числа из строки (cyrb128). */
function hash128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Генератор чисел 0..1 из зерна (sfc32): одно зерно — одна и та же последовательность на любом устройстве. */
export function seededRandom(seed: string): () => number {
  let [a, b, c, d] = hash128(seed);
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Первые числа sfc32 слабо перемешаны — пропускаем.
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** Зерно вращения по ответу капитана: id ответа (шаг + участник) и время, которое поставил сервер (Р-13). */
export function answerSeed(answer: { id: string; submittedAt: number | null }): string {
  return answer.id + ":" + (answer.submittedAt ?? 0);
}

/** Случайное зерно (вращение ведущего, замена задания). */
export function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function pickOne<T>(list: readonly T[], r: number): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))] as T;
}

// ------------------------------------------------------------------ отбор задания

/**
 * Редкость по весам среди редкостей, которые остались в пуле: веса пересчитываются. Сумма весов оставшихся 0 —
 * равновероятно (Р-17 п. 5). fallback — веса пришлось пересчитать (в пуле нет редкости с ненулевым весом,
 * кроме намеренно исключённых).
 */
export function pickRarity(weights: Record<Rarity, number>, present: readonly Rarity[], r: number, excluded: readonly Rarity[] = []): { rarity: Rarity; fallback: boolean } {
  const missing = RARITIES.some((x) => weights[x] > 0 && !present.includes(x) && !excluded.includes(x));
  const total = present.reduce((s, x) => s + Math.max(0, weights[x]), 0);
  if (total <= 0) return { rarity: pickOne(present, r), fallback: true };
  let left = r * total;
  for (const x of present) {
    const w = Math.max(0, weights[x]);
    if (w <= 0) continue;
    if (left < w) return { rarity: x, fallback: missing };
    left -= w;
  }
  // Защита от погрешности сложения: последняя редкость с весом.
  const last = [...present].reverse().find((x) => weights[x] > 0) ?? (present[0] as Rarity);
  return { rarity: last, fallback: missing };
}

export interface PickInput {
  /** Показанные в этой теме задания этой игры, по порядку. */
  played: readonly string[];
  /** Дополнительное вращение: без бонусов «Ещё вращение» (Р-17 п. 3). */
  extra: boolean;
  /** Редкость прошлого задания этой команды (Р-17 п. 4). */
  lastRarity: Rarity | null;
  /** Замена: та же редкость, если есть (Р-18). */
  sameRarity?: Rarity | null;
  /** Замена: заменяемое задание (уже в played). */
  current?: string | null;
}

export interface PickOutput {
  task: RouletteTask;
  rarity: Rarity;
  /** Новый список показанных в этой теме (после сброса колоды — с нуля). */
  played: string[];
  fallbacks: Fallback[];
}

const isExtraSpin = (t: RouletteTask) => t.kind === "bonus" && t.effect === "extraSpin";

/**
 * Отбор задания внутри темы — строго по порядку Р-17: доступные → ещё не показанные (иначе сброс колоды темы без только
 * что показанного) → на доп. вращении без «Ещё вращения» → без второго легендарного подряд → редкость по весам среди
 * оставшихся → задание равновероятно внутри редкости. Пустой пул после шагов 3–4 — шаг отменяется (fallback в журнал).
 * Из генератора берётся ровно два числа: редкость, задание.
 */
export function pickTask(content: RouletteContent, theme: RouletteTheme, input: PickInput, random: () => number): PickOutput | null {
  const all = availableTasks(content, theme);
  const rRarity = random();
  const rTask = random();
  if (all.length === 0) return null;
  const fallbacks: Fallback[] = [];
  const known = new Set(all.map((t) => t.id));
  let played = input.played.filter((id) => known.has(id));
  let pool = all.filter((t) => !played.includes(t.id));
  if (pool.length === 0) {
    // Колода темы кончилась: сброс только этой темы, но не сразу то же задание (и не заменяемое).
    const last = [...played].reverse()[0] ?? null;
    // Заменяемое задание остаётся показанным и в новой колоде (Р-18): иначе оно выпало бы снова сразу после сброса.
    played = input.current && known.has(input.current) ? [input.current] : [];
    fallbacks.push("deckReset");
    pool = all.filter((t) => t.id !== last && t.id !== input.current);
    if (pool.length === 0) pool = all.filter((t) => t.id !== input.current);
    if (pool.length === 0) pool = all;
  }
  if (input.extra && pool.some(isExtraSpin)) {
    const rest = pool.filter((t) => !isExtraSpin(t));
    if (rest.length > 0) pool = rest;
    else fallbacks.push("extraSpinFallback");
  }
  const excluded: Rarity[] = [];
  if (content.noTwoLegendary && input.lastRarity === "legendary" && pool.some((t) => t.rarity === "legendary")) {
    const rest = pool.filter((t) => t.rarity !== "legendary");
    if (rest.length > 0) {
      pool = rest;
      excluded.push("legendary");
    } else fallbacks.push("legendaryFallback");
  }
  const present = RARITIES.filter((x) => pool.some((t) => t.rarity === x));
  let rarity: Rarity;
  if (input.sameRarity && present.includes(input.sameRarity)) rarity = input.sameRarity;
  else {
    const picked = pickRarity(content.weights, present, rRarity, excluded);
    rarity = picked.rarity;
    if (picked.fallback) fallbacks.push("rarityFallback");
  }
  const task = pickOne(
    pool.filter((t) => t.rarity === rarity),
    rTask,
  );
  return { task, rarity, played: [...played, task.id], fallbacks };
}

// ------------------------------------------------------------------ колесо

/** Сколько полных оборотов делает колесо (без случайности). */
export function turnsFor(spinSeconds: number): number {
  return 3 + Math.round(spinSeconds);
}

/**
 * Итоговый поворот колеса по часовой стрелке, градусы: указатель сверху попадает в сектор index (отступ f доли сектора
 * от его начала, 0,15–0,85 — не на границу). Сектор i занимает [i·s, (i+1)·s) по часовой стрелке от верха.
 */
export function landingAngle(index: number, sectors: number, spinSeconds: number, f: number): number {
  const s = 360 / Math.max(1, sectors);
  const target = (((360 - (index + f) * s) % 360) + 360) % 360;
  return Math.round((turnsFor(spinSeconds) * 360 + target) * 100) / 100;
}

/** Какой сектор под указателем при повороте angle. */
export function sectorAt(angle: number, sectors: number): number {
  const n = Math.max(1, sectors);
  const theta = (((360 - (angle % 360)) % 360) + 360) % 360;
  return Math.min(n - 1, Math.floor(theta / (360 / n)));
}

/**
 * Поворот колеса через elapsedMs после начала вращения: быстрый старт и долгое неравномерное замедление по кривой curve
 * (степень «ease-out»), после остановки — пауза перед открытием (Р-14, Р-15). Без случайности. Тиканье и вид разгона
 * экрана — этап 2 (колесо).
 */
export function wheelRotation(spin: { angle: number; durationMs: number; curve: number }, elapsedMs: number): number {
  const moving = Math.max(1, spin.durationMs - REVEAL_PAUSE_MS);
  const u = Math.min(1, Math.max(0, elapsedMs / moving));
  const eased = 1 - Math.pow(1 - u, spin.curve);
  return Math.round(spin.angle * eased * 100) / 100;
}

export interface SpinInput {
  sectors: readonly string[];
  played: Readonly<Record<string, readonly string[]>>;
  extra: boolean;
  lastRarity: Rarity | null;
  /** Эффект «Выбор темы» (этап 7): колесо идёт к этой теме, дальше Р-17. */
  forcedTheme?: string | null;
}

export interface SpinOutcome {
  index: number;
  themeId: string;
  taskId: string;
  rarity: Rarity;
  /** Новые показанные этой темы. */
  played: string[];
  fallbacks: Fallback[];
  angle: number;
  durationMs: number;
  curve: number;
}

/**
 * Вращение целиком из зерна: тема (равновероятно среди секторов, Р-16), редкость, задание, угол, кривая — именно в
 * таком порядке чисел генератора. null — ни в одной теме колеса нечего выпасть (снимок игры испорчен).
 */
export function spinOutcome(content: RouletteContent, input: SpinInput, seed: string): SpinOutcome | null {
  const random = seededRandom(seed);
  const n = input.sectors.length;
  if (n === 0) return null;
  const rTheme = random();
  const forced = input.forcedTheme ? input.sectors.indexOf(input.forcedTheme) : -1;
  const first = forced >= 0 ? forced : Math.min(n - 1, Math.floor(rTheme * n));
  for (let k = 0; k < n; k++) {
    const index = (first + k) % n;
    const themeId = input.sectors[index] as string;
    const theme = themeById(content, themeId);
    if (!theme) continue;
    const picked = pickTask(content, theme, { played: input.played[themeId] ?? [], extra: input.extra, lastRarity: input.lastRarity }, random);
    if (!picked) continue;
    const f = 0.15 + 0.7 * random();
    const curve = Math.round((2.6 + 1.2 * random()) * 100) / 100;
    return {
      index,
      themeId,
      taskId: picked.task.id,
      rarity: picked.rarity,
      played: picked.played,
      fallbacks: picked.fallbacks,
      angle: landingAngle(index, n, content.spinSeconds, f),
      durationMs: Math.round(content.spinSeconds * 1000) + REVEAL_PAUSE_MS,
      curve,
    };
  }
  return null;
}
