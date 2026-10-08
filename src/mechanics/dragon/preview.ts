import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import type { DragonContent } from "./content";
import { closeHeroes, dragonPrimary, nextBattle, nextTask, parseDragonResult, revealTask, showTask, startDragon, taskOf, toggleMark } from "./logic";

const PICKS = [
  { hero: "knight", stats: { str: 2, mind: 1, agi: 0, luck: 1, cha: 1 } },
  { hero: "sorceress", stats: { str: 0, mind: 3, agi: 1, luck: 1, cha: 0 } },
  { hero: "bard", stats: { str: 1, mind: 0, agi: 1, luck: 0, cha: 3 } },
];

export const dragonPreview: PreviewDriver<DragonContent> = ({ session, content, participants, answers }) => {
  const teams = scoringIds(participants);
  const r = parseDragonResult(session.state.result);
  switch (dragonPrimary(session, content)) {
    case "start":
      return { label: "Пульт: «Выбор героев»", change: startDragon(session, participants) };
    case "heroesDone":
      if (answers.length === 0) return { label: "Капитаны выбрали героев и свойства", answers: teams.map((pid, i) => ({ pid, value: PICKS.at(i % PICKS.length) })) };
      return { label: "Пульт: «Герои выбраны — в бой!»", change: closeHeroes(session, content, answers, participants) };
    case "show":
      return { label: "Пульт: «Показать задание»", change: showTask(session, content, participants) };
    case "reveal": {
      const task = taskOf(content, r);
      const alive = teams.filter((p) => !r.dead.includes(p));
      if (task?.kind === "choice" && answers.length === 0) {
        return { label: "Капитаны ответили", answers: alive.map((pid, i) => ({ pid, value: { choice: i % 3 === 1 ? (task.correct + 1) % 4 : task.correct } })) };
      }
      if (task?.kind === "dice" && answers.length === 0) return { label: "Капитаны бросили кубик", answers: alive.map((pid) => ({ pid, value: { roll: true } })) };
      if (task?.kind === "task") {
        const want = alive.filter((_, i) => i % 3 !== 1);
        const next = want.find((p) => !r.marks.includes(p));
        if (next) return { label: "Ведущий отмечает, кто выполнил задание", change: toggleMark(session, next) };
      }
      return { label: "Пульт: «Удар!»", change: revealTask(session, content, answers, participants) };
    }
    case "next":
      return { label: r.phase === "victory" || r.phase === "defeat" ? "Пульт: «Итог боя»" : "Пульт: «Следующее задание»", change: nextTask(session, content, participants) };
    case "nextBattle":
      return { label: "Пульт: «Следующий бой»", change: nextBattle(session, content, participants) };
    default:
      return null;
  }
};
