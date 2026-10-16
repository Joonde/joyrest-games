import { describe, expect, it } from "vitest";
import type { AgencyEvent, GameResult } from "../data/types";
import { hostGamesSummary, recentResults, upcomingOf } from "./hostOverview";

const DAY = 86_400_000;
// 16 октября 2026, 20:00 по Москве.
const now = Date.UTC(2026, 9, 16, 17, 0);

function result(id: string, playedAt: number | null, participantsCount: number): GameResult {
  return { id, hostId: "h1", code: "123456", gameTitle: id, mechanic: "quiz", themeId: "joyrest", playMode: "solo", playedAt, participantsCount, board: [] };
}

function event(id: string, patch: Partial<AgencyEvent>): AgencyEvent {
  return { id, hostId: "h1", hostName: "Виталий", day: "2026-10-20", start: 19 * 60, end: 23 * 60, clientName: "", clientPhone: "", title: "Корпоратив", place: "", guests: 30, note: "", cancelled: false, held: null, ...patch };
}

describe("«Итоги игр» ведущего", () => {
  it("сводка: всего, за 30 дней, гости и среднее, последняя игра", () => {
    const s = hostGamesSummary([result("a", now - 2 * DAY, 20), result("b", now - 40 * DAY, 31), result("c", null, 0)], now);
    expect(s).toEqual({ games: 3, last30: 1, guests: 51, average: 17, lastPlayedAt: now - 2 * DAY });
  });

  it("без игр — нули", () => {
    expect(hostGamesSummary([], now)).toEqual({ games: 0, last30: 0, guests: 0, average: 0, lastPlayedAt: null });
  });

  it("ближайшие: только свои, без отменённых и прошедших, идущее сейчас — первым", () => {
    const list = upcomingOf(
      [
        event("later", { day: "2026-10-25" }),
        event("soon", { day: "2026-10-18" }),
        event("now", { day: "2026-10-16", start: 18 * 60, end: 22 * 60 }),
        event("past", { day: "2026-10-10" }),
        event("cancelled", { day: "2026-10-19", cancelled: true }),
        event("other", { day: "2026-10-17", hostId: "h2" }),
      ],
      "h1",
      now,
    );
    expect(list.map((e) => e.id)).toEqual(["now", "soon", "later"]);
  });

  it("ближайшие — не больше лимита", () => {
    const many = Array.from({ length: 8 }, (_, i) => event(`e${i}`, { day: `2026-10-${20 + i}` }));
    expect(upcomingOf(many, "h1", now, 5)).toHaveLength(5);
  });

  it("прошедшие игры — новые сверху, с лимитом", () => {
    const list = recentResults([result("old", now - 9 * DAY, 1), result("new", now - DAY, 1), result("none", null, 1)], 2);
    expect(list.map((r) => r.id)).toEqual(["new", "old"]);
  });
});
