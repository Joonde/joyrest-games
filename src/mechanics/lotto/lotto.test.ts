import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Session } from "../../data/types";
import { CARD_STYLES, CARD_STYLE_TITLES, cardCells, cellFit, createLotto, parseLotto, parseSongList, type LottoContent } from "./content";
import { DEMO_LOTTO } from "./demo";
import { canLastCall, cardFor, cardLines, hushSong, lastCall, revealedUpTo, splitMarks, isWin, lottoBack, lottoPrimary, lottoSteps, lottoVideoCommand, lyricsCommand, nextSong, orderOf, parseLottoResult, playedNumbers, playedUpTo, playSong, replaySong, revealSong, score, shuffledOrder, songAt } from "./logic";
import { DRUM_MS, softHyphens, hasLyrics, lyricIndex, lyricsFromText, parseLrc, parseLyrics, songLength, toLrc } from "./content";
import { badVideoLink, hasVideo } from "./content";
import { validateLotto } from "./validate";
import { lineProgress } from "./karaoke";

const NO_VIDEO = { source: "none" as const, url: "", name: "" };
const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Песня ${i}`, artist: "", trackId: null, trackStart: 0, video: NO_VIDEO, videoStart: 0, length: null, lyrics: [], times: [], lyricsShow: "reveal" as const, lyricsAt: 0 }));
const game = (patch: Partial<LottoContent> = {}): LottoContent => ({ songs: songs(12), size: 3, rule: "line", fragment: 30, prizes: [300, 200, 100], cardStyle: "classic", videoHide: false, hint: true, drum: "off", playAfter: false, ...patch });
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
    const dup = game({ songs: [...songs(9), { ...songs(1)[0]!, id: "x", title: "Песня 1" }] });
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

describe("лото: что собрать для победы", () => {
  // Карточка 3×3: клетки 0..8, ряд 0 — 0,1,2; столбец 0 — 0,3,6; диагональ — 0,4,8.
  const card = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  const row = new Set(["a", "b", "c"]);
  const col = new Set(["a", "d", "g"]);
  const diag = new Set(["a", "e", "i"]);
  it("линия по горизонтали — только ряд", () => {
    expect(isWin(card, row, 3, "row")).toBe(true);
    expect(isWin(card, col, 3, "row")).toBe(false);
    expect(isWin(card, diag, 3, "row")).toBe(false);
  });
  it("линия по вертикали — только столбец", () => {
    expect(isWin(card, col, 3, "column")).toBe(true);
    expect(isWin(card, row, 3, "column")).toBe(false);
    expect(isWin(card, diag, 3, "column")).toBe(false);
  });
  it("любая линия — ряд, столбец или диагональ", () => {
    for (const set of [row, col, diag]) expect(isWin(card, set, 3, "line")).toBe(true);
  });
  it("правило сохраняется и читается, неизвестное — «одна линия»", () => {
    expect(parseLotto({ ...createLotto(), rule: "row" }).rule).toBe("row");
    expect(parseLotto({ ...createLotto(), rule: "column" }).rule).toBe("column");
    expect(parseLotto({ ...createLotto(), rule: "diagonal" }).rule).toBe("line");
  });
});


describe("«Назад» через несколько песен (QA 23 октября 2026)", () => {
  const c = game();
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
  const back = (s: Session, t: number) => {
    const plan = lottoBack(s);
    if (!plan) throw new Error("нет шага назад");
    return applyChange(s, plan.change, t);
  };

  it("победа на песне, название следующей показано → «Назад» до победной песни снимает 300 и победу", () => {
    let win = -1;
    for (let k = 0; k < c.songs.length && win < 0; k++) if (isWin(cardFor(c, "a"), playedUpTo(c, k), c.size, c.rule)) win = k;
    expect(win).toBeGreaterThanOrEqual(0);
    expect(win).toBeLessThan(c.songs.length - 1);
    let s = applyChange(base, playSong(base), 1);
    for (let k = 0; k < win; k++) {
      s = applyChange(s, revealSong(s, c, [], []), 2);
      s = applyChange(s, nextSong(s), 3);
    }
    s = applyChange(s, revealSong(s, c, [claim(win, "a")], []), 4);
    expect(s.leaderboard.a?.score).toBe(300);
    s = applyChange(s, nextSong(s), 5);
    s = applyChange(s, revealSong(s, c, [], []), 6);
    expect(s.leaderboard.a).toMatchObject({ score: 300, last: 0 });
    s = back(s, 7); // название следующей → она звучит
    s = back(s, 8); // → название победной песни
    expect(s.state).toMatchObject({ step: win, stage: "reveal" });
    expect(parseLottoResult(s.state.result).last).toEqual(["a"]);
    expect(s.leaderboard.a).toMatchObject({ score: 300, last: 300 });
    s = back(s, 9); // → победная песня звучит: очки и победа сняты
    expect(s.leaderboard.a).toMatchObject({ score: 0, last: 0 });
    expect(parseLottoResult(s.state.result).winners).toEqual([]);
    // Повторный показ названия — снова 300, не 600.
    s = applyChange(s, revealSong(s, c, [claim(win, "a")], []), 10);
    expect(s.leaderboard.a?.score).toBe(300);
  });

  it("старые итоги без побед по песням читаются без ошибок", () => {
    expect(parseLottoResult({ winners: ["a"], wins: [{ step: "x" }, { step: 2, prizes: { a: 300, b: "x" } }] }).wins).toEqual([{ step: 2, prizes: { a: 300 } }]);
    expect(parseLottoResult(null).wins).toEqual([]);
  });
});


describe("барабан: случайный порядок песен (27 октября 2026)", () => {
  const c = game({ songs: songs(24), drum: "full" });
  const base: Session = {
    id: "sess-1",
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
    leaderboard: { a: { name: "Аня", kind: "player", score: 0 } },
    createdAt: 0,
  };

  it("порядок — перестановка всех песен, один и тот же для сессии, разный для разных сессий", () => {
    const o1 = shuffledOrder(c, "sess-1");
    expect([...o1].sort((x, y) => x - y)).toEqual(c.songs.map((_, i) => i));
    expect(shuffledOrder(c, "sess-1")).toEqual(o1);
    expect(shuffledOrder(c, "sess-2")).not.toEqual(o1);
    expect(o1).not.toEqual(c.songs.map((_, i) => i));
  });

  it("первая песня ставит порядок, дальше он не меняется — ни «Следующая», ни «Назад», ни повтор", () => {
    let s = applyChange(base, playSong(base, c), 1);
    const order = parseLottoResult(s.state.result).order;
    expect(order).toEqual(shuffledOrder(c, base.id));
    s = applyChange(s, replaySong(s), 2);
    s = applyChange(s, revealSong(s, c, [], []), 3);
    s = applyChange(s, nextSong(s), 4);
    expect(parseLottoResult(s.state.result).order).toEqual(order);
    expect(songAt(c, order, s.state.step)?.id).toBe(c.songs[order[1] as number]?.id);
    const back = lottoBack(s);
    if (!back) throw new Error("нет шага назад");
    s = applyChange(s, back.change, 5);
    expect(parseLottoResult(s.state.result).order).toEqual(order);
    // Назад до заставки и снова «Включить» — та же первая песня.
    const back2 = lottoBack(applyChange(s, lottoBack(s)?.change ?? {}, 6));
    expect(back2).not.toBeNull();
    const again = applyChange(base, playSong(base, c), 7);
    expect(parseLottoResult(again.state.result).order).toEqual(order);
  });

  it("без барабана — по списку; у старых сессий без порядка — по списку", () => {
    const plain = game({ songs: songs(5) });
    const s = applyChange(base, playSong(base, plain), 1);
    expect(orderOf(plain, parseLottoResult(s.state.result).order)).toEqual([0, 1, 2, 3, 4]);
    expect(orderOf(plain, [0, 0, 1, 2, 3])).toEqual([0, 1, 2, 3, 4]);
    expect(orderOf(plain, [4, 3, 2, 1, 0])).toEqual([4, 3, 2, 1, 0]);
    expect(orderOf(plain, "x")).toEqual([0, 1, 2, 3, 4]);
  });

  it("проверка «Лото!» — по песням в порядке барабана, а не по списку", () => {
    const small = game({ songs: songs(12), size: 3, rule: "full", drum: "full" });
    let s = applyChange(base, playSong(base, small), 1);
    const order = parseLottoResult(s.state.result).order;
    const card = cardFor(small, "a");
    // Играем песни, пока не прозвучат все 9 с карточки Ани.
    while (![...card].every((id) => playedUpTo(small, s.state.step, order).has(id))) {
      s = applyChange(s, revealSong(s, small, [], []), 2);
      s = applyChange(s, nextSong(s), 3);
    }
    const step = s.state.step;
    const won = applyChange(s, revealSong(s, small, [claim(step, "a")], []), 4);
    expect(won.leaderboard.a?.score).toBe(300);
    // По списку (без порядка) на этом шаге карточка, как правило, ещё не собрана — значит, порядок учтён.
    expect(playedUpTo(small, step, order).size).toBe(step + 1);
    expect(playedNumbers(order, step)).toEqual(order.slice(0, step + 1).map((i) => i + 1));
  });

  it("стоп и текст на экран — команды пульта; новая песня их сбрасывает", () => {
    let s = applyChange(base, playSong(base, c), 1);
    s = applyChange(s, revealSong(s, c, [], []), 2);
    s = applyChange(s, hushSong(s), 3);
    s = applyChange(s, lyricsCommand(s, "on"), 4);
    expect(parseLottoResult(s.state.result)).toMatchObject({ hush: 1, lyrics: "on" });
    s = applyChange(s, nextSong(s), 5);
    expect(parseLottoResult(s.state.result)).toMatchObject({ hush: 0, lyrics: "auto" });
  });

  it("«Назад» с новой песни на название прошлой — музыка прошлой не включается (hush)", () => {
    let s = applyChange(base, playSong(base, c), 1);
    s = applyChange(s, revealSong(s, c, [], []), 2);
    s = applyChange(s, nextSong(s), 3);
    const back = lottoBack(s);
    if (!back) throw new Error("нет шага назад");
    s = applyChange(s, back.change, 4);
    expect(s.state.stage).toBe("reveal");
    expect(parseLottoResult(s.state.result).hush).toBeGreaterThan(0);
  });

  it("настройки барабана: старые игры — без барабана, новые — с барабаном; длительность показа", () => {
    expect(parseLotto({ songs: [] }).drum).toBe("off");
    expect(parseLotto({ drum: "quick" }).drum).toBe("quick");
    expect(parseLotto({ drum: "x" }).drum).toBe("off");
    expect(createLotto().drum).toBe("full");
    expect(parseLotto(createLotto()).drum).toBe("full");
    expect(DRUM_MS.off).toBe(0);
    expect(DRUM_MS.quick).toBeLessThan(DRUM_MS.full);
    expect(parseLotto({ playAfter: true }).playAfter).toBe(true);
    expect(parseLotto({}).playAfter).toBe(false);
  });
});

describe("песня: своя длина, текст и разметка", () => {
  it("длина песни: общая, своя в пределах, «до конца»", () => {
    const c = parseLotto({ fragment: 30, songs: [{ id: "a" }, { id: "b", length: 0 }, { id: "c", length: 2 }, { id: "d", length: 99999 }, { id: "e", length: 75 }] });
    expect(c.songs.map((s) => s.length)).toEqual([null, 0, 5, 900, 75]);
    expect(songLength(c, c.songs[0])).toBe(30);
    expect(songLength(c, c.songs[1])).toBe(0);
    expect(songLength(c, c.songs[4])).toBe(75);
  });

  it("текст: пустые строки убираются, время не убывает и не длиннее строк", () => {
    expect(lyricsFromText("Первая\n\n  Вторая  \r\nТретья")).toEqual(["Первая", "Вторая", "Третья"]);
    expect(parseLyrics(["а", "б", "в"], [5, 3, 10, 20])).toEqual({ lyrics: ["а", "б", "в"], times: [5, 5, 10] });
    expect(parseLyrics(["а", "б"], [1.234, "x", 3])).toEqual({ lyrics: ["а", "б"], times: [1.2] });
    expect(parseLyrics("мусор", null)).toEqual({ lyrics: [], times: [] });
    const many = parseLyrics(Array.from({ length: 500 }, (_, i) => `строка ${i}`), []);
    expect(many.lyrics.length).toBe(200);
  });

  it("песня из базы: текст, разметка и когда показывать", () => {
    const c = parseLotto({ songs: [{ id: "a", lyrics: ["раз", "два"], times: [10, 12.55], lyricsShow: "at", lyricsAt: 8.04 }, { id: "b", lyricsShow: "x" }] });
    expect(c.songs[0]).toMatchObject({ lyrics: ["раз", "два"], times: [10, 12.6], lyricsShow: "at", lyricsAt: 8 });
    expect(c.songs[1]).toMatchObject({ lyrics: [], times: [], lyricsShow: "reveal", lyricsAt: 0 });
    expect(hasLyrics(c.songs[0])).toBe(true);
    expect(hasLyrics(c.songs[1])).toBe(false);
  });

  it(".lrc: метки времени, служебные теги, несколько меток у строки, смещение", () => {
    const lrc = "[ar:Кто-то]\n[ti:Песня]\n[offset:+500]\n[00:12.50]Первая строка\n[00:15.00][01:00.00]Припев\n[00:20]Третья\nбез времени";
    const parsed = parseLrc(lrc);
    expect(parsed).toEqual({ lyrics: ["Первая строка", "Припев", "Третья", "Припев"], times: [12, 14.5, 19.5, 59.5] });
    expect(parseLrc("просто текст\nбез меток")).toBeNull();
    const back = toLrc({ title: "Т", artist: "А", lyrics: ["раз", "два"], times: [62.5] });
    expect(back).toBe("[ti:Т]\n[ar:А]\n[01:02.50] раз\nдва");
    expect(parseLrc(back)).toEqual({ lyrics: ["раз"], times: [62.5] });
  });

  it("какая строка звучит", () => {
    const times = [10, 12, 15];
    expect(lyricIndex(times, 5)).toBe(-1);
    expect(lyricIndex(times, 10)).toBe(0);
    expect(lyricIndex(times, 14.9)).toBe(1);
    expect(lyricIndex(times, 100)).toBe(2);
    expect(lyricIndex([], 3)).toBe(-1);
  });
});

describe("караоке: доля спетой строки", () => {
  it("от начала строки до начала следующей; последняя — 4 секунды; за краями — 0 и 1", () => {
    const times = [10, 12, 12, 20];
    expect(lineProgress(times, 0, 9)).toBe(0);
    expect(lineProgress(times, 0, 11)).toBe(0.5);
    expect(lineProgress(times, 0, 30)).toBe(1);
    expect(lineProgress(times, 1, 12)).toBe(1);
    expect(lineProgress(times, 3, 22)).toBe(0.5);
    expect(lineProgress(times, 9, 22)).toBe(0);
  });
});

describe("отметки после ответа и «Последний шанс» (28 октября 2026)", () => {
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
    state: { ...startState(), phase: "playing" },
    leaderboard: { a: { name: "Аня", kind: "player", score: 0 }, b: { name: "Боря", kind: "player", score: 0 } },
    createdAt: 0,
  };

  it("открытые названия: пока песня звучит — без неё, на названии, в «Последний шанс» и на награждении — с ней", () => {
    let s = applyChange(base, playSong(base), 1);
    expect([...revealedUpTo(c, s.state)]).toEqual([]);
    s = applyChange(s, revealSong(s, c, [], []), 2);
    expect([...revealedUpTo(c, s.state)]).toEqual(["s0"]);
    s = applyChange(s, nextSong(s), 3);
    expect([...revealedUpTo(c, s.state)]).toEqual(["s0"]);
    expect([...revealedUpTo(c, { ...s.state, stage: "ready" })]).toEqual([]);
  });

  it("догадка — пока название не открыто; открылось — верная настоящая, неверная — к снятию", () => {
    const revealed = new Set(["s0", "s3"]);
    expect(splitMarks(["s3", "s5", "s0"], revealed)).toEqual({ confirmed: ["s3", "s0"], pencil: ["s5"] });
    // «Лото!» по настоящим отметкам: догадка линию не собирает.
    const card = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
    expect(isWin(card, new Set(splitMarks(["s0", "s1", "s2"], new Set(["s0", "s1"])).confirmed), 3, "row")).toBe(false);
    expect(isWin(card, new Set(splitMarks(["s0", "s1", "s2"], new Set(["s0", "s1", "s2"])).confirmed), 3, "row")).toBe(true);
  });

  it("«Последний шанс» — только на названии последней песни и один раз; песня не перезапускается", () => {
    let s = applyChange(base, playSong(base), 1);
    for (let k = 0; k < 8; k++) {
      expect(canLastCall(s, c)).toBe(false);
      s = applyChange(s, revealSong(s, c, [], []), 2);
      expect(canLastCall(s, c)).toBe(false);
      s = applyChange(s, nextSong(s), 3);
    }
    s = applyChange(s, revealSong(s, c, [claim(8, "a", 4)], []), 4);
    expect(s.leaderboard.a?.score).toBe(300);
    expect(canLastCall(s, c)).toBe(true);
    const startedAt = s.state.startedAt;
    s = applyChange(s, lastCall(s), 5);
    expect(s.state.stage).toBe("question");
    expect(s.state.startedAt).toBe(startedAt);
    expect(parseLottoResult(s.state.result).call).toBe(1);
    expect(canLastCall(s, c)).toBe(false);
    // Название остаётся открытым — гости отмечают по нему.
    expect(revealedUpTo(c, s.state).has(c.songs[8]!.id)).toBe(true);
    // Боря собрал после названия: засчитан вторым, Аня остаётся с первым призом.
    s = applyChange(s, revealSong(s, c, [claim(8, "a", 4), claim(8, "b", 9)], []), 6);
    expect(s.leaderboard.a?.score).toBe(300);
    expect(s.leaderboard.b?.score).toBe(200);
    const r = parseLottoResult(s.state.result);
    expect(r.winners).toEqual(["a", "b"]);
    expect(r.last).toEqual(["b"]);
    expect(r.wins.find((w) => w.step === 8)?.prizes).toEqual({ a: 300, b: 200 });
    expect(canLastCall(s, c)).toBe(false);
    // «Назад» с названия после шанса снимает обе победы этой песни.
    const back = lottoBack(s);
    if (!back) throw new Error("нет шага назад");
    const undone = applyChange(s, back.change, 7);
    expect(undone.leaderboard.a?.score).toBe(0);
    expect(undone.leaderboard.b?.score).toBe(0);
    expect(parseLottoResult(undone.state.result).winners).toEqual([]);
  });

  it("«Назад» из «Последнего шанса» — снова название, победители и очки на месте", () => {
    let s = applyChange(base, playSong(base), 1);
    for (let k = 0; k < 8; k++) {
      s = applyChange(s, revealSong(s, c, [], []), 2);
      s = applyChange(s, nextSong(s), 3);
    }
    s = applyChange(s, revealSong(s, c, [claim(8, "a", 4)], []), 4);
    s = applyChange(s, lastCall(s), 5);
    const back = lottoBack(s);
    if (!back) throw new Error("нет шага назад");
    expect(back.clearAnswers).toBeUndefined();
    const again = applyChange(s, back.change, 6);
    expect(again.state.stage).toBe("reveal");
    expect(again.leaderboard.a?.score).toBe(300);
    expect(parseLottoResult(again.state.result)).toMatchObject({ winners: ["a"], last: ["a"], call: 0 });
    expect(canLastCall(again, c)).toBe(true);
  });

  it("новая песня сбрасывает «Последний шанс»; старые итоги без поля — 0", () => {
    expect(parseLottoResult({}).call).toBe(0);
    expect(parseLottoResult({ call: -2 }).call).toBe(0);
    const s = applyChange(base, playSong(base), 1);
    expect(parseLottoResult(applyChange(s, nextSong(s), 2).state.result).call).toBe(0);
  });
});

describe("мягкие переносы в названиях", () => {
  const show = (t: string) => softHyphens(t).replace(/\u00ad/g, "-");
  it("длинные слова — по слогам, короткие и с дефисом — как есть", () => {
    expect(show("Колыбельная")).toBe("Ко-лы-бель-ная");
    expect(show("Позвони мне, позвони")).toBe("Поз-во-ни мне, поз-во-ни");
    expect(show("Лимонадное настроение")).toBe("Ли-мо-над-ное нас-тро-ение");
    expect(show("Ла-ла-ла")).toBe("Ла-ла-ла");
    expect(show("Сон")).toBe("Сон");
  });
  it("переносы не меняют текст и не оставляют одну букву", () => {
    for (const t of ["Дискотека девяностых", "Мандариновый Новый год", "Фейерверк желаний", "Километры до тебя", "Шоколадное"]) {
      const out = softHyphens(t);
      expect(out.replace(/\u00ad/g, "")).toBe(t);
      for (const word of out.split(/\s+/)) for (const part of word.split("\u00ad")) expect(part.replace(/[^А-Яа-яЁё]/g, "").length).toBeGreaterThanOrEqual(2);
    }
  });
});
