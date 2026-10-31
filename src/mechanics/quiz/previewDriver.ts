import type { PreviewDriver } from "../preview";
import { scoringIds } from "../preview";
import { parseBuzz } from "../../core/buzz";
import { correctSet, drawEffectOfSettings, settingsOf, usesAnswers, type QuizContent, type QuizQuestion } from "./content";
import { closeBets, isAuctionDraw } from "./auction";
import { parseResult } from "./logic";
import { parseSuperAnswer, parseVoteAnswer } from "../../core/supergame";
import { actionLabel, buzzRightAnswer, closeSuperVote, coinSuperVote, openSuperVote, skipSuper, superVoteSync, buzzSync, buzzWrongAnswer, extraAction, nextQuestion, primaryAction, reveal, showBoard, showQuestion, showTotal, superSync } from "./flow";

/** Ответ телефона на вопрос — как его шлёт телефон гостя; `right` — верный или нет. */
function answerFor(q: QuizQuestion, right: boolean, i: number): unknown {
  if (q.kind === "open" || (q.kind === "auction" && usesAnswers(q))) return right ? (q.answers[i % Math.max(1, q.answers.length)] ?? "") : "не помню";
  if (q.kind === "pictures") return (q.pictures ?? []).map((p, k) => (right || k === 0 ? (p.answers[0] ?? "") : "не знаю"));
  if (q.kind === "super") {
    // Уровни разные: кто посмелее — дороже.
    const levels = q.levels ?? [];
    const level = Math.min(Math.max(0, levels.length - 1), i);
    const l = levels[level];
    const kind = l?.kind ?? "open";
    if (kind === "choice") {
      const good = l?.correct?.[0] ?? 0;
      return { level, text: "", choice: right ? good : (l?.options ?? []).findIndex((_, k) => !(l?.correct ?? []).includes(k)) };
    }
    if (kind === "order") {
      const order = (l?.options ?? []).map((_, k) => k);
      if (!right && order.length > 1) [order[0], order[1]] = [order[1] as number, order[0] as number];
      return { level, text: "", order };
    }
    if (kind === "number") return { level, text: "", guess: right ? (l?.number ?? 0) : (l?.number ?? 0) + 1000 };
    return { level, text: right ? (l?.answers[0] ?? "") : "не знаю" };
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

export const quizPreview: PreviewDriver<QuizContent> = ({ session, content, participants, answers: allAnswers }) => {
  let answers = allAnswers;
  const teams = scoringIds(participants);
  const { step } = session.state;
  const q = content.questions[step];
  const action = primaryAction(session, content);
  const who = session.playMode === "teams" ? "Капитаны" : "Игроки";
  switch (action) {
    case "vote":
      return { label: "Пульт: «Голосование: играем суперигру?»", change: openSuperVote(session, content) };
    case "voteDone": {
      // Большинство за — видно, как играют суперигру.
      if (!answers.some((a) => parseVoteAnswer(a.value))) return { label: "Гости голосуют: играем суперигру?", answers: teams.map((pid, i) => ({ pid, value: { vote: i === teams.length - 1 && teams.length > 2 ? "no" : "yes" } })) };
      const sync = superVoteSync(session, answers);
      if (sync) return { label: "На экране: сколько за и против", change: sync };
      return { label: "Пульт: «Подвести итог голосования»", change: closeSuperVote(session, answers) };
    }
    case "skip":
      return { label: "Пульт: «Пропустить суперигру»", change: skipSuper(session) };
    case "coin": {
      const change = coinSuperVote(session, session.state.startedAt ?? 0, () => 0.1);
      return change ? { label: "Голоса поровну — пульт: «Бросить монетку»", change } : null;
    }
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
      if (q.kind === "auction") {
        if (isAuctionDraw(session)) return { label: "Жребий выбрал, кто отвечает", change: { state: { slide: null } } };
        const auction = parseResult(session.state.result).auction;
        if (!auction || auction.phase === "bets") {
          // Двое ставят одинаково больше всех — видно жребий.
          if (answers.length === 0) return { label: `${who} делают ставки`, answers: teams.map((pid, i) => ({ pid, value: { bet: i < 2 ? q.points : Math.max(1, Math.round(q.points / 2)) } })) };
          const name = (pid: string) => session.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? "Игрок";
          const change = closeBets(session, q, answers, { id: `aucprev${step}`, now: session.state.startedAt ?? 0, name, effect: drawEffectOfSettings(content), pick: (pool) => pool[pool.length - 1] ?? null });
          return change ? { label: "Пульт: «Ставки сделаны»", change } : null;
        }
        if (answers.length === 0) {
          const pids = auction.phase === "answer" && auction.who ? [auction.who] : teams;
          return { label: auction.phase === "answer" ? "Отвечает выигравший ставку" : `${who} отвечают`, answers: pids.map((pid, i) => ({ pid, value: answerFor(q, i === 0, i) })) };
        }
        return { label: "Пульт: «Показать ответ»", change: reveal(session, content, answers, participants) };
      }
      // Голоса за суперигру — не ответы уровней.
      if (q.kind === "super") answers = answers.filter((a) => parseSuperAnswer(a.value) !== null);
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
