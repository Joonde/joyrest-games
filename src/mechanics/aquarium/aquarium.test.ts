import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Session } from "../../data/types";
import { createAquarium, parseAquarium } from "./content";
import { FISH, ORN, figureById } from "./figures";
import { feedFish, hideItem, itemKey, nextGarland, parseAquaResult, pendingItems, phoneItems, releaseItems, SCENE_CAP, setScene, startAquarium } from "./logic";

const content = createAquarium();

function session(result: unknown = {}, stage: Session["state"]["stage"] = "question"): Session {
  return {
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: null,
    gameTitle: "Аквариум",
    mechanic: "aquarium",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), phase: "playing", stage, result },
    leaderboard: {},
    createdAt: 0,
  };
}

const answer = (pid: string, items: unknown[], at = 1): Answer => ({ id: `0_${pid}`, step: 0, pid, uid: pid, value: { items }, submittedAt: at });
const fish = (id: string, fig = "clown", extra: Record<string, unknown> = {}) => ({ id, scene: "aqua", fig, name: "Аня", onBody: true, sha: "a".repeat(64), ...extra });

describe("«Аквариум и Ёлка»: настройки", () => {
  it("битые поля — по умолчанию, рисунков с телефона 1–10", () => {
    expect(parseAquarium(null)).toEqual(content);
    expect(parseAquarium({ scene: "tree", starters: false, moderation: "host", names: false, perGuest: 99 })).toEqual({ scene: "tree", starters: false, moderation: "host", names: false, perGuest: 10 });
    expect(parseAquarium({ perGuest: 0 }).perGuest).toBe(1);
  });

  it("фигуры как в прототипе: 10 рыбок и 13 игрушек, у каждой контур", () => {
    expect(FISH).toHaveLength(10);
    expect(ORN).toHaveLength(13);
    for (const f of [...FISH, ...ORN]) {
      expect(f.shapes.length, f.id).toBeGreaterThan(0);
      expect(figureById(f.id)).toBe(f);
    }
    expect(new Set([...FISH, ...ORN].map((f) => f.id)).size).toBe(23);
  });
});

describe("«Аквариум и Ёлка»: ход", () => {
  it("«Открыть раскраску» — один шаг без таймера, ответы можно дополнять", () => {
    const change = startAquarium(session({}, "ready"), content, []);
    expect(change.state?.stage).toBe("question");
    expect(change.state?.timeLimit).toBeNull();
    expect(change.state?.result).toMatchObject({ changeable: true, scene: "aqua", items: [], feed: 0 });
  });

  it("рисунок с телефона: проверка фигуры и сцены, имя не длиннее 16, лишний id — один раз", () => {
    const items = phoneItems({ items: [fish("a"), fish("a"), fish("b", "ball"), fish("c", "nope"), fish("d", "shark", { name: "Очень-очень длинное имя гостя" }), { id: "../x", scene: "aqua", fig: "clown" }] });
    expect(items.map((i) => i.id)).toEqual(["a", "d"]);
    expect(items[1]?.name).toHaveLength(16);
    expect(phoneItems({ items: [{ ...fish("e"), sha: "../../etc" }] })[0]?.sha).toBeNull();
  });

  it("новые рисунки ждут, «На экран» ставит их; повтор ответа не дублирует, убранный не возвращается", () => {
    const s0 = session(parseAquaResult({}, content));
    const answers = [answer("p1", [fish("a"), fish("b")]), answer("p2", [fish("a", "angel")], 2)];
    const pending = pendingItems(s0, answers, content);
    expect(pending.map((i) => itemKey(i.pid, i.id))).toEqual(["p1:a", "p1:b", "p2:a"]);
    const s1 = session(releaseItems(s0, content, pending)?.state?.result);
    expect(parseAquaResult(s1.state.result).items).toHaveLength(3);
    expect(pendingItems(s1, answers, content)).toEqual([]);
    expect(releaseItems(s1, content, pending)).toBeNull();
    const s2 = session(hideItem(s1, content, "p1:b")?.state?.result);
    expect(parseAquaResult(s2.state.result).items.map((i) => itemKey(i.pid, i.id))).toEqual(["p1:a", "p2:a"]);
    expect(pendingItems(s2, answers, content)).toEqual([]);
  });

  it("с одного телефона — не больше, чем разрешено в игре", () => {
    const many = Array.from({ length: 12 }, (_, i) => fish(`f${i}`));
    expect(pendingItems(session(), [answer("p1", many)], { ...content, perGuest: 3 })).toHaveLength(3);
  });

  it("на сцене не больше 40: самые старые уходят и не вернутся", () => {
    const s0 = session();
    const add = Array.from({ length: SCENE_CAP + 5 }, (_, i) => ({ ...fish(`f${i}`), pid: `p${i}`, scene: "aqua" as const }));
    const r = parseAquaResult(releaseItems(s0, content, add)?.state?.result);
    expect(r.items).toHaveLength(SCENE_CAP);
    expect(r.items[0]?.id).toBe("f5");
    expect(r.gone).toContain("p0:f0");
  });

  it("сцена, корм и гирлянда — с пульта", () => {
    const s = session(parseAquaResult({}, content));
    expect(parseAquaResult(setScene(s, content, "tree")?.state?.result).scene).toBe("tree");
    expect(setScene(s, content, "aqua")).toBeNull();
    expect(parseAquaResult(feedFish(s, content).state?.result).feed).toBe(1);
    const g1 = session(nextGarland(s, content).state?.result);
    const g2 = session(nextGarland(g1, content).state?.result);
    expect(parseAquaResult(nextGarland(g2, content).state?.result).garland).toBe(0);
  });
});

describe("«Аквариум и Ёлка»: учёт рисунков без повторов (QA 23 октября 2026)", () => {
  const many = { ...content, perGuest: 10 };
  const crowd = (guests: number, per: number): Answer[] =>
    Array.from({ length: guests }, (_, g) => answer(`p${g}`, Array.from({ length: per }, (_, i) => fish(`i${i}`)), g));

  it("70 гостей × 10 рисунков: каждый на экране ровно один раз, ушедшие со сцены не возвращаются", () => {
    const answers = crowd(70, 10);
    let s = session();
    const shown = new Map<string, number>();
    for (let round = 0; round < 50; round++) {
      const pending = pendingItems(s, answers, many);
      if (pending.length === 0) break;
      for (const i of pending) shown.set(itemKey(i.pid, i.id), (shown.get(itemKey(i.pid, i.id)) ?? 0) + 1);
      const change = releaseItems(s, many, pending);
      if (!change) break;
      s = applyChange(s, change, 1_000_000);
    }
    expect(shown.size).toBe(700);
    expect([...shown.values()].every((n) => n === 1)).toBe(true);
    const r = parseAquaResult(s.state.result);
    expect(r.items).toHaveLength(SCENE_CAP);
    expect(r.gone).toEqual([]);
    expect(Object.values(r.seen).every((n) => n === 10)).toBe(true);
    expect(r.skip).toEqual({});
  });

  it("рисунки приходят по одному: учёт не растёт, повторов нет", () => {
    let s = session();
    const lists = new Map<string, unknown[]>();
    let shownTimes = 0;
    for (let k = 0; k < 10; k++)
      for (let g = 0; g < 70; g++) {
        const list = [...(lists.get(`p${g}`) ?? []), fish(`i${k}`)];
        lists.set(`p${g}`, list);
        const answers = [...lists.entries()].map(([pid, items], i) => answer(pid, items, i));
        const pending = pendingItems(s, answers, many);
        shownTimes += pending.length;
        const change = releaseItems(s, many, pending);
        if (change) s = applyChange(s, change, 1_000_000);
      }
    expect(shownTimes).toBe(700);
    expect(JSON.stringify(s.state.result).length).toBeLessThan(20000);
  });

  it("ведущий выпускает не по порядку и скрывает: разобранные не возвращаются, номера сворачиваются", () => {
    const answers = [answer("p1", [fish("a"), fish("b"), fish("c")])];
    const s0 = session();
    const [a, b, c] = pendingItems(s0, answers, content);
    const s1 = applyChange(s0, releaseItems(s0, content, [c!])!, 1_000_000);
    expect(parseAquaResult(s1.state.result).skip).toEqual({ p1: [2] });
    expect(pendingItems(s1, answers, content).map((i) => i.id)).toEqual(["a", "b"]);
    const s2 = applyChange(s1, hideItem(s1, content, a!)!, 1_000_000);
    expect(hideItem(s2, content, a!)).toBeNull();
    const s3 = applyChange(s2, releaseItems(s2, content, [b!])!, 1_000_000);
    const r = parseAquaResult(s3.state.result);
    expect(r.seen).toEqual({ p1: 3 });
    expect(r.skip).toEqual({});
    expect(pendingItems(s3, answers, content)).toEqual([]);
    // «Убрать» с экрана — рисунок уходит и не возвращается.
    const s4 = applyChange(s3, hideItem(s3, content, c!)!, 1_000_000);
    expect(parseAquaResult(s4.state.result).items.map((i) => i.id)).toEqual(["b"]);
    expect(pendingItems(s4, answers, content)).toEqual([]);
  });

  it("старая сессия с `gone` и рисунками без номера читается: убранные не возвращаются", () => {
    const old = session({ items: [{ ...fish("a"), pid: "p1" }], gone: ["p1:b"] });
    const answers = [answer("p1", [fish("a"), fish("b"), fish("c")])];
    expect(pendingItems(old, answers, content).map((i) => i.id)).toEqual(["c"]);
    const r = parseAquaResult({ seen: { p1: 2, "": 3, p2: -1, p3: "x" }, skip: { p1: [1, 4, 4, "x"], p2: [0] } });
    expect(r.seen).toEqual({ p1: 2 });
    expect(r.skip).toEqual({ p1: [4], p2: [0] });
  });
});
