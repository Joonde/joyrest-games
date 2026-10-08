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
import { cellAt, finishOf, parseQuestResult, type QuestResult } from "./logic";

export type QuestAnswerValue = { roll: true };

const TEAM_COLORS = ["#E3AA9C", "#E3C68C", "#A3C2AA", "#D2A0AC", "#B3AADD", "#9FC3D6", "#E0B3A0", "#C9C08F"];

/** Значок команды на фишке: её смайлик или первая буква. */
function tokenOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? "?";
  return /\p{Extended_Pictographic}/u.test(first) ? first : first.toUpperCase();
}

function colorOf(session: Session, r: QuestResult, pid: string): string {
  const entry = session.leaderboard[pid];
  const index = entry?.colorIndex ?? Math.max(0, r.order.indexOf(pid));
  return TEAM_COLORS[index % TEAM_COLORS.length] ?? "#E3C68C";
}

/** Поле змейкой снизу вверх: «Старт», клетки 1..N, «Финиш». */
export function QuestBoard({ session, content, result, size = "screen" }: { session: Session; content: QuestContent; result: QuestResult; size?: "screen" | "phone" }) {
  const total = finishOf(content) + 1;
  const cols = total > 72 ? 12 : total > 50 ? 10 : 8;
  const rows = Math.ceil(total / cols);
  const tokens = new Map<number, string[]>();
  for (const p of result.order) {
    const at = result.pos[p] ?? 0;
    tokens.set(at, [...(tokens.get(at) ?? []), p]);
  }
  return (
    <div className={`quest-board quest-board--${size}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }} aria-label="Игровое поле">
      {Array.from({ length: total }, (_, i) => {
        const row = Math.floor(i / cols);
        const inRow = i % cols;
        const col = row % 2 === 0 ? inRow : cols - 1 - inRow;
        const cell = cellAt(content, i);
        const start = i === 0;
        const finish = i === total - 1;
        const here = tokens.get(i) ?? [];
        const current = result.mode !== "roll" && result.at === i && result.mover;
        return (
          <div
            key={i}
            className={`quest-cell quest-cell--${start ? "start" : finish ? "finish" : (cell?.kind ?? "empty")}${current ? " is-current" : ""}`}
            style={{ gridRow: rows - row, gridColumn: col + 1 }}
          >
            <span className="quest-cell__n">{start ? "Старт" : finish ? "Финиш" : i}</span>
            {cell && QUEST_EMOJI[cell.kind] && <span className="quest-cell__emoji" aria-hidden="true">{QUEST_EMOJI[cell.kind]}</span>}
            {cell?.kind === "bonus" && <span className="quest-cell__move">+{cell.move}</span>}
            {cell?.kind === "trap" && <span className="quest-cell__move">{cell.move}</span>}
            {here.length > 0 && (
              <span className="quest-cell__tokens">
                {here.map((p) => (
                  <span key={p} className={`quest-token${p === result.mover ? " is-mover" : ""}`} style={{ background: colorOf(session, result, p) }} title={session.leaderboard[p]?.name}>
                    {tokenOf(session.leaderboard[p]?.name ?? "?")}
                  </span>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Die({ value, rolling }: { value: number | null; rolling: string }) {
  const dots: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return (
    <div key={rolling} className="quest-die" aria-label={value ? `Выпало ${value}` : "Кубик"}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={value && dots[value]?.includes(i) ? "quest-die__dot is-on" : "quest-die__dot"} />
      ))}
    </div>
  );
}

function TaskCard({ cell, result, session, showAnswer = false }: { cell: QuestCell | null; result: QuestResult; session: Session; showAnswer?: boolean }) {
  if (!cell) return null;
  const video = (cell.kind === "dance" || cell.kind === "karaoke") && cell.videoUrl ? embedUrl(cell.videoUrl) : null;
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
      if (r.mode === "cell" || r.mode === "done") playSound(r.outcome === "ok" ? "correct" : r.outcome === "fail" ? "wrong" : "drumroll");
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
            <Die value={r.roll} rolling={`${step}:${r.roll ?? 0}`} />
            {r.mode !== "roll" && <TaskCard cell={cell} result={r} session={session} />}
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
          <p>Выпало: {r.roll}</p>
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
