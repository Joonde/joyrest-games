/**
 * Боты «Игр Матрёшки»: играют по **личному виду** телефона (как настоящий телефон, без доступа к состоянию комнаты) —
 * для сквозных игр в настоящем движке комнат (`server/src/rooms/matryoshka.test.ts`) и тестов правил; дальше — предпросмотр
 * и «Репетиция» (3d). Умение бота (`skill` 0–1) решает реакцию и точность; «ленивый» бот ничего не жмёт.
 */
import { PIECES } from "../rules/constants";

export interface BotEvent {
  t: string;
  [field: string]: unknown;
}

export interface Bot {
  pid: string;
  skill: number;
  lazy: boolean;
  /** Что бот уже сделал (чтобы не повторять). */
  done: Set<string>;
  holding: boolean;
  lastKeep: number;
  pieces: number;
  rand: () => number;
}

/** Генератор бота: mulberry32 от строки. */
export function botRandom(seed: string): () => number {
  let a = 0;
  for (let i = 0; i < seed.length; i += 1) a = (Math.imul(a ^ seed.charCodeAt(i), 2654435761) + i) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newBot(pid: string, seed: string, opts: { skill?: number; lazy?: boolean } = {}): Bot {
  const rand = botRandom(`${seed}:${pid}`);
  return { pid, skill: opts.skill ?? 0.4 + rand() * 0.6, lazy: opts.lazy ?? false, done: new Set(), holding: false, lastKeep: -Infinity, pieces: 0, rand };
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function once(b: Bot, key: string): boolean {
  if (b.done.has(key)) return false;
  b.done.add(key);
  return true;
}

/**
 * События бота на этот шаг по его личному виду `me` и часам сервера `now`. Шаг — раз в 100–200 мс. Пауза — ничего (кнопку
 * держать заново после «Продолжить»).
 */
export function botStep(b: Bot, me: unknown, now: number, paused: boolean, hint: { chanceCorrect?: number } = {}): BotEvent[] {
  const v = rec(me);
  if (!v || paused) {
    b.holding = false;
    return [];
  }
  const out: BotEvent[] = [];
  const role = v.role;
  const trial = rec(v.trial);
  const r = b.rand;
  // Болельщик: прогноз и ставки, «Канат».
  const guess = rec(trial?.guess);
  if (guess?.open === true && guess.mine === null && once(b, `guess:${String(trial?.index)}:${String(trial?.stageEnds)}`)) {
    out.push({ t: "guess", n: Math.round(r() * (num(guess.max) ?? 10)) });
  }
  const final = rec(v.final);
  const watch = rec(final?.watch);
  if (watch?.betOpen === true && watch.bet === null && once(b, `bet:${String(watch.stageEnds)}`)) {
    out.push({ t: "bet", side: r() < 0.5 ? 0 : 1 });
  }
  if (b.lazy && role === "player") return out;
  const freeze = rec(trial?.freeze);
  if (freeze && trial?.stage === "play") out.push(...freezeBot(b, freeze, now));
  else if (b.holding) {
    b.holding = false;
  }
  const ginger = rec(trial?.ginger);
  if (ginger && trial?.stage === "play") {
    if (ginger.sub === "pick" && ginger.box === null && r() < 0.3 && once(b, `box:${String(trial.index)}`)) out.push({ t: "box", n: Math.floor(r() * 4) });
    if (ginger.sub === "trace" && ginger.cracked !== true && ginger.done !== true) {
      // Обводка: 2–6 кусочков за шаг по умению, иногда трещина (сложная фигура — чаще).
      const crackP = 0.004 * (1.2 - b.skill);
      if (r() < crackP) out.push({ t: "g", c: b.pieces, crack: true });
      else {
        b.pieces = Math.min(PIECES, b.pieces + Math.round(1 + r() * 5 * b.skill));
        out.push({ t: "g", c: b.pieces });
      }
    }
  } else b.pieces = 0;
  const chairs = rec(trial?.chairs);
  if (chairs && trial?.stage === "play" && chairs.inRound === true && chairs.tapped !== true) {
    const appear = num(chairs.appearAt);
    const rt = 200 + Math.round((1 - b.skill) * 1600 + r() * 400);
    // Реакция — от назначенного появления по часам (как у телефона, не от отрисовки), с отметкой `st`.
    if (appear !== null && now >= appear + rt && once(b, `sit:${String(chairs.round)}:${appear}`)) out.push({ t: "sit", rt: Math.round(now - appear), st: now });
  }
  const rope = rec(trial?.rope);
  if (rope && rope.sub === "pull" && trial?.stage === "play") out.push({ t: "tap", n: Math.round(1 + r() * 2 + b.skill) });
  const hop = rec(trial?.hop);
  if (hop && trial?.stage === "play" && hop.jumper === true && hop.fell !== true) {
    const row = String(hop.row);
    // Реакция — от появления кнопки по часам (как у телефона): сервер сверяет её со своим временем (аудит 3a).
    const braveAt = num(hop.braveAt);
    if (hop.sub === "brave" && hop.braveTapped !== true && braveAt !== null && r() < 0.05 && once(b, `brave:${row}:${String(trial.index)}`)) out.push({ t: "brave", rt: Math.max(150, Math.round(now - braveAt)), st: now });
    if (hop.sub === "jump" && hop.brave === true && hop.pick === null && once(b, `jump:${row}:${String(trial.index)}`)) out.push({ t: "cell", side: r() < 0.5 ? "L" : "R" });
    if (hop.sub === "choose" && hop.brave !== true && hop.pick === null && r() < 0.2 && once(b, `cell:${row}:${String(trial.index)}`)) {
      // Иногда — туда же, куда большинство смельчаков (это не подсказка: результат им не виден).
      const braves = Array.isArray(hop.braves) ? hop.braves.filter((x) => x === "L" || x === "R") : [];
      const follow = braves.length > 0 && r() < 0.5 ? braves[0] : r() < 0.5 ? "L" : "R";
      out.push({ t: "cell", side: follow });
    }
  }
  const chance = rec(v.chance);
  if (chance?.eligible === true && chance.stage === "question" && chance.answered === null && Array.isArray(chance.options)) {
    const at = num(chance.stageAt) ?? now;
    const rt = 600 + Math.round(r() * 4000);
    if (now >= at + rt && once(b, `ans:${at}`)) {
      // Верно — 70%: верный вариант боту подсказывает тест (`hint`), телефон его не знает.
      const correct = hint.chanceCorrect ?? 0;
      out.push({ t: "ans", i: r() < 0.7 ? correct : (correct + 1) % chance.options.length, rt: Math.round(now - at), st: now });
    }
  }
  const dob = rec(v.dobivka);
  if (dob?.stage === "rows" && dob.jumper === true && dob.pick === null && r() < 0.3 && once(b, `dob:${String(dob.row)}:${String(dob.chooseEnds)}`)) out.push({ t: "cell", side: r() < 0.5 ? "L" : "R" });
  const duel = rec(final?.duel);
  if (duel?.stage === "pick" && duel.pick === null && r() < 0.4 && once(b, `rps:${String(duel.roundNo)}:${String(duel.stageEnds)}`)) out.push({ t: "rps", g: ["r", "p", "s"][Math.floor(r() * 3)] });
  return out;
}

/**
 * «Замри!»: держит; поворот приходит за 1 с — отпускает около `at` (умелый — до окна, неумелый — иногда поздно и пойман),
 * снова жмёт после конца взгляда. Пока держит — «держу» раз в секунду (иначе через 2 с без пачек — «стоит»).
 */
function freezeBot(b: Bot, f: Record<string, unknown>, now: number): BotEvent[] {
  if (f.finished === true) {
    b.holding = false;
    return [];
  }
  const gaze = rec(f.gaze);
  const at = num(gaze?.at);
  const end = num(gaze?.end);
  const react = 300 - Math.round(b.skill * 550) + Math.round(b.rand() * 250);
  const resume = end !== null ? end + 150 + Math.round((1 - b.skill) * 500) : null;
  const shouldHold = at === null || end === null ? true : now < at + react || (resume !== null && now >= resume);
  const out: BotEvent[] = [];
  if (shouldHold && !b.holding) {
    b.holding = true;
    b.lastKeep = now;
    out.push({ t: "h", on: true });
  } else if (!shouldHold && b.holding) {
    b.holding = false;
    out.push({ t: "h", on: false });
  } else if (b.holding && now - b.lastKeep >= 1000) {
    b.lastKeep = now;
    out.push({ t: "h", on: true });
  }
  return out;
}
