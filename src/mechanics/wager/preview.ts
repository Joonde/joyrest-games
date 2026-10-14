import type { Answer } from "../../data/types";
import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import { winningSlot, type WagerContent } from "./content";
import { liveProgress, nextQuestion, openBets, parseWagerResult, revealAnswer, showQuestion, wagerPrimary, type Bet } from "./logic";

/** Догадка команды: годы — плюс-минус несколько лет, остальное — с разбросом от правды. */
function guessFor(answer: number, i: number, q: number): number {
  const k = (i + q) % 4;
  if (Number.isInteger(answer) && answer >= 1800 && answer <= 2100) return answer + ([-6, 3, -1, 12][k] ?? 0);
  const factor = [0.8, 1.15, 0.95, 1.4][k] ?? 1;
  const value = answer * factor;
  return Math.abs(value) >= 100 ? Math.round(value / 10) * 10 : Math.round(value);
}

export const wagerPreview: PreviewDriver<WagerContent> = ({ session, content, participants, answers }) => {
  const teams = scoringIds(participants);
  const r = parseWagerResult(session.state.result);
  const question = content.questions[r.q];
  const who = session.playMode === "teams" ? "Капитаны" : "Игроки";
  const score = (pid: string) => session.leaderboard[pid]?.score ?? 0;
  // Ответы телефонов и сразу живой счёт на экране — как пульт пишет его, когда приходят ответы.
  const withLive = (label: string, values: Array<{ pid: string; value: unknown }>) => {
    const at = session.state.startedAt ?? 0;
    const fresh: Answer[] = values.map(({ pid, value }, i) => ({ id: `${session.state.step}_${pid}`, step: session.state.step, pid, uid: pid, value, submittedAt: at + 1500 + i * 700 }));
    return { label, answers: values, change: liveProgress(session, content, fresh) };
  };
  switch (wagerPrimary(session, content)) {
    case "show":
      return { label: `Пульт: «Показать вопрос» ${r.q + 1}`, change: showQuestion(session, content, participants) };
    case "bets":
      if (answers.length === 0 && question) {
        return withLive(`${who} пишут догадки`, teams.map((pid, i) => ({ pid, value: { guess: guessFor(question.answer, i, r.q) } })));
      }
      return { label: "Пульт: «Разложить ответы и открыть ставки»", change: openBets(session, content, answers) };
    case "reveal": {
      if (answers.length === 0 && question) {
        const win = winningSlot(r.slots, question.answer);
        const last = r.slots.length - 1;
        const near = win + 1 <= last ? win + 1 : Math.max(-1, win - 1);
        // Кто-то ставит на точную догадку и добавляет свои очки, кто-то промахивается или ставит на «меньше всех».
        const plans: Bet[][] = [
          [{ slot: win, stake: Math.min(score(teams[0] ?? ""), 30) }, { slot: near, stake: 0 }],
          [{ slot: near, stake: Math.min(score(teams[1] ?? ""), 20) }],
          [{ slot: Math.floor(last / 2), stake: 0 }, { slot: -1, stake: 0 }],
          [{ slot: win, stake: 0 }],
        ];
        return withLive(
          `${who} ставят фишки`,
          teams.map((pid, i) => ({ pid, value: { bets: plans[(i + r.q) % plans.length] ?? [] } })),
        );
      }
      return { label: "Пульт: «Показать ответ»", change: revealAnswer(session, content, answers) };
    }
    case "next":
      return { label: "Пульт: «Следующий вопрос»", change: nextQuestion(session) };
    default:
      return null;
  }
};
