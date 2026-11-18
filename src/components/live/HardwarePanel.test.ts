import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "../../data/types";
import { HardwarePanel } from "./HardwarePanel";

const list = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../../data", () => ({
  hardwareRepo: {
    list,
    save: vi.fn(),
    remove: vi.fn(),
    buzz: vi.fn(),
  },
}));

const session = {
  id: "s1",
  code: "123456",
  hostId: "host",
  gameId: null,
  gameTitle: "Квиз",
  mechanic: "quiz",
  gameSnapshot: {},
  themeId: "joyrest",
  playMode: "teams",
  screenMode: "laptop",
  state: { phase: "lobby", step: 0, startedAt: null, revealed: false, stage: "ready", timeLimit: null, answered: 0, result: null },
  leaderboard: {
    team1: { name: "Медведи", kind: "team", score: 0, colorIndex: 0 },
    team2: { name: "Зайцы", kind: "team", score: 0, colorIndex: 1 },
  },
  createdAt: null,
} satisfies Session;

describe("панель физических кнопок", () => {
  it("показывает участников, эмулятор и действия назначения", () => {
    const html = renderToStaticMarkup(createElement(HardwarePanel, { session, onToast: () => undefined }));
    expect(html).toContain("Эмулятор оборудования");
    expect(html).toContain("Медведи");
    expect(html).toContain("Зайцы");
    expect(html).toContain("Назначить по очереди");
    expect(html).toContain("Реальное оборудование пока не подключено");
  });
});
