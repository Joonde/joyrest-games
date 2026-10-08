import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import { acceptedAnswers, type SurvivalContent } from "./content";
import { afterAuction, closeBets, finishAuction, minBet, nextRound, openAuction, openBets, parseSurvivalResult, revealRound, roundOf, showRound, startSurvival, survivalPrimary, toggleMark } from "./logic";

export const survivalPreview: PreviewDriver<SurvivalContent> = ({ session, content, participants, answers }) => {
  const teams = scoringIds(participants);
  const r = parseSurvivalResult(session.state.result);
  const score = (p: string) => session.leaderboard[p]?.score ?? 0;
  switch (survivalPrimary(session, content)) {
    case "start":
      return { label: "Пульт: «Начать гонку»", change: startSurvival(session, participants) };
    case "auction":
      return { label: "Пульт: «Открыть аукцион билета»", change: openAuction(session, content) };
    case "auctionDone":
      if (answers.length === 0) return { label: "Капитаны предлагают цену за билет", answers: teams.map((pid, i) => ({ pid, value: { bid: Math.max(10, Math.floor(score(pid) / (i + 3))) } })) };
      return { label: "Пульт: «Итоги аукциона»", change: finishAuction(session, answers, participants) };
    case "afterAuction":
      return { label: "Пульт: «К раунду»", change: afterAuction(session) };
    case "bets":
      return { label: "Войнушка! Пульт: «Открыть ставки»", change: openBets(session, content) };
    case "betsDone":
      if (answers.length === 0) {
        return {
          label: "Капитаны сделали ставки",
          answers: teams.map((pid, i) => ((r.tickets[pid] ?? 0) > 0 ? { pid, value: { ticket: true } } : { pid, value: { bet: Math.min(score(pid), minBet(score(pid)) + i * 20) } })),
        };
      }
      return { label: "Пульт: «Ставки приняты — вопрос»", change: closeBets(session, content, answers, participants) };
    case "show":
      return { label: "Пульт: «Показать вопрос / задание»", change: showRound(session, content, participants) };
    case "reveal": {
      const round = roundOf(content, r);
      if (!round) return null;
      const playing = teams.filter((p) => r.phase !== "war" || !r.freed.includes(p));
      if (round.kind === "task" && r.phase === "play") {
        const next = playing.filter((_, i) => i !== 1).find((p) => !r.marks.includes(p));
        if (next) return { label: "Ведущий отмечает, кто выполнил задание", change: toggleMark(session, next) };
      } else if (answers.length === 0) {
        const right = round.kind === "open" ? (acceptedAnswers(round)[0] ?? "") : round.correct;
        const wrong = round.kind === "open" ? "не знаю" : (round.correct + 1) % Math.max(2, round.options.filter(Boolean).length);
        return {
          label: "Капитаны ответили",
          answers: playing.map((pid, i) => ({ pid, value: round.kind === "open" ? { text: i === 1 ? wrong : right } : { choice: i === 1 ? wrong : right } })),
        };
      }
      return { label: r.phase === "war" ? "Пульт: «Показать ответ и банк»" : "Пульт: «Показать ответ»", change: revealRound(session, content, answers, participants) };
    }
    case "next":
      return { label: "Пульт: «Следующий раунд»", change: nextRound(session, content, participants) };
    default:
      return null;
  }
};
