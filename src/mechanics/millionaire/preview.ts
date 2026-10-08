import type { PreviewDriver } from "../preview";
import type { MillionaireContent } from "./content";
import { applyLifeline, millionairePrimary, nextTurn, parseMillionaireResult, questionOf, retryQuestion, revealAnswer, showQuestion, startMillionaire } from "./logic";

export const millionairePreview: PreviewDriver<MillionaireContent> = ({ session, content, participants, answers }) => {
  const r = parseMillionaireResult(session.state.result);
  switch (millionairePrimary(session)) {
    case "start":
      return { label: "Пульт: «Начать игру»", change: startMillionaire(session, participants, content) };
    case "show":
      return { label: "Пульт: «Показать вопрос»", change: showQuestion(session, content) };
    case "reveal": {
      const q = questionOf(content, r);
      const team = r.turn;
      if (!q || !team) return null;
      const used = r.used[team] ?? [];
      const index = r.order.indexOf(team);
      const level = r.levels[team] ?? 0;
      if (answers.length === 0) {
        // Подсказки на втором вопросе: первой команде — «50 на 50», второй — «Право на ошибку».
        if (index === 0 && level === 1 && !used.includes("fifty")) {
          return { label: "Подсказка «50 на 50»: два неверных варианта погасли", change: applyLifeline(session, content, answers, "fifty", session.state.startedAt ?? 0, () => 0.3) };
        }
        if (index === 1 && level === 1 && !used.includes("mistake")) {
          return { label: "Подсказка «Право на ошибку»", change: applyLifeline(session, content, answers, "mistake", session.state.startedAt ?? 0) };
        }
        const wrong = [0, 1, 2, 3].find((i) => i !== q.correct && !r.removed.includes(i)) ?? q.correct;
        // С «Правом на ошибку» сначала ошибаются — видно, как подсказка спасает.
        return { label: "Капитан выбрал ответ", answers: [{ pid: team, value: { choice: r.shield ? wrong : q.correct } }] };
      }
      return { label: "Пульт: «Показать ответ»", change: revealAnswer(session, content, answers, participants) };
    }
    case "retry":
      return { label: "Пульт: «Ответить ещё раз»", change: retryQuestion(session) };
    case "next":
      return { label: "Пульт: «Следующая команда»", change: nextTurn(session, content, participants) };
    default:
      return null;
  }
};
