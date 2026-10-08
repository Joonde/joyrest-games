import type { PreviewDriver } from "../preview";
import type { CheckersContent } from "./content";
import { checkersPrimary, colorOfPid, currentQuestion, endGame, moveChange, nextQuestion, parseCheckersResult, revealQuestion, showQuestion, toMove } from "./logic";
import { legalMoves } from "./rules";

export const checkersPreview: PreviewDriver<CheckersContent> = ({ session, content, participants, answers, n }) => {
  const r = parseCheckersResult(session.state.result);
  switch (checkersPrimary(session, content)) {
    case "show":
      return { label: "Пульт: «Показать вопрос»", change: showQuestion(session, content, participants) };
    case "reveal": {
      const q = currentQuestion(content, r);
      if (q && answers.length === 0 && r.white && r.black) {
        const right = q.kind === "choice" ? q.correct : (q.answers[0] ?? "");
        const wrong = q.kind === "choice" ? (q.correct + 1) % Math.max(2, q.options.length) : "—";
        // По очереди быстрее отвечают то белые, то чёрные.
        const first = n % 2 === 0 ? r.white : r.black;
        const second = first === r.white ? r.black : r.white;
        return { label: "Обе стороны ответили", answers: [{ pid: first, value: right }, { pid: second, value: n % 3 === 0 ? right : wrong }] };
      }
      return { label: "Пульт: «Показать ответ» — ход быстрому", change: revealQuestion(session, content, answers, participants) };
    }
    case "toMove":
      return { label: "Ход на доске: капитан выбирает шашку", change: toMove(session) };
    case "waitMove": {
      const color = colorOfPid(r, r.mover);
      if (!r.mover || !color) return null;
      const move = legalMoves(r.board, color).at(0);
      if (!move) return null;
      if (answers.length === 0) return { label: "Капитан сделал ход на телефоне", answers: [{ pid: r.mover, value: { path: move.path } }] };
      return { label: "Шашка на доске", change: moveChange(session, answers) };
    }
    case "next":
      return { label: "Пульт: «Следующий вопрос»", change: nextQuestion(session) };
    case "end":
      return { label: "Пульт: «Завершить партию»", change: endGame(session) };
    default:
      return null;
  }
};
