import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session } from "../../data/types";
import { createStory, fillTemplate, parseStory, slotsOf } from "./content";
import { endingReveal, endingStart, endingVote, endingWrite, writtenEndings } from "./ending";
import { liesReveal, liesStart, liesWrite, writtenFacts } from "./lies";
import { nextPart, parseStoryResult, revealAuthor, startGuessing, startWriting, storyBack, storyPrimary, withEnding, withLies, writtenStories } from "./logic";
import { validateStory } from "./validate";
import { finishRating, newSentence, showSentence, spinWheel, startRating, wordsIntro } from "./words";

const players: Participant[] = ["a", "b", "c", "d"].map((id, i) => ({ id, name: `Игрок ${id}`, kind: "player", teamId: null, captainUid: id, joinedAt: i + 1 }));
const ans = (step: number, pid: string, value: unknown, at = 1): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: at });
const first = () => 0;

function session(): Session {
  return { id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "Д", mechanic: "story", gameSnapshot: null, themeId: "joyrest", playMode: "solo", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 } as Session;
}
const scores = (s: Session) => Object.fromEntries(Object.entries(s.leaderboard).map(([k, v]) => [k, v.score]));

describe("давайте знакомиться: содержимое", () => {
  it("шаблон: пропуски и подстановка", () => {
    expect(slotsOf("Однажды [кто] пошёл в [Куда]")).toEqual(["кто", "куда"]);
    expect(fillTemplate("[кто] и [кого]", ["кот", null]).map((p) => p.text)).toEqual(["кот", " и ", ""]);
  });

  it("шаблон игры проходит проверку, пустые разделы — нет", () => {
    expect(validateStory(createStory())).toEqual([]);
    expect(parseStory({ sections: ["lies", "lies", "x"] }).sections).toEqual(["lies"]);
    expect(validateStory({ ...createStory(), bank: {} }).length).toBeGreaterThan(0);
    expect(validateStory({ ...createStory(), sections: ["said"], saidQuestions: [] })).toHaveLength(1);
  });
});

describe("«Чья история?»", () => {
  it("запись, угадывание, очки угадавшим и бонус автору, назад снимает очки", () => {
    const content = { ...createStory(), sections: ["author" as const] };
    let s = session();
    expect(storyPrimary(s, content)).toBe("write");
    s = applyChange(s, startWriting(s, players), 1);
    const w = s.state.step;
    const stories = [ans(w, "a", { story: "Я прыгал с парашютом над морем" }, 1), ans(w, "b", { story: "Я пела в хоре Пятницкого" }, 2)];
    expect(storyPrimary(s, content)).toBe("start");
    const start = startGuessing(s, content, stories, players, first);
    expect(start).not.toBeNull();
    s = applyChange(s, start ?? {}, 2);
    const r = parseStoryResult(s.state.result);
    expect(r.stories).toHaveLength(2);
    const written = writtenStories(stories, { ...r, writeStep: w });
    const author = written.find((x) => x.text === r.stories[0]?.text)?.pid ?? "";
    const other = author === "a" ? "b" : "a";
    // Угадал только «c»; автор и голос за себя не считаются.
    const votes = [ans(s.state.step, "c", { guess: author }), ans(s.state.step, "d", { guess: "c" }), ans(s.state.step, author, { guess: other })];
    s = applyChange(s, revealAuthor(s, content, votes, written), 3);
    expect(scores(s).c).toBe(content.guessPoints);
    expect(scores(s)[author]).toBe(0);
    const back = storyBack(s, content);
    s = applyChange(s, back?.change ?? {}, 4);
    expect(scores(s).c).toBe(0);
    // Никто не угадал — бонус автору.
    s = applyChange(s, revealAuthor(s, content, [ans(s.state.step, "c", { guess: "d" })], written), 5);
    expect(scores(s)[author]).toBe(content.authorBonus);
    expect(storyPrimary(s, content)).toBe("next");
  });
});

describe("«Сочиняем историю»", () => {
  it("бумажки по очереди, выбранные слова, рулетка, звёзды без выступившего", () => {
    const content = { ...createStory(), sections: ["words" as const], templates: ["[кто] пошёл в [куда]"] };
    let s = session();
    s = { ...s, leaderboard: Object.fromEntries(players.map((p) => [p.id, { name: p.name, kind: "player" as const, score: 0 }])) };
    const m = newSentence(s, content, wordsIntro(), ["a", "b", "c", "d"], first);
    expect(m.words.papers.map((p) => p.pid)).toEqual(["a", "b"]);
    expect(m.words.papers[0]?.words).toHaveLength(content.paperWords);
    s = applyChange(s, m.change, 1);
    const shown = showSentence(s, m.words, [ans(s.state.step, "a", { word: 1 })], first);
    expect(shown.words.filled[0]).toBe(m.words.papers[0]?.words[1]);
    expect(shown.words.filled[1]).toBe(m.words.papers[1]?.words[0]);
    const spun = spinWheel(s, shown.words, ["a", "b", "c", "d"], (p) => p, () => 0.5);
    expect(spun.words.performer).toBe("c");
    const rate = startRating(s, content, spun.words);
    s = applyChange(s, rate.change, 2);
    const stars = [ans(s.state.step, "a", { stars: 5 }), ans(s.state.step, "b", { stars: 4 }), ans(s.state.step, "c", { stars: 1 })];
    const done = finishRating(s, content, rate.words, stars, (p) => p === "c");
    expect(done.words.avg).toBe(4.5);
    s = applyChange(s, done.change, 3);
    expect(scores(s).c).toBe(Math.round(4.5 * content.starPoints));
  });
});

describe("«Две правды и ложь»", () => {
  it("нашёл ложь — очки, автору — за каждого обманутого", () => {
    const content = { ...createStory(), sections: ["lies" as const] };
    let s = session();
    s = { ...s, leaderboard: Object.fromEntries(players.map((p) => [p.id, { name: p.name, kind: "player" as const, score: 0 }])) };
    const w = liesWrite(s);
    s = applyChange(s, withLies(s, w.lies, w.change), 1);
    const facts = [ans(s.state.step, "a", { facts: ["Был в Китае", "Умею жонглировать", "Боюсь кошек"], lie: 2 })];
    const st = liesStart(s, content, w.lies, facts, first);
    expect(st).not.toBeNull();
    if (!st) return;
    s = applyChange(s, withLies(s, st.lies, st.change), 2);
    const lieAt = st.lies.items[0]?.facts.indexOf("Боюсь кошек") ?? -1;
    const votes = [ans(s.state.step, "b", { pick: lieAt }), ans(s.state.step, "c", { pick: (lieAt + 1) % 3 }), ans(s.state.step, "d", { pick: (lieAt + 2) % 3 })];
    const rv = liesReveal(s, content, st.lies, votes, writtenFacts(facts, w.lies.writeStep));
    s = applyChange(s, withLies(s, rv.lies, rv.change), 3);
    expect(scores(s)).toMatchObject({ b: content.guessPoints, a: 2 * Math.round(content.foolPoints / 2), c: 0 });
  });
});

describe("«Что было дальше?»", () => {
  it("настоящая концовка среди выдумок; угадавшим и авторам выдумок — очки", () => {
    const content = { ...createStory(), sections: ["ending" as const] };
    let s = session();
    s = { ...s, leaderboard: Object.fromEntries(players.map((p) => [p.id, { name: p.name, kind: "player" as const, score: 0 }])) };
    const w = endingWrite(s);
    s = applyChange(s, withEnding(s, w.ending, w.change), 1);
    expect(parseStoryResult(s.state.result).changeable).toBe(true);
    const stories = [ans(s.state.step, "a", { start: "Однажды я заблудился в лесу под Тверью", end: "вышел к лагерю олимпийцев" })];
    const st = endingStart(s, content, w.ending, stories, first);
    if (!st) throw new Error("нет историй");
    s = applyChange(s, withEnding(s, st.ending, st.change), 2);
    const fakes = [ans(s.state.step, "b", { fake: "встретил медведя" }), ans(s.state.step, "c", { fake: "нашёл клад" }), ans(s.state.step, "a", { fake: "это не считается" })];
    const written = writtenEndings(stories, w.ending.writeStep);
    const vote = endingVote(s, content, st.ending, fakes, written, first);
    expect(vote.ending.options).toHaveLength(3);
    s = applyChange(s, withEnding(s, vote.ending, vote.change), 3);
    const id = (t: string) => vote.ending.options.find((o) => o.text === t)?.id ?? "";
    const votes = [ans(s.state.step, "b", { pick: id("вышел к лагерю олимпийцев") }), ans(s.state.step, "c", { pick: id("встретил медведя") }), ans(s.state.step, "d", { pick: id("встретил медведя") })];
    const rv = endingReveal(s, content, vote.ending, votes, fakes, written);
    s = applyChange(s, withEnding(s, rv.ending, rv.change), 4);
    expect(scores(s)).toMatchObject({ b: content.guessPoints + 2 * content.foolPoints, c: 0, d: 0, a: 0 });
  });
});

describe("разделы по порядку", () => {
  it("после раздела — следующий, «Назад» с заставки возвращает прошлый", () => {
    const content = { ...createStory(), sections: ["author" as const, "lies" as const] };
    let s = session();
    s = applyChange(s, startWriting(s, players), 1);
    const stories = [ans(s.state.step, "a", { story: "Я однажды выиграл в лотерею чайник" })];
    s = applyChange(s, startGuessing(s, content, stories, players, first) ?? {}, 2);
    s = applyChange(s, revealAuthor(s, content, [], writtenStories(stories, parseStoryResult({ ...(s.state.result as object), writeStep: 0 }))), 3);
    expect(storyPrimary(s, content)).toBe("nextPart");
    const before = s.state.step;
    s = applyChange(s, nextPart(s), 4);
    expect(parseStoryResult(s.state.result).part).toBe(1);
    expect(storyPrimary(s, content)).toBe("liesWrite");
    s = applyChange(s, storyBack(s, content)?.change ?? {}, 5);
    expect(s.state.step).toBe(before);
    expect(parseStoryResult(s.state.result).part).toBe(0);
  });
});
