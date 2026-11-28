import { describe, expect, it } from "vitest";
import type { Participant } from "../data/types";
import {
  AUTO_TEAM_NAMES,
  autoTeamNames,
  formationRevision,
  newFormation,
  parseTeamFormation,
  pickCaptain,
  planAutoAssign,
  planDistribution,
  plural,
  startBlockers,
  publicFormation,
  settingsError,
  shuffled,
  teamNameKey,
  unwillingCaptains,
} from "./teamFormation";

/** Предсказуемый «случай»: всегда первый вариант. */
const first = () => 0;
/** Псевдослучайный, но повторяемый. */
function seeded(seed: number) {
  let s = seed;
  return (max: number) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s % max;
  };
}

describe("командное лобби: настройки", () => {
  it("число команд 1–20, вместимость 2–10, мест не больше 100 (решение владельца)", () => {
    expect(settingsError(6, 10)).toBeNull();
    expect(settingsError(10, 10)).toBeNull();
    expect(settingsError(20, 5)).toBeNull();
    expect(settingsError(20, 10)).toBe("capacity-limit");
    expect(settingsError(11, 10)).toBe("capacity-limit");
    expect(settingsError(0, 5)).toBe("invalid-argument");
    expect(settingsError(21, 2)).toBe("invalid-argument");
    expect(settingsError(6, 1)).toBe("invalid-argument");
    expect(settingsError(6, 11)).toBe("invalid-argument");
    expect(settingsError(2.5, 4)).toBe("invalid-argument");
    expect(settingsError("6", 4)).toBe("invalid-argument");
  });

  it("новые настройки: по умолчанию 6 команд по 10; «Случайные капитаны» в первой версии нет", () => {
    expect(newFormation({ mode: "self" })).toEqual({ mode: "self", teamCount: 6, maxMembers: 10, revision: 1, distributed: false, excluded: [] });
    expect(newFormation({ mode: "randomTeams", teamCount: 5, maxMembers: 4 })).toMatchObject({ mode: "randomTeams", teamCount: 5, maxMembers: 4 });
    expect(newFormation({ mode: "randomCaptains" })).toBeNull();
    expect(newFormation({ mode: "self", teamCount: 20, maxMembers: 10 })).toBeNull();
    expect(newFormation("self")).toBeNull();
  });

  it("старая сессия и мусор — прежнее лобби без ошибок; неверные числа не роняют разбор", () => {
    expect(parseTeamFormation(null)).toBeNull();
    expect(parseTeamFormation({ mode: "legacy" })).toBeNull();
    expect(parseTeamFormation({ mode: "randomCaptains", teamCount: 3 })).toBeNull();
    expect(parseTeamFormation({ mode: "self", teamCount: "x", revision: -1, excluded: ["a", 5] })).toEqual({
      mode: "self",
      teamCount: 6,
      maxMembers: 10,
      revision: 0,
      distributed: false,
      excluded: ["a"],
    });
  });

  it("revision прежнего лобби после возврата сохраняется", () => {
    expect(formationRevision({ mode: "legacy", revision: 7 })).toBe(7);
    expect(parseTeamFormation({ mode: "legacy", revision: 7 })).toBeNull();
    expect(formationRevision(null)).toBe(0);
    expect(formationRevision({ revision: -2 })).toBe(0);
  });

  it("гостям — без списка исключённых", () => {
    const f = newFormation({ mode: "randomTeams" })!;
    expect(publicFormation({ ...f, excluded: ["p1"] })).not.toHaveProperty("excluded");
  });
});

describe("командное лобби: названия", () => {
  it("одно название без смайлика, регистра и «ё»", () => {
    expect(teamNameKey("🦊 Лисы")).toBe("лисы");
    expect(teamNameKey("ЛИСЫ")).toBe("лисы");
    expect(teamNameKey("  🦊🦊  Лисы  ")).toBe("лисы");
    expect(teamNameKey("Ёжики")).toBe(teamNameKey("ежики"));
    expect(teamNameKey("Лисы 2")).not.toBe(teamNameKey("Лисы"));
  });

  it("готовые названия разные, не «Команда N» и не совпадают с занятыми", () => {
    const names = autoTeamNames(20, ["Лисы"], seeded(3));
    expect(new Set(names.map(teamNameKey)).size).toBe(20);
    expect(names.some((n) => teamNameKey(n) === "лисы")).toBe(false);
    expect(names.every((n) => !/^команда\s*\d/i.test(teamNameKey(n)))).toBe(true);
    // Список кончился — с номером, но без повторов.
    const many = autoTeamNames(AUTO_TEAM_NAMES.length + 3, [], first);
    expect(new Set(many.map(teamNameKey)).size).toBe(AUTO_TEAM_NAMES.length + 3);
  });
});

describe("командное лобби: распределение", () => {
  it("перемешивание — та же колода в другом порядке", () => {
    const deck = Array.from({ length: 30 }, (_, i) => `p${i}`);
    const out = shuffled(deck, seeded(7));
    expect([...out].sort()).toEqual([...deck].sort());
    expect(out).not.toEqual(deck);
  });

  it("30 игроков на 6 команд — по 5; 27 на 6 — размеры отличаются не больше чем на 1", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
    expect(planDistribution(ids(30), 6, seeded(1)).map((t) => t.length)).toEqual([5, 5, 5, 5, 5, 5]);
    const sizes = planDistribution(ids(27), 6, seeded(2)).map((t) => t.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(27);
  });

  it("автодобор: в самые малочисленные, переполненных нет, остаток — списком", () => {
    const plan = planAutoAssign(["a", "b", "c", "d"], [{ id: "t1", size: 3 }, { id: "t2", size: 1 }], 3, first);
    const into = plan.assigned.map(([, t]) => t);
    expect(into.filter((t) => t === "t2").length).toBe(2);
    expect(into.filter((t) => t === "t1").length).toBe(0);
    expect(plan.rest.length).toBe(2);
    expect(planAutoAssign(["a"], [], 3, first)).toEqual({ assigned: [], rest: ["a"] });
  });
});

describe("командное лобби: выбор капитана (ТЗ 6.5)", () => {
  const c = (id: string, joinedAt: number, online: boolean, noCaptain = false) => ({ id, joinedAt, online, noCaptain });

  it("согласные на связи → все на связи → согласные не на связи → все", () => {
    expect(pickCaptain([c("a", 1, true, true), c("b", 2, true)])).toEqual({ id: "b", unwilling: false });
    expect(pickCaptain([c("a", 1, false), c("b", 2, true, true)])).toEqual({ id: "b", unwilling: true });
    expect(pickCaptain([c("a", 1, false, true), c("b", 2, false)])).toEqual({ id: "b", unwilling: false });
    expect(pickCaptain([c("a", 1, false, true)])).toEqual({ id: "a", unwilling: true });
    expect(pickCaptain([])).toBeNull();
  });

  it("без случая — первый по времени входа; со случаем — из своей группы", () => {
    expect(pickCaptain([c("b", 2, true), c("a", 1, true)])?.id).toBe("a");
    const random = pickCaptain([c("a", 1, true, true), c("b", 2, true), c("x", 3, true)], () => 1);
    expect(random?.id).toBe("x");
  });

  it("предупреждение ведущему: капитан команды отметил «Не хочу»", () => {
    const team = (id: string, captainUid: string): Participant => ({ id, name: id, kind: "team", teamId: null, captainUid });
    const phone = (id: string, teamId: string, noCaptain = false): Participant => ({ id, name: id, kind: "player", teamId, captainUid: id, ...(noCaptain ? { noCaptain } : {}) });
    expect(unwillingCaptains([team("t1", "a"), phone("a", "t1", true), team("t2", "b"), phone("b", "t2"), phone("c", "t2", true)])).toEqual(["t1"]);
  });
});

describe("командное лобби: когда можно начать игру (ТЗ 7.3)", () => {
  const formation = { mode: "self" as const, teamCount: 2, maxMembers: 2, revision: 1, distributed: false };
  const team = (id: string, captainUid: string): Participant => ({ id, name: id, kind: "team", teamId: null, captainUid });
  const phone = (id: string, teamId: string | null): Participant => ({ id, name: id, kind: "player", teamId, captainUid: id });

  it("нет команд — нельзя; команда без телефона из таблицы — можно", () => {
    expect(startBlockers(formation, [phone("a", null)], {})).toEqual(["Пока нет ни одной команды."]);
    expect(startBlockers({ ...formation, mode: "randomTeams" }, [], {})).toEqual(["Сначала разделите гостей на команды."]);
    expect(startBlockers(formation, [], { m1: { name: "Ручная", kind: "team", score: 0 } })).toEqual([]);
    // Запись убранной команды (с капитаном, без участника) — не получатель очков.
    expect(startBlockers(formation, [], { gone: { name: "Лисы", kind: "team", score: 0, captainUid: "a" } })).toEqual(["Пока нет ни одной команды."]);
  });

  it("пустая команда, капитан не в команде, переполнение, лишние команды", () => {
    expect(startBlockers(formation, [team("t1", "a")], {})).toEqual(["В команде «t1» никого нет — уберите её."]);
    expect(startBlockers(formation, [team("t1", "x"), phone("a", "t1")], {})).toEqual(["У команды «t1» нет капитана — назначьте его."]);
    expect(startBlockers(formation, [team("t1", "a"), phone("a", "t1"), phone("b", "t1"), phone("c", "t1")], {})).toEqual(["В команде «t1» больше 2 человек."]);
    const three = [team("t1", "a"), phone("a", "t1"), team("t2", "b"), phone("b", "t2"), team("t3", "c"), phone("c", "t3")];
    expect(startBlockers(formation, three, {})).toEqual(["Команд больше, чем разрешено (3 из 2)."]);
  });

  it("люди без команды старт не блокируют", () => {
    expect(startBlockers(formation, [team("t1", "a"), phone("a", "t1"), phone("late", null)], {})).toEqual([]);
  });

  it("склонение", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, "гость", "гостя", "гостей"))).toEqual(["гость", "гостя", "гостей", "гостей", "гость", "гостя", "гостей"]);
  });
});
