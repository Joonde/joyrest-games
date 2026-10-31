import { describe, expect, it } from "vitest";
import { activeStep, finaleSteps, parseMarks, stepsHint } from "./finaleSteps";

describe("дела гостя после игры", () => {
  it("порядок: сторис → оценка → чаевые → канал", () => {
    expect(finaleSteps({ card: true, review: true, tips: true })).toEqual(["card", "review", "tips", "channel"]);
  });

  it("чего нет — пропускается, канал есть всегда", () => {
    expect(finaleSteps({ card: false, review: true, tips: true })).toEqual(["review", "tips", "channel"]);
    expect(finaleSteps({ card: true, review: false, tips: false })).toEqual(["card", "channel"]);
    expect(finaleSteps({ card: false, review: false, tips: false })).toEqual(["channel"]);
  });

  it("подсвечен первый без отметки; пропущенный тоже считается пройденным", () => {
    const steps = finaleSteps({ card: true, review: true, tips: true });
    expect(activeStep(steps, {})).toBe("card");
    expect(activeStep(steps, { card: "done" })).toBe("review");
    expect(activeStep(steps, { card: "done", review: "skip" })).toBe("tips");
    expect(activeStep(steps, { review: "done" })).toBe("card");
    expect(activeStep(steps, { card: "done", review: "done", tips: "skip", channel: "done" })).toBeNull();
  });

  it("подсказка о числе шагов", () => {
    expect(stepsHint(4)).toBe("4 коротких шага · около минуты");
    expect(stepsHint(2)).toBe("2 коротких шага · около минуты");
    expect(stepsHint(1)).toBe("1 короткий шаг · около минуты");
  });

  it("сохранённые отметки — только известные шаги и значения", () => {
    expect(parseMarks({ card: "done", review: "skip", tips: "yes", other: "done" })).toEqual({ card: "done", review: "skip" });
    expect(parseMarks(null)).toEqual({});
    expect(parseMarks("done")).toEqual({});
  });
});
