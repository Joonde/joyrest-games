import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import type { BoardContent } from "./content";
import { armBuzz, boardBuzzSync, boardPrimary, boardReveal, boardWrong, nextRound, openCell, parseBoardResult, roundCells, setCat, startAuction, startCatQuestion, toBoard } from "./logic";

export const boardPreview: PreviewDriver<BoardContent> = ({ session, content, participants, answers }) => {
  const teams = scoringIds(participants);
  const r = parseBoardResult(session.state.result);
  const cells = roundCells(content, r.round).map(({ category, cell }) => ({ cat: category, cell }));
  switch (boardPrimary(session, content)) {
    case "pick": {
      const left = cells.filter(({ cell }) => !r.opened.includes(cell.id));
      // Второй ход — «Кот в мешке», если он есть: так видно ставки.
      const cat = r.opened.length === 1 ? left.find(({ cell }) => cell.kind === "cat") : undefined;
      const next = cat ?? left.find(({ cell }) => cell.kind !== "cat") ?? left.at(0);
      if (!next) return null;
      return { label: `Ведущий открывает клетку «${next.cat.title} · ${next.cell.points}»`, change: openCell(session, content, next.cell.id) };
    }
    case "toBuzz": {
      // «Кот в мешке»: ведущий отдаёт вопрос другой команде и ставит цену.
      if (!r.catTo) {
        const to = teams.find((pid) => pid !== r.pickerBefore) ?? teams[0] ?? null;
        return { label: "Кот в мешке: ведущий отдаёт вопрос другой команде", change: setCat(session, to, r.catPrice) };
      }
      const change = startCatQuestion(session, content);
      return change ? { label: "Пульт: «Показать вопрос» — отвечает только эта команда", change } : null;
    }
    case "arm": {
      const change = armBuzz(session, content);
      return change ? { label: "Ведущий прочитал вопрос: «Запустить отсчёт»", change } : null;
    }
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
    case "nextRound": {
      const change = nextRound(session, content);
      return change ? { label: "Пульт: «Следующий раунд» — поле дороже", change } : null;
    }
    case "auction": {
      if (answers.length === 0) return { label: "Аукцион: команды ставят очки", answers: teams.map((pid, i) => ({ pid, value: { bet: 100 + i * 50 } })) };
      const change = startAuction(session, content, answers);
      return change ? { label: "Пульт: «Ставки сделаны» — отвечает поставивший больше всех", change } : null;
    }
    default:
      return null;
  }
};
