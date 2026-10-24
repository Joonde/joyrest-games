import { describe, expect, it } from "vitest";
import { eventLight, LIGHT_ORDER, lightCounts, sortByLight, type EventLight } from "./eventLight";
import { eventSpan } from "./events";

const MIN = 60_000;
const H = 60 * MIN;
// Пятница, 4 декабря 2026, 19:00–22:30 по Москве.
const base = { id: "e1", day: "2026-12-04", start: 19 * 60, end: 22 * 60 + 30, cancelled: false, held: null as boolean | null, acceptedAt: null as number | null, acceptRev: 1, live: false };
const span = eventSpan(base)!;

describe("цветной кружок мероприятия", () => {
  it("впереди: ждёт ведущего, за сутки без подтверждения — «Не подтвердил», подтвердил — «Принято»", () => {
    expect(eventLight(base, span.from - 3 * 24 * H)).toEqual({ light: "wait", label: "Ждёт ведущего" });
    expect(eventLight(base, span.from - 24 * H - MIN).light).toBe("wait");
    expect(eventLight(base, span.from - 24 * H)).toEqual({ light: "late", label: "Не подтвердил · через 24 ч" });
    expect(eventLight(base, span.from - 18 * H).label).toBe("Не подтвердил · через 18 ч");
    expect(eventLight(base, span.from - 40 * MIN).label).toBe("Не подтвердил · через 40 мин");
    expect(eventLight({ ...base, acceptedAt: 1 }, span.from - 2 * H)).toEqual({ light: "ok", label: "Принято" });
    // Записанные до 22 октября 2026 подтверждения не спрашивали.
    expect(eventLight({ ...base, acceptRev: 0 }, span.from - 2 * H).light).toBe("ok");
  });
  it("время мероприятия — «Идёт · до 22:30»; ведущий открыл игру раньше — тоже «Идёт»", () => {
    expect(eventLight(base, span.from)).toEqual({ light: "live", label: "Идёт · до 22:30" });
    expect(eventLight({ ...base, acceptedAt: 1 }, span.to - MIN).light).toBe("live");
    expect(eventLight({ ...base, live: true }, span.from - 30 * MIN).light).toBe("live");
  });
  it("после «до»: игра открыта — «Сверх плана · N мин», закрыта — «Прошло — отметьте»", () => {
    expect(eventLight({ ...base, live: true }, span.to + 25 * MIN)).toEqual({ light: "over", label: "Сверх плана · 25 мин" });
    expect(eventLight({ ...base, live: true }, span.to + 10 * 1000).label).toBe("Сверх плана · 1 мин");
    expect(eventLight(base, span.to)).toEqual({ light: "check", label: "Прошло — отметьте" });
  });
  it("отметки и отмена сильнее времени", () => {
    expect(eventLight({ ...base, held: true, live: true }, span.to + H).light).toBe("held");
    expect(eventLight({ ...base, held: false }, span.to + H).light).toBe("failed");
    expect(eventLight({ ...base, cancelled: true, live: true, held: true }, span.from).light).toBe("off");
  });
  it("«по цвету»: сначала срочное, внутри — будущие ближайшие сверху, прошедшие — свежие сверху", () => {
    const now = span.from + H; // пятница 20:00
    const ev = (id: string, day: string, extra: object = {}) => ({ ...base, id, day, ...extra });
    const list = [
      ev("held-old", "2026-11-20", { held: true }),
      ev("ok-far", "2026-12-20", { acceptedAt: 1 }),
      ev("check-old", "2026-11-27"),
      ev("held-new", "2026-12-01", { held: true }),
      ev("live", "2026-12-04"),
      ev("late", "2026-12-05", { start: 12 * 60, end: 15 * 60 }),
      ev("wait-near", "2026-12-10"),
      ev("over", "2026-12-04", { start: 15 * 60, end: 18 * 60, live: true }),
      ev("off", "2026-12-12", { cancelled: true }),
      ev("ok-near", "2026-12-08", { acceptedAt: 1 }),
      ev("check-new", "2026-12-02"),
      ev("wait-far", "2026-12-24"),
    ];
    const sorted = sortByLight(list, now);
    expect(sorted.map((e) => e.id)).toEqual(["over", "late", "live", "check-new", "check-old", "wait-near", "wait-far", "ok-near", "ok-far", "held-new", "held-old", "off"]);
    const counts = lightCounts(list, now);
    expect(counts).toEqual({ over: 1, late: 1, live: 1, check: 2, wait: 2, ok: 2, held: 2, failed: 0, off: 1 } satisfies Record<EventLight, number>);
    expect(LIGHT_ORDER).toHaveLength(9);
  });
});
