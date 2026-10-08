import type { PreviewDriver } from "../preview";
import type { MillionaireContent } from "./content";
import { applyLifeline, millionairePrimary, nextTurn, parseMillionaireResult, questionOf, retryQuestion, revealAnswer, showQuestion, startMillionaire } from "./logic";

export const millionairePreview: PreviewDriver<MillionaireContent> = ({ session, content, participants, answers, n }) => {
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
      const used = Object.values(r.used).flat();
      // Один раз показываем подсказку: «50 на 50» гасит два неверных варианта.
      if (answers.length === 0 && !used.includes("fifty") && n > 3) {
        return { label: "Подсказка «50 на 50»: два неверных варианта погасли", change: applyLifeline(session, content, answers, "fifty", session.state.startedAt ?? 0, () => 0.3) };
      }
      if (answers.length === 0) {
        const wrong = [0, 1, 2, 3].find((i) => i !== q.correct && !r.removed.includes(i)) ?? q.correct;
        // Каждый третий ход — ошибка, чтобы было видно, как команда падает до несгораемой.
        const choice = n % 3 === 2 ? wrong : q.correct;
        return { label: "Капитан выбрал ответ", answers: [{ pid: team, value: { choice } }] };
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
