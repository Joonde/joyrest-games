import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import type { BoardContent } from "./content";
import { boardBuzzSync, boardPrimary, boardReveal, boardWrong, openCell, parseBoardResult, startCatQuestion, toBoard } from "./logic";

export const boardPreview: PreviewDriver<BoardContent> = ({ session, content, participants, answers }) => {
  const teams = scoringIds(participants);
  const r = parseBoardResult(session.state.result);
  const cells = content.categories.flatMap((c) => c.cells.map((cell) => ({ cat: c, cell })));
  switch (boardPrimary(session, content)) {
    case "pick": {
      const left = cells.filter(({ cell }) => !r.opened.includes(cell.id));
      // Второй ход — «Кот в мешке», если он есть: так видно ставки.
      const cat = r.opened.length === 1 ? left.find(({ cell }) => cell.kind === "cat") : undefined;
      const next = cat ?? left.find(({ cell }) => cell.kind !== "cat") ?? left.at(0);
      if (!next) return null;
      return { label: `Ведущий открывает клетку «${next.cat.title} · ${next.cell.points}»`, change: openCell(session, content, next.cell.id) };
    }
    case "toBuzz":
      if (answers.length === 0) return { label: "Кот в мешке: команды делают ставки", answers: teams.map((pid, i) => ({ pid, value: { bet: 100 + i * 50 } })) };
      return { label: "Пульт: «Ставки сделаны»", change: startCatQuestion(session, content, answers) };
    case "reveal": {
      if (answers.length === 0) return { label: "Команды жмут кнопку «Кто первый»", answers: [...teams].reverse().map((pid) => ({ pid, value: { buzz: true } })) };
      const sync = boardBuzzSync(session, answers);
      if (sync) return { label: "Первым ответ даёт тот, кто нажал раньше", change: sync };
      if (r.opened.length === 2 && r.buzz.current && Object.keys(r.fines).length === 0 && r.buzz.order.indexOf(r.buzz.current) === 0) {
        return { label: "Пульт: «Неверно» — слово следующему", change: boardWrong(session, content) };
      }
      return { label: r.buzz.current ? "Пульт: «Верно»" : "Пульт: «Никто не ответил верно»", change: boardReveal(session, content, participants, r.buzz.current !== null) };
    }
    case "toBoard":
      return { label: "Пульт: «К полю»", change: toBoard(session) };
    default:
      return null;
  }
};
