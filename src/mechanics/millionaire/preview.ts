import type { PreviewDriver } from "../preview";
import type { MillionaireContent } from "./content";
import { syncChosen, lockAnswer, wrongChoice, applyLifeline, millionairePrimary, nextTurn, parseMillionaireResult, questionOf, retryQuestion, revealAnswer, showQuestion, startMillionaire } from "./logic";

export const millionairePreview: PreviewDriver<MillionaireContent> = ({ session, content, participants, answers }) => {
  const r = parseMillionaireResult(session.state.result);
  switch (millionairePrimary(session)) {
    case "start":
      return { label: "Пульт: «Начать игру»", change: startMillionaire(session, participants, content) };
    case "show":
      return { label: "Пульт: «Показать вопрос»", change: showQuestion(session, content) };
    case "lock": {
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
      if (r.chosen === null) return { label: "На экране — выбор команды (оранжевая рамка)", change: syncChosen(session, answers) };
      return { label: "«Фиксируем ответ?» — «Да, фиксируем»", change: lockAnswer(session, answers) };
    }
    case "reveal":
      return { label: "Пульт: «Показать ответ»", change: revealAnswer(session, content, answers, participants) };
    case "retry":
      return { label: "Пульт: «Ответить ещё раз»", change: retryQuestion(session, content) };
    case "next":
      return { label: session.playMode === "teams" ? "Пульт: «Следующая команда»" : "Пульт: «Следующий игрок»", change: nextTurn(session, content, participants) };
    case "wrongChoice":
      return { label: "Пульт: «Дальше, пропустив ход»", change: wrongChoice(session, content, participants, "skip") };
    default:
      return null;
  }
};
