import { describe, expect, it } from "vitest";
import { DRAFT_TTL_MS, DRAFTS_MAX, draftHasContent, draftsKey, draftTitle, parseDrafts, removeDraft, upsertDraft, type EventFormDraft } from "./eventDrafts";

const NOW = Date.UTC(2026, 9, 24, 12);

function draft(over: Partial<EventFormDraft> = {}): EventFormDraft {
  return {
    id: "ev1",
    savedAt: NOW,
    day: "2026-12-20",
    start: 19 * 60,
    end: 22 * 60,
    hostId: "",
    title: "",
    clientName: "",
    clientPhone: "",
    place: "",
    guests: "",
    note: "",
    program: null,
    ...over,
  };
}

describe("черновики мероприятий", () => {
  it("у каждого человека свой ключ", () => {
    expect(draftsKey("u1")).not.toBe(draftsKey("u2"));
    expect(draftsKey("")).toBe("joyrest.draft.events.me");
  });

  it("пустая форма (только дата и время) — не черновик", () => {
    expect(draftHasContent(draft())).toBe(false);
    expect(upsertDraft([], draft())).toEqual([]);
    for (const over of [{ hostId: "h1" }, { title: "Свадьба" }, { clientName: "Анна" }, { clientPhone: "+7 985" }, { place: "Кафе" }, { guests: "40" }, { note: "Тихо" }]) {
      expect(draftHasContent(draft(over)), JSON.stringify(over)).toBe(true);
    }
  });

  it("тот же id заменяется, новый — сверху; очистили форму — черновик уходит", () => {
    let list = upsertDraft([], draft({ id: "a", title: "Свадьба" }));
    list = upsertDraft(list, draft({ id: "b", clientName: "Анна" }));
    expect(list.map((d) => d.id)).toEqual(["b", "a"]);
    list = upsertDraft(list, draft({ id: "a", title: "Свадьба", clientName: "Ольга" }));
    expect(list.map((d) => d.id)).toEqual(["a", "b"]);
    expect(list[0]?.clientName).toBe("Ольга");
    list = upsertDraft(list, draft({ id: "a" }));
    expect(list.map((d) => d.id)).toEqual(["b"]);
    expect(removeDraft(list, "b")).toEqual([]);
  });

  it("с устройства: мусор, чужое и старше 30 дней — отбрасываются, не больше 10, свежие сверху", () => {
    expect(parseDrafts(null, NOW)).toEqual([]);
    expect(parseDrafts("{не json", NOW)).toEqual([]);
    expect(parseDrafts('{"id":"x"}', NOW)).toEqual([]);
    const many = Array.from({ length: 15 }, (_, i) => draft({ id: `d${i}`, title: `Т${i}`, savedAt: NOW - i * 1000 }));
    const raw = JSON.stringify([
      ...many,
      { id: "old", day: "2026-12-20", title: "Старый", savedAt: NOW - DRAFT_TTL_MS - 1 },
      { id: "badday", day: "2026-02-30", title: "Х", savedAt: NOW },
      { id: "", day: "2026-12-20", title: "Без id", savedAt: NOW },
      "строка",
      draft({ id: "d0", title: "Повтор", savedAt: NOW - 5 }),
    ]);
    const list = parseDrafts(raw, NOW);
    expect(list).toHaveLength(DRAFTS_MAX);
    expect(list[0]?.id).toBe("d0");
    expect(list[0]?.title).toBe("Т0");
    expect(list.some((d) => d.id === "old" || d.id === "badday" || d.id === "")).toBe(false);
  });

  it("длинное обрезается, время держится в пределах суток", () => {
    const [d] = parseDrafts(JSON.stringify([{ ...draft({ title: "Т" }), clientName: "А".repeat(500), start: -5, end: 99999, guests: "1234567890" }]), NOW);
    expect(d?.clientName.length).toBeLessThanOrEqual(100);
    expect(d?.start).toBe(18 * 60);
    expect(d?.end).toBe(18 * 60);
    expect(d?.guests.length).toBeLessThanOrEqual(6);
  });

  it("подпись: что и клиент, иначе «Без названия»", () => {
    expect(draftTitle(draft({ title: "Свадьба", clientName: "Анна" }))).toBe("Свадьба · Анна");
    expect(draftTitle(draft({ clientName: "Анна" }))).toBe("Анна");
    expect(draftTitle(draft())).toBe("Без названия");
  });
});
