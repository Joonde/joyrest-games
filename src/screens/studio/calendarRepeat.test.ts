import { describe, expect, it } from "vitest";
import { alreadyText, entryKey, partialText, pendingDays, planRepeat, repeatKey, saveErrorText, splitSaved } from "./calendarRepeat";

const days = ["2026-11-02", "2026-11-09", "2026-11-16"];

function counter() {
  let n = 0;
  return () => `id${++n}`;
}

describe("повтор каждую неделю", () => {
  it("каждой неделе — свой id", () => {
    const plan = planRepeat(null, repeatKey(days[0]!, "free", 0, 1440, 3, ""), days, counter());
    expect(Object.values(plan.ids)).toEqual(["id1", "id2", "id3"]);
    expect(pendingDays(plan, days)).toEqual(days);
  });

  it("повтор той же попытки — те же id, сохранённые не отправляются", () => {
    const make = counter();
    const key = repeatKey(days[0]!, "free", 0, 1440, 3, "");
    const first = planRepeat(null, key, days, make);
    first.saved.push(days[0]!);
    const again = planRepeat(first, key, days, make);
    expect(again.ids).toEqual(first.ids);
    expect(pendingDays(again, days)).toEqual(days.slice(1));
  });

  it("поменяли форму — новые id", () => {
    const make = counter();
    const first = planRepeat(null, repeatKey(days[0]!, "free", 0, 1440, 3, ""), days, make);
    const other = planRepeat(first, repeatKey(days[0]!, "busy", 0, 1440, 3, ""), days, make);
    expect(other.ids[days[0]!]).not.toBe(first.ids[days[0]!]);
    expect(other.saved).toEqual([]);
  });

  it("после ошибки поменяли форму (заметку, недели) — сохранённые с тем же видом и временем не отправляются снова", () => {
    const make = counter();
    // Первая попытка: 3 недели, сохранилась одна, потом обрыв.
    const first = planRepeat(null, repeatKey(days[0]!, "free", 600, 1200, 3, ""), days, make);
    const done = new Set<string>([entryKey(days[0]!, "free", 600, 1200)]);
    first.saved.push(days[0]!);
    // Дописали заметку — новая попытка с новыми id…
    const second = planRepeat(first, repeatKey(days[0]!, "free", 600, 1200, 3, "свадьба"), days, make);
    expect(second.saved).toEqual([]);
    // …но первую неделю не отправляем: она уже сохранена ранее.
    const split = splitSaved(pendingDays(second, days), done, "free", 600, 1200);
    expect(split.send).toEqual(days.slice(1));
    expect(split.already).toEqual([days[0]]);
    expect(alreadyText(split.already.length)).toBe("1 неделя уже сохранена ранее");
    // Другое время или вид — это другая запись, её отправляем.
    expect(splitSaved(days, done, "busy", 600, 1200).send).toEqual(days);
    expect(splitSaved(days, done, "free", 600, 1260).send).toEqual(days);
    expect(alreadyText(0)).toBe("");
    expect(alreadyText(3)).toBe("3 нед. уже сохранено ранее");
  });

  it("текст частичной ошибки называет, сколько не сохранилось", () => {
    expect(partialText(4, 12)).toContain("не сохранилось 8");
    expect(partialText(0, 12)).toContain("Не получилось сохранить");
  });

  it("постоянный отказ сервера — причина, а не «проверьте интернет»", () => {
    const full = saveErrorText({ code: "resource-exhausted" }, 2, 4, "2026-11-16", 12);
    expect(full).toBe("Сохранено 2 из 4. На 16.11.2026 у вас уже 12 записей — больше в один день нельзя. Уберите лишние отметки этого дня.");
    const far = saveErrorText({ code: "invalid-argument" }, 0, 12, "2028-12-01", 12);
    expect(far).toContain("01.12.2028 отметить нельзя");
    expect(far).not.toContain("интернет");
    expect(saveErrorText({ code: "unavailable" }, 0, 1, "2026-11-02", 12)).toBe(partialText(0, 1));
    expect(saveErrorText(new Error("сеть"), 1, 3, "2026-11-09", 12)).toBe(partialText(1, 3));
  });
});
