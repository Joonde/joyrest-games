import { describe, expect, it } from "vitest";
import {
  QTE_COUNTDOWN_MS,
  QTE_MASH_MAX,
  QTE_RING_TRAVEL_MS,
  arrowFor,
  countdownDigit,
  dodgeWindow,
  gradeOf,
  mashAverage,
  parseQteAnswer,
  parseQteLevel,
  qteGoAt,
  qteTimeLimit,
  qteValue,
  ringAccuracy,
  ringHalfWindow,
  ringScale,
  ringTargetAt,
  swipeOk,
  teamDodged,
  teamRing,
} from "./qte";

describe("QTE: окна и Ловкость", () => {
  it("зона «Хорошо» по сложности: 0,8 / 0,5 / 0,3 с целиком", () => {
    expect(ringHalfWindow("easy") * 2).toBe(800);
    expect(ringHalfWindow("normal") * 2).toBe(500);
    expect(ringHalfWindow("hard") * 2).toBe(300);
  });

  it("Ловкость расширяет окно на 10% за очко, не больше 3 очков", () => {
    expect(ringHalfWindow("normal", 1)).toBe(275);
    expect(ringHalfWindow("normal", 3)).toBe(325);
    expect(ringHalfWindow("normal", 9)).toBe(325);
    expect(ringHalfWindow("normal", -2)).toBe(250);
    expect(ringHalfWindow("normal", Number.NaN)).toBe(250);
    expect(dodgeWindow("normal")).toBe(2500);
    expect(dodgeWindow("hard", 2)).toBe(2160);
  });

  it("неизвестная сложность — «Норма»", () => {
    expect(parseQteLevel("easy")).toBe("easy");
    expect(parseQteLevel("hard")).toBe("hard");
    expect(parseQteLevel("insane")).toBe("normal");
    expect(parseQteLevel(undefined)).toBe("normal");
  });
});

describe("QTE: время", () => {
  it("старт — через отсчёт, золото — через путь кольца", () => {
    expect(qteGoAt(1_000)).toBe(1_000 + QTE_COUNTDOWN_MS);
    expect(ringTargetAt(1_000)).toBe(1_000 + QTE_COUNTDOWN_MS + QTE_RING_TRAVEL_MS);
  });

  it("время шага покрывает отсчёт, событие и запас при любой Ловкости", () => {
    for (const level of ["easy", "normal", "hard"] as const) {
      for (const agility of [0, 1, 2, 3]) {
        const ring = qteTimeLimit("ring", level, agility) * 1000;
        expect(ring).toBeGreaterThanOrEqual(QTE_COUNTDOWN_MS + QTE_RING_TRAVEL_MS + 2 * ringHalfWindow(level, agility));
        const swipe = qteTimeLimit("swipe", level, agility) * 1000;
        expect(swipe).toBeGreaterThanOrEqual(QTE_COUNTDOWN_MS + dodgeWindow(level, agility));
      }
    }
    expect(qteTimeLimit("ring", "normal", 0)).toBe(8);
    expect(qteTimeLimit("ring", "easy", 3)).toBe(8);
    expect(qteTimeLimit("swipe", "normal", 0)).toBe(8);
    expect(qteTimeLimit("mash", "normal")).toBe(15);
    expect(Number.isInteger(qteTimeLimit("ring", "easy", 3))).toBe(true);
  });

  it("отсчёт 3-2-1 до старта, после — пусто", () => {
    expect(countdownDigit(-3000)).toBe(3);
    expect(countdownDigit(-2001)).toBe(3);
    expect(countdownDigit(-2000)).toBe(2);
    expect(countdownDigit(-1)).toBe(1);
    expect(countdownDigit(0)).toBeNull();
    expect(countdownDigit(500)).toBeNull();
    expect(countdownDigit(-9000)).toBe(3);
  });

  it("кольцо: у края до старта, ровно на золоте в момент золота, дальше меньше", () => {
    expect(ringScale(-500)).toBe(ringScale(0));
    expect(ringScale(0)).toBeCloseTo(2.4);
    expect(ringScale(QTE_RING_TRAVEL_MS)).toBeCloseTo(1);
    expect(ringScale(QTE_RING_TRAVEL_MS + 400)).toBeLessThan(1);
    expect(ringScale(60_000)).toBeCloseTo(0.15);
  });
});

describe("QTE: точность и оценка", () => {
  const half = 250;

  it("в золото — 100, край «Хорошо» — 50, два окна и дальше — 0, раньше и позже одинаково", () => {
    expect(ringAccuracy(0, half)).toBe(100);
    expect(ringAccuracy(half, half)).toBe(50);
    expect(ringAccuracy(-half, half)).toBe(50);
    expect(ringAccuracy(2 * half, half)).toBe(0);
    expect(ringAccuracy(5000, half)).toBe(0);
    expect(ringAccuracy(Number.NaN, half)).toBe(0);
    expect(ringAccuracy(10, 0)).toBe(0);
  });

  it("границы оценок: «Идеально» — ближе 40% окна, «Хорошо» — внутри окна", () => {
    expect(gradeOf(ringAccuracy(0.4 * half, half))).toBe("perfect");
    expect(gradeOf(ringAccuracy(0.4 * half + 5, half))).toBe("good");
    expect(gradeOf(ringAccuracy(half, half))).toBe("good");
    expect(gradeOf(ringAccuracy(half + 5, half))).toBe("weak");
    expect(gradeOf(80)).toBe("perfect");
    expect(gradeOf(79)).toBe("good");
    expect(gradeOf(50)).toBe("good");
    expect(gradeOf(49)).toBe("weak");
    expect(gradeOf(Number.NaN)).toBe("weak");
  });

  it("команда: средняя точность нажавших, никто не нажал — «Слабо»", () => {
    expect(teamRing([])).toEqual({ grade: "weak", acc: 0, pressed: 0 });
    expect(teamRing([100, 60])).toEqual({ grade: "perfect", acc: 80, pressed: 2 });
    expect(teamRing([90, 40, 50])).toEqual({ grade: "good", acc: 60, pressed: 3 });
    expect(teamRing([30])).toEqual({ grade: "weak", acc: 30, pressed: 1 });
    expect(teamRing([500, -20])).toEqual({ grade: "good", acc: 50, pressed: 2 });
  });
});

describe("QTE: уворот", () => {
  it("стрелка одна и та же для того же телефона и шага", () => {
    expect(arrowFor("7_abc")).toBe(arrowFor("7_abc"));
  });

  it("стрелки примерно поровну влево и вправо", () => {
    let left = 0;
    for (let i = 0; i < 1000; i++) if (arrowFor(`${i % 37}_player${i}`) === "left") left++;
    expect(left).toBeGreaterThan(400);
    expect(left).toBeLessThan(600);
  });

  it("стрелку не угадать по прошлому шагу: у того же игрока стороны не чередуются строго", () => {
    const dirs = Array.from({ length: 32 }, (_, step) => arrowFor(`${step}_abc`));
    // У честной монетки сторона повторяет прошлую примерно в половине шагов (~15 из 31).
    const repeats = dirs.filter((d, i) => i > 0 && d === dirs[i - 1]).length;
    expect(repeats).toBeGreaterThanOrEqual(8);
    expect(new Set(dirs).size).toBe(2);
  });

  it("соседние телефоны не получают одну сторону подряд", () => {
    const dirs = Array.from({ length: 12 }, (_, i) => arrowFor(`5_p${i}`));
    expect(new Set(dirs).size).toBe(2);
  });

  it("увернулся: верная сторона и успел", () => {
    const right = parseQteAnswer({ qte: "swipe", dir: "right", ms: 900 });
    expect(swipeOk(right, "right", 2500)).toBe(true);
    expect(swipeOk(right, "left", 2500)).toBe(false);
    expect(swipeOk(right, "right", 800)).toBe(false);
    expect(swipeOk(null, "right", 2500)).toBe(false);
    expect(swipeOk(parseQteAnswer({ qte: "ring", acc: 90, ms: 0 }), "right", 2500)).toBe(false);
  });

  it("команда увернулась, если успело больше половины телефонов", () => {
    expect(teamDodged(4, 6)).toBe(true);
    expect(teamDodged(3, 6)).toBe(false);
    expect(teamDodged(1, 1)).toBe(true);
    expect(teamDodged(0, 1)).toBe(false);
    expect(teamDodged(0, 0)).toBe(false);
  });
});

describe("QTE: добивание", () => {
  it("в среднем на телефон, лишние нажатия отброшены", () => {
    expect(mashAverage([10, 20], 2)).toBe(15);
    expect(mashAverage([10, 20], 4)).toBe(7.5);
    expect(mashAverage([10_000], 1)).toBe(QTE_MASH_MAX);
    expect(mashAverage([-5, Number.NaN, 3], 3)).toBe(1);
    expect(mashAverage([10], 0)).toBe(0);
  });
});

describe("QTE: ответ телефона", () => {
  it("значения обрезаются, мусор — null", () => {
    expect(parseQteAnswer({ qte: "ring", acc: 140, ms: -99_999 })).toEqual({ kind: "ring", acc: 100, ms: -10_000 });
    expect(parseQteAnswer({ qte: "ring", acc: 72.6 })).toEqual({ kind: "ring", acc: 73, ms: null });
    expect(parseQteAnswer({ qte: "ring", acc: "90" })).toBeNull();
    expect(parseQteAnswer({ qte: "swipe", dir: "up", ms: 100 })).toBeNull();
    expect(parseQteAnswer({ qte: "swipe", dir: "left", ms: -50 })).toEqual({ kind: "swipe", dir: "left", ms: 0 });
    expect(parseQteAnswer({ qte: "swipe", dir: "left" })).toBeNull();
    expect(parseQteAnswer({ qte: "mash", taps: 1e9 })).toEqual({ kind: "mash", taps: QTE_MASH_MAX });
    expect(parseQteAnswer({ qte: "mash", taps: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseQteAnswer({ choice: 2 })).toBeNull();
    expect(parseQteAnswer(null)).toBeNull();
    expect(parseQteAnswer([1, 2])).toBeNull();
    expect(parseQteAnswer("ring")).toBeNull();
  });

  it("отправленное читается обратно тем же", () => {
    const answers = [
      { kind: "ring", acc: 88, ms: -40 },
      { kind: "ring", acc: 0, ms: null },
      { kind: "swipe", dir: "right", ms: 1200 },
      { kind: "mash", taps: 64 },
    ] as const;
    for (const a of answers) expect(parseQteAnswer(qteValue(a))).toEqual(a);
  });
});
