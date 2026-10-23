import { describe, expect, it } from "vitest";
import {
  changeKind,
  correctSet,
  DEFAULT_SETTINGS,
  duplicateQuestion,
  toggleCorrect,
  mediaIds,
  moveItem,
  newQuestion,
  parseContent,
  quizRounds,
  roundTitle,
  type QuizContent,
  type QuizQuestion,
} from "./content";
import { IMPORT_EXAMPLE, parseImport } from "./importText";
import { DEMO_QUIZ_FORMATS } from "./demo";
import { podiumNext, startPodium } from "../../core/podium";
import { applyChange, startState } from "../../core/session";
import type { Session, SessionState } from "../../data/types";
import { actionLabel, back, boardAfterReveal, boardView, buzzRightAnswer, buzzSync, buzzWrongAnswer, extraAction, nextQuestion, primaryAction, reveal, showBoard, showQuestion, showTotal, superSync, toggleAccepted } from "./flow";
import { acceptKey } from "../../core/supergame";
import { emptyResult, groupOpenAnswers, isCorrect, numberDeltas, orderShown, parseResult, resultOf, score, steps } from "./logic";
import { matchesAnswer, normalizeAnswer } from "./normalize";
import { errorsFor, validateContent, validateQuestion } from "./validate";

function choice(patch: Partial<QuizQuestion> = {}): QuizQuestion {
  return { ...newQuestion("choice"), text: "Вопрос?", options: ["Да", "Нет"], correct: 0, ...patch };
}

describe("parseContent", () => {
  it("мусор из базы превращается в пустой квиз", () => {
    const empty = { questions: [], settings: DEFAULT_SETTINGS };
    expect(parseContent(null)).toEqual(empty);
    expect(parseContent("x")).toEqual(empty);
    expect(parseContent({ questions: "x" })).toEqual(empty);
  });

  it("битые поля вопроса заменяются значениями по умолчанию", () => {
    const { questions } = parseContent({
      questions: [{ id: "a", kind: "weird", text: 5, options: ["1", 2], correct: 7, timeLimit: 9999, points: -3 }],
    });
    expect(questions[0]).toMatchObject({
      id: "a",
      kind: "choice",
      text: "",
      options: ["1", ""],
      correct: -1,
      timeLimit: 300,
      points: 1,
      imageId: null,
      round: null,
    });
  });

  it("название раунда — одна строка до 60 символов, пустое — раунда нет", () => {
    const { questions } = parseContent({ questions: [{ round: "  Кино\n и музыка " }, { round: "   " }, { round: 5 }, { round: "я".repeat(80) }] });
    expect(questions.map((q) => q.round?.length ?? null)).toEqual(["Кино и музыка".length, null, null, 60]);
  });

  it("заметка ведущему — до 300 символов, мусор — пусто", () => {
    const { questions } = parseContent({ questions: [{ note: "Факт: Эйфелеву башню красят раз в 7 лет" }, { note: 5 }, { note: "я".repeat(400) }] });
    expect(questions.map((q) => q.note?.length)).toEqual([39, 0, 300]);
  });

  it("одинаковые id вопросов становятся разными", () => {
    const { questions } = parseContent({ questions: [{ id: "a" }, { id: "a" }] });
    expect(new Set(questions.map((q) => q.id)).size).toBe(2);
  });

  it("сохранённый квиз читается без изменений", () => {
    const content = { questions: [choice({ imageId: "img1" }), { ...newQuestion("open"), text: "Ответ?", answers: ["ёлка"] }] };
    const once = parseContent(JSON.parse(JSON.stringify(content)));
    // Всё, что было в игре, на месте; повторный разбор ничего не меняет.
    expect(once).toMatchObject({ ...content, settings: DEFAULT_SETTINGS });
    expect(parseContent(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("настройки проведения: по умолчанию заставка, таблица после каждого вопроса, без картинок на телефонах", () => {
    expect(parseContent({ settings: { intro: false, board: "manual", phoneImages: true } }).settings).toEqual({ intro: false, board: "manual", phoneImages: true, raceTarget: 5 });
    expect(parseContent({ settings: { intro: "нет", board: "иногда" } }).settings).toEqual(DEFAULT_SETTINGS);
  });

  it("несколько верных вариантов: любой засчитывается, мусор отбрасывается", () => {
    const { questions } = parseContent({ questions: [{ options: ["а", "б", "в"], correct: 0, alsoCorrect: [2, 2, 9, 0, "x"] }] });
    const q = questions[0] as QuizQuestion;
    expect(correctSet(q)).toEqual([0, 2]);
    expect(isCorrect(q, 2)).toBe(true);
    expect(isCorrect(q, 1)).toBe(false);
    const unmarked = toggleCorrect(toggleCorrect(q, 0), 2);
    expect(unmarked.correct).toBe(-1);
    expect(validateQuestion(unmarked).some((e) => e.path.endsWith("/correct"))).toBe(true);
    expect(correctSet(toggleCorrect(q, 1))).toEqual([0, 1, 2]);
  });
});

describe("mediaIds", () => {
  it("картинки без повторов", () => {
    const q = choice({ imageId: "m1" });
    expect(mediaIds({ questions: [q, duplicateQuestion(q), choice()] })).toEqual(["m1"]);
  });
});

describe("правка вопросов", () => {
  it("дубль — новый id и те же поля", () => {
    const q = choice();
    const copy = duplicateQuestion(q);
    expect(copy.id).not.toBe(q.id);
    expect({ ...copy, id: q.id }).toEqual(q);
  });

  it("порядок меняется перемещением", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("смена типа сохраняет верный вариант как открытый ответ", () => {
    const open = changeKind(choice({ correct: 1 }), "open");
    expect(open.kind).toBe("open");
    expect(open.answers).toEqual(["Нет"]);
    expect(open.timeLimit).toBe(45);
  });

  it("смена типа не трогает время и очки, которые ведущий поменял сам", () => {
    const speed = changeKind(choice({ timeLimit: 20, points: 100 }), "speed");
    expect(speed.timeLimit).toBe(20);
    expect(speed.points).toBe(200);
  });
});

describe("normalizeAnswer", () => {
  it("регистр, ё/е, пробелы и пунктуация не важны", () => {
    expect(normalizeAnswer(" Ёлка! ")).toBe("елка");
    expect(normalizeAnswer("Санкт-Петербург")).toBe(normalizeAnswer("санкт петербург"));
    expect(matchesAnswer("ЕЛКА", ["ёлка"])).toBe(true);
    expect(matchesAnswer("елки", ["ёлка"])).toBe(false);
    expect(matchesAnswer("!!!", ["!!!"])).toBe(false);
  });
});

describe("validate", () => {
  it("пустая игра не запускается", () => {
    expect(validateContent({ questions: [] })).toEqual([{ path: "questions", message: "Добавьте хотя бы один вопрос." }]);
  });

  it("готовый вопрос без ошибок", () => {
    expect(validateQuestion(choice())).toEqual([]);
    expect(validateQuestion({ ...newQuestion("open"), text: "Как?", answers: ["так"] })).toEqual([]);
  });

  it("подсказки привязаны к полю вопроса", () => {
    const q = choice({ text: " ", options: ["Да", ""], correct: -1, timeLimit: 2 });
    const errors = validateQuestion(q);
    expect(errorsFor(errors, q.id, "text")).toHaveLength(1);
    expect(errorsFor(errors, q.id, "options")[0]?.message).toMatch(/Заполните/);
    expect(errorsFor(errors, q.id, "correct")).toHaveLength(1);
    expect(errorsFor(errors, q.id, "timeLimit")).toHaveLength(1);
    expect(errorsFor(errors, q.id)).toHaveLength(4);
  });

  it("варианты: от 2 до 6 и без совпадений", () => {
    expect(validateQuestion(choice({ options: ["Да"] })).map((e) => e.message)).toContain("Нужно хотя бы 2 варианта ответа.");
    expect(validateQuestion(choice({ options: ["Да", " да!"] }))[0]?.message).toMatch(/совпадают/);
    expect(validateQuestion(choice({ options: ["1", "2", "3", "4", "5", "6", "7"] }))[0]?.message).toMatch(/Не больше 6/);
  });

  it("открытый вопрос без верного ответа", () => {
    const q = { ...newQuestion("open"), text: "Как?", answers: [" ", "?"] };
    expect(validateQuestion(q).map((e) => e.message)).toEqual(["Добавьте хотя бы один верный ответ."]);
  });
});

describe("parseImport", () => {
  it("пример из интерфейса распознаётся без замечаний", () => {
    const { questions, skipped } = parseImport(IMPORT_EXAMPLE);
    expect(skipped).toEqual([]);
    expect(questions).toHaveLength(5);
    expect(questions[3]?.question).toMatchObject({ kind: "order", options: ["Бриллиантовая рука", "Ирония судьбы", "Москва слезам не верит"] });
    expect(questions[4]?.question).toMatchObject({ kind: "number", number: 1665, unit: "ступеней" });
    expect(questions[0]?.question).toMatchObject({
      kind: "choice",
      text: "Какой город называют Северной столицей?",
      options: ["Москва", "Санкт-Петербург", "Казань"],
      correct: 1,
    });
    expect(questions[0]?.question.round).toBe("География");
    expect(questions[1]?.question).toMatchObject({ kind: "choice", correct: 0, alsoCorrect: [1] });
    expect(questions[2]?.question).toMatchObject({ kind: "open", answers: ["30", "тридцать"], round: null });
    expect(questions.flatMap((q) => q.problems)).toEqual([]);
  });

  it("верный вариант можно пометить по-разному, нумерация вопросов убирается", () => {
    const { questions } = parseImport("1. Раз?\n-* а\n- б\n2) Два?\n- а\n- б *");
    expect(questions.map((q) => [q.question.text, q.question.correct])).toEqual([
      ["Раз?", 0],
      ["Два?", 1],
    ]);
  });

  it("замечания: нет верного, нет вариантов, лишние варианты", () => {
    const { questions } = parseImport("Без верного?\n- а\n- б\nБез вариантов?\nМного?\n* 1\n- 2\n- 3\n- 4\n- 5\n- 6\n- 7");
    expect(questions[0]?.problems).toEqual(["Отметьте правильный вариант."]);
    expect(questions[1]?.problems).toEqual(["Нет ни вариантов («-»), ни ответа («=»)."]);
    expect(questions[2]?.question.options).toHaveLength(6);
    expect(questions[2]?.problems[0]).toMatch(/Больше 6/);
  });

  it("строки до первого вопроса пропускаются с номером", () => {
    expect(parseImport("- а\n\nВопрос?\n= да").skipped).toEqual([1]);
  });
});

describe("steps и score", () => {
  const open = { ...newQuestion("open"), text: "Что зелёное?", answers: ["ёлка", "трава"], points: 50 };
  const speed = { ...newQuestion("speed"), text: "Быстро!", options: ["a", "b"], correct: 1, points: 200, timeLimit: 10 };
  const content = { questions: [choice({ points: 100 }), open, speed] };
  const state = (patch: Partial<SessionState> = {}): SessionState => ({
    ...startState(),
    stage: "question",
    startedAt: 1_000,
    timeLimit: 10,
    ...patch,
  });
  const answer = (pid: string, value: unknown, submittedAt: number | null = 2_000) => ({
    id: pid,
    step: 0,
    pid,
    uid: pid,
    value,
    submittedAt,
  });
  const [first, second, third] = steps(content);
  if (!first || !second || !third) throw new Error("нет шагов");

  it("один шаг на вопрос", () => {
    expect(steps(content).map((s) => s.answerable)).toEqual([true, true, true]);
    expect(steps(content).map((s) => s.id)).toEqual(content.questions.map((q) => q.id));
  });

  it("выбор варианта: очки только за верный номер", () => {
    expect(score(first, [answer("a", 0), answer("b", 1), answer("c", "0")], { state: state() })).toEqual([
      { pid: "a", delta: 100 },
    ]);
  });

  it("открытый ответ: без регистра и ё/е, плюс засчитанные ведущим опечатки", () => {
    const answers = [answer("a", "Елка!"), answer("b", "ёлко"), answer("c", "ель")];
    expect(score(second, answers, { state: state() })).toEqual([{ pid: "a", delta: 50 }]);
    const withTypo = state({ result: { counts: [], correct: 0, total: 0, accepted: [normalizeAnswer("ёлко")] } });
    expect(score(second, answers, { state: withTypo })).toEqual([
      { pid: "a", delta: 50 },
      { pid: "b", delta: 50 },
    ]);
    expect(isCorrect(open, 3)).toBe(false);
  });

  it("на скорость: самый быстрый — максимум, в последнюю секунду — половина", () => {
    // Старт в 1 000 мс, лимит 10 с: ответы через 2 с, 6 с и 10 с; неверный — 0.
    const answers = [answer("fast", 1, 3_000), answer("mid", 1, 7_000), answer("late", 1, 11_000), answer("wrong", 0, 1_500)];
    expect(score(third, answers, { state: state() })).toEqual([
      { pid: "fast", delta: 200 },
      { pid: "mid", delta: 150 },
      { pid: "late", delta: 100 },
    ]);
  });

  it("на скорость: одинаковое время — одинаковые очки, один ответ — максимум", () => {
    const same = [answer("a", 1, 4_000), answer("b", 1, 4_000)];
    expect(score(third, same, { state: state() }).map((d) => d.delta)).toEqual([200, 200]);
    expect(score(third, [answer("a", 1, 9_000)], { state: state() })).toEqual([{ pid: "a", delta: 200 }]);
    // Отметка времени ещё не пришла с сервера — как последняя секунда.
    expect(score(third, [answer("a", 1, 2_000), answer("b", 1, null)], { state: state() }).map((d) => d.delta)).toEqual([
      200, 100,
    ]);
  });
});

describe("ход игры на пульте", () => {
  const q1 = choice({ points: 100, timeLimit: 20 });
  const q2 = { ...newQuestion("open"), text: "Ответ?", answers: ["да"], points: 50 };
  const content = { questions: [q1, q2] };
  const player = (id: string, name: string, joinedAt = 1) => ({
    id,
    name,
    kind: "player" as const,
    teamId: null,
    captainUid: id,
    joinedAt,
  });
  const base: Session = {
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: startState(),
    leaderboard: { a: { name: "Аня", kind: "player", score: 0 }, b: { name: "Боря", kind: "player", score: 0 } },
    createdAt: 0,
  };
  const ans = (step: number, pid: string, value: unknown) => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: 5 });
  const people = [player("a", "Аня"), player("b", "Боря"), player("c", "Аня", 2)];

  it("показать вопрос → ответ → таблица → следующий → награждение → завершить", () => {
    let s = base;
    expect(primaryAction(s, content)).toBe("show");
    s = applyChange(s, showQuestion(s, content), 1);
    expect(s.state).toMatchObject({ stage: "question", startedAt: 1, timeLimit: 20 });
    expect(primaryAction(s, content)).toBe("reveal");
    s = applyChange(s, reveal(s, content, [ans(0, "a", 0), ans(0, "b", 1), ans(0, "c", 0)], people), 2);
    expect(s.state).toMatchObject({ stage: "reveal", revealed: true });
    expect(parseResult(s.state.result)).toEqual({ counts: [2, 1], correct: 2, total: 3, accepted: [] });
    expect(s.leaderboard.a).toMatchObject({ score: 100, last: 100 });
    expect(s.leaderboard.b?.score).toBe(0);
    expect(s.leaderboard.b?.last ?? 0).toBe(0);
    // Опоздавший гость с тем же именем внесён в таблицу с номером.
    expect(s.leaderboard.c).toMatchObject({ name: "Аня 2", score: 100 });
    s = applyChange(s, showBoard(s, content), 3);
    expect(primaryAction(s, content)).toBe("next");
    s = applyChange(s, nextQuestion(s, content), 4);
    expect(s.state).toMatchObject({ step: 1, stage: "ready", startedAt: null });
    s = applyChange(s, showQuestion(s, content), 5);
    s = applyChange(s, toggleAccepted(s, normalizeAnswer("ДА!")), 6);
    s = applyChange(s, reveal(s, content, [ans(1, "b", "да")], people), 7);
    expect(s.leaderboard.b).toMatchObject({ score: 50, last: 50 });
    expect(s.leaderboard.a).toMatchObject({ score: 100, last: 0 });
    s = applyChange(s, showBoard(s, content), 8);
    const board = s;
    // Аня и Аня 2 — по 100 (общее 1 место), Боря — 50 (3 место); второго места нет.
    expect(primaryAction(s, content)).toBe("podium");
    expect(actionLabel(s, content, "podium")).toBe("Награждение");
    s = applyChange(s, startPodium(s), 9);
    expect(s.state.stage).toBe("podium");
    expect(primaryAction(s, content)).toBe("podiumNext");
    expect(actionLabel(s, content, "podiumNext")).toBe("Показать 3 место");
    s = applyChange(s, podiumNext(s), 10);
    expect(actionLabel(s, content, "podiumNext")).toBe("Показать 1 место");
    s = applyChange(s, podiumNext(s), 11);
    expect(primaryAction(s, content)).toBe("finish");
    // «Назад» закрывает места по одному, с заставки — обратно к таблице и итогам шага.
    s = applyChange(s, back(s)?.change ?? {}, 12);
    s = applyChange(s, back(s)?.change ?? {}, 13);
    expect(s.state.stage).toBe("podium");
    s = applyChange(s, back(s)?.change ?? {}, 14);
    expect(s.state.stage).toBe("board");
    expect(s.state.result).toEqual(board.state.result);
    expect(primaryAction(s, content)).toBe("podium");
  });

  it("без очков у всех награждения нет — сразу «Завершить игру»", () => {
    const last = { ...base, state: { ...base.state, step: 1, stage: "board" as const, revealed: true } };
    expect(primaryAction(last, content)).toBe("finish");
  });

  it("«Назад» снимает очки шага, повторный показ ответа считает заново", () => {
    let s = applyChange(base, showQuestion(base, content), 1);
    s = applyChange(s, reveal(s, content, [ans(0, "a", 0)], people), 2);
    expect(s.leaderboard.a?.score).toBe(100);
    const toQuestion = back(s);
    s = applyChange(s, toQuestion?.change ?? {}, 3);
    expect(s.state.stage).toBe("question");
    expect(s.leaderboard.a).toMatchObject({ score: 0, last: 0 });
    s = applyChange(s, reveal(s, content, [ans(0, "a", 0)], people), 4);
    expect(s.leaderboard.a?.score).toBe(100);
  });

  it("«Назад» с открытого вопроса убирает ответы, с «готовы?» — на таблицу прошлого", () => {
    const open = applyChange(base, showQuestion(base, content), 1);
    expect(back(open)?.clearAnswers).toBe(0);
    expect(back(base)).toBeNull();
    const second = { ...base, state: { ...base.state, step: 1 } };
    expect(back(second)?.change.state).toMatchObject({ step: 0, stage: "board" });
  });

  it("открытые ответы собираются в уникальные строки", () => {
    const groups = groupOpenAnswers(q2, [ans(1, "a", "Да"), ans(1, "b", "да!"), ans(1, "c", "lf")], ["lf"]);
    expect(groups).toEqual([
      { key: "да", text: "Да", count: 2, status: "correct" },
      { key: "lf", text: "lf", count: 1, status: "accepted" },
    ]);
  });
});

describe("раунды квиза", () => {
  const q = (round: string | null = null) => choice({ round });
  const content = { questions: [q(), q(), q("Кино"), q(), q("Музыка")] };
  const player = (id: string, name: string) => ({ id, name, kind: "player" as const, teamId: null, captainUid: id, joinedAt: 1 });
  const base: Session = {
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: startState(),
    leaderboard: {},
    createdAt: 0,
  };

  it("до первого названного раунда — безымянный первый; без названий раундов нет", () => {
    expect(quizRounds(content)).toEqual([
      { number: 1, title: "", from: 0, to: 1 },
      { number: 2, title: "Кино", from: 2, to: 3 },
      { number: 3, title: "Музыка", from: 4, to: 4 },
    ]);
    expect(quizRounds({ questions: [q(), q()] })).toEqual([]);
    expect(roundTitle({ number: 1, title: "", from: 0, to: 1 })).toBe("Раунд 1");
    expect(roundTitle({ number: 2, title: "Раунд 2", from: 0, to: 1 })).toBe("Раунд 2");
    expect(roundTitle({ number: 2, title: "Кино", from: 2, to: 3 })).toBe("Раунд 2: Кино");
  });

  it("копия вопроса не начинает новый раунд", () => {
    expect(duplicateQuestion(q("Кино")).round).toBeNull();
  });

  it("конец раунда: итоги раунда → общий счёт → следующий раунд со счётом раунда с нуля", () => {
    const people = [player("a", "Аня"), player("b", "Боря")];
    const ans = (step: number, pid: string) => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: 0, submittedAt: 5 });
    let s: Session = { ...base, leaderboard: {}, state: { ...base.state, step: 1 } };
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, reveal(s, content, [ans(1, "a")], people), 2);
    expect(actionLabel(s, content, "board")).toBe("Итоги раунда");
    s = applyChange(s, showBoard(s, content), 3);
    expect(boardView(s)).toBe("round");
    expect(primaryAction(s, content)).toBe("total");
    s = applyChange(s, showTotal(s), 4);
    expect(boardView(s)).toBe("total");
    expect(primaryAction(s, content)).toBe("next");
    // «Назад» с общего счёта — к итогам раунда, оттуда — к ответу.
    expect(back(s)?.change.state?.result).toMatchObject({ board: "round" });
    s = applyChange(s, nextQuestion(s, content), 5);
    expect(s.leaderboard.a).toMatchObject({ score: 100, roundBase: 100 });
    expect(actionLabel(s, content, "show")).toBe("Начать раунд");
    // В середине раунда — обычная таблица.
    s = applyChange(s, showQuestion(s, content), 6);
    s = applyChange(s, reveal(s, content, [ans(2, "b")], people), 7);
    s = applyChange(s, showBoard(s, content), 8);
    expect(boardView(s)).toBe("plain");
    // Боря догнал Аню: общее первое место, поднялся на одно.
    expect(s.leaderboard.b).toMatchObject({ score: 100, move: 1 });
  });

  it("«Назад» с заставки нового раунда возвращает общий счёт и старт прошлого раунда", () => {
    const people = [player("a", "Аня"), player("b", "Боря")];
    const ans = (step: number, pid: string) => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: 0, submittedAt: 5 });
    let s: Session = { ...base, leaderboard: {}, state: { ...base.state, step: 1 } };
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, reveal(s, content, [ans(1, "a")], people), 2);
    s = applyChange(s, showBoard(s, content), 3);
    s = applyChange(s, showTotal(s), 4);
    s = applyChange(s, nextQuestion(s, content), 5);
    expect(s.leaderboard.a).toMatchObject({ roundBase: 100 });
    s = applyChange(s, back(s)!.change, 6);
    expect(s.state).toMatchObject({ step: 1, stage: "board" });
    expect(boardView(s)).toBe("total");
    expect(s.leaderboard.a).toMatchObject({ score: 100, roundBase: 0 });
    // То же — если ведущий уже открыл первый вопрос раунда и показал ответ.
    {
      let t = applyChange(s, nextQuestion(s, content), 10);
      t = applyChange(t, showQuestion(t, content), 11);
      t = applyChange(t, reveal(t, content, [], people), 12);
      t = applyChange(t, back(t)!.change, 13);
      t = applyChange(t, back(t)!.change, 14);
      t = applyChange(t, back(t)!.change, 15);
      expect(t.state).toMatchObject({ step: 1, stage: "board" });
      expect(boardView(t)).toBe("total");
      expect(t.leaderboard.a).toMatchObject({ score: 100, roundBase: 0 });
    }
    // Дальше назад — к итогам раунда, к ответу и снятию очков: очки раунда не уходят в минус.
    s = applyChange(s, back(s)!.change, 7);
    expect(boardView(s)).toBe("round");
    s = applyChange(s, back(s)!.change, 8);
    s = applyChange(s, back(s)!.change, 9);
    expect(s.leaderboard.a).toMatchObject({ score: 0, roundBase: 0 });
  });

  it("стрелки: обогнавший поднимается, обойдённый опускается", () => {
    const people = [player("a", "Аня"), player("b", "Боря")];
    let s: Session = {
      ...base,
      leaderboard: { a: { name: "Аня", kind: "player", score: 100 }, b: { name: "Боря", kind: "player", score: 50 } },
    };
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, reveal(s, content, [{ id: "0_b", step: 0, pid: "b", uid: "b", value: 0, submittedAt: 5 }], people), 2);
    expect(s.leaderboard.b?.move).toBe(1);
    expect(s.leaderboard.a?.move).toBe(-1);
  });
});

describe("демо-квиз", () => {
  it("8 вопросов всех типов и без ошибок", async () => {
    const { DEMO_QUIZ } = await import("./demo");
    expect(DEMO_QUIZ.content.questions).toHaveLength(8);
    expect(new Set(DEMO_QUIZ.content.questions.map((q) => q.kind))).toEqual(new Set(["choice", "open", "speed"]));
    expect(validateContent(DEMO_QUIZ.content)).toEqual([]);
  });
});

describe("настройки проведения на пульте", () => {
  const q = (round: string | null = null) => ({ ...choice({ points: 100 }), round });
  const session = (_content: { questions: QuizQuestion[] }, state: Partial<SessionState>): Session => ({
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), ...state },
    leaderboard: { a: { name: "Аня", kind: "player", score: 10 } },
    createdAt: 0,
  });

  it("таблица по кнопке: после ответа — сразу следующий вопрос, таблица — дополнительной кнопкой", () => {
    const content = { questions: [q(), q()], settings: { ...DEFAULT_SETTINGS, board: "manual" as const } };
    const s = session(content, { stage: "reveal", step: 0 });
    expect(primaryAction(s, content)).toBe("next");
    expect(extraAction(s, content)).toBe("board");
    const last = session(content, { stage: "reveal", step: 1 });
    expect(primaryAction(last, content)).toBe("podium");
  });

  it("таблица в конце раунда: в середине раунда — дальше, в конце — итоги раунда", () => {
    const content = { questions: [q("Кино"), q(), q("Музыка")], settings: { ...DEFAULT_SETTINGS, board: "rounds" as const } };
    expect(primaryAction(session(content, { stage: "reveal", step: 0 }), content)).toBe("next");
    expect(primaryAction(session(content, { stage: "reveal", step: 1 }), content)).toBe("board");
    expect(boardAfterReveal({ questions: [q(), q()], settings: { ...DEFAULT_SETTINGS, board: "rounds" } }, 1)).toBe(true);
    expect(boardAfterReveal({ questions: [q(), q()], settings: { ...DEFAULT_SETTINGS, board: "rounds" } }, 0)).toBe(false);
  });

  it("без заставки: «Следующий вопрос» сразу открывает вопрос; заставка нового раунда остаётся", () => {
    const content = { questions: [q(), q(), q("Музыка")], settings: { ...DEFAULT_SETTINGS, intro: false } };
    const direct = nextQuestion(session(content, { stage: "board", step: 0 }), content);
    expect(direct.state).toMatchObject({ step: 1, stage: "question", startedAt: "server" });
    const round = nextQuestion(session(content, { stage: "board", step: 1 }), content);
    expect(round.state).toMatchObject({ step: 2, stage: "ready" });
  });
});

describe("гонка «кто первый» и несколько картинок", () => {
  const base = (_questions: QuizQuestion[]): Session =>
    ({
      id: "s",
      code: "1",
      hostId: "h",
      gameId: "g",
      gameTitle: "К",
      mechanic: "quiz",
      gameSnapshot: null,
      themeId: "joyrest",
      playMode: "solo",
      screenMode: "laptop",
      state: { ...startState(), phase: "playing" },
      leaderboard: { a: { name: "Аня", kind: "player", score: 0 }, b: { name: "Боря", kind: "player", score: 0 } },
      createdAt: 0,
    }) as Session;
  const buzzQ = (): QuizQuestion => ({ ...newQuestion("buzz"), id: "b1", answers: ["Queen"], points: 100, steps: 2 });
  const press = (pid: string, at: number) => ({ id: `0_${pid}`, step: 0, pid, uid: pid, value: { buzz: true }, submittedAt: at });

  it("слово первому, «Неверно» — следующему, «Верно» — очки и деления; «Назад» снимает", () => {
    const content: QuizContent = { questions: [buzzQ()], settings: { ...DEFAULT_SETTINGS, raceTarget: 3 } };
    let s = base(content.questions);
    s = applyChange(s, showQuestion(s, content), 1);
    expect(s.state.timeLimit).toBeNull();
    const answers = [press("b", 20), press("a", 10)];
    const sync = buzzSync(s, answers);
    if (!sync) throw new Error("нет записи");
    s = applyChange(s, sync, 2);
    expect(parseResult(s.state.result).buzz).toMatchObject({ current: "a", order: ["a", "b"] });
    expect(buzzSync(s, answers)).toBeNull();
    s = applyChange(s, buzzWrongAnswer(s), 3);
    expect(parseResult(s.state.result).buzz).toMatchObject({ current: "b", out: ["a"] });
    s = applyChange(s, buzzRightAnswer(s, content, answers, []), 4);
    expect(s.state.stage).toBe("reveal");
    expect(s.leaderboard.b).toMatchObject({ score: 100, race: 2, last: 100 });
    expect(s.leaderboard.a?.score).toBe(0);
    const plan = back(s, content);
    if (!plan) throw new Error("нет шага назад");
    s = applyChange(s, plan.change, 5);
    expect(s.state.stage).toBe("question");
    expect(s.leaderboard.b).toMatchObject({ score: 0, race: 0 });
    expect(parseResult(s.state.result).buzz).toMatchObject({ current: "b", winner: null, out: ["a"] });
  });

  it("никто не угадал — «Показать ответ» без очков", () => {
    const content: QuizContent = { questions: [buzzQ()], settings: DEFAULT_SETTINGS };
    let s = base(content.questions);
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, reveal(s, content, [press("a", 5)], []), 2);
    expect(s.leaderboard.a?.score).toBe(0);
    expect(s.state.stage).toBe("reveal");
  });

  it("картинки: очки за каждую угаданную, опечатку можно засчитать по номеру картинки", () => {
    const q: QuizQuestion = {
      ...newQuestion("pictures"),
      id: "p1",
      points: 100,
      pictures: [
        { imageId: "i1", answers: ["Париж"] },
        { imageId: "i2", answers: ["Рим", "Roma"] },
        { imageId: "i3", answers: ["Лондон"] },
        { imageId: "i4", answers: ["Барселона"] },
      ],
    };
    const answers = [
      { id: "0_a", step: 0, pid: "a", uid: "a", value: ["париж", "roma", "лондн", ""], submittedAt: 1 },
      { id: "0_b", step: 0, pid: "b", uid: "b", value: ["Париж", "Рим", "Лондон", "Барселона"], submittedAt: 2 },
    ];
    const step = { id: q.id, answerable: true, question: q };
    expect(score(step, answers, { state: { ...startState(), result: emptyResult() } })).toEqual([
      { pid: "a", delta: 50 },
      { pid: "b", delta: 100 },
    ]);
    // Ведущий засчитал «лондн» у третьей картинки.
    expect(score(step, answers, { state: { ...startState(), result: { ...emptyResult(), accepted: ["2:лондн"] } } })[0]).toEqual({ pid: "a", delta: 75 });
    expect(resultOf(q, answers, []).right).toEqual([2, 2, 1, 1]);
    expect(validateQuestion({ ...q, pictures: [{ imageId: null, answers: [""] }] }).map((e) => e.path)).toContain("questions/p1/pictures");
    expect(mediaIds({ questions: [q] })).toEqual(["i1", "i2", "i3", "i4"]);
  });
});

describe("суперигра в квизе", () => {
  const superQ = (): QuizQuestion => ({
    ...newQuestion("super"),
    id: "s1",
    levels: [
      { points: 100, text: "Столица Франции?", answers: ["Париж"], imageId: null },
      { points: 200, text: "Самая длинная река?", answers: ["Нил"], imageId: null },
      { points: 300, text: "Автор «Мастера и Маргариты»?", answers: ["Булгаков"], imageId: "img3" },
      { points: 500, text: "Год полёта Гагарина?", answers: ["1961"], imageId: null },
    ],
  });
  const session = (): Session =>
    ({
      id: "s",
      code: "1",
      hostId: "h",
      gameId: "g",
      gameTitle: "К",
      mechanic: "quiz",
      gameSnapshot: null,
      themeId: "joyrest",
      playMode: "teams",
      screenMode: "laptop",
      state: { ...startState(), phase: "playing" },
      leaderboard: {
        a: { name: "Лисы", kind: "team", score: 400 },
        b: { name: "Совы", kind: "team", score: 400 },
        c: { name: "Тигры", kind: "team", score: 400 },
      },
      createdAt: 0,
    }) as Session;
  const pick = (pid: string, level: number, text: string, at = 10) => ({ id: `1_${pid}`, step: 1, pid, uid: pid, value: { level, text }, submittedAt: at });

  it("заставка всегда, выбор уровней на экран, верно — плюс, ошибка — минус по правилу, «Назад» снимает", () => {
    const content: QuizContent = { questions: [choice(), superQ()], settings: { ...DEFAULT_SETTINGS, intro: false } };
    let s = session();
    expect(actionLabel(s, content, "next")).toBe("Суперигра");
    s = applyChange(s, nextQuestion(s, content), 1);
    expect(s.state.stage).toBe("ready");
    expect(actionLabel(s, content, "show")).toBe("Открыть уровни");
    s = applyChange(s, showQuestion(s, content), 2);
    expect(s.state.timeLimit).toBe(90);
    const answers = [pick("a", 2, "булгаков"), pick("b", 3, "1962"), pick("c", 2, "Булгакофф")];
    const sync = superSync(s, content, answers);
    if (!sync) throw new Error("нет записи");
    s = applyChange(s, sync, 3);
    expect(parseResult(s.state.result).picks).toEqual({ a: 2, b: 3, c: 2 });
    expect(superSync(s, content, answers)).toBeNull();
    // Ведущий засчитал опечатку Тигров.
    s = applyChange(s, toggleAccepted(s, acceptKey(2, "Булгакофф")), 4);
    expect(actionLabel(s, content, "reveal")).toBe("Показать ответы");
    s = applyChange(s, reveal(s, content, answers, []), 5);
    expect(s.leaderboard.a).toMatchObject({ score: 700, last: 300 });
    expect(s.leaderboard.b).toMatchObject({ score: 150, last: -250 });
    expect(s.leaderboard.c).toMatchObject({ score: 700, last: 300 });
    expect(parseResult(s.state.result).verdicts?.b).toMatchObject({ level: 3, right: false, delta: -250 });
    const plan = back(s, content);
    if (!plan) throw new Error("нет шага назад");
    s = applyChange(s, plan.change, 6);
    expect(s.leaderboard.b?.score).toBe(400);
    expect(s.leaderboard.a?.score).toBe(400);
  });

  it("проверка уровней и картинки уровней в игре", () => {
    const q = superQ();
    expect(validateQuestion(q)).toEqual([]);
    const empty = newQuestion("super");
    expect(validateQuestion(empty).map((e) => e.path)).toContain(`questions/${empty.id}/levels`);
    expect(mediaIds({ questions: [q] })).toEqual(["img3"]);
    const parsed = parseContent({ questions: [q] }).questions[0];
    expect(parsed?.levels?.[2]?.answers).toEqual(["Булгаков"]);
    expect(parsed?.penalty).toBe("halfTop");
    expect(isCorrect(q, { level: 0, text: "париж" })).toBe(true);
  });
});

describe("«Расставь по порядку» и «Угадай число»", () => {
  const answer = (pid: string, value: unknown) => ({ id: pid, step: 0, pid, uid: pid, value, submittedAt: 2_000 });
  const state = { ...startState(), stage: "question" as const, startedAt: 1_000, timeLimit: 30 };
  const order = (patch: Partial<QuizQuestion> = {}): QuizQuestion => ({ ...newQuestion("order"), text: "По годам", options: ["1969", "1975", "1979", "1997"], ...patch });
  const number = (patch: Partial<QuizQuestion> = {}): QuizQuestion => ({ ...newQuestion("number"), text: "Ступеней?", number: 1665, unit: "ступеней", points: 100, ...patch });

  it("карточки на экране перемешаны одинаково везде и никогда не в верном порядке", () => {
    for (let i = 0; i < 200; i++) {
      const q = order({ id: `q${i}` });
      const shown = orderShown(q);
      expect([...shown].sort()).toEqual([0, 1, 2, 3]);
      expect(shown).not.toEqual([0, 1, 2, 3]);
      expect(orderShown(q)).toEqual(shown);
    }
  });

  it("порядок: весь верно — все очки, частично — доля, без частичных — ноль; чужой ответ не считается", () => {
    const q = order();
    const [step] = steps({ questions: [q] });
    if (!step) throw new Error("нет шага");
    const res = score(step, [answer("a", { order: [0, 1, 2, 3] }), answer("b", { order: [0, 1, 3, 2] }), answer("c", { order: [3, 2, 1, 0] }), answer("d", { order: [0, 0, 1, 2] }), answer("e", 2)], { state });
    expect(res).toEqual([
      { pid: "a", delta: 100 },
      { pid: "b", delta: 50 },
    ]);
    const [strict] = steps({ questions: [order({ partial: false })] });
    if (!strict) throw new Error("нет шага");
    expect(score(strict, [answer("a", { order: [0, 1, 2, 3] }), answer("b", { order: [0, 1, 3, 2] })], { state })).toEqual([{ pid: "a", delta: 100 }]);
    expect(isCorrect(q, { order: [0, 1, 2, 3] })).toBe(true);
    const result = resultOf(q, [answer("a", { order: [0, 1, 2, 3] }), answer("b", { order: [0, 1, 3, 2] })], []);
    expect(result).toMatchObject({ correct: 1, total: 2, right: [2, 2, 1, 1] });
  });

  it("число: места по близости 100/60/30, одинаково близкие делят место, точно в цель +50%", () => {
    const q = number();
    const deltas = numberDeltas(q, [answer("a", { guess: 1650 }), answer("b", { guess: 1680 }), answer("c", { guess: 1710 }), answer("d", { guess: 1500 }), answer("e", { guess: 1200 }), answer("x", "много")]);
    const by = Object.fromEntries(deltas.map((d) => [d.pid, d]));
    expect(by.a).toMatchObject({ place: 1, delta: 100 });
    expect(by.b).toMatchObject({ place: 1, delta: 100 });
    expect(by.c).toMatchObject({ place: 2, delta: 60 });
    expect(by.d).toMatchObject({ place: 3, delta: 30 });
    expect(by.e).toMatchObject({ place: 4, delta: 0 });
    expect(by.x).toBeUndefined();
    expect(numberDeltas(q, [answer("a", { guess: 1665 })])[0]?.delta).toBe(150);
    const closest = numberDeltas(number({ scoring: "closest" }), [answer("a", { guess: 1650 }), answer("c", { guess: 1710 })]);
    expect(closest.map((d) => d.delta)).toEqual([100, 0]);
    const [step] = steps({ questions: [q] });
    if (!step) throw new Error("нет шага");
    expect(score(step, [answer("a", { guess: 1650 }), answer("e", { guess: 1200 })], { state })).toEqual([
      { pid: "a", delta: 100 },
      { pid: "e", delta: 60 },
    ]);
    expect(resultOf(q, [answer("a", { guess: 1650 })], []).guesses).toEqual({ a: 1650 });
    expect(parseResult(resultOf(q, [answer("a", { guess: 1650 })], [])).guesses).toEqual({ a: 1650 });
  });

  it("данные: разбор, проверка и смена формата", () => {
    const parsed = parseContent({ questions: [{ id: "n", kind: "number", text: "?", number: 12.5, unit: " км ", scoring: "closest" }, { id: "o", kind: "order", text: "?", options: ["a", "b", "c"], partial: false }] });
    expect(parsed.questions[0]).toMatchObject({ kind: "number", number: 12.5, unit: "км", scoring: "closest" });
    expect(parsed.questions[1]).toMatchObject({ kind: "order", partial: false });
    expect(parseContent({ questions: [{ kind: "number", number: "abc" }] }).questions[0]?.number).toBeNull();
    expect(validateQuestion(number({ number: null })).map((e) => e.message)).toContain("Впишите верное число.");
    expect(validateQuestion(order({ options: ["a", "b"] })).map((e) => e.message)[0]).toMatch(/от 3 до 6 карточек/);
    expect(validateQuestion(order({ options: ["a", "A", "b"] })).map((e) => e.message)).toContain("Две карточки совпадают — порядок не угадать.");
    expect(validateQuestion(order())).toEqual([]);
    expect(validateQuestion(number())).toEqual([]);
    const fromChoice = changeKind(choice({ options: ["Б", "А", "В"], correct: 1 }), "order");
    expect(fromChoice.options).toEqual(["А", "Б", "В"]);
    expect(changeKind({ ...newQuestion("open"), answers: ["1 665"] }, "number").number).toBe(1665);
  });

  it("ход игры: показать ответ начисляет очки и «Назад» их снимает", () => {
    const content: QuizContent = { questions: [number()], settings: DEFAULT_SETTINGS };
    let session = {
      id: "s",
      code: "123456",
      hostId: "h",
      gameId: null,
      gameTitle: "t",
      mechanic: "quiz",
      gameSnapshot: null,
      themeId: "joyrest",
      playMode: "solo",
      screenMode: "laptop",
      state: { ...startState(), phase: "playing", stage: "question", startedAt: 1_000, timeLimit: 30 },
      leaderboard: { a: { name: "Аня", kind: "player", score: 0 }, b: { name: "Боря", kind: "player", score: 0 } },
      createdAt: null,
    } as Session;
    session = applyChange(session, reveal(session, content, [answer("a", { guess: 1660 }), answer("b", { guess: 2000 })], []), 5_000);
    expect(session.leaderboard.a?.score).toBe(100);
    expect(session.leaderboard.b?.score).toBe(60);
    const plan = back(session, content);
    if (!plan) throw new Error("нет «Назад»");
    session = applyChange(session, plan.change, 6_000);
    expect(session.leaderboard.a?.score).toBe(0);
    expect(session.leaderboard.b?.score).toBe(0);
  });
});

describe("шаблон «Квиз: порядок и числа»", () => {
  it("проходит проверку и разбирается без потерь", () => {
    const content = parseContent(DEMO_QUIZ_FORMATS.content);
    expect(validateContent(content)).toEqual([]);
    expect(content.questions.map((q) => q.kind)).toEqual(["order", "number", "order", "number", "order", "number"]);
  });
});

describe("«Назад» через несколько вопросов (QA 23 октября 2026)", () => {
  const player = (id: string, name: string) => ({ id, name, kind: "player" as const, teamId: null, captainUid: id, joinedAt: 1 });
  const people = [player("a", "Аня"), player("b", "Боря")];
  const ans = (step: number, pid: string, value: unknown, submittedAt = 5) => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt });
  const base = (): Session => ({
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), phase: "playing" },
    leaderboard: { a: { name: "Аня", kind: "player", score: 0 }, b: { name: "Боря", kind: "player", score: 0 } },
    createdAt: 0,
  });
  /** «Назад», пока не дойдём до нужного этапа нужного шага. */
  function backTo(s: Session, content: QuizContent, step: number, stage: string): Session {
    let t = s;
    for (let i = 0; i < 40 && !(t.state.step === step && t.state.stage === stage); i++) {
      const plan = back(t, content);
      if (!plan) throw new Error(`назад некуда: шаг ${t.state.step}, ${t.state.stage}`);
      t = applyChange(t, plan.change, 100 + i);
    }
    return t;
  }

  it("Аня верно на 1-м, 2-й до таблицы, заставка 3-го → назад до 1-го → «Показать ответ» — снова 100, не 200", () => {
    const content: QuizContent = { questions: [choice({ points: 100 }), choice({ points: 100 }), choice({ points: 100 })] };
    const a1 = [ans(0, "a", 0)];
    let s = base();
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, reveal(s, content, a1, people), 2);
    s = applyChange(s, showBoard(s, content), 3);
    s = applyChange(s, nextQuestion(s, content), 4);
    s = applyChange(s, showQuestion(s, content), 5);
    s = applyChange(s, reveal(s, content, [ans(1, "a", 1), ans(1, "b", 0)], people), 6);
    s = applyChange(s, showBoard(s, content), 7);
    s = applyChange(s, nextQuestion(s, content), 8);
    expect(s.leaderboard.a?.score).toBe(100);
    expect(s.leaderboard.b?.score).toBe(100);
    s = backTo(s, content, 0, "question");
    expect(s.leaderboard.a?.score).toBe(0);
    expect(s.leaderboard.b?.score).toBe(0);
    s = applyChange(s, reveal(s, content, a1, people), 50);
    expect(s.leaderboard.a?.score).toBe(100);
    expect(s.leaderboard.b?.score).toBe(0);
  });

  it("назад до таблицы прошлого шага — ровно тот этап, итоги и стрелки", () => {
    const content: QuizContent = { questions: [choice(), choice(), choice()] };
    let s = base();
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, reveal(s, content, [ans(0, "b", 0)], people), 2);
    s = applyChange(s, showBoard(s, content), 3);
    const atBoard = s;
    s = applyChange(s, nextQuestion(s, content), 4);
    s = applyChange(s, showQuestion(s, content), 5);
    s = applyChange(s, reveal(s, content, [ans(1, "a", 0)], people), 6);
    s = applyChange(s, nextQuestion(s, content), 7);
    s = backTo(s, content, 0, "board");
    expect(s.leaderboard.b).toMatchObject({ score: 100, last: 100, move: atBoard.leaderboard.b?.move ?? 0 });
    expect(s.leaderboard.a).toMatchObject({ score: 0, last: 0 });
    const { history: _h, ...rest } = (s.state.result ?? {}) as Record<string, unknown>;
    const { history: _h0, ...was } = (atBoard.state.result ?? {}) as Record<string, unknown>;
    expect(rest).toEqual(was);
  });

  it("гонка: после «Назад» через заставку кнопка и победитель на месте, деления снимаются один раз", () => {
    const race: QuizQuestion = { ...newQuestion("buzz"), id: "r1", answers: ["Queen"], points: 100, steps: 2 };
    const content: QuizContent = { questions: [race, choice()], settings: { ...DEFAULT_SETTINGS, raceTarget: 5 } };
    const presses = [{ id: "0_a", step: 0, pid: "a", uid: "a", value: { buzz: true }, submittedAt: 10 }];
    let s = base();
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, buzzSync(s, presses) ?? {}, 2);
    s = applyChange(s, buzzRightAnswer(s, content, presses, people), 3);
    expect(s.leaderboard.a).toMatchObject({ score: 100, race: 2 });
    s = applyChange(s, showBoard(s, content), 4);
    s = applyChange(s, nextQuestion(s, content), 5);
    s = applyChange(s, back(s, content)!.change, 6);
    expect(s.state).toMatchObject({ step: 0, stage: "board" });
    expect(parseResult(s.state.result).buzz).toMatchObject({ winner: "a", order: ["a"] });
    s = backTo(s, content, 0, "question");
    expect(s.leaderboard.a).toMatchObject({ score: 0, race: 0 });
    expect(parseResult(s.state.result).buzz).toMatchObject({ current: "a", winner: null });
  });

  it("суперигра и «Угадай число»: итоги шага возвращаются вместе с этапом", () => {
    const num: QuizQuestion = { ...newQuestion("number"), id: "n1", text: "Ступеней?", number: 1665, points: 100 };
    const content: QuizContent = { questions: [num, choice()] };
    let s = base();
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, reveal(s, content, [ans(0, "a", { guess: 1600 }), ans(0, "b", { guess: 1665 })], people), 2);
    s = applyChange(s, showBoard(s, content), 3);
    s = applyChange(s, nextQuestion(s, content), 4);
    s = applyChange(s, back(s, content)!.change, 5);
    expect(parseResult(s.state.result).guesses).toEqual({ a: 1600, b: 1665 });
    expect(s.leaderboard.b).toMatchObject({ score: 150, last: 150 });
  });

  it("таблица «по кнопке» и «в конце раунда»: назад с заставки — на ответ, таблицу не показывали", () => {
    for (const board of ["manual", "rounds"] as const) {
      const content: QuizContent = { questions: [choice(), choice()], settings: { ...DEFAULT_SETTINGS, board } };
      let s = base();
      s = applyChange(s, showQuestion(s, content), 1);
      s = applyChange(s, reveal(s, content, [ans(0, "a", 0)], people), 2);
      expect(primaryAction(s, content)).toBe("next");
      s = applyChange(s, nextQuestion(s, content), 3);
      s = applyChange(s, back(s, content)!.change, 4);
      expect(s.state).toMatchObject({ step: 0, stage: "reveal" });
      expect(parseResult(s.state.result).counts).toEqual([1, 0]);
    }
  });

  it("без заставки: назад с открытого вопроса через «готовы?» — к прошлому шагу", () => {
    const content: QuizContent = { questions: [choice(), choice()], settings: { ...DEFAULT_SETTINGS, intro: false } };
    let s = base();
    s = applyChange(s, showQuestion(s, content), 1);
    s = applyChange(s, reveal(s, content, [ans(0, "a", 0)], people), 2);
    s = applyChange(s, showBoard(s, content), 3);
    s = applyChange(s, nextQuestion(s, content), 4);
    expect(s.state.stage).toBe("question");
    s = backTo(s, content, 0, "question");
    expect(s.leaderboard.a?.score).toBe(0);
  });

  it("длинная игра: стопка ограничена по размеру, назад за её край нельзя (очки не портятся)", () => {
    const content: QuizContent = { questions: Array.from({ length: 30 }, () => choice()) };
    const crowd: Record<string, Session["leaderboard"][string]> = {};
    for (let i = 0; i < 500; i++) crowd[`guest-${String(i).padStart(24, "0")}`] = { name: `Гость ${i}`, kind: "player", score: 0 };
    let s: Session = { ...base(), leaderboard: crowd };
    for (let step = 0; step < 29; step++) {
      s = applyChange(s, showQuestion(s, content), step * 10 + 1);
      const all = Object.keys(crowd).map((pid) => ans(step, pid, 0));
      s = applyChange(s, reveal(s, content, all, []), step * 10 + 2);
      s = applyChange(s, showBoard(s, content), step * 10 + 3);
      s = applyChange(s, nextQuestion(s, content), step * 10 + 4);
    }
    expect(JSON.stringify(s.state.result).length).toBeLessThan(45_000);
    let guard = 0;
    for (let plan = back(s, content); plan && guard < 400; plan = back(s, content), guard++) s = applyChange(s, plan.change, 1000 + guard);
    const first = Object.values(s.leaderboard)[0];
    // Снимали ровно столько шагов, сколько помнили: очки = 100 × число не снятых шагов.
    expect((first?.score ?? 0) % 100).toBe(0);
    expect(s.state.step).toBeGreaterThan(0);
    expect(first?.score).toBe(s.state.step * 100);
  });
});
