import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Session } from "../../data/types";
import { cardCells, parseLotto, parseSongList, type LottoContent } from "./content";
import { DEMO_LOTTO } from "./demo";
import { cardFor, cardLines, isWin, lottoBack, lottoPrimary, lottoSteps, nextSong, parseLottoResult, playedUpTo, playSong, revealSong, score } from "./logic";
import { validateLotto } from "./validate";

const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Песня ${i}`, artist: "", trackId: null, trackStart: 0 }));
const game = (patch: Partial<LottoContent> = {}): LottoContent => ({ songs: songs(12), size: 3, rule: "line", fragment: 30, prizes: [300, 200, 100], ...patch });
const claim = (step: number, pid: string, at: number | null = 1): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value: { marks: [] }, submittedAt: at });

describe("содержимое лото", () => {
  it("мусор из базы — значения по умолчанию, без исключений", () => {
    const c = parseLotto({ songs: [{ id: "a", title: 5 }, { id: "a", title: "x" }], size: 7, rule: "x", fragment: 9999, prizes: [-5, "x"] });
    expect(c.size).toBe(4);
    expect(c.rule).toBe("line");
    expect(c.fragment).toBe(180);
    expect(c.prizes).toEqual([0, 0]);
    expect(new Set(c.songs.map((s) => s.id)).size).toBe(2);
    expect(() => parseLotto(null)).not.toThrow();
  });

  it("список «Исполнитель — Песня» разбирается", () => {
    const list = parseSongList("1. Земфира — Хочешь?\nКино: Звезда по имени Солнце\nПросто название\n\n");
    expect(list.map((s) => [s.artist, s.title])).toEqual([
      ["Земфира", "Хочешь?"],
      ["Кино", "Звезда по имени Солнце"],
      ["", "Просто название"],
    ]);
  });

  it("проверка: песен на карточку, названия, повторы", () => {
    expect(validateLotto(game({ songs: songs(8) }))[0]?.message).toMatch(/хотя бы 9 песен/);
    expect(validateLotto(game())).toEqual([]);
    const dup = game({ songs: [...songs(9), { id: "x", title: "Песня 1", artist: "", trackId: null, trackStart: 0 }] });
    expect(validateLotto(dup).some((e) => e.path === "songs/x/title")).toBe(true);
    expect(validateLotto(parseLotto(DEMO_LOTTO.content))).toEqual([]);
  });
});

describe("карточки", () => {
  it("у одного участника — всегда одна и та же, у разных — разные, без повторов", () => {
    const c = game();
    const a = cardFor(c, "anna");
    expect(cardFor(c, "anna")).toEqual(a);
    expect(a).toHaveLength(cardCells(c));
    expect(new Set(a).size).toBe(a.length);
    const cards = new Set(["anna", "boris", "vera", "gleb", "dina"].map((p) => cardFor(c, p).join()));
    expect(cards.size).toBeGreaterThan(3);
  });

  it("линии: ряды, столбцы, диагонали", () => {
    expect(cardLines(3)).toHaveLength(8);
    const card = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    expect(isWin(card, new Set(["a", "e", "i"]), 3, "line")).toBe(true);
    expect(isWin(card, new Set(["a", "b"]), 3, "line")).toBe(false);
    expect(isWin(card, new Set(["a", "b", "c", "d", "g"]), 3, "twoLines")).toBe(true);
    expect(isWin(card, new Set(["a", "b", "c", "d", "e"]), 3, "twoLines")).toBe(false);
    expect(isWin(card, new Set(card), 3, "full")).toBe(true);
  });
});

describe("очки за «Лото!»", () => {
  const c = game();
  const steps = lottoSteps(c);
  const state = (result: unknown = null) => ({ ...startState(), stage: "question" as const, result });

  it("заявка верна, только если линия собрана из прозвучавших песен; первым — больше", () => {
    // Все песни прозвучали — у всех линия; порядок — по времени заявки.
    const last = steps[11];
    if (!last) throw new Error("нет шага");
    const deltas = score(last, [claim(11, "b", 5), claim(11, "a", 2), claim(11, "c", 9), claim(11, "d", 12)], { state: state() });
    expect(deltas).toEqual([
      { pid: "a", delta: 300 },
      { pid: "b", delta: 200 },
      { pid: "c", delta: 100 },
      { pid: "d", delta: 100 },
    ]);
    // В самом начале линии нет ни у кого.
    const first = steps[0];
    if (!first) throw new Error("нет шага");
    expect(score(first, [claim(0, "a")], { state: state() })).toEqual([]);
  });

  it("кто уже выиграл, второй раз очков не получает; следующий — следующий приз", () => {
    const last = steps[11];
    if (!last) throw new Error("нет шага");
    expect(score(last, [claim(11, "a"), claim(11, "b", 3)], { state: state({ winners: ["a"] }) })).toEqual([{ pid: "b", delta: 200 }]);
  });

  it("собрана ли карточка — по песням, а не по отметкам гостя", () => {
    const anna = cardFor(c, "anna");
    const order = c.songs.map((s) => s.id);
    // Через сколько песен у Ани впервые собирается линия.
    let first = -1;
    for (let k = 0; k < order.length; k++) {
      if (isWin(anna, playedUpTo(c, k), c.size, c.rule)) {
        first = k;
        break;
      }
    }
    expect(first).toBeGreaterThanOrEqual(2);
    const before = steps[first - 1];
    const at = steps[first];
    if (!before || !at) throw new Error("нет шага");
    expect(score(before, [claim(first - 1, "anna")], { state: state() })).toEqual([]);
    expect(score(at, [claim(first, "anna")], { state: state() })).toEqual([{ pid: "anna", delta: 300 }]);
  });
});

describe("ход лото на пульте", () => {
  const c = game({ songs: songs(9) });
  const base: Session = {
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "",
    mechanic: "lotto",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: startState(),
    leaderboard: { a: { name: "Аня", kind: "player", score: 0 }, b: { name: "Боря", kind: "player", score: 0 } },
    createdAt: 0,
  };

  it("первая песня → название → дальше …; на последней все собрали — награждение", () => {
    let s = base;
    expect(lottoPrimary(s, c)).toBe("play");
    s = applyChange(s, playSong(s), 1);
    expect(s.state.stage).toBe("question");
    for (let k = 0; k < 8; k++) {
      s = applyChange(s, revealSong(s, c, [], []), 2);
      expect(lottoPrimary(s, c)).toBe("next");
      s = applyChange(s, nextSong(s), 3);
    }
    // Последняя (9-я) песня: на карточке 3×3 все 9 — у обоих линия; Аня нажала раньше.
    s = applyChange(s, revealSong(s, c, [claim(8, "b", 7), claim(8, "a", 4)], []), 4);
    expect(s.leaderboard.a?.score).toBe(300);
    expect(s.leaderboard.b?.score).toBe(200);
    expect(parseLottoResult(s.state.result)).toMatchObject({ winners: ["a", "b"], last: ["a", "b"] });
    expect(lottoPrimary(s, c)).toBe("podium");
    // «Назад» с названия снимает очки и победителей этой песни.
    const back = lottoBack(s);
    if (!back) throw new Error("нет шага назад");
    const undone = applyChange(s, back.change, 5);
    expect(undone.leaderboard.a?.score).toBe(0);
    expect(parseLottoResult(undone.state.result).winners).toEqual([]);
  });

  it("неверная заявка отмечается, победители переходят на следующую песню", () => {
    let s = applyChange(base, playSong(base), 1);
    s = applyChange(s, revealSong(s, c, [claim(0, "a")], []), 2);
    expect(parseLottoResult(s.state.result).rejected).toEqual(["a"]);
    s = applyChange(s, { state: { result: { winners: ["b"], last: [], rejected: [], replay: 0 } } }, 3);
    s = applyChange(s, nextSong(s), 4);
    expect(parseLottoResult(s.state.result).winners).toEqual(["b"]);
  });
});
