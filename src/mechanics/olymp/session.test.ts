import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { createOlymp, parseOlymp, validateOlymp } from "./content";
import { readyAbilities } from "./logic";
import {
  assignGods,
  closePick,
  closeVote,
  fightResult,
  godTurn,
  nextScene,
  nextTurn,
  olympBack,
  olympPrimary,
  openRoll,
  openVote,
  parseOlympResult,
  showRoll,
  startFight,
  startOlymp,
} from "./logic";

const teams = (n: number): Participant[] => Array.from({ length: n }, (_, i) => ({ id: `T${i}`, name: `Команда ${i + 1}`, kind: "team", teamId: null, captainUid: `u${i}`, joinedAt: i }));
const session = (): Session => ({ id: "olymp-s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "olymp", gameSnapshot: null, themeId: "winter", playMode: "teams", screenMode: "laptop", state: { ...startState(), phase: "playing", stage: "ready" }, leaderboard: {}, createdAt: 0 });
let t = 2_000_000;
const apply = (s: Session, c: SessionChange | null) => {
  expect(c, "действие пульта должно быть доступно").not.toBeNull();
  return applyChange(s, c ?? {}, (t += 1000));
};
const ans = (s: Session, pid: string, value: unknown, late = 10): Answer => ({ id: `${s.state.step}_${pid}`, step: s.state.step, pid, uid: `u${pid}`, value, submittedAt: (s.state.startedAt ?? 0) + late });

/** Прогон всей истории: телефоны отвечают как настоящие капитаны, пульт жмёт главную кнопку. */
function play(n: number, seed: number, difficulty: "easy" | "normal" | "hard" = "normal") {
  const content = { ...createOlymp(), difficulty };
  const parts = teams(n);
  let s = session();
  let rnd = seed;
  const next = () => {
    rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0;
    return rnd;
  };
  const seen: string[] = [];
  for (let i = 0; i < 2000; i++) {
    const action = olympPrimary(s, content);
    const r = parseOlympResult(s.state.result);
    seen.push(action);
    if (action === "finish" || action === "podium") return { s, r, seen };
    if (action === "start") s = apply(s, startOlymp(s, parts));
    else if (action === "pickDone") s = apply(s, closePick(s, content, parts.map((p, k) => ans(s, p.id, { god: ["zeus", "athena", "hestia", "hades", "zeus"][k % 5] }, k + 1)), parts));
    else if (action === "next") s = apply(s, nextScene(s, content, parts));
    else if (action === "roll") s = apply(s, openRoll(s, parts));
    else if (action === "showRoll") {
      const who = r.check?.who as string;
      s = apply(s, showRoll(s, content, next() % 3 === 0 ? [] : [ans(s, who, { roll: true }, next() % 900)], parts));
    } else if (action === "openVote") s = apply(s, openVote(s, content, parts));
    else if (action === "closeVote") s = apply(s, closeVote(s, content, parts.map((p) => ans(s, p.id, { vote: next() % (r.vote?.options.length ?? 1) }, next() % 500)), parts));
    else if (action === "fight") s = apply(s, startFight(s, content, parts));
    else if (action === "act") {
      const b = r.battle;
      const actor = b?.actor as string;
      const ready = b ? readyAbilities(b, actor) : [];
      const ab = ready.find((a) => a.ult) ?? ready[next() % ready.length];
      if (next() % 4 === 0) s = apply(s, godTurn(s, parts, [], { ability: ab?.id ?? "", target: null }));
      else s = apply(s, godTurn(s, parts, [ans(s, actor, { ability: ab?.id, target: parts[next() % n]?.id ?? null }, 5)]));
    } else if (action === "nextTurn") s = apply(s, nextTurn(s, parts));
    else if (action === "fightResult") s = apply(s, fightResult(s, parts));
    else throw new Error(`Неизвестное действие ${action}`);
    // инварианты после каждого шага
    const after = parseOlympResult(s.state.result);
    for (const p of after.phase === "pick" ? [] : after.order) {
      const m = after.party[p];
      expect(m, "у каждой команды есть бог").toBeTruthy();
      expect(m?.hp ?? 0).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(m?.coins)).toBe(true);
      expect(m?.coins ?? 0).toBeGreaterThanOrEqual(0);
      expect(s.leaderboard[p]?.score ?? 0, "очки = опыт").toBe(m?.xp ?? 0);
    }
    expect(JSON.stringify(s.state.result).length, "состояние помещается в запись пульта").toBeLessThan(110_000);
  }
  throw new Error("История не дошла до конца");
}

describe("Олимп на сессии", () => {
  it("содержимое: по умолчанию «Вечная зима», без ошибок", () => {
    expect(validateOlymp(createOlymp())).toEqual([]);
    expect(parseOlymp({ difficulty: "x", voteSeconds: 9999 })).toEqual({ story: "winter", difficulty: "normal", voteSeconds: 300 });
  });

  it("боги: раньше выбравший получает бога, занятого — первый свободный, без ответа — тоже", () => {
    const answers: Answer[] = [
      { id: "1", step: 1, pid: "B", uid: "b", value: { god: "zeus" }, submittedAt: 5 },
      { id: "2", step: 1, pid: "A", uid: "a", value: { god: "zeus" }, submittedAt: 9 },
    ];
    const g = assignGods(["A", "B", "C"], answers, 1, 0);
    expect(g.B).toBe("zeus");
    expect(g.A).not.toBe("zeus");
    expect(new Set(Object.values(g)).size).toBe(3);
  });

  it("история проходится до концовки при 1–10 командах, опыт = очки, драхмы целые", () => {
    const endings = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const n = 1 + (seed % 10);
      const { r, seen } = play(n, seed, (["easy", "normal", "hard"] as const)[seed % 3]);
      expect(r.phase).toBe("end");
      endings.add(r.scene);
      expect(seen).toContain("fight");
      expect(r.log.length).toBeGreaterThan(5);
    }
    // разные пути и концовки встречаются
    expect(endings.size).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("«Назад» отменяет одно действие вместе с опытом", () => {
    const content = createOlymp();
    const parts = teams(3);
    let s = session();
    s = apply(s, startOlymp(s, parts));
    s = apply(s, closePick(s, content, [], parts));
    s = apply(s, nextScene(s, content, parts)); // пролог → совет (проверка)
    s = apply(s, openRoll(s, parts));
    const before = { ...s.leaderboard };
    s = apply(s, showRoll(s, content, [], parts));
    const r = parseOlympResult(s.state.result);
    expect(r.check?.outcome).toBeTruthy();
    const back = olympBack(s);
    s = apply(s, back);
    const r2 = parseOlympResult(s.state.result);
    expect(r2.check?.outcome).toBeNull();
    for (const p of r2.order) expect(s.leaderboard[p]?.score ?? 0).toBe(before[p]?.score ?? 0);
    expect(s.state.stage).toBe("question");
  });

  it("ход бога: способность с телефона капитана, неготовая — отказ", () => {
    const content = createOlymp();
    const parts = teams(2);
    let s = session();
    s = apply(s, startOlymp(s, parts));
    s = apply(s, closePick(s, content, [], parts));
    // дойти до первого боя
    for (let i = 0; i < 40 && olympPrimary(s, content) !== "fight"; i++) {
      const a = olympPrimary(s, content);
      if (a === "next") s = apply(s, nextScene(s, content, parts));
      else if (a === "roll") s = apply(s, openRoll(s, parts));
      else if (a === "showRoll") s = apply(s, showRoll(s, content, [], parts));
      else if (a === "openVote") s = apply(s, openVote(s, content, parts));
      else if (a === "closeVote") {
        // все за Аркадию (бой с волками)
        s = apply(s, closeVote(s, content, parts.map((p) => ans(s, p.id, { vote: 1 })), parts));
      }
    }
    expect(olympPrimary(s, content)).toBe("fight");
    s = apply(s, startFight(s, content, parts));
    for (let i = 0; i < 10 && olympPrimary(s, content) === "nextTurn"; i++) s = apply(s, nextTurn(s, parts));
    expect(olympPrimary(s, content)).toBe("act");
    const r = parseOlympResult(s.state.result);
    const actor = r.battle?.actor as string;
    expect(godTurn(s, parts, [ans(s, actor, { ability: "нет-такой", target: null })])).toBeNull();
    const ok = readyAbilities(r.battle!, actor)[0];
    s = apply(s, godTurn(s, parts, [ans(s, actor, { ability: ok?.id, target: null })]));
    expect(parseOlympResult(s.state.result).lastDie?.ability).toBe(ok?.name);
  });
});
