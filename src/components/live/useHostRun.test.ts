import { describe, expect, it } from "vitest";
import { applyChange, meetsExpect, startState } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";
import { runHostChange, type HostMake, type HostRunDeps, type HostRunOptions } from "./useHostRun";

const base: Session = {
  id: "s",
  code: "123456",
  hostId: "h",
  gameId: "g",
  gameTitle: "",
  mechanic: "stage",
  gameSnapshot: null,
  themeId: "joyrest",
  playMode: "teams",
  screenMode: "laptop",
  state: { ...startState(), stage: "question", result: { mode: "perform", gifts: [] } },
  leaderboard: { a: { name: "Команда А", kind: "team", score: 0 } },
  createdAt: 0,
};

/** Сервер в памяти: `expect` как на настоящем, «фон пульта» может записать итоги шага между касанием и записью. */
function harness(options: { onFirstApply?: (s: Session) => Session; error?: unknown } = {}) {
  let server = base;
  const seen = base;
  const applied: SessionChange[] = [];
  const cleared: number[] = [];
  let first = true;
  const deps: HostRunDeps = {
    seen,
    current: () => server,
    nextSession: () => Promise.resolve(),
    apply: async (change) => {
      if (first && options.onFirstApply) server = options.onFirstApply(server);
      first = false;
      if (options.error) throw options.error;
      if (!meetsExpect(server.state, change.expect)) throw Object.assign(new Error("changed"), { code: "failed-precondition" });
      applied.push(change);
      server = applyChange(server, change, 0);
    },
    clearAnswers: async (step) => {
      cleared.push(step);
    },
    rehearsal: false,
  };
  return { deps, applied, cleared, server: () => server, setServer: (s: Session) => (server = s) };
}

const gift = (s: Session): Session => ({ ...s, state: { ...s.state, result: { mode: "perform", gifts: ["b"] } } });
const done = (s: Session): SessionChange => ({ state: { result: { ...(s.state.result as object), mode: "result" } }, addScore: { a: 10 } });

function run(make: HostMake, h: ReturnType<typeof harness>, options: HostRunOptions = {}) {
  return runHostChange(make, options, h.deps);
}

describe("запись пульта (runHostChange)", () => {
  it("обычное касание: запись с отпечатком итогов шага", async () => {
    const h = harness();
    expect(await run(done, h)).toBe("done");
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]?.expect?.stage).toBe("question");
    expect(typeof h.applied[0]?.expect?.result).toBe("string");
    expect(h.server().leaderboard.a?.score).toBe(10);
  });

  it("фон записал итоги шага — запись собирается заново по свежей сессии и проходит со второго раза", async () => {
    const h = harness({ onFirstApply: gift });
    const bases: Session[] = [];
    const outcome = await run((s) => {
      bases.push(s);
      return done(s);
    }, h);
    expect(outcome).toBe("done");
    expect(bases).toHaveLength(2);
    // Подарок, пришедший с фона, не затёрт: повтор собран по свежим итогам.
    expect(h.server().state.result).toEqual({ mode: "result", gifts: ["b"] });
    expect(h.server().leaderboard.a?.score).toBe(10);
  });

  it("готовую запись заново не собрать — «Игра изменилась — нажмите ещё раз»", async () => {
    const h = harness({ onFirstApply: gift });
    expect(await run(done(base), h)).toBe("conflict");
    expect(h.applied).toHaveLength(0);
  });

  it("retry: false — без повтора", async () => {
    const h = harness({ onFirstApply: gift });
    expect(await run((s) => done(s), h, { retry: false })).toBe("conflict");
    expect(h.applied).toHaveLength(0);
  });

  it("момент игры другой (второй пульт уже засчитал) — не повторяем", async () => {
    const h = harness({ onFirstApply: (s) => ({ ...s, state: { ...s.state, result: { mode: "result", gifts: [] } } }) });
    h.deps.moment = (s) => String((s.state.result as { mode?: string } | null)?.mode);
    expect(await run((s) => done(s), h)).toBe("conflict");
    expect(h.applied).toHaveLength(0);
  });

  it("игра ушла дальше (шаг или этап) — молча, как раньше", async () => {
    const h = harness({ onFirstApply: (s) => ({ ...s, state: { ...s.state, step: 1, stage: "ready" } }) });
    expect(await run((s) => done(s), h)).toBe("moved");
    expect(h.applied).toHaveLength(0);
  });

  it("действие недоступно и пустая запись — ничего не отправляем", async () => {
    const h = harness();
    expect(await run(null, h)).toBe("none");
    expect(await run(() => ({}), h)).toBe("empty");
    expect(h.applied).toHaveLength(0);
  });

  it("сбой связи — ошибка наружу", async () => {
    const h = harness({ error: Object.assign(new Error("net"), { code: "unavailable" }) });
    const outcome = await run((s) => done(s), h);
    expect(typeof outcome).toBe("object");
  });

  it("«Назад» с очисткой ответов: итоги изменились до записи — ответы не стираются, повтор по свежей сессии", async () => {
    const h = harness();
    const bases: Session[] = [];
    let calls = 0;
    const outcome = await run(
      (s) => {
        bases.push(s);
        calls++;
        // Пока собиралась первая запись, фон записал подарок.
        if (calls === 1) h.setServer(gift(h.server()));
        return { state: { step: 1, stage: "ready", result: null } };
      },
      h,
      { clear: [0] },
    );
    expect(outcome).toBe("done");
    expect(calls).toBe(2);
    expect(h.cleared).toEqual([0]);
  });
  it("attempts: безопасное действие повторяется, пока фон пишет итоги шага (кнопки телефонов)", async () => {
    const h = harness();
    let applies = 0;
    const apply = h.deps.apply;
    // Первые две записи перебивает фон (очередь «кто первый»).
    h.deps.apply = async (change) => {
      if (applies++ < 2) h.setServer({ ...h.server(), state: { ...h.server().state, result: { mode: "perform", gifts: [`g${applies}`] } } });
      return apply(change);
    };
    expect(await run((s) => done(s), h)).toBe("conflict");
    applies = 0;
    h.setServer(base);
    expect(await run((s) => done(s), h, { attempts: 4 })).toBe("done");
    expect(h.applied).toHaveLength(1);
  });

  it("свой момент касания: общий момент изменился, а для этого действия — нет — повтор проходит", async () => {
    const h = harness({ onFirstApply: (s) => ({ ...s, state: { ...s.state, result: { mode: "other", gifts: [] } } }) });
    h.deps.moment = (s) => String((s.state.result as { mode?: string } | null)?.mode);
    expect(await run((s) => ({ state: { result: { ...(s.state.result as object), extra: 1 } } }), h, { moment: () => "тот же" })).toBe("done");
  });

  it("settle: фон уже увёл игру дальше (телефон бросил кубик) — молча, без записи", async () => {
    const h = harness();
    h.deps.settle = async () => {
      h.setServer({ ...h.server(), state: { ...h.server().state, stage: "reveal", revealed: true } });
    };
    expect(await run((s) => done(s), h)).toBe("moved");
    expect(h.applied).toHaveLength(0);
  });

  it("settle: фон записал итоги без смены этапа — запись собирается по свежей сессии с первого раза", async () => {
    const h = harness();
    h.deps.settle = async () => {
      h.setServer(gift(h.server()));
    };
    const bases: Session[] = [];
    expect(
      await run((s) => {
        bases.push(s);
        return done(s);
      }, h),
    ).toBe("done");
    expect(bases).toHaveLength(1);
    expect(h.server().state.result).toEqual({ mode: "result", gifts: ["b"] });
  });
});
