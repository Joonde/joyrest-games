import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { createMillionaire, levelsOf, parseMillionaire, parseMillionaireList, pointsAt, resizeLadder, safeFloor, type MillionaireContent } from "./content";

const LEVELS = 12;
import { DEMO_MILLIONAIRE } from "./demo";
import {
  applyLifeline,
  audienceVotes,
  canUseLifeline,
  finishAudience,
  liveAudience,
  lockAnswer,
  markPick,
  millionaireBack,
  millionairePrimary,
  nextTurn,
  parseMillionaireResult,
  questionOf,
  refuseLifeline,
  requestedLifeline,
  retryQuestion,
  revealAnswer,
  showQuestion,
  startMillionaire,
  syncChosen,
  wrongChoice,
  nextPlayer,
  attemptsLeft,
  ladderWindow,
} from "./logic";
import { validateMillionaire } from "./validate";

const teams: Participant[] = ["A", "B", "C"].map((id, i) => ({ id, name: `Команда ${id}`, kind: "team", teamId: null, captainUid: `u${id}`, joinedAt: i }));
// Телефоны: капитан A (uA) и участник A, капитан B, участник C.
const phones: Participant[] = [
  { id: "uA", name: "Аня", kind: "player", teamId: "A", captainUid: "uA", joinedAt: 10 },
  { id: "pA2", name: "Боря", kind: "player", teamId: "A", captainUid: "pA2", joinedAt: 11 },
  { id: "uB", name: "Вика", kind: "player", teamId: "B", captainUid: "uB", joinedAt: 12 },
  { id: "pC2", name: "Гоша", kind: "player", teamId: "C", captainUid: "pC2", joinedAt: 13 },
];
const everyone = [...teams, ...phones];
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "millionaire", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: { ...startState(), stage: "ready" }, leaderboard: {}, createdAt: 0 });
let t = 1_000_000;
const apply = (s: Session, c: SessionChange | null) => applyChange(s, c ?? {}, (t += 1000));
const ans = (s: Session, pid: string, uid: string, value: unknown, late = 10): Answer => ({ id: `${s.state.step}_${pid}`, step: s.state.step, pid, uid, value, submittedAt: (s.state.startedAt ?? 0) + late });

/** По три вопроса на ступень (команде — свой, плюс запасные), верный — вариант B. */
function game(): MillionaireContent {
  // Тесты хода — на прежней лестнице из 12 ступеней (несгораемые 4 и 8), без ограничения попыток.
  const c: MillionaireContent = { ...resizeLadder(createMillionaire(), 12), attempts: null };
  c.questions = [];
  for (let level = 1; level <= LEVELS; level++) {
    for (let k = 0; k < 4; k++) c.questions.push({ id: `q${level}_${k}`, level, text: `Вопрос ${level}.${k}`, options: ["а", "б", "в", "г"], correct: 1, note: "" });
  }
  return c;
}

function started(content = game()) {
  let s = session();
  expect(millionairePrimary(s)).toBe("start");
  s = apply(s, startMillionaire(s, everyone, content));
  return { s, content };
}

describe("Кто хочет стать миллионером: содержимое", () => {
  it("новая игра — 15 ступеней (несгораемые 5 и 10), 2 попытки; старые без лестницы — 12", () => {
    const c = createMillionaire();
    expect(levelsOf(c)).toBe(15);
    expect(c.safe).toEqual([5, 10]);
    expect(pointsAt(c, 15)).toBe(1_000_000);
    expect(c.attempts).toBe(2);
    const old = parseMillionaire({ questions: [{ level: 14 }] });
    expect(levelsOf(old)).toBe(12);
    expect(old.questions[0]?.level).toBe(12);
    expect(old.attempts).toBeNull();
    expect(parseMillionaire({ attempts: 7 }).attempts).toBeNull();
    expect(parseMillionaire({ ...c }).attempts).toBe(2);
    const back = resizeLadder(c, 12);
    expect(levelsOf(back)).toBe(12);
    expect(back.safe).toEqual([4, 8]);
    expect(Math.max(...back.questions.map((q) => q.level))).toBe(12);
  });

  it("лестница, несгораемые 4 и 8, падение до несгораемой", () => {
    const c = resizeLadder(createMillionaire(), 12);
    expect(c.ladder).toHaveLength(12);
    expect(pointsAt(c, 12)).toBe(1_000_000);
    expect(safeFloor(c, 3)).toBe(0);
    expect(safeFloor(c, 7)).toBe(4);
    expect(safeFloor(c, 11)).toBe(8);
    expect(parseMillionaire({ safe: [0, 4, 4, 12, 8], lifelines: ["fifty", "bad"] })).toMatchObject({ safe: [4, 8], lifelines: ["fifty"] });
  });

  it("список: вопрос, варианты, верный «*», ступень по порядку или «# Ступень N»", () => {
    const list = parseMillionaireList("Столица Франции?\n- Рим\n* Париж\n- Берлин\n- Мадрид\nСколько ног у паука?\n- 6\n* 8\n- 10\n- 4\n# Ступень 5\nЗапасной?\n* да\n- нет\n- может\n- никогда");
    expect(list.map((q) => q.level)).toEqual([1, 2, 5]);
    expect(list[0]).toMatchObject({ text: "Столица Франции?", options: ["Рим", "Париж", "Берлин", "Мадрид"], correct: 1 });
    expect(list[2]?.correct).toBe(0);
  });

  it("проверка: на каждой ступени вопрос с 4 вариантами; шаблон проходит", () => {
    expect(validateMillionaire(createMillionaire()).length).toBeGreaterThan(0);
    expect(validateMillionaire(game())).toEqual([]);
    expect(validateMillionaire(DEMO_MILLIONAIRE)).toEqual([]);
  });
});

describe("Кто хочет стать миллионером: ход", () => {
  it("очередь команд, вопрос своей ступени, верно — выше, неверно — до несгораемой", () => {
    let { s, content } = started();
    let r = parseMillionaireResult(s.state.result);
    expect(r.order).toEqual(["A", "B", "C"]);
    expect(r.turn).toBe("A");
    expect(millionairePrimary(s)).toBe("show");
    s = apply(s, showQuestion(s, content));
    expect(questionOf(content, parseMillionaireResult(s.state.result))?.level).toBe(1);
    // Ответ чужой команды не считается; капитан A — B (верно).
    expect(revealAnswer(s, content, [ans(s, "B", "uB", { choice: 1 })], everyone)).toBeNull();
    s = apply(s, revealAnswer(s, content, [ans(s, "A", "uA", { choice: 1 })], everyone));
    r = parseMillionaireResult(s.state.result);
    expect(r.outcome).toBe("right");
    expect(r.levels.A).toBe(1);
    expect(s.leaderboard.A?.score).toBe(1000);
    s = apply(s, nextTurn(s, content, everyone));
    expect(parseMillionaireResult(s.state.result).turn).toBe("B");
    // Вопрос B — другой вопрос 1-й ступени (весь зал видел вопрос A).
    s = apply(s, showQuestion(s, content));
    expect(parseMillionaireResult(s.state.result).q).toBe("q1_1");
  });

  it("ошибка роняет до несгораемой; ведущий может отметить ответ за команду", () => {
    let { s, content } = started();
    // Команда A поднимается до 6-й ступени.
    const r0 = parseMillionaireResult(s.state.result);
    s = { ...s, state: { ...s.state, result: { ...r0, levels: { A: 6, B: 0, C: 0 } } } };
    s = apply(s, showQuestion(s, content));
    expect(questionOf(content, parseMillionaireResult(s.state.result))?.level).toBe(7);
    s = apply(s, markPick(s, 3));
    s = apply(s, revealAnswer(s, content, [], everyone));
    const r = parseMillionaireResult(s.state.result);
    expect(r.outcome).toBe("wrong");
    expect(r.levels.A).toBe(4);
    expect(s.leaderboard.A?.score).toBe(5000);
    // «Назад» — ступень и счёт обратно.
    s = apply(s, millionaireBack(s, content, everyone)?.change ?? null);
    expect(parseMillionaireResult(s.state.result).levels.A).toBe(6);
    expect(s.leaderboard.A?.score).toBe(20000);
  });

  it("дошла до 12 — миллионер, дальше не ходит; все закончили — награждение", () => {
    const content = game();
    let s = session();
    s = apply(s, startMillionaire(s, teams.slice(0, 1), { ...content, players: "one" }));
    const r0 = parseMillionaireResult(s.state.result);
    s = { ...s, state: { ...s.state, result: { ...r0, levels: { A: 11 } } } };
    s = apply(s, showQuestion(s, content));
    s = apply(s, revealAnswer(s, content, [ans(s, "A", "uA", { choice: 1 })], teams));
    expect(s.leaderboard.A?.score).toBe(1_000_000);
    expect(parseMillionaireResult(s.state.result).done).toEqual(["A"]);
    s = apply(s, nextTurn(s, { ...content, players: "one" }, teams));
    expect(parseMillionaireResult(s.state.result).mode).toBe("over");
    expect(millionairePrimary(s)).toBe("podium");
  });

  it("одна команда: играет выбранная ведущим", () => {
    const content = { ...game(), players: "one" as const };
    let s = session();
    s = apply(s, startMillionaire(s, everyone, content, "B"));
    expect(parseMillionaireResult(s.state.result).order).toEqual(["B"]);
  });
});

describe("Кто хочет стать миллионером: подсказки", () => {
  function atQuestion() {
    let { s, content } = started();
    s = apply(s, showQuestion(s, content));
    return { s, content };
  }

  it("каждая — один раз: после использования отмечена и больше не берётся (и со второго пульта)", () => {
    let { s, content } = atQuestion();
    const step = s.state.step;
    const change = applyLifeline(s, content, [], "host", t);
    s = apply(s, change);
    const r = parseMillionaireResult(s.state.result);
    expect(r.used.A).toEqual(["host"]);
    expect(r.tip).toBe(true);
    expect(r.flash).toBe("host");
    expect(s.state.step).toBe(step + 1);
    expect(canUseLifeline(s, content, [], "host")).toMatchObject({ ok: false, reason: "Уже использована" });
    expect(applyLifeline(s, content, [], "host", t)).toBeNull();
    // У другой команды подсказка своя.
    expect(r.used.B).toBeUndefined();
  });

  it("50 на 50: убирает ровно два неверных, верный остаётся; ответ на погашенный не считается", () => {
    let { s, content } = atQuestion();
    s = apply(s, applyLifeline(s, content, [], "fifty", t, () => 0.99));
    const r = parseMillionaireResult(s.state.result);
    expect(r.removed).toHaveLength(2);
    expect(r.removed).not.toContain(1);
    const gone = r.removed[0] as number;
    expect(revealAnswer(s, content, [ans(s, "A", "uA", { choice: gone })], everyone)).toBeNull();
  });

  it("замена вопроса: другой вопрос той же ступени, прежний ответ не считается; нет запасного — нельзя", () => {
    let { s, content } = atQuestion();
    const before = parseMillionaireResult(s.state.result).q;
    const old = ans(s, "A", "uA", { choice: 0 });
    // Ответ выбран, но не зафиксирован — подсказку ещё можно взять.
    expect(canUseLifeline(s, content, [old], "swap").ok).toBe(true);
    s = apply(s, applyLifeline(s, content, [], "swap", t));
    const r = parseMillionaireResult(s.state.result);
    expect(r.q).not.toBe(before);
    expect(questionOf(content, r)?.level).toBe(1);
    expect(r.seen).toContain(before);
    // Ответ на прежний шаг больше не считается.
    expect(revealAnswer(s, content, [old], everyone)).toBeNull();
    const lonely = { ...content, questions: content.questions.filter((q) => q.level !== 1 || q.id === r.q) };
    const s2 = { ...s, state: { ...s.state, result: { ...r, used: {} } } };
    expect(canUseLifeline(s2, lonely, [], "swap")).toMatchObject({ ok: false, reason: "Нет запасного вопроса этой ступени" });
  });

  it("помощь зала: голосуют все, кроме команды, чей ход; проценты на экран, вопрос снова открыт", () => {
    let { s, content } = atQuestion();
    s = apply(s, applyLifeline(s, content, [], "audience", t));
    expect(parseMillionaireResult(s.state.result).mode).toBe("audience");
    expect(s.state.timeLimit).toBe(content.audienceSeconds);
    expect(millionairePrimary(s)).toBe("audienceDone");
    const votes = [ans(s, "uA", "uA", { vote: 0 }), ans(s, "pA2", "pA2", { vote: 0 }), ans(s, "uB", "uB", { vote: 1 }), ans(s, "pC2", "pC2", { vote: 1 }), ans(s, "B", "uB", { vote: 2 })];
    // Голос «за команду B» не считается: капитан B уже голосует своим телефоном.
    expect(audienceVotes(s, votes, everyone)).toEqual([0, 2, 0, 0]);
    s = apply(s, finishAudience(s, votes, everyone));
    const r = parseMillionaireResult(s.state.result);
    expect(r.mode).toBe("question");
    expect(r.audience).toEqual([0, 100, 0, 0]);
    expect(s.state.timeLimit).toBeNull();
    expect(millionairePrimary(s)).toBe("lock");
  });

  it("звонок другу: минута по часам сервера; право на ошибку спасает один раз", () => {
    let { s, content } = atQuestion();
    s = apply(s, applyLifeline(s, content, [], "call", 5000));
    expect(parseMillionaireResult(s.state.result).callEndsAt).toBe(65_000);
    s = apply(s, applyLifeline(s, content, [], "mistake", t));
    s = apply(s, revealAnswer(s, content, [ans(s, "A", "uA", { choice: 0 })], everyone));
    let r = parseMillionaireResult(s.state.result);
    expect(r.outcome).toBe("saved");
    expect(r.levels.A).toBe(0);
    expect(r.removed).toContain(0);
    expect(millionairePrimary(s)).toBe("retry");
    s = apply(s, retryQuestion(s));
    s = apply(s, revealAnswer(s, content, [ans(s, "A", "uA", { choice: 2 })], everyone));
    r = parseMillionaireResult(s.state.result);
    expect(r.outcome).toBe("wrong");
  });

  it("капитан просит подсказку с телефона — только капитан команды, чей ход", () => {
    const { s } = atQuestion();
    expect(requestedLifeline(s, [ans(s, "pA2", "pA2", { lifeline: "fifty" })], everyone)).toBeNull();
    expect(requestedLifeline(s, [ans(s, "uB", "uB", { lifeline: "fifty" })], everyone)).toBeNull();
    s.leaderboard.A = { name: "Команда A", kind: "team", score: 0, captainUid: "uA" };
    expect(requestedLifeline(s, [ans(s, "uA", "uA", { lifeline: "fifty", n: "x1" })], everyone)).toEqual({ id: "fifty", n: "x1" });
    expect(requestedLifeline(s, [ans(s, "uA", "uA", { lifeline: "nope" })], everyone)).toBeNull();
    // Ведущий переспросил — игрок передумал: эта просьба гаснет, новая (другой номер) снова видна.
    const s2 = apply(s, refuseLifeline(s, "x1"));
    expect(requestedLifeline(s2, [ans(s2, "uA", "uA", { lifeline: "fifty", n: "x1" })], everyone)).toBeNull();
    expect(requestedLifeline(s2, [ans(s2, "uA", "uA", { lifeline: "fifty", n: "x2" })], everyone)).toEqual({ id: "fifty", n: "x2" });
    // Игрок в solo просит своим ответом.
    expect(requestedLifeline(s, [ans(s, "A", "uA", { lifeline: "call", n: "y" })], everyone)).toEqual({ id: "call", n: "y" });
  });

  it("выбор подсвечивается, ведущий переспрашивает и фиксирует; после фиксации телефон ответ не меняет", () => {
    let { s, content } = atQuestion();
    expect(millionairePrimary(s)).toBe("lock");
    expect(parseMillionaireResult(s.state.result).changeable).toBe(true);
    expect(lockAnswer(s, [])).toBeNull();
    s = apply(s, syncChosen(s, [ans(s, "A", "uA", { choice: 0 })]));
    expect(parseMillionaireResult(s.state.result).chosen).toBe(0);
    // Передумал до фиксации.
    s = apply(s, syncChosen(s, [ans(s, "A", "uA", { choice: 1 })]));
    expect(syncChosen(s, [ans(s, "A", "uA", { choice: 1 })])).toBeNull();
    s = apply(s, lockAnswer(s, [ans(s, "A", "uA", { choice: 1 })]));
    let r = parseMillionaireResult(s.state.result);
    expect(r).toMatchObject({ chosen: 1, locked: true, changeable: false });
    expect(millionairePrimary(s)).toBe("reveal");
    expect(canUseLifeline(s, content, [], "fifty")).toMatchObject({ ok: false, reason: "Ответ уже зафиксирован" });
    // Телефон прислал другой ответ — не считается.
    expect(syncChosen(s, [ans(s, "A", "uA", { choice: 2 })])).toBeNull();
    s = apply(s, revealAnswer(s, content, [ans(s, "A", "uA", { choice: 2 })], everyone));
    expect(parseMillionaireResult(s.state.result).outcome).toBe("right");
    // «Назад» с ответа — снова к зафиксированному вопросу, ещё «Назад» — фиксация снята.
    s = apply(s, millionaireBack(s, content, everyone)?.change ?? null);
    expect(millionairePrimary(s)).toBe("reveal");
    s = apply(s, millionaireBack(s, content, everyone)?.change ?? null);
    r = parseMillionaireResult(s.state.result);
    expect(r.locked).toBe(false);
    expect(millionairePrimary(s)).toBe("lock");
  });

  it("помощь зала: гости по QR добавляют голоса, проценты на экране обновляются сами", () => {
    let { s, content } = atQuestion();
    s = apply(s, applyLifeline(s, content, [], "audience", t));
    expect(parseMillionaireResult(s.state.result)).toMatchObject({ audienceVote: true, audience: [0, 0, 0, 0] });
    const phonesVotes = [ans(s, "uB", "uB", { vote: 1 })];
    expect(liveAudience(s, [], everyone)).toBeNull();
    s = apply(s, liveAudience(s, phonesVotes, everyone, [0, 2, 1, 0]));
    let r = parseMillionaireResult(s.state.result);
    expect(r.audience).toEqual([0, 75, 25, 0]);
    expect(r.votes).toBe(4);
    expect(liveAudience(s, phonesVotes, everyone, [0, 2, 1, 0])).toBeNull();
    s = apply(s, finishAudience(s, phonesVotes, everyone, [0, 2, 1, 1]));
    r = parseMillionaireResult(s.state.result);
    expect(r).toMatchObject({ mode: "question", audienceVote: false, votes: 5, audience: [0, 60, 20, 20] });
  });

  it("подсказку нельзя, пока вопрос не открыт или после ответа; выключенную в игре — нельзя", () => {
    let { s, content } = started();
    expect(canUseLifeline(s, content, [], "fifty").ok).toBe(false);
    s = apply(s, showQuestion(s, content));
    expect(canUseLifeline(s, { ...content, lifelines: ["host"] }, [], "fifty").ok).toBe(false);
    s = apply(s, markPick(s, 1));
    expect(canUseLifeline(s, content, [], "fifty").ok).toBe(true);
    s = apply(s, lockAnswer(s, []));
    expect(canUseLifeline(s, content, [], "fifty")).toMatchObject({ ok: false, reason: "Ответ уже зафиксирован" });
  });
});

describe("оформление экрана зала «Миллионера»", () => {
  it("старые игры без поля и неизвестные значения — «Классика», шаблон и новые игры — «Студия»", () => {
    const old: Record<string, unknown> = { ...createMillionaire() };
    delete old.look;
    expect(parseMillionaire(old).look).toBe("classic");
    expect(parseMillionaire({ ...old, look: "gold" }).look).toBe("classic");
    expect(parseMillionaire(undefined).look).toBe("classic");
    expect(parseMillionaire({ ...old, look: "studio" }).look).toBe("studio");
    expect(parseMillionaire({ ...old, look: "evening" }).look).toBe("evening");
    expect(createMillionaire().look).toBe("studio");
    const demo = parseMillionaire(DEMO_MILLIONAIRE);
    expect(demo.look).toBe("studio");
    expect(validateMillionaire(demo)).toEqual([]);
    expect(validateMillionaire({ ...demo, look: "evening" })).toEqual([]);
  });
});

describe("Кто хочет стать миллионером: после ошибки решает ведущий", () => {
  function wrongAt(level: number) {
    let { s, content } = started();
    const r0 = parseMillionaireResult(s.state.result);
    s = { ...s, state: { ...s.state, result: { ...r0, levels: { A: level, B: 0, C: 0 } } } };
    s = apply(s, showQuestion(s, content));
    s = apply(s, markPick(s, 3));
    s = apply(s, revealAnswer(s, content, [], everyone));
    expect(millionairePrimary(s)).toBe("wrongChoice");
    return { s, content };
  }

  it("«Выбывает»: больше не ходит, очки остаются; последние выбыли — конец игры", () => {
    let { s, content } = wrongAt(6);
    s = apply(s, wrongChoice(s, content, everyone, "out"));
    let r = parseMillionaireResult(s.state.result);
    expect(r.out).toEqual(["A"]);
    expect(r.turn).toBe("B");
    expect(s.leaderboard.A?.score).toBe(5000);
    // Круг: B → C → снова B (A выбыла).
    s = apply(s, nextTurn(s, content, everyone));
    s = apply(s, nextTurn(s, content, everyone));
    r = parseMillionaireResult(s.state.result);
    expect(r.turn).toBe("B");
  });

  it("«Сначала»: ступень 0 и счёт 0, ход следующей команды", () => {
    let { s, content } = wrongAt(6);
    s = apply(s, wrongChoice(s, content, everyone, "restart"));
    const r = parseMillionaireResult(s.state.result);
    expect(r.levels.A).toBe(0);
    expect(s.leaderboard.A?.score ?? 0).toBe(0);
    expect(r.turn).toBe("B");
  });

  it("«Дальше, пропустив ход»: ступень по несгораемой, свой следующий ход пропускает", () => {
    let { s, content } = wrongAt(6);
    s = apply(s, wrongChoice(s, content, everyone, "skip"));
    let r = parseMillionaireResult(s.state.result);
    expect(r.levels.A).toBe(4);
    expect(r.turn).toBe("B");
    expect(r.skip).toEqual(["A"]);
    s = apply(s, nextTurn(s, content, everyone));
    expect(parseMillionaireResult(s.state.result).turn).toBe("C");
    // После C очередь A — пропуск, ходит B; пропуск снят.
    s = apply(s, nextTurn(s, content, everyone));
    r = parseMillionaireResult(s.state.result);
    expect(r.turn).toBe("B");
    expect(r.skip).toEqual([]);
    s = apply(s, nextTurn(s, content, everyone));
    s = apply(s, nextTurn(s, content, everyone));
    expect(parseMillionaireResult(s.state.result).turn).toBe("A");
  });

  it("решать можно только после неверного ответа", () => {
    const { s, content } = started();
    expect(wrongChoice(s, content, everyone, "out")).toBeNull();
  });

  it("очередь: пропускающий уступает ход, а если ходить больше некому — ходит", () => {
    expect(nextPlayer(["A", "B"], [], "B", ["A"])).toEqual({ who: "B", skip: [] });
    expect(nextPlayer(["A", "B"], ["B"], "A", ["A"])).toEqual({ who: "A", skip: [] });
    expect(nextPlayer(["A", "B"], ["A", "B"], "A", [])).toEqual({ who: null, skip: [] });
  });
});

describe("Кто хочет стать миллионером: попытки после ошибки и 15 ступеней", () => {
  function attemptsGame(attempts: number | null) {
    const content = { ...game(), attempts };
    let s = session();
    s = apply(s, startMillionaire(s, everyone, content));
    return { s, content };
  }
  function miss(s: Session, content: MillionaireContent) {
    s = apply(s, showQuestion(s, content));
    s = apply(s, markPick(s, 3));
    return apply(s, revealAnswer(s, content, [], everyone));
  }

  it("ошибки считаются; «Назад» с показа ответа возвращает попытку", () => {
    let { s, content } = attemptsGame(1);
    s = miss(s, content);
    let r = parseMillionaireResult(s.state.result);
    expect(r.misses.A).toBe(1);
    expect(attemptsLeft(content, r, "A")).toBe(0);
    s = apply(s, millionaireBack(s, content, everyone)?.change ?? null);
    r = parseMillionaireResult(s.state.result);
    expect(r.misses.A ?? 0).toBe(0);
  });

  it("попытки 0: первая ошибка — попыток нет; все выбыли — конец игры и награждение по очкам", () => {
    let { s, content } = attemptsGame(0);
    for (const team of ["A", "B", "C"]) {
      expect(parseMillionaireResult(s.state.result).turn).toBe(team);
      s = miss(s, content);
      expect(attemptsLeft(content, parseMillionaireResult(s.state.result), team)).toBe(-1);
      s = apply(s, wrongChoice(s, content, everyone, "out"));
    }
    const r = parseMillionaireResult(s.state.result);
    expect(r.mode).toBe("over");
    expect(r.out).toEqual(["A", "B", "C"]);
    expect(millionairePrimary(s)).not.toBe("show");
  });

  it("без ограничения — attemptsLeft null", () => {
    const { s, content } = attemptsGame(null);
    expect(attemptsLeft(content, parseMillionaireResult(s.state.result), "A")).toBeNull();
  });

  it("15 ступеней: шаблон проходит проверку, миллионер — на 15-й", () => {
    expect(levelsOf(DEMO_MILLIONAIRE)).toBe(15);
    expect(validateMillionaire(DEMO_MILLIONAIRE)).toEqual([]);
    const content = { ...DEMO_MILLIONAIRE, attempts: null };
    let s = session();
    s = apply(s, startMillionaire(s, teams, content));
    const r0 = parseMillionaireResult(s.state.result);
    s = { ...s, state: { ...s.state, result: { ...r0, levels: { A: 14, B: 0, C: 0 } } } };
    s = apply(s, showQuestion(s, content));
    const q = questionOf(content, parseMillionaireResult(s.state.result));
    expect(q?.level).toBe(15);
    s = apply(s, markPick(s, q?.correct ?? 0));
    s = apply(s, revealAnswer(s, content, [], teams));
    const r = parseMillionaireResult(s.state.result);
    expect(r.levels.A).toBe(15);
    expect(r.done).toContain("A");
    expect(s.leaderboard.A?.score).toBe(1_000_000);
  });
});

describe("полоски на экране зала", () => {
  it("больше трёх команд — окно из трёх по кругу с той, чья очередь; выбывшие пропускаются", () => {
    const base = parseMillionaireResult({ order: ["fox", "bear", "owl", "goat", "dog"], turn: "fox" });
    expect(ladderWindow(base, 3)).toEqual(["fox", "bear", "owl"]);
    expect(ladderWindow({ ...base, turn: "bear" }, 3)).toEqual(["bear", "owl", "goat"]);
    expect(ladderWindow({ ...base, turn: "dog" }, 3)).toEqual(["dog", "fox", "bear"]);
    expect(ladderWindow({ ...base, turn: "owl", out: ["goat"] }, 3)).toEqual(["owl", "dog", "fox"]);
    expect(ladderWindow(parseMillionaireResult({ order: ["a", "b"], turn: "b" }), 3)).toEqual(["a", "b"]);
  });
});

describe("время на ответ", () => {
  it("таймер вопроса: новые игры — 30 с, старые — без таймера; «окончательный ответ» останавливает часы, звонок добавляет своё время", () => {
    expect(createMillionaire().answerSeconds).toBe(30);
    expect(parseMillionaire({}).answerSeconds).toBe(0);
    expect(parseMillionaire({ answerSeconds: 17 }).answerSeconds).toBe(0);
    let { s, content } = started();
    s = apply(s, showQuestion(s, content));
    expect(s.state.timeLimit).toBe(30);
    s = apply(s, applyLifeline(s, content, [], "call", 0));
    expect(s.state.timeLimit).toBe(30 + content.callSeconds);
    s = apply(s, lockAnswer(s, [ans(s, "A", "uA", { choice: 1 })]));
    expect(s.state.timeLimit).toBeNull();
    const old = started({ ...game(), answerSeconds: 0 });
    expect(apply(old.s, showQuestion(old.s, old.content)).state.timeLimit).toBeNull();
  });
});
