import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Session } from "../../data/types";
import { CARD_STYLES, CARD_STYLE_TITLES, cardCells, cellFit, createLotto, parseLotto, parseSongList, type LottoContent } from "./content";
import { DEMO_LOTTO } from "./demo";
import { cardFor, cardLines, isWin, lottoBack, lottoPrimary, lottoSteps, lottoVideoCommand, nextSong, parseLottoResult, playedUpTo, playSong, replaySong, revealSong, score } from "./logic";
import { badVideoLink, hasVideo } from "./content";
import { validateLotto } from "./validate";

const NO_VIDEO = { source: "none" as const, url: "", name: "" };
const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Песня ${i}`, artist: "", trackId: null, trackStart: 0, video: NO_VIDEO, videoStart: 0 }));
const game = (patch: Partial<LottoContent> = {}): LottoContent => ({ songs: songs(12), size: 3, rule: "line", fragment: 30, prizes: [300, 200, 100], cardStyle: "classic", videoHide: false, hint: true, ...patch });
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

  it("оформление карточки: старые игры и неизвестные значения — «Классика»", () => {
    expect(parseLotto({ songs: [], size: 4 }).cardStyle).toBe("classic");
    expect(parseLotto({ cardStyle: "neon" }).cardStyle).toBe("classic");
    expect(parseLotto({ cardStyle: 5 }).cardStyle).toBe("classic");
    expect(parseLotto({ cardStyle: "evening" }).cardStyle).toBe("evening");
    expect(parseLotto({ cardStyle: "day" }).cardStyle).toBe("day");
    expect(parseLotto(createLotto()).cardStyle).toBe(createLotto().cardStyle);
    expect(CARD_STYLES.map((s) => CARD_STYLE_TITLES[s])).toEqual(["Классика", "Вечер", "День"]);
  });

  it("клетка рисованной карточки: длинные слова и названия — шрифт меньше, исполнитель убирается", () => {
    expect(cellFit("Вика", 4)).toEqual({ fit: 1, artist: true });
    expect(cellFit("", 4)).toEqual({ fit: 1, artist: true });
    const long = cellFit("Владивосток 2000", 4);
    expect(long.fit).toBeLessThan(1);
    expect(long.fit).toBeGreaterThanOrEqual(0.6);
    expect(long.artist).toBe(true);
    expect(cellFit("Полковнику никто не пишет", 4).artist).toBe(false);
    expect(cellFit("Районы-кварталы", 3).fit).toBe(1);
    expect(cellFit("Оченьоченьоченьдлинноеслово", 5).fit).toBe(0.6);
    for (const size of [3, 4, 5] as const) {
      expect(cellFit("Звезда по имени Солнце", size).artist).toBe(false);
      expect(cellFit("Вика", size).artist).toBe(size < 5);
    }
  });

  it("шаблон библиотеки — карточка «Вечер», проверка проходит", () => {
    const demo = parseLotto(DEMO_LOTTO.content);
    expect(demo.cardStyle).toBe("evening");
    expect(validateLotto(demo)).toEqual([]);
    for (const cardStyle of CARD_STYLES) expect(validateLotto(game({ cardStyle }))).toEqual([]);
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
    const dup = game({ songs: [...songs(9), { id: "x", title: "Песня 1", artist: "", trackId: null, trackStart: 0, video: NO_VIDEO, videoStart: 0 }] });
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

  it("«Назад» через следующую песню снимает и очки, и победу прошлой", () => {
    let s = base;
    s = applyChange(s, playSong(s), 1);
    for (let k = 0; k < 8; k++) {
      s = applyChange(s, revealSong(s, c, [], []), 2);
      s = applyChange(s, nextSong(s), 3);
    }
    s = applyChange(s, revealSong(s, c, [claim(8, "a", 4)], []), 4);
    expect(s.leaderboard.a?.score).toBe(300);
    // Ведущий ушёл бы дальше, если бы была песня; имитируем «следующую» и возврат.
    const next = applyChange(s, { state: { step: 9, stage: "question", revealed: false, result: { winners: ["a"], last: [], rejected: [], replay: 0 } } }, 5);
    const back1 = lottoBack(next);
    if (!back1) throw new Error("нет шага назад");
    const atReveal = applyChange(next, back1.change, 6);
    expect(parseLottoResult(atReveal.state.result).last).toEqual(["a"]);
    const back2 = lottoBack(atReveal);
    if (!back2) throw new Error("нет шага назад");
    const undone = applyChange(atReveal, back2.change, 7);
    expect(undone.leaderboard.a?.score).toBe(0);
    expect(parseLottoResult(undone.state.result).winners).toEqual([]);
  });
});

describe("видео песни (клип, караоке)", () => {
  it("из базы: ссылка, файл, мусор — без видео; старые игры — без видео и с показом сразу", () => {
    const c = parseLotto({
      songs: [
        { id: "a", title: "А", video: { source: "link", url: " https://youtu.be/dQw4w9WgXcQ ", name: "x" }, videoStart: 12.4 },
        { id: "b", title: "Б", video: { source: "file", url: "https://x", name: "клип.mp4" }, videoStart: -5 },
        { id: "c", title: "В", video: { source: "zzz" } },
        { id: "d", title: "Г" },
      ],
    });
    expect(c.songs[0]?.video).toEqual({ source: "link", url: "https://youtu.be/dQw4w9WgXcQ", name: "x" });
    expect(c.songs[0]?.videoStart).toBe(12);
    expect(c.songs[1]?.video).toEqual({ source: "file", url: "", name: "клип.mp4" });
    expect(c.songs[1]?.videoStart).toBe(0);
    expect(c.songs[2]?.video.source).toBe("none");
    expect(c.songs[3]?.video.source).toBe("none");
    expect(c.videoHide).toBe(false);
    expect(parseLotto({ videoHide: true }).videoHide).toBe(true);
    expect(hasVideo(c.songs[0])).toBe(true);
    expect(hasVideo(c.songs[1])).toBe(true);
    expect(hasVideo(c.songs[2])).toBe(false);
    expect(hasVideo({ video: { source: "link", url: " ", name: "" } })).toBe(false);
  });

  it("чужая ссылка — ошибка проверки, правильная — нет", () => {
    const bad = game({ songs: songs(12).map((s, i) => (i === 0 ? { ...s, video: { source: "link" as const, url: "https://example.com/a.mp4", name: "" } } : s)) });
    expect(badVideoLink(bad.songs[0] ?? { video: NO_VIDEO })).toBe(true);
    expect(validateLotto(bad).some((e) => e.path.endsWith("/video"))).toBe(true);
    const ok = game({ songs: songs(12).map((s, i) => (i === 0 ? { ...s, video: { source: "link" as const, url: "https://rutube.ru/video/0123456789abcdef0123456789abcdef/", name: "" } } : s)) });
    expect(validateLotto(ok)).toEqual([]);
  });

  it("команды пульта: пауза, дальше, перемотка; новая песня — видео с начала; показ названия видео не трогает", () => {
    const content = game();
    let s: Session = { id: "v", code: "111111", hostId: "h", gameId: "g", gameTitle: "", mechanic: "lotto", gameSnapshot: null, themeId: "joyrest", playMode: "solo", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 };
    s = applyChange(s, playSong(s), 1);
    expect(parseLottoResult(s.state.result).video).toEqual({ n: 0, cmd: "play", paused: false });
    s = applyChange(s, lottoVideoCommand(s, "pause"), 1);
    expect(parseLottoResult(s.state.result).video).toEqual({ n: 1, cmd: "pause", paused: true });
    s = applyChange(s, lottoVideoCommand(s, "fwd"), 1);
    expect(parseLottoResult(s.state.result).video).toEqual({ n: 2, cmd: "fwd", paused: true });
    s = applyChange(s, lottoVideoCommand(s, "play"), 1);
    expect(parseLottoResult(s.state.result).video.paused).toBe(false);
    s = applyChange(s, revealSong(s, content, [], []), 1);
    expect(parseLottoResult(s.state.result).video).toEqual({ n: 3, cmd: "play", paused: false });
    const back = lottoBack(s);
    expect(back).not.toBeNull();
    if (back) expect(parseLottoResult(applyChange(s, back.change, 1).state.result).video.n).toBe(3);
    s = applyChange(s, lottoVideoCommand(s, "stop"), 1);
    s = applyChange(s, nextSong(s), 1);
    expect(parseLottoResult(s.state.result).video).toEqual({ n: 0, cmd: "play", paused: false });
    s = applyChange(s, lottoVideoCommand(s, "pause"), 1);
    s = applyChange(s, replaySong(s), 1);
    const r = parseLottoResult(s.state.result);
    expect(r.replay).toBe(1);
    expect(r.video.paused).toBe(false);
    const toPrev = lottoBack(s);
    if (toPrev) expect(parseLottoResult(applyChange(s, toPrev.change, 1).state.result).video.paused).toBe(true);
  });
});
