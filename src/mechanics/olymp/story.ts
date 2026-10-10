// «Олимп» — история как дерево сцен с развилками и узлами (ветки сходятся).
// Сцена: рассказ ведущего, проверка кубиком, голосование, бой или концовка.
// Выборы и важные исходы запоминаются флагами «Саги» — от них зависят следующие сцены и концовка.
import type { EffectSpec } from "./gods";
import type { Outcome, StatId } from "./rules";

/** Локация: оформление экрана зала (картинка, частицы, музыка) — общая для нескольких сцен. */
export interface Place {
  id: string;
  name: string;
  /** Частицы на экране зала. */
  weather: "snow" | "embers" | "mist" | "none";
  /** Набор музыки локации. */
  music: "olympus" | "temple" | "forest" | "river" | "boss" | "spring";
}

export interface OutcomeBranch {
  /** Что прочитать после броска. */
  text: string;
  /** Куда дальше; нет — `next` сцены. */
  next?: string;
  /** Опыт богу, который бросал (по умолчанию — по исходу: 30/20/10/5/0). */
  xp?: number;
  /** Эффект на бросавшего. */
  effect?: EffectSpec;
  /** Флаг Саги. */
  flag?: string;
  /** Драхмы отряду (делятся бросками). */
  coins?: number;
  /** Урон бросавшему (крит. неудача). */
  hurt?: number;
}

interface SceneBase {
  id: string;
  place: string;
  title: string;
  /** Текст для ведущего — читает вслух; на экране зала — коротко (`screen`). */
  text: string;
  /** Одна-две строки на экране зала. */
  screen: string;
}

export interface NarrateScene extends SceneBase {
  kind: "narrate";
  next: string;
}

export interface CheckScene extends SceneBase {
  kind: "check";
  /** Чем бросают. */
  stat: StatId;
  /** Подсказка ведущему: кто говорит и что пытается сделать. */
  action: string;
  outcomes: Record<Outcome, OutcomeBranch>;
  next: string;
}

export interface VoteOption {
  label: string;
  hint: string;
  next: string;
  /** Вариант виден, только если в Саге есть флаг. */
  needs?: string;
}

export interface VoteScene extends SceneBase {
  kind: "vote";
  options: VoteOption[];
}

export interface FightScene extends SceneBase {
  kind: "fight";
  foe: string;
  win: string;
  lose: string;
}

export interface EndScene extends SceneBase {
  kind: "end";
  ending: "good" | "mid" | "bad";
}

/** Развилка по флагам Саги без голосования (узел, где ветки сходятся). */
export interface BranchScene extends SceneBase {
  kind: "branch";
  /** Первое совпавшее условие; `default` — если ни одно. */
  rules: Array<{ flag: string; next: string }>;
  default: string;
}

export type Scene = NarrateScene | CheckScene | VoteScene | FightScene | EndScene | BranchScene;

export interface Story {
  id: string;
  title: string;
  /** Коротко для студии и заставки. */
  blurb: string;
  start: string;
  places: Place[];
  scenes: Scene[];
}

export function sceneOf(story: Story, id: string | null | undefined): Scene | undefined {
  return story.scenes.find((s) => s.id === id);
}

export function placeOf(story: Story, id: string): Place | undefined {
  return story.places.find((p) => p.id === id);
}

/** Куда может вести сцена (для проверки дерева). */
export function exitsOf(scene: Scene): string[] {
  switch (scene.kind) {
    case "narrate":
      return [scene.next];
    case "check":
      return [scene.next, ...Object.values(scene.outcomes).map((o) => o.next).filter((n): n is string => !!n)];
    case "vote":
      return scene.options.map((o) => o.next);
    case "fight":
      return [scene.win, scene.lose];
    case "branch":
      return [...scene.rules.map((r) => r.next), scene.default];
    case "end":
      return [];
  }
}

/** Варианты голосования с учётом флагов Саги. */
export function visibleOptions(scene: VoteScene, flags: string[]): VoteOption[] {
  return scene.options.filter((o) => !o.needs || flags.includes(o.needs));
}

/** Куда ведёт развилка по флагам. */
export function branchNext(scene: BranchScene, flags: string[]): string {
  return scene.rules.find((r) => flags.includes(r.flag))?.next ?? scene.default;
}

/** Ошибки дерева: ссылки в никуда, недостижимые сцены, тупики, нет концовок, неизвестные места. */
export function validateStory(story: Story): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const s of story.scenes) {
    if (ids.has(s.id)) errors.push(`Сцена ${s.id} повторяется`);
    ids.add(s.id);
    if (!placeOf(story, s.place)) errors.push(`Сцена ${s.id}: нет места ${s.place}`);
    if (!s.text.trim() || !s.screen.trim()) errors.push(`Сцена ${s.id}: нет текста`);
    if (s.kind === "vote" && s.options.filter((o) => !o.needs).length < 2) errors.push(`Сцена ${s.id}: меньше двух вариантов без условий`);
  }
  if (!ids.has(story.start)) errors.push(`Нет начальной сцены ${story.start}`);
  for (const s of story.scenes) for (const n of exitsOf(s)) if (!ids.has(n)) errors.push(`Сцена ${s.id} ведёт в несуществующую ${n}`);
  // достижимость и тупики
  const seen = new Set<string>();
  const queue = [story.start];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = sceneOf(story, id);
    if (s) queue.push(...exitsOf(s));
  }
  for (const s of story.scenes) if (!seen.has(s.id)) errors.push(`Сцена ${s.id} недостижима`);
  const ends = story.scenes.filter((s) => s.kind === "end");
  if (ends.length === 0) errors.push("Нет ни одной концовки");
  // из каждой сцены можно дойти до концовки
  const canEnd = new Set(ends.map((e) => e.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of story.scenes) {
      if (canEnd.has(s.id)) continue;
      if (exitsOf(s).some((n) => canEnd.has(n))) {
        canEnd.add(s.id);
        changed = true;
      }
    }
  }
  for (const s of story.scenes) if (!canEnd.has(s.id)) errors.push(`Из сцены ${s.id} не дойти до концовки`);
  return errors;
}
