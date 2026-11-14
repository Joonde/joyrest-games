/**
 * Экран зала «Игр Матрёшки» без React (Блок 3c): поток `screen` игровой комнаты → модель → какой экран показать, кто какая фишка,
 * что «наступило» (звуки и анимации — только при открытом экране). Часы — сверенные (`GET /api/time`, у экрана свои), без сверки —
 * сдвиг по `at` событий, как у «Бубликатора»; на паузе отсчёты стоят. Снимок или перемена — по непрерывности потока (разрыв
 * больше 3 с или сводка опоздала больше 2,5 с — снимок: моментов нет).
 */
import type { RoomClosedReason, RoomStreamEvent } from "../../../data/types";
import { CATCH_FROM_MS, HEAD_TURN_MS, REACTION_MS } from "../rules/constants";
import type { ScreenPlayer } from "../rules/types";
import { F_DONE, F_FAIL, F_HOLD, F_OFFLINE } from "../rules/views";
import { parseScreen, type PhraseV, type ScreenV } from "./view";

export { F_DONE, F_FAIL, F_HOLD, F_OFFLINE };

export interface ScreenModel {
  view: ScreenV | null;
  paused: boolean;
  /** Момент паузы по часам сервера (отсчёты стоят на нём). */
  pausedAt: number | null;
  /** Сдвиг «сервер − экран» по `at` событий (замер всегда не больше настоящего — берём больший). */
  offset: number | null;
  closed: RoomClosedReason | null;
  heardAt: number;
  viewAt: number | null;
  /** Вид — снимок (первая сводка, переподключение, опоздание): моменты по нему не играются. */
  fresh: boolean;
  /** Смайлик (или первая буква имени) каждого номера: из лобби и из имён — фишка одна и та же всю игру. */
  marks: Record<number, string>;
  /** Кто уже в сугробе (номера, по порядку): трибуна и сугроб внизу. */
  outSeen: number[];
  /** Имена, которые экран уже видел (сводка шлёт имена не всех — бюджет 4 КБ): «Табло» подписывает ими номера. */
  known: Record<number, string>;
}

export function emptyScreen(now: number): ScreenModel {
  return { view: null, paused: false, pausedAt: null, offset: null, closed: null, heardAt: now, viewAt: null, fresh: true, marks: {}, outSeen: [], known: {} };
}

export const SNAPSHOT_GAP_MS = 3000;
export const STALE_MS = 2500;

/** Сдвиг «сервер − местные часы» после нового замера (как у телефона и экрана «Бубликатора»). */
export function nextOffset(offset: number | null, at: number, local: number): number | null {
  if (!Number.isFinite(at)) return offset;
  const sample = at - local;
  return offset === null || sample > offset || offset - sample > 60_000 ? sample : offset;
}

export function isSnapshot(m0: ScreenModel, at: number, local: number): boolean {
  if (m0.view === null || m0.closed !== null || m0.viewAt === null) return true;
  if (at - m0.viewAt > SNAPSHOT_GAP_MS) return true;
  return m0.offset !== null && local + m0.offset - at > STALE_MS;
}

const PICTO = /^(\p{Extended_Pictographic}(?:\u{FE0F}|\u{200D}\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/u;

/** Смайлик в начале имени (платформа хранит его там: «🦊 Аня») или null. */
export function leadingEmoji(name: string): string | null {
  const m = PICTO.exec(name.trim());
  return m?.[1] ?? null;
}

/** Имя без смайлика в начале: «Аня». */
export function plainName(name: string): string {
  const e = leadingEmoji(name);
  return (e ? name.trim().slice(e.length) : name).trim();
}

function learnMarks(marks: Record<number, string>, v: ScreenV): Record<number, string> {
  let out = marks;
  const set = (n: number, mark: string) => {
    if (out[n] === mark) return;
    if (out === marks) out = { ...marks };
    out[n] = mark;
  };
  if (v.lobby?.nums) v.lobby.nums.forEach((n, i) => set(n, v.lobby?.marks[i] ?? "•"));
  for (const [k, name] of Object.entries(v.names)) {
    const e = leadingEmoji(name);
    if (e) set(Number(k), e);
  }
  return out;
}

function learnNames(known: Record<number, string>, v: ScreenV): Record<number, string> {
  let out = known;
  for (const [k, name] of Object.entries(v.names)) {
    const n = Number(k);
    if (out[n] === name) continue;
    if (out === known) out = { ...known };
    out[n] = name;
  }
  return out;
}

function learnOut(seen: number[], v: ScreenV): number[] {
  const add = [...v.justOut, ...(v.trial?.outcome?.out ?? []), ...(v.dobivka?.out ?? [])].filter((n) => n > 0 && !seen.includes(n));
  if (add.length === 0) return seen;
  return [...seen, ...new Set(add)].slice(-200);
}

function withPause(m: ScreenModel, paused: boolean, at: number): ScreenModel {
  if (!paused) return m.paused ? { ...m, paused: false, pausedAt: null } : m;
  return m.paused ? m : { ...m, paused: true, pausedAt: at };
}

/** Событие потока экрана → новая модель. */
export function applyScreen(m0: ScreenModel, e: RoomStreamEvent, local: number): ScreenModel {
  const m: ScreenModel = { ...m0, offset: nextOffset(m0.offset, e.at, local), heardAt: local };
  switch (e.type) {
    case "screen":
    case "snapshot": {
      const view = parseScreen(e.data);
      if (!view) return withPause(m, e.paused, e.at);
      const fresh = e.type === "snapshot" || isSnapshot(m0, e.at, local);
      const next = withPause(m, e.paused, e.at);
      return { ...next, view, viewAt: e.at, closed: null, fresh, marks: learnMarks(m.marks, view), known: learnNames(m.known, view), outSeen: learnOut(fresh && m0.view === null ? [] : m.outSeen, view) };
    }
    case "room":
      return withPause(m, e.paused, e.at);
    case "closed":
      return { ...m, closed: e.reason };
    default:
      return m;
  }
}

/** Время сервера сейчас: на паузе — момент паузы; `synced` — сдвиг сверенных часов (лучше `at` событий), если он есть. */
export function serverNow(m: ScreenModel, local: number, synced: number | null = null): number {
  if (m.paused && m.pausedAt !== null) return m.pausedAt;
  return local + (synced ?? m.offset ?? 0);
}

/** Сколько осталось до момента (мс, не меньше 0); null — момента нет. */
export function leftMs(at: number | null | undefined, now: number): number | null {
  if (at === null || at === undefined || !Number.isFinite(at)) return null;
  return Math.max(0, at - now);
}

/** Секунды для таймера (вверх). */
export function secs(ms: number | null): number | null {
  return ms === null ? null : Math.ceil(ms / 1000);
}

export type Board =
  | "connecting"
  | "tab"
  | "abandoned"
  | "removed"
  | "over"
  | "lobby"
  | "open"
  | "rules"
  | "countdown"
  | "freeze"
  | "ginger"
  | "chairs"
  | "rope"
  | "hop"
  | "judging"
  | "reveal"
  | "results"
  | "chance"
  | "dobivka"
  | "bracket"
  | "duel"
  | "bestFan"
  | "champion"
  | "podium";

/** «Лучший болельщик» показывается перед чемпионом столько (решение по макету: слайд перед чемпионом). */
export const BEST_FAN_MS = 8000;

/**
 * Какой экран показать. `champSince` — когда экран сам увидел этап чемпиона (не снимком): первые `BEST_FAN_MS` — «Лучший
 * болельщик» (если он есть), дальше — чемпион; открыли экран на чемпионе — сразу чемпион.
 */
export function boardOf(m: ScreenModel, local: number, champSince: number | null): Board {
  if (m.closed === "busy" || m.closed === "replaced") return "tab";
  if (m.closed === "abandoned") return "abandoned";
  if (m.closed === "removed") return "removed";
  const v = m.view;
  if (m.closed === "finished") return v?.podium ? "podium" : "over";
  if (!v) return "connecting";
  switch (v.phase) {
    case "lobby":
      return "lobby";
    case "podium":
    case "finished":
      return v.podium ? "podium" : "over";
    case "chance":
      return "chance";
    case "dobivka":
      return "dobivka";
    case "final": {
      const f = v.final;
      if (!f) return "bracket";
      if (f.stage === "champion") return f.bestFan && champSince !== null && local - champSince < BEST_FAN_MS ? "bestFan" : "champion";
      return f.stage === "duel" && f.duel ? "duel" : "bracket";
    }
    case "trial": {
      const t = v.trial;
      if (!t) return "connecting";
      if (t.auto) return "results";
      switch (t.stage) {
        case "open":
          return "open";
        case "rules":
          return "rules";
        case "countdown":
          return "countdown";
        case "judging":
          return "judging";
        case "reveal":
          return "reveal";
        case "results":
          return "results";
        default:
          return t.kind === "hopscotch" ? "hop" : t.kind;
      }
    }
  }
}

// ------------------------------------------------------------------ фишки

/** Цвета фишек — пастель команд платформы (текст на них тёмный). */
export const CHIP_COLORS = ["#E3AA9C", "#E3C68C", "#A3C2AA", "#D2A0AC", "#B3AADD"] as const;
const FALLBACK = ["🦊", "🐻", "🐼", "🐯", "🦁", "🐸", "🐙", "🦄", "🐝", "🦋", "🐧", "🐢", "🌟", "🔥", "🚀", "🎉", "🎈", "🎯", "🎸", "🍕", "🍩", "🍓", "🌈", "👑"];

export function chipColor(n: number): string {
  return CHIP_COLORS[((n % CHIP_COLORS.length) + CHIP_COLORS.length) % CHIP_COLORS.length] ?? CHIP_COLORS[0];
}

/** Фишка номера: смайлик из имени или лобби, иначе — свой по номеру (один и тот же всю игру). */
export function markOf(n: number, marks: Readonly<Record<number, string>>): string {
  return marks[n] ?? FALLBACK[(n * 7) % FALLBACK.length] ?? "🙂";
}

/** «№ 004». */
export function numText(n: number): string {
  return `№ ${String(Math.max(0, Math.round(n))).padStart(3, "0")}`;
}

/** «№ 004 Лёша» — имя без смайлика, если имя известно. */
export function whoText(n: number, names: Readonly<Record<number, string>>): string {
  const name = names[n];
  return name ? `${numText(n)} ${plainName(name)}` : numText(n);
}

export const has = (flags: number, bit: number): boolean => (flags & bit) !== 0;

// ------------------------------------------------------------------ «Замри!»: поворот головы, слова песенки

export type Pose = "back" | "profile" | "tq" | "face";

export interface FreezeLook {
  pose: Pose;
  /** Смотрит (глаза светятся): с T до конца взгляда. */
  look: boolean;
  /** Сколько слов «Раз…», «два…», «три…» уже прозвучало (0–3). */
  words: number;
  /** На экране огромное «ЗАМРИ!». */
  zamri: boolean;
  /** Вздрогнула (обманка): 0,3 с с момента обманки. */
  twitch: boolean;
  /** Ловит ли уже взгляд (с `window`, T + реакция + запас на часы). */
  catching: boolean;
}

/** Обратный поворот после взгляда (лицо → спина). */
export const TURN_BACK_MS = 360;

/** Моменты слов песенки: «Раз» — в начале фразы, «два» — через треть, «три» — через две трети (`at` — «ЗАМРИ!»). */
export function wordTimes(p: PhraseV): [number, number, number] {
  const beat = (p.at - p.start) / 6;
  return [p.start, p.start + 2 * beat, p.start + 4 * beat];
}

/**
 * Вид Матрёшки и песенки в момент `t` (часы сервера). Голова **начинает** поворот в `head` (за 0,4 с до T): спина → профиль →
 * три четверти → лицо, к T она уже смотрит; после конца взгляда — обратно за 0,36 с. Слова — по одному в такт.
 */
export function freezeLook(p: PhraseV | null, t: number): FreezeLook {
  const idle: FreezeLook = { pose: "back", look: false, words: 0, zamri: false, twitch: false, catching: false };
  if (!p) return idle;
  const head = Number.isFinite(p.head) ? p.head : p.at - HEAD_TURN_MS;
  const span = Math.max(1, p.at - head);
  const [w1, w2, w3] = wordTimes(p);
  const words = t >= w3 ? 3 : t >= w2 ? 2 : t >= w1 ? 1 : 0;
  const twitch = p.decoy !== null && t >= p.decoy && t < p.decoy + 300;
  if (t < head) return { ...idle, words, twitch };
  if (t < p.at) {
    const k = (t - head) / span;
    return { pose: k < 0.33 ? "profile" : k < 0.66 ? "tq" : "face", look: false, words: 3, zamri: false, twitch: false, catching: false };
  }
  if (t < p.end) return { pose: "face", look: true, words: 3, zamri: true, twitch: false, catching: t >= p.window };
  const k = (t - p.end) / TURN_BACK_MS;
  if (k < 1) return { pose: k < 0.33 ? "tq" : k < 0.66 ? "profile" : "back", look: false, words: 0, zamri: false, twitch: false, catching: false };
  return idle;
}

/** Окно поимки с T: реакция и запас на часы (для подсказки «Ловит!»). */
export const CATCH_AFTER_MS = CATCH_FROM_MS;
export const REACTION = REACTION_MS;

// ------------------------------------------------------------------ поле «Замри!»

export interface FieldToken {
  num: number;
  /** Доля пути 0…1. */
  x: number;
  lane: number;
  /** Место в дорожке (0, 1, 2…): соседи по дорожке чуть сдвинуты, чтобы фишки с одинаковым путём не легли одна на другую. */
  slot: number;
  hold: boolean;
  done: boolean;
  caught: boolean;
  offline: boolean;
}

/** Дорожек на поле: до 8 фишек в дорожке, 5–12 дорожек. */
export function laneCount(n: number): number {
  return Math.max(5, Math.min(12, Math.ceil(n / 6)));
}

/** Фишки поля «Замри!»: дорожка — по номеру (не прыгает), доля пути — по пути 0–1000. */
export function fieldTokens(players: readonly ScreenPlayer[]): FieldToken[] {
  const lanes = laneCount(players.length);
  const sorted = [...players].sort((a, b) => a[0] - b[0]);
  return sorted.map(([n, path, flags], i) => ({
    num: n,
    x: Math.max(0, Math.min(1, path / 1000)),
    lane: i % lanes,
    slot: Math.floor(i / lanes),
    hold: has(flags, F_HOLD),
    done: has(flags, F_DONE),
    caught: has(flags, F_FAIL),
    offline: has(flags, F_OFFLINE),
  }));
}

/** Лидеры для подписей (до 3 недобежавших, у кого больше пути и известно имя). */
export function leaders(players: readonly ScreenPlayer[], names: Readonly<Record<number, string>>, max = 3): number[] {
  return [...players]
    .filter(([n, , f]) => !has(f, F_DONE) && names[n] !== undefined)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, max)
    .map(([n]) => n);
}

/**
 * Подписи лидеров без наложений: подпись стоит над фишкой; если она задевает уже поставленную (ближе `w` по ширине и `h` по
 * высоте), уходит выше на высоту подписи, а упёрлась в верх поля (`top`) — ниже фишки. Координаты — в пикселях макета.
 */
export function placeTags(points: ReadonlyArray<{ num: number; x: number; y: number }>, w = 340, h = 50, top = -40): Map<number, number> {
  const placed: Array<{ x: number; y: number }> = [];
  const out = new Map<number, number>();
  for (const p of [...points].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const hits = (y: number) => placed.some((q) => Math.abs(q.x - p.x) < w && Math.abs(q.y - y) < h);
    let y = p.y;
    for (let k = 0; k < 6 && hits(y); k += 1) y -= h;
    if (y < top || hits(y)) {
      y = p.y;
      for (let k = 0; k < 6 && hits(y); k += 1) y += h;
    }
    placed.push({ x: p.x, y });
    out.set(p.num, y);
  }
  return out;
}

// ------------------------------------------------------------------ моменты: только то, что наступило при открытом экране

export interface Moments {
  /** Новая матрёшка раскрылась. */
  open: boolean;
  /** Отсчёт 3-2-1 начался. */
  countdown: boolean;
  judging: boolean;
  /** Вскрытие: сколько упало в сугроб (монеты в Копилку). */
  reveal: number;
  /** Объявили пойманных (номер взгляда). */
  caught: boolean;
  /** «Пряник»: открылась коробка, кто-то треснул, кто-то обвёл целиком. */
  box: boolean;
  crack: boolean;
  whole: boolean;
  /** «Стулья»: рассадка объявлена. */
  seated: boolean;
  /** «Канат»: попытка выиграна. */
  ropeWin: boolean;
  /** «Классики»/«Добивка»: лёд треснул. */
  ice: boolean;
  /** «Второй шанс»: дверца, вернулись. */
  door: boolean;
  back: boolean;
  /** Финал: жесты открыты, дуэль выиграна, чемпион, пьедестал. */
  show: boolean;
  duelWon: boolean;
  champion: boolean;
  podium: boolean;
}

const NONE: Moments = { open: false, countdown: false, judging: false, reveal: 0, caught: false, box: false, crack: false, whole: false, seated: false, ropeWin: false, ice: false, door: false, back: false, show: false, duelWon: false, champion: false, podium: false };

/** Что наступило между двумя видами (снимок — ничего). */
export function momentsOf(prev: ScreenV | null, next: ScreenV | null): Moments {
  if (!prev || !next) return NONE;
  const pt = prev.trial;
  const nt = next.trial;
  const sameTrial = pt !== null && nt !== null && pt.index === nt.index && prev.phase === "trial";
  const entered = (stage: string) => next.phase === "trial" && nt?.stage === stage && (!sameTrial || pt?.stage !== stage);
  const pp = pt?.play;
  const np = nt?.play;
  const out: Moments = { ...NONE };
  out.open = entered("open");
  out.countdown = entered("countdown");
  out.judging = entered("judging");
  out.reveal = entered("reveal") ? (nt?.outcome?.out.length ?? 0) : 0;
  if (sameTrial && pp?.kind === "freeze" && np?.kind === "freeze") out.caught = np.caught !== null && np.caught.count > 0 && np.caught.gaze !== pp.caught?.gaze;
  if (sameTrial && pp?.kind === "ginger" && np?.kind === "ginger") {
    out.box = np.boxes.length > pp.boxes.length;
    out.crack = np.cracked > pp.cracked;
    out.whole = np.whole > pp.whole;
  }
  if (sameTrial && pp?.kind === "chairs" && np?.kind === "chairs") out.seated = np.seated !== null && (pp.seated === null || pp.round !== np.round);
  if (sameTrial && pp?.kind === "rope" && np?.kind === "rope") out.ropeWin = np.wins[0] + np.wins[1] > pp.wins[0] + pp.wins[1];
  if (sameTrial && pp?.kind === "hopscotch" && np?.kind === "hopscotch") out.ice = np.fell !== null && (pp.fell === null || pp.row !== np.row);
  const pd = prev.phase === "dobivka" ? prev.dobivka : null;
  const nd = next.phase === "dobivka" ? next.dobivka : null;
  if (pd && nd) out.ice = out.ice || (nd.fell !== null && (pd.fell === null || pd.row !== nd.row));
  const pc = prev.phase === "chance" ? prev.chance : null;
  const nc = next.phase === "chance" ? next.chance : null;
  if (nc) {
    out.door = nc.stage === "offer" && pc?.stage !== "offer";
    out.back = nc.stage === "back" && pc?.stage !== "back" && nc.returned.length > 0;
  }
  const pf = prev.final;
  const nf = next.final;
  if (nf && next.phase === "final") {
    const pduel = pf?.duel;
    const nduel = nf.duel;
    if (nduel) {
      const sameDuel = pduel !== null && pduel !== undefined && pduel.a === nduel.a && pduel.b === nduel.b;
      out.show = nduel.stage === "show" && (!sameDuel || pduel.stage !== "show" || pduel.roundNo !== nduel.roundNo);
      out.duelWon = nduel.winner !== null && (!sameDuel || pduel.winner === null);
    }
    out.champion = nf.stage === "champion" && pf?.stage !== "champion";
  }
  out.podium = next.phase === "podium" && prev.phase !== "podium";
  return out;
}
