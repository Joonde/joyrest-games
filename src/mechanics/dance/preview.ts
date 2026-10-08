import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import type { DanceContent } from "./content";
import { cardOf, dancePrimary, nextTurn, parseDanceResult, pickFromAnswers, resolveTie, showResult, startPick, startVote, turnPid } from "./logic";

export const dancePreview: PreviewDriver<DanceContent> = ({ session, content, participants, answers }) => {
  const teams = scoringIds(participants);
  const r = parseDanceResult(session.state.result);
  switch (dancePrimary(session, content)) {
    case "start":
      return { label: "Пульт: «Начать игру»", change: startPick(session, participants) };
    case "waitPick": {
      const who = turnPid(r);
      const card = content.cards.find((c) => !r.played.includes(c.id));
      if (!who || !card) return null;
      if (answers.length === 0) return { label: "Капитан выбирает карточку", answers: [{ pid: who, value: { card: card.id } }] };
      return { label: "Выступление: на экране видео или трек", change: pickFromAnswers(session, content, answers, participants) };
    }
    case "vote":
      return { label: "Пульт: «Оценивать выступление»", change: startVote(session, content) };
    case "result": {
      const card = cardOf(content, r.card);
      if (answers.length === 0 && card) {
        if (card.kind === "battle") {
          return { label: "Капитаны голосуют, кто победил", answers: teams.map((pid, i) => ({ pid, value: { team: i === 1 ? (teams.at(0) ?? pid) : (teams.at(1) ?? pid) } })) };
        }
        const span = content.maxRate - content.minRate;
        return {
          label: "Другие команды ставят оценки",
          answers: teams.filter((p) => p !== r.performer).map((pid, i) => ({ pid, value: { rate: Math.round(content.minRate + span * (0.6 + 0.15 * i)) } })),
        };
      }
      return { label: "Пульт: «Показать итог»", change: showResult(session, content, answers) };
    }
    case "resolveTie":
      return { label: "Ничья — ведущий называет победителя", change: resolveTie(session, content, r.tie.at(0) ?? "") };
    case "next":
      return { label: "Пульт: «Следующая команда»", change: nextTurn(session, participants) };
    default:
      return null;
  }
};
