// Ход «Аквариума и Ёлки» — чистые функции.
//
// Вся игра — один шаг (`question`, без таймера, ответы можно менять — `result.changeable`): гости раскрашивают фигуры на
// телефонах и присылают их ответом `{ items: [...] }` (у каждого рисунка свой id, список растёт). Пульт ставит новые
// рисунки на экран записью `result.items` (сразу или после просмотра ведущим). Какие рисунки уже разобраны (выпущены или
// «Не показывать»), пульт помнит по порядку прихода: у каждого телефона список только растёт, поэтому `result.seen[pid]` —
// сколько первых его рисунков разобрано, `result.skip[pid]` — разобранные не по порядку (ведущий выпустил третий раньше
// второго). Убранный с экрана рисунок уже разобран и не вернётся. Ничего не забывается и не растёт без края: на телефон —
// одно число и до `perGuest` номеров. `result.gone` — только у старых сессий (id убранных до этого учёта). Сцену (аквариум или ёлка), корм и режим гирлянды переключает пульт. Очков нет — в конце
// «Завершить игру».
import { leaderboardAdditions } from "../../core/leaderboard";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import type { AquariumContent, SceneId } from "./content";
import { figureById, figuresOf } from "./figures";

/** Сколько фигур на сцене одновременно (ёлка — по числу мест, тоже до 40). */
export const SCENE_CAP = 40;
/** Старые сессии: сколько id убранных рисунков читаем из `result.gone`. */
const GONE_CAP = 600;
/** Сколько телефонов помним в `seen` (больше, чем гостей в одной игре). */
const SEEN_CAP = 2000;
export const NAME_MAX = 16;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const SHA = /^[0-9a-f]{64}$/;

/** Рисунок с телефона (в ответе гостя). */
export interface PhoneItem {
  id: string;
  scene: SceneId;
  fig: string;
  name: string;
  onBody: boolean;
  /** Отпечаток файла раскраски на сервере; null — без файла (предпросмотр, нет связи с сервером рисунков). */
  sha: string | null;
}

/** Рисунок на экране (в итогах шага). */
export interface AquaItem extends PhoneItem {
  /** Чей рисунок (кто прислал ответ). */
  pid: string;
  /** Номер рисунка в списке этого телефона (с 0); нет — рисунок старой сессии. */
  n?: number;
}

export interface AquaResult {
  changeable: true;
  scene: SceneId;
  items: AquaItem[];
  /** Старые сессии: ключи убранных рисунков. Новые записи сюда не идут (только если у рисунка нет номера). */
  gone: string[];
  /** Сколько первых рисунков каждого телефона разобрано (выпущены или скрыты). */
  seen: Record<string, number>;
  /** Разобранные не по порядку: номера от `seen[pid]` и дальше. */
  skip: Record<string, number[]>;
  /** Сколько раз покормили рыбок (экран кормит на каждое новое значение). */
  feed: number;
  /** Режим гирлянды: 0 — мерцание, 1 — волна, 2 — тёплый свет. */
  garland: number;
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function cleanName(v: unknown): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return [...v.replace(/[\u0000-\u001f\u007f]/g, "").trim()].slice(0, NAME_MAX).join("");
}

function phoneItemOf(v: unknown): PhoneItem | null {
  const d = rec(v);
  const scene: SceneId | null = d.scene === "aqua" || d.scene === "tree" ? d.scene : null;
  const fig = typeof d.fig === "string" ? figureById(d.fig) : null;
  if (typeof d.id !== "string" || !ID.test(d.id) || !scene || !fig || (fig.kind === "fish") !== (scene === "aqua")) return null;
  return { id: d.id, scene, fig: fig.id, name: cleanName(d.name), onBody: d.onBody === true, sha: typeof d.sha === "string" && SHA.test(d.sha) ? d.sha : null };
}

function itemOf(v: unknown): AquaItem | null {
  const base = phoneItemOf(v);
  const pid = rec(v).pid;
  if (!base || typeof pid !== "string" || pid.length === 0 || pid.length > 128) return null;
  const n = rec(v).n;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1000 ? { ...base, pid, n } : { ...base, pid };
}

const PID_OK = (k: string) => k.length > 0 && k.length <= 128;

function seenOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  let count = 0;
  for (const [k, n] of Object.entries(rec(v))) {
    if (!PID_OK(k) || typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 1000) continue;
    out[k] = n;
    if (++count >= SEEN_CAP) break;
  }
  return out;
}

function skipOf(v: unknown, seen: Record<string, number>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  let count = 0;
  for (const [k, list] of Object.entries(rec(v))) {
    if (!PID_OK(k) || !Array.isArray(list)) continue;
    const from = seen[k] ?? 0;
    const nums = [...new Set(list.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= from && n < 1000))].sort((a, b) => a - b).slice(0, 50);
    if (nums.length === 0) continue;
    out[k] = nums;
    if (++count >= SEEN_CAP) break;
  }
  return out;
}

/** Разобран ли рисунок номер `n` телефона `pid`. */
function isHandled(r: Pick<AquaResult, "seen" | "skip">, pid: string, n: number): boolean {
  return n < (r.seen[pid] ?? 0) || (r.skip[pid]?.includes(n) ?? false);
}

/** Отметить рисунки разобранными: номер — в `skip`, подряд идущие от начала сворачиваются в `seen`. */
function markHandled(r: Pick<AquaResult, "seen" | "skip">, list: { pid: string; n: number }[]): Pick<AquaResult, "seen" | "skip"> {
  const seen = { ...r.seen };
  const skip: Record<string, number[]> = { ...r.skip };
  for (const { pid, n } of list) {
    let cur = seen[pid] ?? 0;
    if (n < cur) continue;
    const set = new Set(skip[pid] ?? []);
    set.add(n);
    while (set.has(cur)) {
      set.delete(cur);
      cur += 1;
    }
    if (cur > 0) seen[pid] = cur;
    if (set.size > 0) skip[pid] = [...set].sort((a, b) => a - b);
    else delete skip[pid];
  }
  return { seen, skip };
}

/** Рисунки из ответа телефона (не больше `limit`). */
export function phoneItems(value: unknown, limit = 50): PhoneItem[] {
  const list = rec(value).items;
  const out: PhoneItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const item = phoneItemOf(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function parseAquaResult(raw: unknown, content?: AquariumContent): AquaResult {
  const d = rec(raw);
  const items = (Array.isArray(d.items) ? d.items : []).map(itemOf).filter((x): x is AquaItem => x !== null);
  const gone = (Array.isArray(d.gone) ? d.gone : []).filter((x): x is string => typeof x === "string" && x.length <= 200).slice(-GONE_CAP);
  const seen = seenOf(d.seen);
  return {
    changeable: true,
    scene: d.scene === "aqua" || d.scene === "tree" ? d.scene : (content?.scene ?? "aqua"),
    items,
    gone,
    seen,
    skip: skipOf(d.skip, seen),
    feed: typeof d.feed === "number" && Number.isFinite(d.feed) ? Math.max(0, Math.floor(d.feed)) : 0,
    garland: typeof d.garland === "number" && Number.isFinite(d.garland) ? ((Math.floor(d.garland) % 3) + 3) % 3 : 0,
  };
}

/** Ключ рисунка: телефон + его id (у разных телефонов id могут совпасть). */
export const itemKey = (pid: string, id: string) => `${pid}:${id}`;
export const keyOf = (item: AquaItem) => itemKey(item.pid, item.id);

export function aquariumSteps(): Step[] {
  return [];
}

export function score(): ScoreDelta[] {
  return [];
}

/** Рисунки, что прислали телефоны и ещё не разобраны (не выпущены и не скрыты). Не больше `perGuest` с одного телефона. */
export function pendingItems(session: Session, answers: Answer[], content: AquariumContent): AquaItem[] {
  const r = parseAquaResult(session.state.result, content);
  // Старые сессии: рисунки на экране без номера и `gone` узнаются по ключу.
  const known = new Set([...r.items.map(keyOf), ...r.gone]);
  const out: AquaItem[] = [];
  const ordered = [...answers].filter((a) => a.step === session.state.step).sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  for (const a of ordered) {
    phoneItems(a.value, content.perGuest).forEach((item, n) => {
      const key = itemKey(a.pid, item.id);
      if (isHandled(r, a.pid, n) || known.has(key)) return;
      known.add(key);
      out.push({ ...item, pid: a.pid, n });
    });
  }
  return out;
}

/** На экран: новые рисунки в конец, на сцене — не больше `SCENE_CAP` (самые старые уходят и не вернутся — они уже разобраны). */
export function releaseItems(session: Session, content: AquariumContent, add: AquaItem[]): SessionChange | null {
  const r = parseAquaResult(session.state.result, content);
  const known = new Set([...r.items.map(keyOf), ...r.gone]);
  const fresh: AquaItem[] = [];
  for (const i of add) {
    const key = keyOf(i);
    if (known.has(key) || (i.n !== undefined && isHandled(r, i.pid, i.n))) continue;
    known.add(key);
    fresh.push(i);
  }
  if (fresh.length === 0) return null;
  let items = [...r.items, ...fresh];
  const gone = [...r.gone];
  for (const scene of ["aqua", "tree"] as const) {
    const of = items.filter((i) => i.scene === scene);
    if (of.length > SCENE_CAP) {
      const dropped = of.slice(0, of.length - SCENE_CAP);
      const drop = new Set(dropped.map(keyOf));
      // Рисунок без номера (старая сессия) помним по ключу, как раньше.
      gone.push(...dropped.filter((i) => i.n === undefined).map(keyOf));
      items = items.filter((i) => !drop.has(keyOf(i)));
    }
  }
  const marked = markHandled(r, fresh.filter((i): i is AquaItem & { n: number } => i.n !== undefined));
  return { state: { result: { ...r, ...marked, items, gone: gone.slice(-GONE_CAP) } } };
}

/** «Не показывать» (рисунок ждёт показа) или «Убрать с экрана». Рисунок разобран и больше не появится. */
export function hideItem(session: Session, content: AquariumContent, item: AquaItem | string): SessionChange | null {
  const r = parseAquaResult(session.state.result, content);
  const key = typeof item === "string" ? item : keyOf(item);
  const onScreen = r.items.find((i) => keyOf(i) === key);
  const n = onScreen?.n ?? (typeof item === "string" ? undefined : item.n);
  const pid = onScreen?.pid ?? (typeof item === "string" ? undefined : item.pid);
  const items = r.items.filter((i) => keyOf(i) !== key);
  if (n !== undefined && pid !== undefined) {
    if (!onScreen && isHandled(r, pid, n)) return null;
    return { state: { result: { ...r, ...markHandled(r, [{ pid, n }]), items } } };
  }
  // Без номера (старая сессия) — по ключу в `gone`.
  if (r.gone.includes(key) && !onScreen) return null;
  return { state: { result: { ...r, items, gone: [...r.gone.filter((g) => g !== key), key].slice(-GONE_CAP) } } };
}

export function setScene(session: Session, content: AquariumContent, scene: SceneId): SessionChange | null {
  const r = parseAquaResult(session.state.result, content);
  return r.scene === scene ? null : { state: { result: { ...r, scene } } };
}

export function feedFish(session: Session, content: AquariumContent): SessionChange {
  const r = parseAquaResult(session.state.result, content);
  return { state: { result: { ...r, feed: r.feed + 1 } } };
}

export function nextGarland(session: Session, content: AquariumContent): SessionChange {
  const r = parseAquaResult(session.state.result, content);
  return { state: { result: { ...r, garland: (r.garland + 1) % 3 } } };
}

/** «Открыть раскраску»: один шаг на всю игру, ответы можно дополнять. */
export function startAquarium(session: Session, content: AquariumContent, participants: Participant[]): SessionChange {
  const r = parseAquaResult(session.state.result, content);
  return {
    leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode),
    state: { stage: "question", startedAt: "server", timeLimit: null, revealed: false, answered: 0, result: { ...r, scene: r.scene ?? content.scene } },
  };
}

/** Сколько рисунков прислал телефон этой игры (для «Осталось N»). */
export function sentCount(value: unknown): number {
  return phoneItems(value).length;
}

/** Фигуры, из которых гость выбирает на этой сцене. */
export function choicesOf(scene: SceneId) {
  return figuresOf(scene);
}
