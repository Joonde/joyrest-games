// Ход «Аквариума и Ёлки» — чистые функции.
//
// Вся игра — один шаг (`question`, без таймера, ответы можно менять — `result.changeable`): гости раскрашивают фигуры на
// телефонах и присылают их ответом `{ items: [...] }` (у каждого рисунка свой id, список растёт). Пульт ставит новые
// рисунки на экран записью `result.items` (сразу или после просмотра ведущим), «Убрать» — в `result.gone`, повторно
// рисунок не появится. Сцену (аквариум или ёлка), корм и режим гирлянды переключает пульт. Очков нет — в конце
// «Завершить игру».
import { leaderboardAdditions } from "../../core/leaderboard";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import type { ScoreDelta, Step } from "../types";
import type { AquariumContent, SceneId } from "./content";
import { figureById, figuresOf } from "./figures";

/** Сколько фигур на сцене одновременно (ёлка — по числу мест, тоже до 40). */
export const SCENE_CAP = 40;
/** Сколько id убранных рисунков помним (чтобы не вернулись). */
const GONE_CAP = 600;
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
}

export interface AquaResult {
  changeable: true;
  scene: SceneId;
  items: AquaItem[];
  gone: string[];
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
  return base && typeof pid === "string" && pid.length > 0 && pid.length <= 128 ? { ...base, pid } : null;
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
  return {
    changeable: true,
    scene: d.scene === "aqua" || d.scene === "tree" ? d.scene : (content?.scene ?? "aqua"),
    items,
    gone,
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

/** Рисунки, что прислали телефоны и ещё нет на экране (и их не убирали). `limit` — сколько с одного телефона. */
export function pendingItems(session: Session, answers: Answer[], content: AquariumContent): AquaItem[] {
  const r = parseAquaResult(session.state.result, content);
  const known = new Set([...r.items.map(keyOf), ...r.gone]);
  const out: AquaItem[] = [];
  const ordered = [...answers].filter((a) => a.step === session.state.step).sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  for (const a of ordered) {
    for (const item of phoneItems(a.value, content.perGuest)) {
      const key = itemKey(a.pid, item.id);
      if (known.has(key)) continue;
      known.add(key);
      out.push({ ...item, pid: a.pid });
    }
  }
  return out;
}

/** На экран: новые рисунки в конец, на сцене — не больше `SCENE_CAP` (самые старые уходят и не вернутся). */
export function releaseItems(session: Session, content: AquariumContent, add: AquaItem[]): SessionChange | null {
  const r = parseAquaResult(session.state.result, content);
  const known = new Set([...r.items.map(keyOf), ...r.gone]);
  const fresh = add.filter((i) => !known.has(keyOf(i)));
  if (fresh.length === 0) return null;
  let items = [...r.items, ...fresh];
  const gone = [...r.gone];
  for (const scene of ["aqua", "tree"] as const) {
    const of = items.filter((i) => i.scene === scene);
    if (of.length > SCENE_CAP) {
      const drop = new Set(of.slice(0, of.length - SCENE_CAP).map(keyOf));
      gone.push(...drop);
      items = items.filter((i) => !drop.has(keyOf(i)));
    }
  }
  return { state: { result: { ...r, items, gone: gone.slice(-GONE_CAP) } } };
}

/** «Не показывать» или «Убрать с экрана». */
export function hideItem(session: Session, content: AquariumContent, key: string): SessionChange | null {
  const r = parseAquaResult(session.state.result, content);
  if (r.gone.includes(key) && !r.items.some((i) => keyOf(i) === key)) return null;
  return { state: { result: { ...r, items: r.items.filter((i) => keyOf(i) !== key), gone: [...r.gone.filter((g) => g !== key), key].slice(-GONE_CAP) } } };
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
