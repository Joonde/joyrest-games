// Предпросмотр «100 к 1»: те же функции пульта, что в игре. Классика — розыгрыш с кнопкой, ход команды,
// три крестика и шанс соперника, «Большая игра» с повтором ответа; «Весь зал» — ответы телефонов, засчитанная
// опечатка и табло по одному ответу.
import { scoringIds, type PreviewDriver } from "../preview";
import { ranked, type HundredContent } from "./content";
import {
  armFace,
  bigEnter,
  bigFinish,
  bigSecond,
  bigStart,
  choosePlaying,
  hallAccept,
  hallClose,
  hallOpen,
  hallOpenNext,
  hundredBuzzSync,
  hundredPrimary,
  missAnswer,
  nextQuestion,
  openAnswer,
  parseHundredResult,
  questionOf,
  roundOf,
  showRest,
  startFace,
} from "./logic";
import { unmatchedWords } from "./match";

export const hundredPreview: PreviewDriver<HundredContent> = ({ session, content, participants, answers }) => {
  const r = parseHundredResult(session.state.result);
  const question = questionOf(content, r);
  const round = roundOf(content, r);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? "команда") : "никто");
  const list = question ? ranked(question) : [];
  const next = list.find((a) => !r.opened.includes(a.id) && !r.shown.includes(a.id));
  switch (hundredPrimary(session, content)) {
    case "start":
      return { label: "Пульт: «Показать вопрос» — розыгрыш", change: startFace(session, content, participants) };
    case "arm":
      return { label: "Ведущий прочитал вопрос: «Запустить отсчёт»", change: armFace(session, content, participants) };
    case "face": {
      if (answers.length === 0 && r.buzz.order.length === 0) return { label: "Капитаны жмут «Жми первым!»", answers: [...r.pair].reverse().map((pid) => ({ pid, value: { buzz: true } })) };
      const sync = hundredBuzzSync(session, answers);
      if (sync) return { label: "Первым нажал тот, кто быстрее по часам сервера", change: sync };
      if (r.opened.length === 0 && next) return { label: `${name(r.buzz.current)} называет «${next.text}» — ведущий касается строки`, change: openAnswer(session, content, participants, next.id) };
      const who = r.buzz.current ?? r.pair[0] ?? null;
      return who ? { label: `Пульт: «Играют ${name(who)}»`, change: choosePlaying(session, participants, who) } : null;
    }
    case "play":
      if (r.opened.length < 3 && next) return { label: `Ответ на табло: «${next.text}» — очки в банк`, change: openAnswer(session, content, participants, next.id) };
      return { label: "Пульт: «✕ Нет на табло»", change: missAnswer(session, content, participants) };
    case "steal":
      return next ? { label: `Шанс соперника: «${next.text}» — банк уходит ему`, change: openAnswer(session, content, participants, next.id) } : { label: "Шанс не использован", change: missAnswer(session, content, participants) };
    case "rest":
      return { label: "Пульт: «Открыть остальные ответы» — без очков", change: showRest(session, content, participants) };
    case "next":
      return { label: content.mode === "hall" ? "Пульт: «Следующий вопрос»" : "Пульт: «Следующий раунд»", change: nextQuestion(session, content, participants) };
    case "bigStart":
      return { label: r.big.player === 0 ? "Большая игра: «Запустить таймер» первому игроку" : "Второй игрок: «Запустить таймер»", change: bigStart(session, content, participants) };
    case "bigEnter": {
      if (!round) return null;
      const cells = r.big.cells[r.big.player];
      const q = round.questions.findIndex((_, i) => !cells[i]);
      const target = round.questions[q];
      if (!target) return null;
      const options = ranked(target);
      // Второй игрок сначала повторяет ответ первого — «Повтор, другой ответ!».
      const pick = r.big.player === 1 ? (q === 0 && r.big.repeat === null ? options[0] : options[1]) : options[0];
      return { label: r.big.player === 1 && pick === options[0] ? "Повтор ответа первого игрока — не принимается" : `Ведущий отмечает ответ: «${pick?.text ?? "нет на табло"}»`, change: bigEnter(session, content, participants, q, pick?.id ?? null) };
    }
    case "bigSecond":
      return { label: "Пульт: «Второй игрок»", change: bigSecond(session, participants) };
    case "bigFinish":
      return { label: "Пульт: «Подвести итог Большой игры»", change: bigFinish(session, content, participants) };
    case "hallOpen":
      return { label: "Весь зал: «Открыть вопрос» — ответы на телефонах", change: hallOpen(session, content, participants) };
    case "hallClose": {
      if (answers.length === 0 && question) {
        const words = list.map((a) => a.text);
        // Одна опечатка, один синоним и одна выдумка — как в жизни.
        return {
          label: "Телефоны прислали до трёх ответов",
          answers: scoringIds(participants).map((pid, i) => ({ pid, value: { words: [words[i % words.length] ?? "", i === 0 ? "что-то своё" : (list[i + 1]?.synonyms[0] ?? ""), words[(i + 2) % words.length] ?? ""].filter(Boolean) } })),
        };
      }
      return { label: "Пульт: «Закрыть ответы»", change: hallClose(session, participants) };
    }
    case "hallRows": {
      const odd = question ? unmatchedWords(question, answers, r.accepted)[0] : undefined;
      if (odd && Object.keys(r.accepted).length === 0) return { label: `Ведущий решает: «${odd.label}» — не засчитывать`, change: hallAccept(session, content, participants, answers, odd.key, "") };
      return { label: "Пульт: «Открыть следующий ответ» — угадавшие получают очки", change: hallOpenNext(session, content, participants, answers) };
    }
    default:
      return null;
  }
};
