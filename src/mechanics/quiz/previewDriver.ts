import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import { parseBuzz } from "../../core/buzz";
import { correctSet, settingsOf, type QuizContent, type QuizQuestion } from "./content";
import { actionLabel, buzzRightAnswer, buzzSync, buzzWrongAnswer, extraAction, nextQuestion, primaryAction, reveal, showBoard, showQuestion, showTotal, superSync } from "./flow";

/** Ответ телефона на вопрос — как его шлёт телефон гостя; `right` — верный или нет. */
function answerFor(q: QuizQuestion, right: boolean, i: number): unknown {
  if (q.kind === "open") return right ? (q.answers[i % Math.max(1, q.answers.length)] ?? "") : "не помню";
  if (q.kind === "pictures") return (q.pictures ?? []).map((p, k) => (right || k === 0 ? (p.answers[0] ?? "") : "не знаю"));
  if (q.kind === "super") {
    // Уровни разные: кто посмелее — дороже.
    const levels = q.levels ?? [];
    const level = Math.min(Math.max(0, levels.length - 1), i);
    return { level, text: right ? (levels[level]?.answers[0] ?? "") : "не знаю" };
  }
  if (q.kind === "order") {
    // Верный порядок — или с двумя переставленными карточками.
    const order = q.options.map((_, k) => k);
    if (!right && order.length > 1) [order[0], order[1]] = [order[1] as number, order[0] as number];
    return { order };
  }
  if (q.kind === "number") {
    const target = q.number ?? 100;
    const spread = Math.max(1, Math.round(Math.abs(target) * 0.05));
    return { guess: right ? target : target + spread * (i + 1) * (i % 2 === 0 ? 1 : -1) };
  }
  const set = correctSet(q);
  const good = set[0] ?? 0;
  const bad = q.options.findIndex((_, k) => !set.includes(k));
  return right || bad < 0 ? good : bad;
}

export const quizPreview: PreviewDriver<QuizContent> = ({ session, content, participants, answers }) => {
  const teams = scoringIds(participants);
  const { step } = session.state;
  const q = content.questions[step];
  const action = primaryAction(session, content);
  const who = session.playMode === "teams" ? "Капитаны" : "Игроки";
  switch (action) {
    case "show":
      return { label: `Пульт: «${actionLabel(session, content, action)}»`, change: showQuestion(session, content) };
    case "reveal": {
      if (!q) return null;
      if (q.kind === "buzz") {
        if (answers.length === 0) return { label: `${session.playMode === "teams" ? "Команды" : "Игроки"} жмут кнопку «Кто первый»`, answers: [...teams].reverse().map((pid) => ({ pid, value: { buzz: true } })) };
        const sync = buzzSync(session, answers);
        if (sync) return { label: "Слово — тому, кто нажал первым", change: sync };
        const buzz = parseBuzz((session.state.result as { buzz?: unknown } | null)?.buzz);
        // Первый нажавший ошибается — видно, как слово уходит следующему.
        if (buzz.current && buzz.out.length === 0 && buzz.order.length > 1) return { label: "Пульт: «Неверно» — слово следующему", change: buzzWrongAnswer(session) };
        return { label: buzz.current ? "Пульт: «Верно»" : "Пульт: «Показать ответ»", change: buzz.current ? buzzRightAnswer(session, content, answers, participants) : reveal(session, content, answers, participants) };
      }
      if (answers.length === 0) {
        // Верно отвечают не все: у каждого вопроса ошибается кто-то свой.
        const wrong = step % Math.max(1, teams.length);
        return {
          label: q.kind === "super" ? `${who} выбирают уровень и пишут ответ` : `${who} отвечают`,
          answers: teams.map((pid, i) => ({ pid, value: answerFor(q, i !== wrong, i) })),
        };
      }
      const picks = superSync(session, content, answers);
      if (picks) return { label: "На экране: кто какой уровень выбрал", change: picks };
      return { label: `Пульт: «${actionLabel(session, content, action)}»`, change: reveal(session, content, answers, participants) };
    }
    case "board":
      return { label: `Пульт: «${actionLabel(session, content, action)}»`, change: showBoard(session, content) };
    case "total":
      return { label: "Пульт: «Общий счёт»", change: showTotal(session) };
    case "next": {
      // Таблица только по кнопке — ведущий показывает её разок в середине игры.
      if (extraAction(session, content) === "board" && settingsOf(content).board === "manual" && step === Math.floor((content.questions.length - 1) / 2)) {
        return { label: "Пульт: «Таблица» (по кнопке)", change: showBoard(session, content) };
      }
      return { label: `Пульт: «${actionLabel(session, content, action)}»`, change: nextQuestion(session, content) };
    }
    default:
      return null;
  }
};
