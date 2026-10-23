// Проверка жребия на экране зала (scripts/robot/draw-check.mjs): настоящий SlideView на кадре 16:9, эффект, число имён,
// тема и момент вращения — из адреса. Часы страницы замораживает Playwright, поэтому кадр детерминирован.
// `?quiz=<сцена>` — «Аукцион» квиза: настоящие экран зала и телефон на этапах ставок, жребия, ответа и итога (сессия
// собирается теми же функциями, что у пульта).
import { createRoot } from "react-dom/client";
import { SlideView } from "../../src/components/live/SlideView";
import { drawSlide, parseDrawEffect } from "../../src/core/draw";
import { applyChange, startState } from "../../src/core/session";
import type { Answer, Session } from "../../src/data/types";
import { auctionSync, closeBets } from "../../src/mechanics/quiz/auction";
import { DEFAULT_SETTINGS, newQuestion, type QuizContent } from "../../src/mechanics/quiz/content";
import { reveal, showQuestion } from "../../src/mechanics/quiz/flow";
import { QuizPlayerView, QuizScreenView } from "../../src/mechanics/quiz/views";
import { applyTheme, getTheme } from "../../src/themes/registry";
import "../../src/fonts.css";
import "../../src/styles.css";

const q = new URLSearchParams(location.search);
applyTheme(getTheme(q.get("theme") ?? "joyrest"));
const root = createRoot(document.getElementById("root") as HTMLElement);
const quiz = q.get("quiz");

if (quiz) {
  root.render(<QuizScene scene={quiz} open={q.get("open") === "1"} />);
} else {
  const n = Math.max(1, Number(q.get("n") ?? "3"));
  const names = Array.from({ length: n }, (_, i) => (q.get("long") === "1" && i % 2 === 0 ? `🦊 Команда очень длинное название ${i + 1}` : `🎉 Игрок ${i + 1}`));
  const winner = names[Number(q.get("win") ?? "0") % n] as string;
  const ends = Date.now() + Number(q.get("left") ?? "0");
  const slide = drawSlide("auccheck", names, winner, ends - 5200, {
    spinEyebrow: "Аукцион · ставки равны",
    spinText: `Одинаковая ставка у ${n}: по 300 — жребий решит, кто отвечает`,
    doneEyebrow: "Аукцион разыгрывает",
    doneText: "Ставка 300 · отвечает на вопрос",
  }, parseDrawEffect(q.get("effect")));
  (window as unknown as { drawWinner: string }).drawWinner = winner;
  root.render(
    <div className="quiz-stage" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <SlideView slide={slide} />
    </div>,
  );
}

/**
 * Сцены «Аукциона»: splash, bets, draw-spin, draw-done, answer, reveal-right, reveal-wrong, all — экран зала;
 * phone-ready, phone-bets, phone-bet-sent, phone-spin, phone-win, phone-watch, phone-reveal-me, phone-reveal-other — телефон.
 * `open` — вопрос с открытым ответом.
 */
function QuizScene({ scene, open }: { scene: string; open: boolean }) {
  const question = {
    ...newQuestion("auction"),
    id: "qauc",
    text: open ? "Кто спел «Yesterday»?" : "В каком году вышел фильм «Титаник» Джеймса Кэмерона?",
    topic: open ? "Музыка 60-х" : "Кино 90-х",
    auctionAnswer: open ? ("open" as const) : ("choice" as const),
    options: open ? [] : ["1997", "1999", "2001"],
    answers: open ? ["Beatles", "Битлз"] : [],
    correct: open ? -1 : 0,
    points: 200,
    timeLimit: 30,
    betTime: 30,
  };
  const content: QuizContent = { questions: [question], settings: { ...DEFAULT_SETTINGS, drawEffect: "wheel" } };
  const T = Date.now();
  const names: Record<string, string> = { a: "🦊 Команда «Бриллиантовые лисы»", b: "🐼 Панды", c: "🎸 Рок-н-ролл", d: "🌟 Звёзды" };
  let s: Session = {
    id: "s",
    code: "123456",
    hostId: "h",
    gameId: "g",
    gameTitle: "Квиз",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId: "joyrest",
    playMode: "solo",
    screenMode: "laptop",
    state: { ...startState(), phase: "playing" },
    leaderboard: Object.fromEntries(Object.entries(names).map(([pid, name], i) => [pid, { name, kind: "player" as const, score: [300, 300, 120, 0][i] ?? 0 }])),
    createdAt: 0,
  };
  const ans = (pid: string, value: unknown, at: number): Answer => ({ id: `0_${pid}`, step: 0, pid, uid: pid, value, submittedAt: at });
  const bets = [ans("a", { bet: 300 }, T - 40_000), ans("b", { bet: 300 }, T - 39_000), ans("c", { bet: 100 }, T - 38_000)];
  if (scene !== "splash" && scene !== "phone-ready") {
    s = applyChange(s, showQuestion(s, content), T - 45_000);
    if (scene === "bets" || scene.startsWith("phone-bet")) {
      s = applyChange(s, auctionSync(s, question, bets) ?? {}, T - 1000);
    } else {
      const tie = scene !== "all";
      const drawAt = scene === "draw-spin" || scene === "phone-spin" ? T - 2000 : T - 30_000;
      const change = closeBets(s, question, tie ? bets : [], { id: "aucq", now: drawAt, name: (pid) => names[pid] ?? pid, effect: "wheel", pick: (pool) => pool[0] ?? null });
      s = applyChange(s, change ?? {}, drawAt);
      if (!scene.startsWith("draw") && scene !== "phone-spin") s = { ...s, state: { ...s.state, slide: null } };
      if (scene.startsWith("reveal") || scene.startsWith("phone-reveal")) {
        const right = scene !== "reveal-wrong";
        const answer = open ? (right ? "битлз" : "Роллинги") : right ? 0 : 1;
        s = applyChange(s, reveal(s, content, [ans("a", answer, drawAt + 5000)], []), T - 1000);
      }
    }
  }
  if (scene.startsWith("phone")) {
    const pid = scene === "phone-win" || scene === "phone-reveal-me" ? "a" : "c";
    const mine = scene === "phone-bet-sent" ? { value: { bet: 100 } } : scene === "phone-reveal-me" ? { value: open ? "битлз" : 0 } : null;
    return (
      <main className="page page--play">
        <div className="card">
          <QuizPlayerView
            session={s}
            content={content}
            participant={{ id: pid, name: names[pid] ?? pid, kind: "player", teamId: null, captainUid: pid, joinedAt: 0 } as never}
            pid={pid}
            role="player"
            myAnswer={mine}
            sending={false}
            onAnswer={() => undefined}
          />
        </div>
      </main>
    );
  }
  return (
    <div className="quiz-stage" style={{ position: "relative", background: "var(--color-bg)", color: "var(--color-text)" }}>
      <QuizScreenView session={s} content={content} />
      {s.state.slide && (
        <div style={{ position: "absolute", inset: 0, background: "var(--color-bg)" }}>
          <SlideView slide={s.state.slide} />
        </div>
      )}
    </div>
  );
}
