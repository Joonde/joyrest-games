import { describe, expect, it } from "vitest";
import type { Answer } from "../data/types";
import { buzzOrder, buzzPhone, buzzRight, buzzWrong, EMPTY_BUZZ, parseBuzz, syncBuzz } from "./buzz";

const press = (pid: string, at: number | null, step = 0): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: { buzz: true }, submittedAt: at });

describe("кнопка «кто первый»", () => {
  it("порядок — по времени сервера, без отметки — в конце, чужой шаг и не нажатия не считаются", () => {
    const answers = [press("b", 200), press("a", 100), press("c", null), press("x", 50, 1), { ...press("y", 10), value: 2 }];
    expect(buzzOrder(answers, 0)).toEqual(["a", "b", "c"]);
  });

  it("слово первому; «Неверно» — следующему, ошибившийся «мимо»; очередь пуста — кнопка снова открыта", () => {
    let b = syncBuzz(EMPTY_BUZZ, ["a", "b"]);
    if (!b) throw new Error("нет состояния");
    expect(b).toMatchObject({ order: ["a", "b"], current: "a" });
    expect(syncBuzz(b, ["a", "b"])).toBeNull();
    b = buzzWrong(b);
    expect(b).toMatchObject({ current: "b", out: ["a"] });
    b = buzzWrong(b);
    expect(b).toMatchObject({ current: null, out: ["a", "b"] });
    // Новое нажатие получает слово, ошибившиеся — нет.
    const c = syncBuzz(b, ["a", "b", "c"]);
    expect(c).toMatchObject({ current: "c", order: ["a", "b", "c"] });
    expect(buzzRight(c ?? b).winner).toBe("c");
  });

  it("позднее пришедшее нажатие не обгоняет записанный порядок; после «Верно» ничего не меняется", () => {
    const b = syncBuzz({ ...EMPTY_BUZZ, order: ["b"], current: "b" }, ["a", "b"]);
    expect(b).toMatchObject({ order: ["b", "a"], current: "b" });
    expect(syncBuzz({ ...EMPTY_BUZZ, order: ["a"], current: "a", winner: "a" }, ["a", "b"])).toBeNull();
  });

  it("телефон: жми, очередь (место среди тех, кто ещё может ответить), ваше слово, мимо, победа", () => {
    const b = { order: ["a", "b", "c"], current: "b", out: ["a"], winner: null };
    expect(buzzPhone(b, "b", true, true).state).toBe("turn");
    expect(buzzPhone(b, "c", true, true)).toEqual({ state: "queued", place: 2 });
    expect(buzzPhone(b, "a", true, true).state).toBe("out");
    expect(buzzPhone(b, "d", false, true).state).toBe("press");
    expect(buzzPhone(b, "d", false, false).state).toBe("closed");
    expect(buzzPhone({ ...b, winner: "b" }, "b", true, false).state).toBe("won");
    expect(buzzPhone({ ...b, winner: "b" }, "c", true, false).state).toBe("lost");
  });

  it("испорченные данные — пустая кнопка", () => {
    expect(parseBuzz(null)).toEqual(EMPTY_BUZZ);
    expect(parseBuzz({ order: ["a", "a", 3, "../x"], current: 5, out: "x" })).toEqual({ order: ["a"], current: null, out: [], winner: null });
  });
});
