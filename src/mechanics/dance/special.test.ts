import { describe, expect, it } from "vitest";
import { applyChange, startState } from "../../core/session";
import type { Answer, Participant, Session, SessionChange } from "../../data/types";
import { danceTrackIds, newCard, parseDance, type DanceContent } from "./content";
import { control, danceBack, dancePrimary, modifierVotes, nextTurn, parseDanceResult, performanceElapsed, pickCard, remixAt, remixDuration, showResult, startPerformance, startPick, startVote, winningModifier } from "./logic";
import { validateDance } from "./validate";
import { runPreview } from "../preview";
import { dancePreview } from "./preview";

const teams: Participant[] = ["A", "B", "C"].map((id, i) => ({ id, name: `Команда ${id}`, kind: "team", teamId: null, captainUid: `u${id}`, joinedAt: i }));
const session = (): Session => ({ id: "s", code: "1", hostId: "h", gameId: "g", gameTitle: "", mechanic: "dance", gameSnapshot: null, themeId: "joyrest", playMode: "teams", screenMode: "laptop", state: startState(), leaderboard: {}, createdAt: 0 });
let t = 0;
const apply = (s: Session, c: SessionChange) => applyChange(s, c, (t += 1000));
const ans = (pid: string, step: number, value: unknown): Answer => ({ id: `${step}_${pid}`, step, pid, uid: pid, value, submittedAt: 1e12 });

function specialContent(): DanceContent {
  const card = newCard("special");
  card.id = "special1";
  card.title = "Неожиданный ремикс";
  card.remix = card.remix.map((clip, index) => ({ ...clip, trackId: `track${index + 1}`, start: index * 20, length: 8 }));
  return parseDance({ cards: [card], battlePoints: 100, voteTime: 30 });
}

describe("«Танцуй иначе»: модель и проверка", () => {
  it("создаёт ровно три коротких фрагмента, нормализует повреждённые данные и собирает треки", () => {
    const parsed = parseDance({
      cards: [{
        id: "x",
        kind: "special",
        video: { source: "link", url: "https://youtu.be/dQw4w9WgXcQ" },
        remix: [{ trackId: "a", trackLength: 99 }, null, { trackId: "не id" }],
      }],
    });
    const card = parsed.cards[0]!;
    expect(card.remix).toHaveLength(3);
    expect(card.remix.map((clip) => clip.length)).toEqual([15, 8, 8]);
    expect(card.remix.map((clip) => clip.trackId)).toEqual(["a", null, null]);
    expect(card.video.source).toBe("none");
    expect(danceTrackIds(parsed)).toEqual(["a"]);
    expect(validateDance(parsed).map((error) => error.path)).toContain("cards/x/remix");
    expect(validateDance(specialContent())).toEqual([]);
  });

  it("не пропускает фрагмент длиннее 15 или короче 3 секунд", () => {
    const content = specialContent();
    content.cards[0]!.remix[0]!.length = 20;
    content.cards[0]!.remix[1]!.length = 2;
    expect(validateDance(content).map((error) => error.message)).toContain("Карточка 1 (Танцуй иначе): длина каждого фрагмента должна быть 3–15 секунд.");
  });

  it("не принимает неизвестный modifier и отрицательное elapsed из состояния", () => {
    const parsed = parseDanceResult({ mode: "modifier", modifier: "unknown", elapsed: -10 });
    expect(parsed.mode).toBe("modifier");
    expect(parsed.modifier).toBeNull();
    expect(parsed.elapsed).toBe(0);
  });
});

describe("«Танцуй иначе»: голосование за усложнение", () => {
  it("учитывает только команды и белый список; ничья и отсутствие голосов разрешаются по порядку", () => {
    let s = session();
    const content = specialContent();
    s = apply(s, startPick(s, teams));
    s = apply(s, pickCard(s, content, "special1", teams));
    const r = parseDanceResult(s.state.result);
    expect(r.mode).toBe("modifier");
    expect(dancePrimary(s, content)).toBe("perform");
    expect(winningModifier(r, [], s.state.step)).toBe("hands");
    const tied = [ans("A", 0, { modifier: "robot" }), ans("B", 0, { modifier: "hands" }), ans("C", 0, { modifier: "slow" })];
    expect(winningModifier(r, tied, 0)).toBe("hands");
    const filtered = [
      ...tied,
      ans("OUT", 0, { modifier: "robot" }),
      ans("A", 9, { modifier: "robot" }),
      ans("B", 0, { modifier: "bad" }),
    ];
    expect([...modifierVotes(r, filtered, 0).values()].reduce((sum, value) => sum + value, 0)).toBe(3);
  });
});

describe("«Танцуй иначе»: полный раунд и музыка", () => {
  it("проходит modifier → perform → vote → result, синхронизирует ремикс и сохраняет очки/возвраты", () => {
    let s = session();
    const content = specialContent();
    s = apply(s, startPick(s, teams));
    s = apply(s, pickCard(s, content, "special1", teams));
    const modifierAnswers = [ans("A", 0, { modifier: "hands" }), ans("B", 0, { modifier: "robot" }), ans("C", 0, { modifier: "robot" })];
    s = apply(s, startPerformance(s, content, modifierAnswers));
    let r = parseDanceResult(s.state.result);
    expect(r.mode).toBe("perform");
    expect(r.modifier).toBe("robot");
    expect(s.state.timeLimit).toBe(24);
    expect(remixDuration(content.cards[0]!)).toBe(24);

    // Открытие экрана на 5-й секунде — первый фрагмент со смещением; на 9-й — второй с начала+1.
    const started = s.state.startedAt ?? 0;
    expect(performanceElapsed(s, content, started + 5000)).toBe(5);
    expect(remixAt(content.cards[0]!, 5)).toMatchObject({ index: 0, offset: 5 });
    expect(performanceElapsed(s, content, started + 9000)).toBe(9);
    expect(remixAt(content.cards[0]!, 9)).toMatchObject({ index: 1, offset: 1 });
    expect(remixAt(content.cards[0]!, 24)).toMatchObject({ index: 2, offset: 8 });
    expect(remixAt(content.cards[0]!, 999)).toMatchObject({ index: 2, offset: 8 });
    expect(remixAt(content.cards[0]!, Number.NaN)).toMatchObject({ index: 0, offset: 0 });

    // Пауза на 5-й секунде: время больше не идёт. Продолжение сохраняет накопленные 5 секунд.
    s = apply(s, control(s, { paused: true }, content, started + 5000));
    r = parseDanceResult(s.state.result);
    expect(r.paused).toBe(true);
    expect(r.elapsed).toBe(5);
    expect(performanceElapsed(s, content, started + 20000)).toBe(5);
    s = apply(s, control(s, { paused: false }, content, started + 20000));
    expect(s.state.timeLimit).toBe(19);
    expect(performanceElapsed(s, content, (s.state.startedAt ?? 0) + 5000)).toBe(10);

    // «Сначала» сбрасывает и время, и участок.
    s = apply(s, control(s, { replay: true }, content, 30000));
    r = parseDanceResult(s.state.result);
    expect(r.elapsed).toBe(0);
    expect(r.paused).toBe(false);
    expect(performanceElapsed(s, content, s.state.startedAt ?? 0)).toBe(0);
    expect(remixAt(content.cards[0]!, 0)).toMatchObject({ index: 0, offset: 0 });

    // Возврат из финального голосования перезапускает выступление и очищает его шаг.
    s = apply(s, startVote(s, content));
    expect(s.state.step).toBe(1);
    const back = danceBack(s, content)!;
    expect(back.clear).toEqual([1]);
    s = apply(s, back.change);
    expect(parseDanceResult(s.state.result).mode).toBe("perform");
    expect(s.state.timeLimit).toBe(24);
    s = apply(s, startVote(s, content));

    // B получает два голоса из трёх и 100 очков; голос за свою команду отфильтрован.
    s = apply(s, showResult(s, content, [ans("A", 1, { team: "B" }), ans("B", 1, { team: "B" }), ans("C", 1, { team: "B" })]));
    expect(s.leaderboard.B?.score).toBe(100);
    expect(parseDanceResult(s.state.result).tie).toEqual([]);
    s = apply(s, nextTurn(s, teams));
    s = apply(s, danceBack(s, content)?.change ?? {});
    expect(parseDanceResult(s.state.result).modifier).toBe("robot");
    s = apply(s, danceBack(s, content)?.change ?? {});
    expect(s.leaderboard.B?.score).toBe(0);
  });

  it("без голосов запускает «Только руки», а возврат из modifier возвращает выбор карточки", () => {
    let s = session();
    const content = specialContent();
    s = apply(s, startPick(s, teams));
    s = apply(s, pickCard(s, content, "special1", teams));
    const back = danceBack(s, content)!;
    expect(back.clear).toEqual([0]);
    s = apply(s, back.change);
    expect(parseDanceResult(s.state.result).mode).toBe("pick");
    s = apply(s, pickCard(s, content, "special1", teams));
    s = apply(s, startPerformance(s, content, []));
    expect(parseDanceResult(s.state.result).modifier).toBe("hands");
  });
});


describe("«Танцуй иначе»: автопредпросмотр", () => {
  it("доходит от выбора усложнения до награждения без застревания", () => {
    const result = runPreview({ mechanic: "dance", content: specialContent(), playMode: "teams", themeId: "joyrest", driver: dancePreview, teams: 3, limit: 30 });
    expect(result.scenes.some((scene) => scene.label.includes("усложнение"))).toBe(true);
    expect(result.scenes.some((scene) => scene.label.includes("специальный батл"))).toBe(true);
    expect(result.scenes.at(-1)?.session.state.phase).toBe("finished");
    expect(result.scenes.at(-1)?.session.state.stage).not.toBe("modifier");
  });
});
