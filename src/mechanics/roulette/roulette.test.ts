import { describe, expect, it } from "vitest";
import { applyChange, resultKey, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { categoryOf } from "../categories";
import { HIDDEN_MECHANICS } from "../hidden";
import { allDemoGames, demoGames, getMechanic, selectableMechanics } from "../registry";
import { catalogThemes, createRoulette, mediaIds, parseRoulette, trackIds } from "./content";
import { DEMO_ROULETTE, DEMO_ROULETTE_RAW } from "./demo";
import { backToThemes, effectiveChoices, hostChoose, hostSetAdded, openThemes, parseRouletteResult, parseThemesAnswer, planWheel, queueWithLate, rouletteAction, syncThemes, themesNeeded } from "./logic";
import { validateRoulette } from "./validate";

const team = (id: string, i: number): Participant => ({ id, name: "Команда " + id, kind: "team", teamId: null, captainUid: "u" + id, joinedAt: i + 1 });
const ans = (pid: string, value: unknown, at: number, step = 0): Answer => ({ id: step + "_" + pid, step, pid, uid: "u" + pid, value, submittedAt: at });

function session(): Session {
  return { id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "Р", mechanic: "roulette", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: { ...startState(), phase: "playing" }, leaderboard: {}, createdAt: 0 } as Session;
}

/** Сессия на выборе тем с командами. */
function onThemes(teams: Participant[]): Session {
  return applyChange(session(), openThemes(session(), teams), 1000);
}

describe("рулетка: модель (п. 6–8)", () => {
  it("мусор не ломает разбор, значения по умолчанию", () => {
    for (const raw of [null, 1, "x", [], { themes: "x", weights: null }]) expect(parseRoulette(raw)).toEqual(createRoulette());
  });

  it("старые указатели прототипа заменяются; повторы id становятся уникальными", () => {
    expect(parseRoulette({ pointer: "cupid" }).pointer).toBe("dagger");
    expect(parseRoulette({ pointer: "zeus" }).pointer).toBe("trident");
    expect(parseRoulette({ pointer: "target" }).pointer).toBe("key");
    expect(parseRoulette({ pointer: "что-то" }).pointer).toBe("arrow");
    const c = parseRoulette({ themes: [{ id: "a", tasks: [{ id: "x" }, { id: "x" }] }, { id: "a", tasks: [{ id: "x" }] }] });
    expect(new Set(c.themes.map((t) => t.id)).size).toBe(2);
    expect(new Set(c.themes.flatMap((t) => t.tasks.map((x) => x.id))).size).toBe(3);
  });

  it("смена типа не стирает поля другого типа; 0 секунд — без таймера; очки по редкости, если не заданы", () => {
    const c = parseRoulette({ rarityPoints: { common: 10, rare: 20, legendary: 30 }, themes: [{ id: "a", tasks: [{ id: "x", kind: "task", rarity: "rare", options: ["1", "2"], correct: [1], seconds: 0 }] }] });
    const task = c.themes[0]!.tasks[0]!;
    expect(task.options).toEqual(["1", "2"]);
    expect(task.correct).toEqual([1]);
    expect(task.seconds).toBe(0);
    expect(task.points).toBe(20);
    expect(parseRoulette({ themes: [{ tasks: [{ seconds: 2 }] }] }).themes[0]!.tasks[0]!.seconds).toBe(5);
  });

  it("правильные варианты — только в пределах вариантов; число и текст чистятся", () => {
    const t = parseRoulette({ themes: [{ tasks: [{ options: ["a", "b"], correct: [5, 1, 1, -1, 0.5], numberAnswer: 1.23456, title: "  Привет\u0007  мир ", text: "строка 1\r\n\r\n\r\nстрока 2" }] }] }).themes[0]!.tasks[0]!;
    expect(t.correct).toEqual([1]);
    expect(t.numberAnswer).toBe(1.235);
    expect(t.title).toBe("Привет мир");
    expect(t.text).toBe("строка 1\n\nстрока 2");
  });

  it("картинки и треки — только id медиатеки", () => {
    const c = parseRoulette({ themes: [{ tasks: [{ imageId: "img1", pictures: [{ imageId: "p1" }, { imageId: "blob:x" }], clip: { trackId: "tr1" }, answerMusic: { trackId: "tr2" } }] }] });
    expect(mediaIds(c)).toEqual(["img1", "p1"]);
    expect(trackIds(c)).toEqual(["tr1", "tr2"]);
  });

  it("шаблон проходит проверку с режимом 18+ и без; тема «18+» без режима скрыта (Р-4, Р-27)", () => {
    expect(validateRoulette(DEMO_ROULETTE)).toEqual([]);
    expect(validateRoulette({ ...DEMO_ROULETTE, adult: true })).toEqual([]);
    expect(catalogThemes(DEMO_ROULETTE).some((t) => t.id === "adult")).toBe(false);
    expect(catalogThemes({ ...DEMO_ROULETTE, adult: true }).some((t) => t.id === "adult")).toBe(true);
    expect(DEMO_ROULETTE.themes).toHaveLength(12);
    const kinds = new Set(DEMO_ROULETTE.themes.flatMap((t) => t.tasks.map((x) => x.kind)));
    expect([...kinds].sort()).toEqual(["battle", "bonus", "buzz", "choice", "dance", "karaoke", "number", "open", "order", "speed", "task"]);
  });
});

describe("рулетка: проверка перед запуском (п. 7)", () => {
  const one = (task: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const ok = (id: string) => ({ id, name: id, tasks: [{ id: id + "1", title: "Т", text: "Т" }] });
    return validateRoulette(parseRoulette({ themes: [ok("a"), ok("b"), { id: "c", name: "c", tasks: [{ id: "c1", title: "Т", text: "Т" }, { id: "x", title: "Т", text: "Т", ...task }] }], ...extra }));
  };
  const paths = (errors: Array<{ path: string }>) => errors.map((e) => e.path);

  it("пустая игра: нужно 3 темы", () => {
    expect(paths(validateRoulette(createRoulette()))).toEqual(["themes"]);
  });
  it("сумма шансов не 100 и больше 15 тем", () => {
    expect(paths(one({}, { weights: { common: 50, rare: 30, legendary: 10 } }))).toEqual(["rarity/weights"]);
    const many = Array.from({ length: 16 }, (_, i) => ({ id: "t" + i, name: "Т" + i, tasks: [{ title: "Т", text: "Т" }] }));
    expect(paths(validateRoulette(parseRoulette({ themes: many })))).toEqual(["themes"]);
  });
  it("18+ без режима не считается; выключенное задание не мешает", () => {
    const ok = (id: string) => ({ id, name: id, tasks: [{ title: "Т", text: "Т" }] });
    const c = parseRoulette({ themes: [ok("a"), ok("b"), { id: "c", name: "c", tasks: [{ title: "Т", text: "Т", adult: true }] }] });
    expect(paths(validateRoulette(c))).toEqual(["themes"]);
    expect(validateRoulette({ ...c, adult: true })).toEqual([]);
    expect(one({ active: false, title: "" })).toEqual([]);
  });
  it("поля по типу задания", () => {
    expect(paths(one({ title: "" }))).toEqual(["themes/c/tasks/x/title"]);
    expect(paths(one({ alcohol: true }))).toEqual(["themes/c/tasks/x/alt"]);
    expect(one({ alcohol: true, alt: "Сок" })).toEqual([]);
    expect(paths(one({ sport: true }))).toEqual(["themes/c/tasks/x/alt"]);
    expect(paths(one({ kind: "choice", options: ["a", "b"] }))).toEqual(["themes/c/tasks/x/correct"]);
    expect(paths(one({ kind: "choice", options: ["a"], correct: [0] }))).toEqual(["themes/c/tasks/x/options"]);
    expect(paths(one({ kind: "speed", options: ["a", ""], correct: [0] }))).toEqual(["themes/c/tasks/x/options"]);
    expect(paths(one({ kind: "order", options: ["a", "b"] }))).toEqual(["themes/c/tasks/x/options"]);
    expect(paths(one({ kind: "open" }))).toEqual(["themes/c/tasks/x/answers"]);
    expect(paths(one({ kind: "number" }))).toEqual(["themes/c/tasks/x/numberAnswer"]);
    expect(one({ kind: "number", numberAnswer: 0 })).toEqual([]);
    expect(paths(one({ kind: "pictures", pictures: [{ imageId: "i1", answers: ["a"] }] }))).toEqual(["themes/c/tasks/x/pictures"]);
    expect(paths(one({ kind: "pictures", pictures: [{ imageId: "i1", answers: ["a"] }, { answers: [] }] }))).toEqual(["themes/c/tasks/x/pictures/1/image", "themes/c/tasks/x/pictures/1/answers"]);
    expect(paths(one({ kind: "bonus", effect: "doubleNext" }))).toEqual(["themes/c/tasks/x/effect"]);
    expect(one({ kind: "bonus", effect: "extraSpin" })).toEqual([]);
    expect(paths(one({ video: { source: "link", url: "https://example.com/x" } }))).toEqual(["themes/c/tasks/x/video"]);
    expect(one({ video: { source: "link", url: "https://youtu.be/dQw4w9WgXcQ" } })).toEqual([]);
    expect(paths(one({ clip: { trackId: "t1", length: 5, fadeIn: 5, fadeOut: 3 } }))).toEqual(["themes/c/tasks/x/clip"]);
  });
});

describe("рулетка: выбор тем (п. 3.1)", () => {
  const teams = ["a", "b", "c"].map(team);
  const content = DEMO_ROULETTE; // по 2 темы на команду

  it("«Открыть выбор тем»: шаг 0, приём без таймера, ответ можно менять; команды в таблице", () => {
    expect(rouletteAction(session())).toBe("openThemes");
    const s = onThemes(teams);
    expect(s.state).toMatchObject({ step: 0, stage: "question", timeLimit: null, startedAt: 1000 });
    expect(parseRouletteResult(s.state.result)).toMatchObject({ mode: "themes", changeable: true });
    expect(Object.keys(s.leaderboard)).toEqual(["a", "b", "c"]);
    expect(rouletteAction(s)).toBe("toWheel");
    expect(openThemes(session(), teams).expect).toEqual({ phase: "playing", step: 0, stage: "ready" });
  });

  it("ответ капитана: только темы каталога, без повторов, не больше разрешённого (Р-5)", () => {
    expect(themesNeeded(content)).toBe(2);
    expect(parseThemesAnswer({ themes: ["music", "music", "adult", "нет", "dance", "cinema"], confirmed: true }, content)).toEqual({ themes: ["music", "dance"], confirmed: true });
    expect(parseThemesAnswer({ choice: 1 }, content)).toBeNull();
    expect(themesNeeded({ ...content, themesPerTeam: 1 })).toBe(1);
  });

  it("выбор считается только подтверждённым и с нужным числом тем; «Изменить» снимает готовность", () => {
    const r = parseRouletteResult(onThemes(teams).state.result);
    const notReady = { a: { themes: [], by: "captain", at: 10 } };
    expect(effectiveChoices(content, r, [ans("a", { themes: ["music"], confirmed: true }, 10)])).toEqual(notReady);
    expect(effectiveChoices(content, r, [ans("a", { themes: ["music", "dance"], confirmed: false }, 10)])).toEqual(notReady);
    const ready = effectiveChoices(content, r, [ans("a", { themes: ["dance", "music"], confirmed: true }, 10)]);
    expect(ready).toEqual({ a: { themes: ["music", "dance"], by: "captain", at: 10 } });
    const withChoice = { ...r, choices: ready };
    expect(effectiveChoices(content, withChoice, [ans("a", { themes: ["music", "dance"], confirmed: false }, 20)])).toEqual({ a: { themes: [], by: "captain", at: 20 } });
  });

  it("ведущий выбирает за команду; более поздний ответ капитана заменяет выбор ведущего, более ранний — нет (Р-6)", () => {
    let s = onThemes(teams);
    const early = [ans("a", { themes: ["music", "dance"], confirmed: false }, 50)];
    s = applyChange(s, hostChoose(s, content, teams, early, "a", ["cinema", "karaoke"])!, 1100);
    const r = parseRouletteResult(s.state.result);
    expect(r.choices.a).toEqual({ themes: ["cinema", "karaoke"], by: "host", at: 50 });
    expect(s.state.answered).toBe(1);
    // Тот же старый ответ капитана выбор ведущего не трогает.
    expect(effectiveChoices(content, r, early).a?.by).toBe("host");
    // Капитан ответил после — его выбор.
    expect(effectiveChoices(content, r, [ans("a", { themes: ["music", "dance"], confirmed: true }, 60)]).a).toEqual({ themes: ["music", "dance"], by: "captain", at: 60 });
    // Снять выбор.
    s = applyChange(s, hostChoose(s, content, teams, early, "a", [])!, 1200);
    expect(parseRouletteResult(s.state.result).choices).toEqual({ a: { themes: [], by: "host", at: 50 } });
    expect(s.state.answered).toBe(0);
  });

  it("пульт переносит выбор в сессию один раз и с отпечатком итогов (второй пульт не затрёт)", () => {
    let s = onThemes(teams);
    const answers = [ans("a", { themes: ["music", "dance"], confirmed: true }, 10)];
    const change = syncThemes(s, content, teams, answers)!;
    expect(change.expect).toEqual({ phase: "playing", step: 0, stage: "question", result: resultKey(s.state.result) });
    s = applyChange(s, change, 1100);
    expect(s.state.answered).toBe(1);
    expect(syncThemes(s, content, teams, answers)).toBeNull();
  });

  it("«К колесу»: 2–8 команд, у всех выбор, в колесе ≥ 3 темы; секторы — в порядке каталога без повторов (Р-7, Р-9)", () => {
    const s = onThemes(teams);
    const partial = [ans("a", { themes: ["music", "dance"], confirmed: true }, 10), ans("b", { themes: ["dance", "music"], confirmed: true }, 11)];
    const no = planWheel(s, content, teams, partial);
    expect(no.ok).toBe(false);
    const all = [...partial, ans("c", { themes: ["music", "dance"], confirmed: true }, 12)];
    const few = planWheel(s, content, teams, all);
    expect(few.ok).toBe(false);
    if (!few.ok) expect(few.problems.join(" ")).toContain("2 из 3");
    const fresh = [...partial, ans("c", { themes: ["questions", "cinema"], confirmed: true }, 12)];
    const plan = planWheel(s, content, teams, fresh);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Сверка ответов и отпечаток итогов: выбор ведущего со второго пульта — не ответ, его ловит отпечаток.
    expect(plan.change.expect).toEqual({ phase: "playing", step: 0, stage: "question", result: resultKey(s.state.result), answers: { step: 0, count: 3, last: 12, sum: 33 } });
    const next = applyChange(s, plan.change, 2000);
    const r = parseRouletteResult(next.state.result);
    expect(next.state).toMatchObject({ step: 1, stage: "question", startedAt: 2000, timeLimit: null });
    expect(r).toMatchObject({ mode: "spin", changeable: false, sectors: ["music", "dance", "cinema", "questions"], order: ["a", "b", "c"], turn: { n: 1, round: 1, team: "a", extra: false }, played: {} });
  });

  it("одна команда — «К колесу» недоступно; темы ведущего добираются до трёх", () => {
    const one = [team("a", 0)];
    let s = onThemes(one);
    const a = [ans("a", { themes: ["music", "dance"], confirmed: true }, 10)];
    const plan = planWheel(s, content, one, a);
    expect(plan.ok).toBe(false);
    const two = [team("a", 0), team("b", 1)];
    s = onThemes(two);
    const answers = [...a, ans("b", { themes: ["music", "dance"], confirmed: true }, 11)];
    expect(planWheel(s, content, two, answers).ok).toBe(false);
    s = applyChange(s, hostSetAdded(s, content, two, answers, "sport", true)!, 1100);
    const ok = planWheel(s, content, two, answers);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.status.sectors).toEqual(["music", "dance", "sport"]);
    // Тему не из каталога (18+ без режима) добавить нельзя.
    expect(hostSetAdded(s, content, two, answers, "adult", true)).toBeNull();
    // Повтор того же действия (второй пульт уже добавил) ничего не переключает обратно.
    expect(hostSetAdded(s, content, two, answers, "sport", true)).toBeNull();
  });

  it("девятая команда в очередь не попадает, её темы не идут в колесо (Р-8)", () => {
    const nine = Array.from({ length: 9 }, (_, i) => team("t" + i, i));
    const s = onThemes(nine);
    const answers = nine.map((p, i) => ans(p.id, { themes: i === 8 ? ["sport", "surprise"] : ["music", i % 2 ? "dance" : "cinema"], confirmed: true }, 10 + i));
    const extra = nine.slice(0, 8).map((p) => p.id);
    const plan = planWheel(s, content, nine, [...answers.slice(0, 8), ans("t0", { themes: ["music", "questions"], confirmed: true }, 30)]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.status.queue).toEqual(extra);
    expect(plan.status.overflow).toEqual(["t8"]);
    expect(plan.status.sectors).not.toContain("sport");
  });

  it("«Назад» к выбору тем — только до первого вращения; выбор сохраняется, ответы шага 1 стираются (Р-42, Р-43)", () => {
    const s = onThemes(teams);
    const fresh = [ans("a", { themes: ["music", "dance"], confirmed: true }, 10), ans("b", { themes: ["cinema", "music"], confirmed: true }, 11), ans("c", { themes: ["questions", "music"], confirmed: true }, 12)];
    const plan = planWheel(s, content, teams, fresh);
    if (!plan.ok) throw new Error("нет плана");
    const wheel = applyChange(s, plan.change, 2000);
    const back = backToThemes(wheel, teams)!;
    expect(back.clearAnswers).toBe(1);
    const again = applyChange(wheel, back.change, 3000);
    expect(again.state).toMatchObject({ step: 0, stage: "question", timeLimit: null, answered: 3 });
    const r = parseRouletteResult(again.state.result);
    expect(r).toMatchObject({ mode: "themes", changeable: true });
    expect(Object.keys(r.choices)).toEqual(["a", "b", "c"]);
    // После вращения «Назад» к темам нет.
    const spun = { ...wheel, state: { ...wheel.state, result: { ...(wheel.state.result as object), played: { music: ["m1"] } } } };
    expect(backToThemes(spun, teams)).toBeNull();
    expect(backToThemes(s, teams)).toBeNull();
    const withResult = (patch: Record<string, unknown>) => ({ ...wheel, state: { ...wheel.state, result: { ...(wheel.state.result as object), ...patch } } });
    expect(backToThemes(withResult({ spin: { id: "x", themeId: "music", taskId: "m1", rarity: "common" } }), teams)).toBeNull();
    expect(backToThemes(withResult({ turn: { n: 2, round: 1, team: "b", extra: false } }), teams)).toBeNull();
    expect(backToThemes(withResult({ turn: { n: 1, round: 1, team: "a", extra: true } }), teams)).toBeNull();
  });

  it("«Снять выбор» у подтверждённого выбора капитана держится, пока капитан не ответит заново (находка аудита 2)", () => {
    let s = onThemes(teams);
    const answers = [ans("a", { themes: ["music", "dance"], confirmed: true }, 10)];
    s = applyChange(s, syncThemes(s, content, teams, answers)!, 1100);
    s = applyChange(s, hostChoose(s, content, teams, answers, "a", [])!, 1200);
    expect(syncThemes(s, content, teams, answers)).toBeNull();
    expect(parseRouletteResult(s.state.result).choices.a?.themes).toEqual([]);
    const again = effectiveChoices(content, parseRouletteResult(s.state.result), [ans("a", { themes: ["cinema", "music"], confirmed: true }, 30)]);
    expect(again.a).toEqual({ themes: ["music", "cinema"], by: "captain", at: 30 });
  });

  it("второй пульт со старым списком ответов не возвращает готовность после «Изменить» (находка аудита 5)", () => {
    let s = onThemes(teams);
    const confirmed = [ans("a", { themes: ["music", "dance"], confirmed: true }, 10)];
    const changed = [ans("a", { themes: ["music", "dance"], confirmed: false }, 20)];
    s = applyChange(s, syncThemes(s, content, teams, confirmed)!, 1100);
    // Пульт А получил «Изменить».
    s = applyChange(s, syncThemes(s, content, teams, changed)!, 1200);
    expect(s.state.answered).toBe(0);
    // Пульт Б ещё видит старый ответ — записывать нечего.
    expect(syncThemes(s, content, teams, confirmed)).toBeNull();
  });

  it("два пульта с разными списками команд не перезаписывают очередь по кругу (повторная проверка, №1)", () => {
    const four = [...teams, team("d", 3)];
    let s = onThemes(four);
    // Пульт Б ещё не видит команду «d» среди участников, но она уже в таблице — очередь не меняется.
    expect(syncThemes(s, content, teams, [])).toBeNull();
    s = applyChange(s, syncThemes(s, content, four, [ans("a", { themes: ["music", "dance"], confirmed: true }, 10)])!, 1100);
    expect(parseRouletteResult(s.state.result).queue).toEqual(["a", "b", "c", "d"]);
    expect(syncThemes(s, content, teams, [ans("a", { themes: ["music", "dance"], confirmed: true }, 10)])).toBeNull();
  });

  it("счётчик «Ответили» и очередь на выборе тем — только первые 8 команд (Р-8)", () => {
    const nine = Array.from({ length: 9 }, (_, i) => team("t" + i, i));
    let s = onThemes(nine);
    expect(parseRouletteResult(s.state.result).queue).toHaveLength(8);
    const answers = [ans("t8", { themes: ["music", "dance"], confirmed: true }, 10)];
    s = applyChange(s, syncThemes(s, content, nine, answers)!, 1100);
    expect(s.state.answered).toBe(0);
  });

  it("опоздавшая команда — в конец очереди, пока их меньше восьми; убранная выпадает (Р-10)", () => {
    const s = onThemes([...teams, team("d", 3)]);
    expect(queueWithLate(["a", "b", "c"], s, [...teams, team("d", 3)])).toEqual(["a", "b", "c", "d"]);
    const removed = { ...s, leaderboard: Object.fromEntries(Object.entries(s.leaderboard).filter(([id]) => id !== "b")) };
    expect(queueWithLate(["a", "b", "c"], removed, [teams[0]!, teams[2]!, team("d", 3)])).toEqual(["a", "c", "d"]);
    const eight = Array.from({ length: 9 }, (_, i) => team("t" + i, i));
    const full = onThemes(eight);
    expect(queueWithLate(eight.slice(0, 8).map((p) => p.id), full, eight)).toHaveLength(8);
  });
});

describe("рулетка: подключение к платформе", () => {
  it("механика зарегистрирована, только команды, скрыта от ведущих, шаблоны есть только в общем списке", () => {
    const m = getMechanic("roulette");
    expect(m?.supports).toEqual({ solo: false, teams: true, noScreen: false });
    expect(m?.ownAnswered).toBe(true);
    expect(HIDDEN_MECHANICS.has("roulette")).toBe(true);
    expect(selectableMechanics.some((x) => x.id === "roulette")).toBe(false);
    expect(demoGames.some((d) => d.mechanic === "roulette")).toBe(false);
    expect(allDemoGames.filter((d) => d.mechanic === "roulette")).toHaveLength(2);
    expect(categoryOf({ mechanic: "roulette", content: DEMO_ROULETTE_RAW })).toBe("adventure");
    for (const d of allDemoGames.filter((x) => x.mechanic === "roulette")) expect(m!.validate(m!.parse(d.content))).toEqual([]);
  });
});
