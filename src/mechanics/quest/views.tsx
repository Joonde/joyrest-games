// «Активная настолка»: поле змейкой на экране зала, фишки команд, кубик, задание клетки.
import { useEffect, useRef } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { useFragment } from "../../components/music/useFragment";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers } from "../../core/session";
import type { Session } from "../../data/types";
import { embedUrl } from "../dance/content";
import type { PlayerViewProps, ViewProps } from "../types";
import { QUEST_EMOJI, QUEST_TITLES, type QuestCell, type QuestContent } from "./content";
import { cellAt, parseQuestResult, type QuestResult } from "./logic";
import { QuestDie, QuestMap } from "./QuestMap";

export type QuestAnswerValue = { roll: true };

/** Поле — карта приключений (`QuestMap.tsx`). */
export const QuestBoard = QuestMap;

function TaskCard({ cell, result, session, showAnswer = false, showVideo = false }: { cell: QuestCell | null; result: QuestResult; session: Session; showAnswer?: boolean; showVideo?: boolean }) {
  if (!cell) return null;
  // Видео со звуком — только на экране зала (на телефонах гостей звука нет).
  const video = showVideo && (cell.kind === "dance" || cell.kind === "karaoke") && cell.videoUrl ? embedUrl(cell.videoUrl) : null;
  return (
    <div className={`quest-task quest-task--${cell.kind}`}>
      <span className="quest-task__kind">
        {QUEST_EMOJI[cell.kind]} {QUEST_TITLES[cell.kind]}
        {cell.points > 0 && (cell.kind === "task" || cell.kind === "question" || cell.kind === "dance" || cell.kind === "karaoke") ? ` · ${cell.points} очков` : ""}
      </span>
      <p className="quest-task__text">
        {cell.kind === "bonus" ? `Бонус! Вперёд на ${cell.move}` : cell.kind === "trap" ? `Ловушка! Назад на ${-cell.move}` : cell.kind === "skip" ? "Пропуск следующего хода" : cell.kind === "empty" ? "Отдых — заданий нет" : cell.text || "Задание от ведущего"}
      </p>
      {video && result.mode === "cell" && <iframe className="quest-task__video" src={video} title={cell.text || "Видео"} allow="autoplay; fullscreen; encrypted-media" allowFullScreen />}
      {showAnswer && cell.kind === "question" && cell.answer && (
        <p className="quest-task__answer">
          Ответ: <strong>{cell.answer}</strong>
        </p>
      )}
      {result.outcome && (
        <p className={result.outcome === "ok" ? "quest-task__outcome is-ok" : "quest-task__outcome"}>
          {result.outcome === "ok" ? `Выполнено! +${result.points}` : "Не выполнено"}
          {result.mover ? (
            <>
              {" "}
              · <NameText name={session.leaderboard[result.mover]?.name ?? ""} />
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

export function QuestScreenView({ session, content }: ViewProps<QuestContent>) {
  const r = parseQuestResult(session.state.result);
  const { stage, step } = session.state;
  const cell = r.mode !== "roll" ? cellAt(content, r.at) : null;
  const mover = r.mover ? (session.leaderboard[r.mover]?.name ?? "") : "";
  useFragment(cell?.trackId ?? null, cell?.trackStart ?? 0, cell?.trackLength ?? 30, cell?.trackId && r.mode === "cell" ? `quest:${step}` : null, { options: { fadeIn: cell?.fadeIn ?? 0, fadeOut: cell?.fadeOut ?? 0 } });
  const prev = useRef(`${step}:${r.mode}:${r.outcome}`);
  useEffect(() => {
    const key = `${step}:${r.mode}:${r.outcome}`;
    if (prev.current !== key) {
      if (r.mode === "done" || (r.mode === "cell" && r.outcome)) playSound(r.outcome === "ok" ? "correct" : "wrong");
      if (r.mode === "finish") playSound("fanfare");
    }
    prev.current = key;
  }, [step, r.mode, r.outcome]);

  return (
    <div className="quest-screen">
      {r.mode === "finish" && <Confetti burst={`quest:${step}`} />}
      <div className="quest-screen__board">
        <QuestBoard session={session} content={content} result={r} />
      </div>
      <aside className="quest-screen__side">
        {stage === "ready" ? (
          <>
            <span className="quiz-screen__badge">Активная настолка</span>
            <h2 className="quest-screen__title">Начнём игру!</h2>
            <p className="quest-screen__note">Команды по очереди бросают кубик на телефоне капитана. Каждая клетка — задание.</p>
          </>
        ) : r.mode === "finish" ? (
          <>
            <h2 className="quest-screen__title">Финиш!</h2>
            <p className="quest-screen__who">
              <NameText name={mover} />
            </p>
            <p className="quest-screen__note">+{r.points} за финиш</p>
          </>
        ) : (
          <>
            <p className="quest-screen__who">
              {r.mode === "roll" ? "Бросает" : "Ходит"} <NameText name={mover} />
            </p>
            <QuestDie value={r.roll} rolling={`${step}:${r.roll ?? 0}`} sounds />
            {r.mode !== "roll" && r.moved !== 0 && (
              <p className="quest-screen__note">
                Клетка {r.hit}: {r.moved > 0 ? `бонус! Вперёд на ${r.moved}` : `ловушка! Назад на ${-r.moved}`} → клетка {r.at}
              </p>
            )}
            {r.mode !== "roll" && <TaskCard cell={cell} result={r} session={session} showVideo />}
          </>
        )}
      </aside>
    </div>
  );
}

export function QuestPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<QuestContent, QuestAnswerValue>) {
  const r = parseQuestResult(session.state.result);
  const { stage } = session.state;
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const me = session.leaderboard[pid];
  const mine = r.mover === pid;
  const cell = r.mode !== "roll" ? cellAt(content, r.at) : null;
  const head = (
    <p className="eyebrow">
      Активная настолка{me ? ` · ${pointsLabel(me.score)} · клетка ${r.pos[pid] ?? 0} из ${content.cells.length}` : ""}
    </p>
  );
  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Скоро начнём!</h2>
        <p className="muted">Когда будет ваш ход, здесь появится кнопка «Бросить кубик».</p>
      </div>
    );
  }
  if (r.mode === "roll") {
    if (mine && role !== "member" && !myAnswer && open) {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          <div className="buzz">
            <button type="button" className="buzz__button quest-roll" disabled={sending} onClick={() => onAnswer({ roll: true })}>
              🎲
              <span>Бросить кубик</span>
            </button>
            <div className="buzz__plate buzz__plate--glow" role="status">
              <strong>Ваш ход!</strong>
              <span>Число выпадет на экране зала</span>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{mine ? (role === "member" ? "Бросает ваш капитан" : "Бросок отправлен") : <>Бросает <NameText name={session.leaderboard[r.mover ?? ""]?.name ?? ""} /></>}</h2>
        {session.screenMode === "none" && <QuestBoard session={session} content={content} result={r} size="phone" />}
      </div>
    );
  }
  return (
    <div className="quiz-phone quiz-phone--center">
      {head}
      {r.mode === "finish" ? (
        <h2>{mine ? "Вы на финише!" : "Есть финиш!"}</h2>
      ) : (
        <>
          <p>
            Выпало: {r.roll}
            {r.moved !== 0 ? ` · ${r.moved > 0 ? "бонус" : "ловушка"}: ${r.moved > 0 ? "+" : ""}${r.moved}` : ""}
          </p>
          <div className={mine ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
            <strong>{mine ? "Ваше задание" : <>Задание для <NameText name={session.leaderboard[r.mover ?? ""]?.name ?? ""} /></>}</strong>
          </div>
          <TaskCard cell={cell} result={r} session={session} />
        </>
      )}
      {session.screenMode === "none" && <QuestBoard session={session} content={content} result={r} size="phone" />}
    </div>
  );
}
