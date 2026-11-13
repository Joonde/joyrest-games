// Комната в памяти (предпросмотр, репетиция, стенд пульта): те же правила, что у сервера, этап `moment` и отказ `moved`, пауза,
// сводки пульта и экрана; боты доводят игру до пьедестала. Плюс модель пульта (`host/model.ts`) на её настоящих сводках.
import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../data/types";
import { applyHost, commandError, emptyHost, hostBoardOf, leaderboardChange, leftOf, mergePick, mergeText, nextLabel, pausedMomentOf, syncsLeaderboard, type HostModel } from "../host/model";
import { parseContent } from "../rules/content";
import { placeOf, rankedLeaderboard } from "../../../core/leaderboard";
import type { HostView } from "../rules/types";
import { autopilot, SimRoom } from "./room";

function clockRoom(opts: { teams: number; guests: number; content?: Record<string, unknown> }) {
  let t = 1_000_000;
  const room = new SimRoom({ content: { legMinutes: 3, ...opts.content }, teams: opts.teams, guests: opts.guests, clock: () => t, seed: "test" });
  const advance = (ms: number) => {
    for (let x = 0; x < ms; x += 100) {
      t += 100;
      room.step();
    }
  };
  return { room, advance, now: () => t };
}

function hostOf(room: SimRoom): { model: () => HostModel; events: RoomStreamEvent[] } {
  let m = emptyHost();
  const events: RoomStreamEvent[] = [];
  room.hostLink().subscribe(
    (e) => {
      events.push(e);
      m = applyHost(m, e, room.now());
    },
    () => undefined,
    false,
  );
  return { model: () => m, events };
}

describe("комната в памяти «Бубликатора»", () => {
  it("50 гостей, 10 команд: автопилот ведущего и боты доводят игру до пьедестала, у экипажей есть очки", async () => {
    const { room, advance } = clockRoom({ teams: 10, guests: 50, content: { saboteur: true } });
    const host = hostOf(room);
    await Promise.resolve();
    let since = 0;
    let last = "";
    for (let i = 0; i < 20 * 60 * 10 && room.s.phase !== "podium"; i += 1) {
      advance(100);
      const mo = `${room.s.phase}:${room.s.leg?.stage}`;
      if (mo !== last) {
        last = mo;
        since = 0;
      } else since += 100;
      const next = autopilot(room.s, since);
      if (next) room.command(next.cmd, next.args);
    }
    expect(room.s.phase).toBe("podium");
    const v = host.model().view;
    expect(v?.phase).toBe("podium");
    expect(v?.crews.length).toBe(10);
    expect(v?.podium?.length).toBe(10);
    // Боты летят: у каждого экипажа есть очки, и они разные (слаженность разная).
    const totals = (v?.crews ?? []).map((c) => c.total);
    expect(Math.min(...totals)).toBeGreaterThan(0);
    expect(new Set(totals).size).toBeGreaterThan(1);
    // Голосование «Кто диверсант?» прошло (экипажи по 5 — с диверсантом).
    expect(room.commands.some((c) => c.cmd === "next" && c.ok)).toBe(true);
    // Сводки пульта приходили раз в секунду.
    expect(host.events.filter((e) => e.type === "host").length).toBeGreaterThan(300);
  }, 60_000);

  it("команда с чужим этапом — отказ moved, ничего не сделано; пауза и «Продолжить» — без этапа", () => {
    const { room, advance } = clockRoom({ teams: 3, guests: 12 });
    const before = `${room.s.phase}`;
    expect(room.command("gather", null, "crews:0:-:0")).toEqual({ ok: false, error: "moved" });
    expect(room.s.phase).toBe(before);
    const m = `lobby:0:-:0`;
    expect(room.command("gather", null, m).ok).toBe(true);
    // Второе касание с прежним этапом не проходит.
    expect(room.command("gather", null, m)).toEqual({ ok: false, error: "moved" });
    room.command("start", null);
    advance(6000);
    const elapsed = room.s.leg?.flight ?? 0;
    room.command("pause", null);
    advance(5000);
    expect(room.s.leg?.flight).toBe(elapsed);
    room.command("resume", null);
    advance(1000);
    expect(room.s.leg?.flight ?? 0).toBeGreaterThan(elapsed);
  });

  it("«Медленнее / Быстрее»: сдвиг из сводки пульта — двойное касание не прибавит дважды", async () => {
    const { room, advance } = clockRoom({ teams: 2, guests: 8 });
    const host = hostOf(room);
    room.command("gather", null);
    room.command("start", null);
    advance(6000);
    await Promise.resolve();
    const v = host.model().view as HostView;
    expect(v.slower).toBe(true);
    const before = v.orderSeconds;
    expect(room.command("time", { delta: 2, from: v.shift }).ok).toBe(true);
    expect(room.command("time", { delta: 2, from: v.shift })).toEqual({ ok: false, error: "moved" });
    expect((host.model().view as HostView).orderSeconds).toBe(before + 2);
  });
});

describe("пульт: модель", () => {
  it("экран пульта по этапу и закрытию потока", () => {
    const { room, advance } = clockRoom({ teams: 2, guests: 8 });
    let m = emptyHost();
    expect(hostBoardOf(m)).toBe("connecting");
    m = applyHost(m, room.hostEvent(), room.now());
    expect(hostBoardOf(m)).toBe("lobby");
    room.command("gather", null);
    m = applyHost(m, room.hostEvent(), room.now());
    expect(hostBoardOf(m)).toBe("crews");
    room.command("start", null);
    m = applyHost(m, room.hostEvent(), room.now());
    expect(hostBoardOf(m)).toBe("launch");
    advance(6000);
    m = applyHost(m, room.hostEvent(), room.now());
    expect(hostBoardOf(m)).toBe("fly");
    expect(hostBoardOf(applyHost(m, { type: "closed", at: 0, reason: "busy" }, 0))).toBe("tab");
    expect(hostBoardOf(applyHost(m, { type: "closed", at: 0, reason: "abandoned" }, 0))).toBe("abandoned");
    expect(hostBoardOf(m, true)).toBe("over");
    // Пауза приходит отдельным событием.
    expect(applyHost(m, { type: "room", at: 0, paused: true }, 0).paused).toBe(true);
  });

  it("пауза: отсчёты пульта стоят, после «Продолжить» не прыгают назад (аудит 2d, №1)", async () => {
    const { room, advance, now } = clockRoom({ teams: 2, guests: 8, content: { saboteur: true } });
    const host = hostOf(room);
    room.command("gather", null);
    room.command("start", null);
    await Promise.resolve();
    advance(1000);
    const left = () => leftOf(host.model().view?.endsAt ?? null, now() + host.model().skew, pausedMomentOf(host.model())) ?? -1;
    expect(host.model().view?.stage).toBe("launch");
    room.command("pause", null);
    const atPause = left();
    expect(host.model().view?.pausedAt).not.toBeNull();
    expect(atPause).toBeGreaterThan(0);
    // Сводки идут раз в секунду и на паузе — отсчёт стоит.
    for (let i = 0; i < 6; i += 1) {
      advance(1000);
      expect(left()).toBe(atPause);
    }
    // Пауза пришла отдельным событием раньше сводки — стоим с момента события, а не идём.
    const early = applyHost(applyHost(emptyHost(), room.hostEvent(), now()), { type: "room", at: now(), paused: true }, now());
    expect(pausedMomentOf(early)).not.toBeNull();
    room.command("resume", null);
    // Сразу после «Продолжить»: то же, что стояло; дальше — идёт от него, без скачка.
    expect(left()).toBe(atPause);
    advance(500);
    expect(host.model().view?.pausedAt).toBeNull();
    expect(atPause - left()).toBeGreaterThanOrEqual(400);
    expect(atPause - left()).toBeLessThanOrEqual(600);
  });

  it("«Объединить»: выбор — только из экипажей, которые есть; нет маленьких — самый маленький (аудит 2d, №2)", () => {
    const crews = [
      { id: 0, players: 4, small: false },
      { id: 1, players: 3, small: false },
      { id: 2, players: 5, small: false },
    ];
    // Все от 3 человек — блок есть, «Кого влить» — самый маленький.
    expect(mergePick(crews, null, null)).toEqual({ fromId: 1, toId: 0 });
    // Выбранный экипаж влили (его нет) — берём маленький, а не пропадаем.
    const after = [
      { id: 0, players: 6, small: false },
      { id: 3, players: 2, small: true },
    ];
    expect(mergePick(after, 1, 0)).toEqual({ fromId: 3, toId: 0 });
    // «Куда» не совпадает с «кого».
    expect(mergePick(after, 3, 3)).toEqual({ fromId: 3, toId: 0 });
    expect(mergePick([{ id: 0, players: 2, small: true }], null, null)).toEqual({ fromId: null, toId: null });
  });

  it("подпись «Дальше»: голосование, следующий перелёт, награждение", () => {
    const base = { stage: "dock", leg: 0, legs: 3, voteOpensAt: 123 } as unknown as HostView;
    expect(nextLabel(base)).toBe("Кто диверсант? — открыть голосование");
    expect(nextLabel({ ...base, voteOpensAt: null })).toBe("Старт перелёта 2");
    expect(nextLabel({ ...base, stage: "voted", voteOpensAt: null, leg: 2 })).toBe("К награждению");
  });

  it("отказы: «moved» — молча, остальное — понятным текстом", () => {
    expect(commandError("failed-precondition", "moved")).toBeNull();
    expect(commandError("failed-precondition", "vote-pending")).toContain("голосование");
    expect(commandError("unavailable", "")).toContain("интернет");
  });

  it("таблица лидеров: общий счёт экипажа — его команде и влитым командам (решение 13 ноября 2026), группа — по экипажу", () => {
    const v = {
      crews: [
        { team: "t0", teams: ["t0", "t2"], total: 1200.4 },
        { team: "t1", teams: ["t1"], total: 800 },
      ],
    } as unknown as HostView;
    const board = {
      t0: { name: "Лисы", kind: "team" as const, score: 0, colorIndex: 0 },
      t1: { name: "Ракеты", kind: "team" as const, score: 800 },
      t2: { name: "Медведи", kind: "team" as const, score: 300 },
    };
    expect(leaderboardChange(v, board)).toEqual({
      t0: { name: "Лисы", kind: "team", score: 1200, colorIndex: 0, group: "t0" },
      t2: { name: "Медведи", kind: "team", score: 1200, group: "t0" },
    });
    const written = { ...board, t0: { ...board.t0, score: 1200, group: "t0" }, t2: { ...board.t2, score: 1200, group: "t0" } };
    expect(leaderboardChange(v, written)).toBeNull();
    // Места — по экипажам: «Лисы» и «Медведи» — 1-е, «Ракеты» — 2-е (не 3-е); мест всего 2.
    expect(rankedLeaderboard(written).map((e) => [e.id, e.place])).toEqual([
      ["t0", 1],
      ["t2", 1],
      ["t1", 2],
    ]);
    expect(placeOf(written, "t1")).toEqual({ place: 2, total: 2 });
    // «Назад — переиграть перелёт» отменил объединение: группа снимается, у «Медведей» снова свой счёт.
    const undone = { crews: [{ team: "t0", teams: ["t0"], total: 500 }, { team: "t1", teams: ["t1"], total: 800 }, { team: "t2", teams: ["t2"], total: 300 }] } as unknown as HostView;
    expect(leaderboardChange(undone, written)).toEqual({
      t0: { name: "Лисы", kind: "team", score: 500, colorIndex: 0 },
      t2: { name: "Медведи", kind: "team", score: 300 },
    });
    // После «Назад» на «Экипажи собраны» таблица переписывается сразу (аудит 2d, №4).
    expect(syncsLeaderboard({ phase: "crews", stage: null } as HostView)).toBe(true);
    expect(syncsLeaderboard({ phase: "drill", stage: null } as HostView)).toBe(true);
    expect(syncsLeaderboard({ phase: "lobby", stage: null } as HostView)).toBe(false);
    expect(syncsLeaderboard({ phase: "leg", stage: "fly" } as HostView)).toBe(false);
    expect(syncsLeaderboard({ phase: "leg", stage: "dock" } as HostView)).toBe(true);
    expect(syncsLeaderboard({ phase: "podium", stage: null } as HostView)).toBe(true);
  });

  it("текст «Объединить» — как в правилах (названия экипажей не склоняем)", () => {
    expect(mergeText({ name: "Комета", total: 1184 }, { name: "Орбита" }, true)).toBe(
      `Объединить «Комета» с «Орбита»? Очки «Комета» (${(1184).toLocaleString("ru-RU")}) прибавятся к «Орбита». Отменить нельзя — только «Назад — переиграть перелёт».`,
    );
    expect(mergeText({ name: "Комета", total: 0 }, { name: "Орбита" }, false)).toMatch(/Отменить нельзя\.$/);
  });

  it("сводка пульта: новые поля для кнопок (сдвиг, пределы, объединение, голосование)", () => {
    const { room, advance } = clockRoom({ teams: 2, guests: 10, content: { saboteur: true } });
    room.command("gather", null);
    let v = room.hostEvent();
    if (v.type !== "host") throw new Error("не host");
    let h = v.data as HostView;
    expect(h.merge).toBeNull();
    expect(h.move).toBeNull();
    expect(h.crews.every((c) => c.team !== null && c.teams.includes(c.team))).toBe(true);
    room.command("start", null);
    advance(6000);
    v = room.hostEvent();
    h = (v as { data: HostView }).data;
    expect(h.merge).toBe("busy");
    expect(h.move).toBe("busy");
    expect(parseContent(undefined).legs).toBe(3);
  });
});
