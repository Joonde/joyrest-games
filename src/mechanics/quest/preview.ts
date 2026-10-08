import type { PreviewDriver } from "../preview";
import type { QuestContent } from "./content";
import { judge, nextTurn, parseQuestResult, questPrimary, rollChange, startQuest } from "./logic";

export const questPreview: PreviewDriver<QuestContent> = ({ session, content, participants, answers, n }) => {
  const r = parseQuestResult(session.state.result);
  switch (questPrimary(session)) {
    case "start":
      return { label: "Пульт: «Начать игру»", change: startQuest(session, participants) };
    case "waitRoll":
      if (!r.mover) return null;
      if (answers.length === 0) return { label: "Капитан: «Бросить кубик»", answers: [{ pid: r.mover, value: { roll: true } }] };
      return { label: "Фишка идёт — на экране клетка", change: rollChange(session, content, answers, participants) };
    case "judge":
      return n % 4 === 3 ? { label: "Пульт: «Не выполнено»", change: judge(session, content, false) } : { label: "Пульт: «Выполнено»", change: judge(session, content, true) };
    case "next":
      return { label: "Пульт: «Следующая команда»", change: nextTurn(session, participants) };
    default:
      return null;
  }
};
