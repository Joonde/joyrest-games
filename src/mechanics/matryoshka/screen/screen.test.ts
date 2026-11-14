// Экран зала «Игр Матрёшки» (Блок 3c, docs/matryoshka.md, «3c — экран зала»): разбор сводки, поворот головы и слова песенки
// по часам сервера, ноты песенки (последняя — ровно в T, в обманку — тишина), снимок без моментов, фишки и подписи без
// наложений. Сводки — настоящие (`screenView` комнаты с ботами), как их видит экран.
import { describe, expect, it } from "vitest";
import type { RoomStreamEvent } from "../../../data/types";
import { HEAD_TURN_MS } from "../rules/constants";
import { screenView } from "../rules/views";
import { World } from "../rules/world.test-kit";
import { DANCE_DECOY_MS, DECOY_GAP_MS, chantNotes, danceNotes } from "./music";
import { applyScreen, boardOf, emptyScreen, F_HOLD, fieldTokens, freezeLook, isSnapshot, laneCount, leadingEmoji, markOf, momentsOf, placeTags, plainName, wordTimes } from "./model";
import { parseScreen, type PhraseV } from "./view";

const ev = (w: World, type: "screen" | "snapshot" = "screen", at = w.now): RoomStreamEvent =>
  type === "snapshot" ? { type, at, paused: w.paused, every: 200, offlineMs: 3000, data: screenView(w.s, w) } : { type, at, version: w.changes, paused: w.paused, players: 0, online: 0, data: screenView(w.s, w) };

/** Пульт жмёт главную кнопку, пока не выполнится условие (условие — и после шага, до нажатия: этапы ожидания видны). */
function drive(w: World, cond: () => boolean, limit = 1_500_000): boolean {
  for (let t = 0; t < limit; t += 100) {
    if (cond()) return true;
    w.step(100, true);
    if (cond()) return true;
    const c = w.host().can;
    if (c.next) w.cmd("next");
    else if (c.duel) w.cmd("duel");
    else if (c.podium) w.cmd("podium");
  }
  return cond();
}

describe("сводка экрана", () => {
  it("каждый этап настоящей игры разбирается без ошибок и узнаётся экраном", () => {
    const w = new World(30, {}, "screen-all");
    w.players.forEach((p, i) => {
      p.name = `🦊 Игрок ${i + 1}`;
      const m = w.s.members[p.pid];
      if (m) m.name = p.name;
    });
    const seen = new Set<string>();
    let m = emptyScreen(0);
    const lobby = parseScreen(screenView(w.s, w));
    expect(lobby?.lobby?.nums).toHaveLength(30);
    expect(lobby?.lobby?.lives).toBe(w.s.content.lives);
    m = applyScreen(m, ev(w, "snapshot"), w.now);
    expect(markOf(1, m.marks)).toBe("🦊");
    w.cmd("start");
    drive(w, () => {
      const v = parseScreen(screenView(w.s, w));
      expect(v).not.toBeNull();
      m = applyScreen(m, ev(w), w.now);
      seen.add(boardOf(m, w.now, null));
      return w.s.phase === "podium";
    });
    for (const b of ["open", "rules", "countdown", "judging", "reveal", "results", "bracket", "duel", "podium"]) expect(seen).toContain(b);
    // Имена, которые экран видел, остаются для «Табло».
    expect(Object.keys(m.known).length).toBeGreaterThan(0);
  });

  it("мусор и чужие поля не роняют экран", () => {
    for (const data of [null, 1, "x", [], { phase: "nope" }, { phase: "trial", trial: { kind: "zzz", play: { kind: "freeze", players: "x" } } }, { phase: "final", final: { rounds: [[1]] } }]) {
      expect(() => parseScreen(data)).not.toThrow();
    }
    const v = parseScreen({ phase: "lobby", style: "night", lobby: { count: 3, marks: ["🦊", 7, "А"], nums: [1, 2, "3"] } });
    expect(v?.style).toBe("night");
    expect(v?.lobby?.marks[1]).toBe("•");
  });

  it("смайлик — из начала имени, имя — без него", () => {
    expect(leadingEmoji("🦊 Аня")).toBe("🦊");
    expect(leadingEmoji("Аня")).toBeNull();
    expect(plainName("🦊 Аня")).toBe("Аня");
    expect(markOf(5, {})).not.toBe("");
  });
});

describe("снимок и моменты", () => {
  it("первая сводка, разрыв больше 3 с и опоздание больше 2,5 с — снимок; моментов по снимку нет", () => {
    const w = new World(10, {}, "snap");
    let m = applyScreen(emptyScreen(0), ev(w), 0);
    expect(m.fresh).toBe(true);
    m = applyScreen(m, ev(w, "screen", w.now + 500), 500);
    expect(m.fresh).toBe(false);
    expect(isSnapshot(m, w.now + 4000, 4000)).toBe(true);
    expect(momentsOf(null, m.view)).toEqual(momentsOf(m.view, null));
    expect(Object.values(momentsOf(null, m.view)).every((x) => x === false || x === 0)).toBe(true);
  });

  it("матрёшка раскрылась и вскрытие — моменты, повтор той же сводки — нет", () => {
    const w = new World(12, {}, "moments");
    w.cmd("start");
    let prev = parseScreen(screenView(w.s, w));
    let opened = 0;
    let revealed = 0;
    drive(w, () => {
      const next = parseScreen(screenView(w.s, w));
      const mo = momentsOf(prev, next);
      if (mo.open) opened += 1;
      if (next?.phase === "trial" && next.trial?.stage === "reveal" && prev?.trial?.stage !== "reveal") revealed += 1;
      expect(momentsOf(next, next).open).toBe(false);
      prev = next;
      return w.s.phase === "final";
    });
    expect(opened).toBeGreaterThan(0);
    expect(revealed).toBeGreaterThan(0);
  });
});

describe("«Замри!»: голова, слова и песенка по часам сервера", () => {
  const p: PhraseV = { start: 10_000, at: 13_000, end: 15_000, decoy: null, window: 13_550, head: 13_000 - HEAD_TURN_MS };

  it("голова начинает поворот в `head` (за 0,4 с до T) и к T уже смотрит, глаза светятся только во взгляде", () => {
    expect(freezeLook(p, p.head - 1).pose).toBe("back");
    expect(freezeLook(p, p.head).pose).toBe("profile");
    expect(freezeLook(p, p.head).look).toBe(false);
    expect(freezeLook(p, p.at - 1).pose).toBe("face");
    expect(freezeLook(p, p.at).look).toBe(true);
    expect(freezeLook(p, p.at).zamri).toBe(true);
    expect(freezeLook(p, p.end - 1).look).toBe(true);
    expect(freezeLook(p, p.end).look).toBe(false);
    expect(freezeLook(p, p.end + 1000).pose).toBe("back");
    expect(freezeLook(null, 0).pose).toBe("back");
  });

  it("слова «Раз…», «два…», «три…» — по одному в такт, огромное «ЗАМРИ!» — в T", () => {
    const [w1, w2, w3] = wordTimes(p);
    expect(w1).toBe(p.start);
    expect(w1 < w2 && w2 < w3 && w3 < p.at).toBe(true);
    expect(freezeLook(p, w2 - 1).words).toBe(1);
    expect(freezeLook(p, w2).words).toBe(2);
    expect(freezeLook(p, w3).words).toBe(3);
    expect(freezeLook(p, p.at - 1).zamri).toBe(false);
  });

  it("последняя нота мелодии — ровно в T, ноты по порядку; в обманку — 0,3 с тишины", () => {
    const notes = chantNotes(p);
    const accent = notes.find((n) => n.voice === "accent");
    expect(accent?.t).toBe(p.at);
    expect(Math.max(...notes.map((n) => n.t))).toBe(p.at);
    expect(notes.every((n, i) => i === 0 || notes[i - 1]!.t <= n.t)).toBe(true);
    const decoy = { ...p, decoy: 11_500 };
    const quiet = chantNotes(decoy).filter((n) => n.t >= 11_500 && n.t < 11_500 + DECOY_GAP_MS);
    expect(quiet).toHaveLength(0);
    expect(chantNotes(decoy).find((n) => n.voice === "accent")?.t).toBe(p.at);
    expect(freezeLook(decoy, 11_600).twitch).toBe(true);
  });

  it("настоящая фраза комнаты: голова за 0,4 с до T, у всех фраз игры", () => {
    const w = new World(20, {}, "phrases");
    w.cmd("start");
    const heads: number[] = [];
    drive(w, () => {
      const t = screenView(w.s, w).trial as { kind?: string; play?: { phrase?: { at: number; head: number } | null } } | undefined;
      const play = t?.play;
      if (t?.kind === "freeze" && play?.phrase && !heads.includes(play.phrase.at)) {
        heads.push(play.phrase.at);
        expect(play.phrase.at - play.phrase.head).toBe(HEAD_TURN_MS);
      }
      return w.s.trial?.kind !== undefined && w.s.trial.kind !== "freeze" && heads.length > 0;
    });
    expect(heads.length).toBeGreaterThan(1);
  });
});

describe("«Стулья»: музыка обрывается в момент стопа", () => {
  it("после стопа нот нет, в обманку — пауза", () => {
    const notes = danceNotes(0, 20_000, 0, 12_000, 5_000);
    expect(notes.every((n) => n.t < 12_000)).toBe(true);
    expect(notes.some((n) => n.t >= 5_000 && n.t < 5_000 + DANCE_DECOY_MS)).toBe(false);
    expect(notes.some((n) => n.t > 6_000 && n.t < 12_000)).toBe(true);
  });
});

describe("поле «Замри!» и подписи", () => {
  it("дорожка — по номеру, соседи с одинаковым путём разведены", () => {
    const players = Array.from({ length: 100 }, (_, i) => [i + 1, 300, F_HOLD] as [number, number, number]);
    const t = fieldTokens(players);
    expect(laneCount(6)).toBe(5);
    expect(laneCount(100)).toBe(12);
    expect(new Set(t.map((x) => `${x.lane}:${x.slot}`)).size).toBe(100);
    expect(fieldTokens([...players].reverse()).map((x) => x.lane)).toEqual(t.map((x) => x.lane));
  });

  it("подписи лидеров не ложатся одна на другую", () => {
    const pts = [
      { num: 1, x: 500, y: 300 },
      { num: 2, x: 520, y: 310 },
      { num: 3, x: 540, y: 305 },
    ];
    const y = placeTags(pts, 250, 38, 0);
    const ys = pts.map((p) => y.get(p.num) ?? 0).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(38);
  });
});
