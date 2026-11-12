import { describe, expect, it } from "vitest";
import type { Session } from "../data/types";
import { acceptsAnswers, addTimeChange, adjustBoard, answerDeadline, answersMark, answersOpen, applyChange, closesAnswers, meetsExpect, olderThanShow, placeAfter, secondsLeft, staleAnswer, startState } from "./session";

const session: Session = {
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
  leaderboard: { a: { name: "Аня", kind: "player", score: 5 } },
  createdAt: 0,
};

describe("окно ответа", () => {
  const open = { ...startState(), stage: "question" as const, startedAt: 10_000, timeLimit: 20 };

  it("таймер по часам сервера", () => {
    expect(answerDeadline(open)).toBe(30_000);
    expect(secondsLeft(open, 10_000)).toBe(20);
    expect(secondsLeft(open, 29_100)).toBe(1);
    expect(secondsLeft(open, 40_000)).toBe(0);
    expect(secondsLeft(startState(), 0)).toBeNull();
  });

  it("ответы — только на открытый вопрос и пока идёт время", () => {
    expect(acceptsAnswers(open, 20_000)).toBe(true);
    expect(acceptsAnswers(open, 31_000)).toBe(false);
    expect(acceptsAnswers({ ...open, stage: "reveal", revealed: true }, 20_000)).toBe(false);
    expect(acceptsAnswers(startState(), 0)).toBe(false);
  });
});

describe("applyChange (репетиция)", () => {
  it("меняет состояние и таблицу, время сервера — текущее", () => {
    const next = applyChange(
      session,
      { state: { stage: "question", startedAt: "server" }, leaderboard: { a: null, b: { name: "Боря", kind: "player", score: 1 } } },
      777,
    );
    expect(next.state.stage).toBe("question");
    expect(next.state.startedAt).toBe(777);
    expect(next.leaderboard).toEqual({ b: { name: "Боря", kind: "player", score: 1 } });
    expect(session.leaderboard.a).toBeDefined();
  });

  it("игра пошла дальше — таблица «посмотреть сейчас» уходит с экрана", () => {
    const peeking = { ...session, state: { ...session.state, peek: "total" as const } };
    expect(applyChange(peeking, { state: { stage: "reveal" } }, 1).state.peek).toBeNull();
    expect(applyChange(peeking, { state: { answered: 3 } }, 1).state.peek).toBe("total");
  });
});

describe("ожидание пульта и правки таблицы", () => {
  it("изменение — только если игра там, где её видел пульт", () => {
    const state = { ...startState(), step: 2, stage: "question" as const };
    expect(meetsExpect(state, undefined)).toBe(true);
    expect(meetsExpect(state, { phase: "playing", step: 2, stage: "question" })).toBe(true);
    expect(meetsExpect(state, { step: 1 })).toBe(false);
    expect(meetsExpect(state, { stage: "ready" })).toBe(false);
    expect(meetsExpect(state, { phase: "lobby" })).toBe(false);
  });

  it("ожидание слайда: тот же id — да, другой или «слайда нет» — нет", () => {
    const slide = { id: "tb1", kind: "tech" as const, title: "Пауза", text: "", lines: [], endsAt: 1 };
    const withSlide = { ...startState(), slide };
    expect(meetsExpect(withSlide, { slide: "tb1" })).toBe(true);
    expect(meetsExpect(withSlide, { slide: "jq1" })).toBe(false);
    expect(meetsExpect(withSlide, { slide: null })).toBe(false);
    expect(meetsExpect(startState(), { slide: null })).toBe(true);
    expect(meetsExpect(startState(), { slide: "tb1" })).toBe(false);
  });

  it("прибавка очков и новое имя — только у тех, кто в таблице", () => {
    const board = { a: { name: "Аня", kind: "player" as const, score: 10, last: 5 } };
    expect(adjustBoard(board, { a: 10, x: 5 }, { a: "Анна", y: "Боря" })).toEqual({ a: { name: "Анна", kind: "player", score: 20, last: 5 } });
    const twice = adjustBoard(adjustBoard(board, { a: 10 }), { a: 10 });
    expect(twice.a?.score).toBe(30);
  });
});

describe("отпечаток итогов шага (expect.result)", () => {
  it("не зависит от порядка ключей и пропущенных undefined", async () => {
    const { resultKey } = await import("./session");
    expect(resultKey({ a: 1, b: { y: [1, 2], x: "т" } })).toBe(resultKey({ b: { x: "т", y: [1, 2] }, a: 1, c: undefined }));
    expect(resultKey(null)).toBe(resultKey(undefined));
    expect(resultKey({ judged: true })).not.toBe(resultKey({ judged: false }));
  });

  it("второй пульт с устаревшим видом не проходит", async () => {
    const { meetsExpect, resultKey, startState } = await import("./session");
    const state = { ...startState(), result: { judged: "c1" } };
    expect(meetsExpect(state, { step: 0, result: resultKey({ judged: "c1" }) })).toBe(true);
    expect(meetsExpect(state, { step: 0, result: resultKey(null) })).toBe(false);
  });
});

describe("+10 секунд", () => {
  const open = { ...startState(), stage: "question" as const, startedAt: 100_000, timeLimit: 20 };

  it("продлевает открытый вопрос; время вышло — ещё 10 секунд с этой минуты", () => {
    expect(addTimeChange(open, 105_000)).toEqual({ state: { timeLimit: 30 }, expect: { phase: "playing", step: 0, stage: "question" } });
    // Прошло 45 с при лимите 20 — гости снова отвечают до 55-й секунды.
    expect(addTimeChange(open, 145_000)?.state?.timeLimit).toBe(55);
    expect(acceptsAnswers({ ...open, timeLimit: 55 }, 150_000)).toBe(true);
  });

  it("нечего продлевать: вопрос не открыт, без таймера, ответ показан, потолок", () => {
    expect(addTimeChange({ ...open, stage: "reveal" }, 105_000)).toBeNull();
    expect(addTimeChange({ ...open, timeLimit: null }, 105_000)).toBeNull();
    expect(addTimeChange({ ...open, revealed: true }, 105_000)).toBeNull();
    // Таймер ещё идёт и упёрся в потолок — прибавлять некуда.
    expect(addTimeChange({ ...open, timeLimit: 900 }, 105_000)).toBeNull();
  });

  it("долгий перерыв при открытом вопросе: время вышло — кнопка работает и через 15 минут, и через час", () => {
    // Раньше через 15 минут после показа вопроса кнопка гасла навсегда (паспорт общей части, Н-4).
    const late = addTimeChange(open, 100_000 + 905_000);
    expect(late?.state?.timeLimit).toBe(915);
    expect(acceptsAnswers({ ...open, timeLimit: 915 }, 100_000 + 910_000)).toBe(true);
    expect(addTimeChange(open, 100_000 + 3_600_000)?.state?.timeLimit).toBe(3610);
    // Упёрся в потолок, время вышло — снова можно дать 10 секунд.
    expect(addTimeChange({ ...open, timeLimit: 900 }, 100_000 + 901_000)?.state?.timeLimit).toBe(911);
    // Открыли заново после потолка, таймер идёт — ещё 10 секунд прибавляются (раньше кнопка гасла до конца отсчёта).
    expect(addTimeChange({ ...open, timeLimit: 915 }, 100_000 + 906_000)?.state?.timeLimit).toBe(925);
    expect(addTimeChange({ ...open, timeLimit: 3610 }, 100_000 + 3_601_000)?.state?.timeLimit).toBe(3620);
    // Открыли заново у самого потолка (на 889-й секунде, лимит стал 899) — следующее «+10» не упирается в 900.
    expect(addTimeChange(open, 100_000 + 889_000)?.state?.timeLimit).toBe(899);
    expect(addTimeChange({ ...open, timeLimit: 899 }, 100_000 + 890_000)?.state?.timeLimit).toBe(909);
    // Разумный предел — 12 часов: дальше продлевать нечего.
    expect(addTimeChange(open, 100_000 + 13 * 3_600_000)).toBeNull();
  });
});

describe("приём ответов и запись пульта", () => {
  const open = { ...startState(), stage: "question" as const, startedAt: 100_000, timeLimit: 20 };

  it("открыт только текущий шаг с открытым вопросом", () => {
    expect(answersOpen(open, 0)).toBe(true);
    expect(answersOpen(open, 1)).toBe(false);
    expect(answersOpen({ ...open, revealed: true }, 0)).toBe(false);
    expect(answersOpen({ ...open, stage: "ready" }, 0)).toBe(false);
    expect(answersOpen({ ...open, phase: "finished" }, 0)).toBe(false);
  });

  it("ответ старше нынешнего показа вопроса — не ответ на этот показ (ставка аукциона, ответ до «Назад»)", () => {
    expect(staleAnswer(open, 99_999)).toBe(true);
    expect(staleAnswer(open, 100_000)).toBe(false);
    expect(staleAnswer(open, 100_500)).toBe(false);
    // Время неизвестно, вопрос закрыт или ответ можно менять — запись остаётся как есть.
    expect(staleAnswer(open, null)).toBe(false);
    expect(staleAnswer({ ...open, startedAt: null }, 99_999)).toBe(false);
    expect(staleAnswer({ ...open, stage: "reveal", revealed: true }, 99_999)).toBe(false);
    expect(staleAnswer({ ...open, stage: "ready" }, 99_999)).toBe(false);
    expect(staleAnswer({ ...open, phase: "finished" }, 99_999)).toBe(false);
    expect(staleAnswer({ ...open, result: { changeable: true } }, 99_999)).toBe(false);
    expect(staleAnswer({ ...open, result: { changeable: false } }, 99_999)).toBe(true);
    // Сервер отклонил ответ (время вышло, ведущий уже показал ответ): старая запись — всё равно не ответ на этот показ.
    const shown = { ...open, stage: "reveal" as const, revealed: true };
    expect(olderThanShow(shown, 99_999)).toBe(true);
    expect(olderThanShow(open, 100_000)).toBe(false);
    expect(olderThanShow({ ...open, result: { changeable: true } }, 99_999)).toBe(false);
    expect(olderThanShow({ ...open, startedAt: null }, 99_999)).toBe(false);
  });

  it("запись закрывает приём: показать ответ, следующий шаг, назад к заставке; итоги шага и таймер — нет", () => {
    expect(closesAnswers(open, { state: { stage: "reveal", revealed: true } }, 0)).toBe(true);
    expect(closesAnswers(open, { state: { step: 1, stage: "ready" } }, 0)).toBe(true);
    expect(closesAnswers(open, { state: { stage: "ready", startedAt: null } }, 0)).toBe(true);
    expect(closesAnswers(open, { state: { result: { mode: "vote" } } }, 0)).toBe(false);
    expect(closesAnswers(open, { state: { timeLimit: 30 } }, 0)).toBe(false);
    expect(closesAnswers(open, { state: { stage: "question", startedAt: "server" } }, 0)).toBe(false);
    // Вопрос и так закрыт — закрывать нечего.
    expect(closesAnswers({ ...open, stage: "reveal", revealed: true }, { state: { stage: "board" } }, 0)).toBe(false);
    expect(placeAfter(open, { state: { step: 2 } })).toEqual({ phase: "playing", step: 2, stage: "question", revealed: false });
  });

  it("отметка списка ответов: сколько на шаге и когда пришёл последний", () => {
    expect(answersMark(0, [])).toEqual({ step: 0, count: 0, last: null, sum: 0 });
    expect(
      answersMark(3, [
        { step: 3, submittedAt: 500 },
        { step: 3, submittedAt: 900 },
        { step: 3, submittedAt: null },
        { step: 2, submittedAt: 5000 },
      ]),
    ).toEqual({ step: 3, count: 3, last: 900, sum: 1400 });
    // Ответ заменили другим с более ранним временем: число и последний те же, сумма — другая.
    const before = answersMark(0, [{ step: 0, submittedAt: 1_800_000_000_100 }, { step: 0, submittedAt: 1_800_000_000_900 }]);
    const after = answersMark(0, [{ step: 0, submittedAt: 1_800_000_000_500 }, { step: 0, submittedAt: 1_800_000_000_900 }]);
    expect(after.count).toBe(before.count);
    expect(after.last).toBe(before.last);
    expect(after.sum).not.toBe(before.sum);
  });
});
