import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { allQuestions, answerPoints, createHundred, importHundred, parseHundred, ranked, reversePoints, roundsFromImport, sourceLine, type HundredContent } from "./content";
import { DEMO_HUNDRED } from "./demo";
import {
  armFace,
  bigEnter,
  bigFinish,
  bigSecond,
  bigStart,
  choosePlaying,
  defaultPair,
  hallAccept,
  hallClose,
  hallOpen,
  hallOpenNext,
  hallOpenRow,
  hallPayouts,
  hundredBack,
  hundredBuzzSync,
  hundredPrimary,
  hundredSteps,
  missAnswer,
  nextQuestion,
  openAnswer,
  parseHundredResult,
  questionOf,
  score,
  showRest,
  startFace,
} from "./logic";
import { editDistance, matchedAnswers, matchWord, unmatchedWords } from "./match";
import { validateHundred } from "./validate";

const teams: Participant[] = ["fox", "tiger", "owl"].map((id, i) => ({ id, name: id, kind: "team", teamId: null, captainUid: `${id}-phone`, joinedAt: i + 1 }));

function base(_content: HundredContent, playMode: "solo" | "teams" = "teams"): Session {
  return {
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "",
    mechanic: "hundred",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode,
    screenMode: "laptop",
    state: { ...startState(), phase: "playing" },
    leaderboard: {},
    createdAt: 0,
  };
}

let clock = 1_000_000;
function apply(s: Session, change: SessionChange | null | undefined): Session {
  expect(change).toBeTruthy();
  clock += 1000;
  return applyChange(s, change ?? {}, clock);
}

const wedding = parseHundred(DEMO_HUNDRED[0]?.content);
const hall = parseHundred(DEMO_HUNDRED[3]?.content);
const r = (s: Session) => parseHundredResult(s.state.result);
const scoreOf = (s: Session, p: string) => s.leaderboard[p]?.score ?? 0;

function press(s: Session, pids: string[]): Answer[] {
  return pids.map((pid, i) => ({ id: `${s.state.step}_${pid}`, step: s.state.step, pid, uid: pid, value: { buzz: true }, submittedAt: clock + 100 + i * 50 }));
}

describe("содержимое", () => {
  it("parse устойчив к мусору", () => {
    for (const raw of [null, 5, "x", [], { rounds: "x" }, { rounds: [null, 1, { kind: "zzz", questions: [{ answers: [{ points: 1e9, synonyms: [1, "a"] }] }] }] }]) {
      const c = parseHundred(raw);
      expect(Array.isArray(c.rounds)).toBe(true);
      for (const { question } of allQuestions(c)) for (const a of question.answers) expect(a.points).toBeLessThanOrEqual(100);
    }
    const c = parseHundred({ rounds: [{ kind: "big", questions: Array.from({ length: 9 }, () => ({ text: "в" })) }], mode: "hall", buzzTime: 999, look: "nope" });
    expect(c.rounds[0]?.questions).toHaveLength(5);
    expect(c.mode).toBe("hall");
    expect(c.buzzTime).toBe(30);
    expect(c.look).toBe("classic");
    expect(parseHundred(wedding)).toEqual(wedding);
  });

  it("шаблоны проходят проверку, очки — оценка JoyRest, не опрос", () => {
    expect(DEMO_HUNDRED.length).toBeGreaterThanOrEqual(4);
    let total = 0;
    for (const d of DEMO_HUNDRED) {
      const c = parseHundred(d.content);
      expect(validateHundred(c), d.title).toEqual([]);
      for (const { question } of allQuestions(c)) {
        total++;
        expect(question.source).toBe("estimate");
        expect(sourceLine(question)).toBe("Оценка JoyRest, не опрос");
      }
    }
    expect(total).toBeGreaterThanOrEqual(20);
    expect(total).toBeLessThanOrEqual(40);
  });

  it("validate: проценты, число ответов, пустой вопрос, «Большая игра» — последней", () => {
    const c = createHundred();
    expect(validateHundred(c).length).toBeGreaterThan(0);
    const q = c.rounds[0]?.questions[0];
    if (!q) throw new Error("нет вопроса");
    q.text = "Вопрос?";
    q.answers = q.answers.map((a, i) => ({ ...a, text: `Ответ ${i}`, points: 30 }));
    expect(validateHundred(c).some((e) => e.path === `questions/${q.id}/points` && e.message.includes("больше 100"))).toBe(true);
    q.answers = q.answers.slice(0, 3);
    expect(validateHundred(c).some((e) => e.path === `questions/${q.id}/answers`)).toBe(true);
    const moved = { ...wedding, rounds: [...wedding.rounds].reverse() };
    expect(validateHundred(moved).some((e) => e.path === "rounds")).toBe(true);
    expect(validateHundred({ ...wedding, rounds: [] }).some((e) => e.path === "rounds")).toBe(true);
  });

  it("опрос подписан честно: число ответивших", () => {
    const q = { ...(wedding.rounds[0]?.questions[0] ?? createHundred().rounds[0]!.questions[0]!), source: "poll" as const, pollCount: 46 };
    expect(sourceLine(q)).toBe("Опрос гостей · 46 человек · очки — в пересчёте на 100");
    expect(sourceLine({ ...q, pollCount: 22 })).toContain("22 человека");
  });

  it("импорт списком: ответы с очками и синонимами, заголовки раундов", () => {
    const { questions, skipped } = importHundred(`# Двойная игра
Что дарят на свадьбу?
- Деньги в конверте = 39 | конверт, деньги
- Посуду = 14
- Технику = 12 | чайник; пылесос
- Цветы = 8
- Бельё

# Большая игра
Фрукт?
- Яблоко = 40
- Банан = 20
- Груша = 10
- Киви = 5
Овощ?
- Морковь = 30
- Картошка = 30
- Лук = 10
- Капуста = 10`);
    expect(skipped).toEqual([]);
    expect(questions).toHaveLength(3);
    const first = questions[0];
    expect(first?.kind).toBe("double");
    expect(first?.question.answers[0]).toMatchObject({ text: "Деньги в конверте", points: 39, synonyms: ["конверт", "деньги"] });
    expect(first?.question.answers[2]?.synonyms).toEqual(["чайник", "пылесос"]);
    expect(first?.problems.some((p) => p.includes("Бельё"))).toBe(true);
    const rounds = roundsFromImport(questions);
    expect(rounds.map((x) => [x.kind, x.questions.length])).toEqual([
      ["double", 1],
      ["big", 2],
    ]);
  });
});

describe("очки и «Игра наоборот»", () => {
  it("наоборот: популярный — 15, редкий — 240", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => reversePoints(6, i))).toEqual([15, 30, 60, 120, 180, 240]);
    expect(reversePoints(4, 3)).toBe(240);
    expect(reversePoints(8, 0)).toBe(5);
    const q = wedding.rounds[3]?.questions[0];
    if (!q) throw new Error("нет вопроса");
    const list = ranked(q);
    expect(answerPoints("reverse", q, list[0]?.id ?? "")).toBe(15);
    expect(answerPoints("reverse", q, list[5]?.id ?? "")).toBe(240);
    expect(answerPoints("double", q, list[0]?.id ?? "")).toBe(list[0]?.points);
  });

  it("шаги: по вопросу на шаг", () => {
    expect(hundredSteps(wedding)).toHaveLength(9);
    expect(defaultPair(wedding, ["a", "b", "c"], 0)).toEqual(["a", "b"]);
    expect(defaultPair(wedding, ["a", "b", "c"], 1)).toEqual(["c", "a"]);
    expect(defaultPair(wedding, ["a"], 0)).toEqual(["a"]);
  });
});

describe("классика: обычный раунд", () => {
  function toPlay(content: HundredContent, roundIndex = 0) {
    let s = base(content);
    for (let i = 0; i < roundIndex; i++) s = { ...s, state: { ...s.state, result: { ...r(s), round: i + 1, mode: "intro" } } };
    s = apply(s, startFace(s, content, teams));
    expect(r(s).pair).toEqual(roundIndex === 0 ? ["fox", "tiger"] : r(s).pair);
    expect(s.state.stage).toBe("question");
    expect(hundredPrimary(s, content)).toBe("arm");
    const before = s.state.step;
    s = apply(s, armFace(s, content, teams));
    expect(s.state.step).toBe(before + 1);
    expect(s.state.timeLimit).toBe(content.buzzTime);
    // Нажатие третьей команды (не играет) не считается.
    s = apply(s, hundredBuzzSync(s, press(s, ["owl", "tiger", "fox"])));
    expect(r(s).buzz.current).toBe(r(s).pair.includes("tiger") ? "tiger" : r(s).buzz.current);
    return s;
  }

  it("розыгрыш → играют Тигры → банк × 2 при всех открытых ответах", () => {
    const double = { ...wedding, rounds: [wedding.rounds[1]!, ...wedding.rounds.slice(2)] };
    let s = toPlay(double);
    const q = questionOf(double, r(s));
    if (!q) throw new Error("нет вопроса");
    const list = ranked(q);
    s = apply(s, openAnswer(s, double, teams, list[1]!.id));
    expect(r(s).bank).toBe(list[1]!.points);
    s = apply(s, choosePlaying(s, teams, "tiger"));
    expect(s.state.stage).toBe("reveal");
    expect(hundredPrimary(s, double)).toBe("play");
    for (const a of list) if (!r(s).opened.includes(a.id)) s = apply(s, openAnswer(s, double, teams, a.id));
    const sum = list.reduce((x, a) => x + a.points, 0);
    expect(r(s).mode).toBe("done");
    expect(r(s).winner).toBe("tiger");
    expect(r(s).award).toBe(sum * 2);
    expect(scoreOf(s, "tiger")).toBe(sum * 2);
    expect(score({ id: "x", answerable: true, question: q, kind: "double", hall: false }, [], { state: s.state })).toEqual([{ pid: "tiger", delta: sum * 2 }]);
    // «Назад» — одно действие, очки снимаются.
    const back = hundredBack(s, double);
    s = apply(s, back?.change);
    expect(scoreOf(s, "tiger")).toBe(0);
    expect(r(s).mode).toBe("play");
  });

  it("три крестика → шанс соперника: угадал — банк ему, не угадал — банк первой команде", () => {
    let s = toPlay(wedding);
    const q = questionOf(wedding, r(s))!;
    const list = ranked(q);
    s = apply(s, choosePlaying(s, teams, "fox"));
    s = apply(s, openAnswer(s, wedding, teams, list[0]!.id));
    for (let i = 0; i < 3; i++) s = apply(s, missAnswer(s, wedding, teams));
    expect(r(s).mode).toBe("steal");
    expect(r(s).strikes).toBe(3);
    const atSteal = s;
    // Шанс использован: банк (ответ лис + ответ тигров) — тиграм.
    s = apply(s, openAnswer(s, wedding, teams, list[1]!.id));
    expect(r(s).winner).toBe("tiger");
    expect(scoreOf(s, "tiger")).toBe(list[0]!.points + list[1]!.points);
    expect(scoreOf(s, "fox")).toBe(0);
    // Шанс мимо: банк — лисам.
    let t = apply(atSteal, missAnswer(atSteal, wedding, teams));
    expect(r(t).winner).toBe("fox");
    expect(scoreOf(t, "fox")).toBe(list[0]!.points);
    // Остальные ответы — без очков.
    expect(hundredPrimary(t, wedding)).toBe("rest");
    t = apply(t, showRest(t, wedding, teams));
    expect(scoreOf(t, "fox")).toBe(list[0]!.points);
    expect(hundredPrimary(t, wedding)).toBe("next");
    t = apply(t, nextQuestion(t, wedding, teams));
    expect(r(t).round).toBe(1);
    expect(r(t).mode).toBe("intro");
    expect(r(t).pair).toEqual(["owl", "fox"]);
  });

  it("«Назад» с каждого действия до самого начала, нажатия после отсчёта убираются", () => {
    let s = toPlay(wedding);
    const list = ranked(questionOf(wedding, r(s))!);
    s = apply(s, choosePlaying(s, teams, "fox"));
    s = apply(s, openAnswer(s, wedding, teams, list[0]!.id));
    s = apply(s, missAnswer(s, wedding, teams));
    let steps = 0;
    let clear: number[] = [];
    for (let back = hundredBack(s, wedding); back; back = hundredBack(s, wedding)) {
      clear = [...clear, ...back.clear];
      s = apply(s, back.change);
      steps++;
    }
    expect(steps).toBe(5);
    expect(r(s).mode).toBe("intro");
    expect(s.state.step).toBe(0);
    expect(clear).toContain(1);
    expect(Object.values(s.leaderboard).every((e) => e.score === 0)).toBe(true);
  });

  it("промах в розыгрыше — слово следующему нажавшему, крестик не ставится", () => {
    let s = toPlay(wedding);
    const first = r(s).buzz.current;
    s = apply(s, missAnswer(s, wedding, teams));
    expect(r(s).faceMiss).toBe(1);
    expect(r(s).strikes).toBe(0);
    expect(r(s).buzz.current).not.toBe(first);
  });

  it("«Игра наоборот»: банк по очкам снизу вверх", () => {
    const reverse = { ...wedding, rounds: [wedding.rounds[3]!] };
    let s = toPlay(reverse);
    const list = ranked(questionOf(reverse, r(s))!);
    s = apply(s, choosePlaying(s, teams, "fox"));
    s = apply(s, openAnswer(s, reverse, teams, list[5]!.id));
    s = apply(s, openAnswer(s, reverse, teams, list[0]!.id));
    expect(r(s).bank).toBe(240 + 15);
  });
});

describe("Большая игра", () => {
  it("два игрока, повтор не принимается, бонус за цель", () => {
    const content: HundredContent = { ...wedding, rounds: [wedding.rounds[0]!, wedding.rounds[4]!] };
    let s = base(content);
    s = { ...s, leaderboard: { fox: { name: "fox", kind: "team", score: 50 }, tiger: { name: "tiger", kind: "team", score: 10 } } };
    s = { ...s, state: { ...s.state, result: { round: 0, mode: "done", pair: ["fox", "tiger"] } } };
    s = apply(s, nextQuestion(s, content, teams));
    expect(r(s).big.team).toBe("fox");
    expect(hundredPrimary(s, content)).toBe("bigStart");
    s = apply(s, bigStart(s, content, teams));
    expect(s.state.timeLimit).toBe(20);
    const round = content.rounds[1]!;
    round.questions.forEach((q, i) => {
      s = apply(s, bigEnter(s, content, teams, i, i === 4 ? null : ranked(q)[0]!.id));
    });
    expect(hundredPrimary(s, content)).toBe("bigSecond");
    s = apply(s, bigSecond(s, teams));
    s = apply(s, bigStart(s, content, teams));
    expect(s.state.timeLimit).toBe(25);
    const q0 = round.questions[0]!;
    s = apply(s, bigEnter(s, content, teams, 0, ranked(q0)[0]!.id));
    expect(r(s).big.repeat).toBe(0);
    expect(r(s).big.cells[1][0]).toBeNull();
    round.questions.forEach((q, i) => {
      s = apply(s, bigEnter(s, content, teams, i, ranked(q)[1]!.id));
    });
    const total = round.questions.reduce((x, q, i) => x + (i === 4 ? 0 : ranked(q)[0]!.points) + ranked(q)[1]!.points, 0);
    s = apply(s, bigFinish(s, content, teams));
    expect(r(s).mode).toBe("bigDone");
    const expected = total + (total >= content.bigGoal ? content.bigBonus : 0);
    expect(r(s).award).toBe(expected);
    expect(scoreOf(s, "fox")).toBe(50 + expected);
    expect(hundredPrimary(s, content)).toBe("award");
    s = apply(s, hundredBack(s, content)?.change);
    expect(scoreOf(s, "fox")).toBe(50);
  });
});

describe("«Весь зал»", () => {
  it("нормализация и опечатки", () => {
    const q = hall.rounds[1]!.questions[0]!; // домашнее животное
    const cat = ranked(q)[0]!.id;
    expect(matchWord(q, "КОТ!", {})).toBe(cat);
    expect(matchWord(q, "  кошка ", {})).toBe(cat);
    expect(matchWord(q, "кошька", {})).toBe(cat);
    expect(matchWord(q, "черепашенька", {})).toBeNull();
    expect(matchWord(q, "жираф", {})).toBeNull();
    expect(matchWord(q, "жираф", { жираф: cat })).toBe(cat);
    expect(matchedAnswers(q, ["кот", "котик", "пёс"], {})).toHaveLength(2);
    expect(editDistance("абв", "абв", 1)).toBe(0);
    expect(editDistance("абвгд", "абвгдеё", 1)).toBe(2);
    const wedding0 = wedding.rounds[0]!.questions[0]!;
    expect(matchWord(wedding0, "конверт с деньгами", {})).toBe(ranked(wedding0)[0]!.id);
  });

  it("каждый совпавший ответ приносит очки, нераспознанные засчитывает ведущий", () => {
    const content: HundredContent = { ...hall, rounds: [hall.rounds[1]!, hall.rounds[0]!] }; // ×2 — двойная
    let s = base(content, "solo");
    const players: Participant[] = ["a", "b", "c"].map((id, i) => ({ id, name: id, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));
    s = apply(s, hallOpen(s, content, players));
    expect(s.state.stage).toBe("question");
    expect(r(s).changeable).toBe(true);
    const step = s.state.step;
    const answers: Answer[] = [
      { id: `${step}_a`, step, pid: "a", uid: "a", value: { words: ["кошка", "собака", "кот"] }, submittedAt: clock },
      { id: `${step}_b`, step, pid: "b", uid: "b", value: { words: ["хомячок", "морская свинка"] }, submittedAt: clock },
      { id: `${step}_c`, step, pid: "c", uid: "c", value: { words: ["жираф"] }, submittedAt: clock },
    ];
    s = apply(s, hallClose(s, players));
    expect(hundredPrimary(s, content)).toBe("hallRows");
    const q = content.rounds[0]!.questions[0]!;
    const list = ranked(q);
    const odd = unmatchedWords(q, answers, {});
    expect(odd.map((u) => u.label)).toEqual(["жираф", "морская свинка"]);
    s = apply(s, hallOpenRow(s, content, players, answers, list[0]!.id)); // кошка
    expect(scoreOf(s, "a")).toBe(list[0]!.points * 2);
    expect(scoreOf(s, "b")).toBe(0);
    // «морская свинка» → пятый ответ: ответ ещё не открыт — очки придут при открытии.
    s = apply(s, hallAccept(s, content, players, answers, odd[1]!.key, list[4]!.id));
    expect(scoreOf(s, "b")).toBe(0);
    s = apply(s, hallOpenRow(s, content, players, answers, list[4]!.id));
    expect(scoreOf(s, "b")).toBe(list[4]!.points * 2);
    // Засчитали после открытия — очки сразу.
    s = apply(s, hallAccept(s, content, players, answers, odd[0]!.key, list[0]!.id));
    expect(scoreOf(s, "c")).toBe(list[0]!.points * 2);
    while (hundredPrimary(s, content) === "hallRows") s = apply(s, hallOpenNext(s, content, players, answers));
    expect(scoreOf(s, "a")).toBe((list[0]!.points + list[1]!.points) * 2);
    expect(scoreOf(s, "b")).toBe((list[2]!.points + list[4]!.points) * 2);
    expect(hallPayouts(content, r(s), answers)[list[0]!.id]).toEqual({ a: list[0]!.points * 2, c: list[0]!.points * 2 });
    expect(r(s).hits[list[0]!.id]).toBe(2);
    const step2 = { id: "x", answerable: true, question: q, kind: "double" as const, hall: true };
    expect(score(step2, answers, { state: s.state }).find((d) => d.pid === "a")?.delta).toBe(scoreOf(s, "a"));
    // «Назад» снимает ровно последнее действие (последняя открытая строка — самая популярная из оставшихся).
    const total = Object.values(s.leaderboard).reduce((x, e) => x + e.score, 0);
    const last = ranked(q).find((a) => !r(s).undo.at(-1)?.result.opened.includes(a.id))!;
    const back = hundredBack(s, content, answers);
    s = apply(s, back?.change);
    const lost = Object.values(back?.change.addScore ?? {}).reduce((x, n) => x + n, 0);
    expect(lost).toBe(-Object.keys(hallPayouts(content, { ...r(s), opened: [last.id] }, answers)[last.id] ?? {}).length * last.points * 2);
    expect(Object.values(s.leaderboard).reduce((x, e) => x + e.score, 0)).toBe(total + lost);
    expect(hundredPrimary(s, content)).toBe("hallRows");
    // Ещё назад до «Закрыть ответы» — все очки сняты.
    for (let b = hundredBack(s, content, answers); b && r(s).mode === "hallCheck"; b = hundredBack(s, content, answers)) s = apply(s, b.change);
    expect(Object.values(s.leaderboard).every((e) => e.score === 0)).toBe(true);
  });

  it("«Большая игра» в «Весь зал» — обычные вопросы зала", () => {
    let s = base(hall, "solo");
    s = { ...s, state: { ...s.state, result: { round: 4, q: 0, mode: "hallCheck", opened: hall.rounds[4]!.questions[0]!.answers.map((a) => a.id) } } };
    expect(hundredPrimary(s, hall)).toBe("next");
    s = apply(s, nextQuestion(s, hall, []));
    expect(r(s).round).toBe(4);
    expect(r(s).q).toBe(1);
    expect(hundredPrimary(s, hall)).toBe("hallOpen");
  });
});
