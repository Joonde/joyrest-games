// «Активная настолка»: экран зала как на макете Figma — нарисованное поле на весь кадр, слева команды, сверху
// чей ход и кубик, справа снизу карточка клетки.
import { useEffect, useRef } from "react";
import { Confetti } from "../../components/live/Confetti";
import { playSound } from "../../components/live/sound";
import { useServerNow } from "../../components/live/useServerNow";
import { useFragment } from "../../components/music/useFragment";
import { NameText } from "../../components/NameText";
import { rankedLeaderboard } from "../../core/leaderboard";
import { pointsLabel } from "../../core/results";
import { acceptsAnswers } from "../../core/session";
import type { Session } from "../../data/types";
import { embedUrl } from "../dance/content";
import type { PlayerViewProps, ViewProps } from "../types";
import { cellText, QUEST_EMOJI, QUEST_TITLES, type QuestCell, type QuestContent } from "./content";
import { cellAt, parseQuestResult, type QuestResult } from "./logic";
import { QuestDie, QuestMap, teamColor } from "./QuestMap";

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
        {cell.kind === "bonus" ? `Бонус! Вперёд на ${cell.move}` : cell.kind === "trap" ? `Ловушка! Назад на ${-cell.move}` : cell.kind === "skip" ? "Пропуск следующего хода" : cell.kind === "empty" ? "Отдых — заданий нет" : cellText(cell, session.playMode) || "Задание от ведущего"}
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
  const ranked = rankedLeaderboard(session.leaderboard);
  const shownTeams = ranked.slice(0, 10);

  return (
    <div className={`quest-screen qx--${content.style}`}>
      {r.mode === "finish" && <Confetti burst={`quest:${step}`} />}
      <div className="quest-screen__board">
        <QuestBoard session={session} content={content} result={r} />
      </div>
      {ranked.length > 0 && (
        <aside className="qx-panel" aria-label="Команды">
          <p className="qx-panel__head">
            <span className="qx-panel__mark">J✦R</span> {session.playMode === "teams" ? "Команды" : "Игроки"} · {ranked.length}
          </p>
          <ol className="qx-panel__list">
            {shownTeams.map((e) => (
              <li key={e.id} className={e.id === r.mover ? "qx-row is-mover" : "qx-row"}>
                <span className="qx-row__place">{e.place}</span>
                <span className="qx-row__chip" style={{ background: teamColor(session, r, e.id) }} aria-hidden="true">
                  {Array.from(e.name.trim())[0] ?? "?"}
                </span>
                <span className="qx-row__name">
                  <NameText name={e.name} />
                </span>
                <span className="qx-row__cell">кл. {r.pos[e.id] ?? 0}</span>
                <span className="qx-row__score">{e.score}</span>
              </li>
            ))}
          </ol>
          {ranked.length > shownTeams.length && <p className="qx-panel__more">и ещё {ranked.length - shownTeams.length}</p>}
        </aside>
      )}
      {stage === "ready" ? (
        <div className="qx-center">
          <span className="qx-center__eyebrow">Активная настолка</span>
          <h2 className="qx-center__title">Начнём игру!</h2>
          <p className="qx-center__note">
            {session.playMode === "teams" ? "Команды по очереди бросают кубик на телефоне капитана." : "Игроки по очереди бросают кубик на своём телефоне."} Каждая клетка — задание.
          </p>
        </div>
      ) : r.mode === "finish" ? (
        <div className="qx-center">
          <span className="qx-center__eyebrow">Финиш!</span>
          <h2 className="qx-center__title">
            <NameText name={mover} />
          </h2>
          <p className="qx-center__note">+{r.points} за финиш</p>
        </div>
      ) : (
        <>
          <div className="qx-turn">
            <div className="qx-turn__who">
              <span className="qx-turn__label">{r.mode === "roll" ? "Бросает кубик" : "Ходит"}</span>
              <span className="qx-turn__name">
                <NameText name={mover} />
              </span>
            </div>
            <QuestDie value={r.roll} rolling={`${step}:${r.roll ?? 0}`} sounds />
            {r.mode !== "roll" && r.roll ? (
              <div className="qx-turn__who">
                <span className="qx-turn__label">выпало</span>
                <span className="qx-turn__roll">
                  {r.roll} → кл. {r.at}
                </span>
              </div>
            ) : null}
          </div>
          {r.mode !== "roll" && (
            <div className="qx-card">
              {r.moved !== 0 && (
                <p className="qx-card__move">
                  Клетка {r.hit}: {r.moved > 0 ? `бонус! Вперёд на ${r.moved}` : `ловушка! Назад на ${-r.moved}`} → клетка {r.at}
                </p>
              )}
              <TaskCard cell={cell} result={r} session={session} showVideo />
            </div>
          )}
        </>
      )}
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
