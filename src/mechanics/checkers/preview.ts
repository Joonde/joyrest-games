import type { PreviewDriver } from "../preview";
import type { CheckersContent } from "./content";
import { checkersPrimary, colorOfPid, currentQuestion, moveChange, nextTurn, parseCheckersResult, revealTask, startGame, toTask } from "./logic";
import { capturePoints, legalMoves } from "./rules";

export const checkersPreview: PreviewDriver<CheckersContent> = ({ session, content, participants, answers, n }) => {
  const r = parseCheckersResult(session.state.result);
  switch (checkersPrimary(session, content)) {
    case "start":
      return { label: "Пульт: «Начать партию» — первыми ходят белые", change: startGame(session, participants) };
    case "waitMove": {
      const color = colorOfPid(r, r.mover);
      if (!r.mover || !color) return null;
      // Тестовые команды берут шашку, если можно, — так видно задания.
      const moves = legalMoves(r.board, color);
      const move = moves.find((m) => capturePoints(r.board, m) > 0) ?? moves.at(n % Math.max(1, moves.length)) ?? moves.at(0);
      if (!move) return null;
      if (answers.length === 0) return { label: "Капитан сделал ход на телефоне", answers: [{ pid: r.mover, value: { path: move.path } }] };
      return { label: move.captured.length > 0 ? "Съели шашку!" : "Шашка на доске", change: moveChange(session, answers) };
    }
    case "task": {
      return { label: "Пульт: «Вопрос команде» — той, что потеряла шашку", change: toTask(session, content) };
    }
    case "taskReveal": {
      const q = currentQuestion(content, r);
      if (q && r.victim && answers.length === 0) {
        const right = q.kind === "choice" ? q.correct : (q.answers[0] ?? "");
        const wrong = q.kind === "choice" ? (q.correct + 1) % Math.max(2, q.options.length) : "—";
        return { label: "Капитан ответил", answers: [{ pid: r.victim, value: n % 3 === 0 ? wrong : right }] };
      }
      return { label: "Пульт: «Показать ответ»", change: revealTask(session, content, answers) };
    }
    case "turn":
      return { label: "Пульт: «Ход» — очередь соперника", change: nextTurn(session) };
    default:
      return null;
  }
};
