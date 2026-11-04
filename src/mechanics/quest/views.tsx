// «Активная настолка»: экран зала как на макете Figma — нарисованное поле на весь кадр, слева команды (и легенда
// клеток), сверху чей ход и кубик. Задание клетки выходит крупно в центр, когда фишка дошла (поле под ним темнеет),
// после «Выполнено» / «Не выполнено» уезжает в угол. Финиш — баннер с местом прихода и «доигрываем круг»
// (решение владельца 4 ноября 2026). Телефон — дорожка «старт → финиш» с фишками, «ваш ход через N», своё задание.
import { useEffect, useRef, useState } from "react";
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
import { cellText, QUEST_EMOJI, QUEST_TITLES, type QuestCell, type QuestContent, type QuestKind } from "./content";
import { cellAt, finalLeft, finishOf, movesBefore, parseQuestResult, type QuestResult } from "./logic";
import { QuestDie, QuestMap, teamColor } from "./QuestMap";

export type QuestAnswerValue = { roll: true };

/** Поле — карта приключений (`QuestMap.tsx`). */
export const QuestBoard = QuestMap;

const TASK_KINDS: QuestKind[] = ["task", "question", "dance", "karaoke"];
const isTask = (cell: QuestCell | null) => !!cell && TASK_KINDS.includes(cell.kind);

/** Сколько идёт фишка на экране зала (кубик, шаги, бонус или ловушка) — задание выходит после. */
function walkMs(r: QuestResult): number {
  return 1100 + Math.max(0, r.hit - r.from) * 320 + 250 + (r.moved !== 0 ? 700 : 0);
}

/** Бонус или ловушка сдвинули фишку: «Клетка 12: бонус! Вперёд на 3 → клетка 15». */
function moveLine(r: QuestResult): string | null {
  if (r.moved === 0) return null;
  return `Клетка ${r.hit}: ${r.moved > 0 ? `бонус! Вперёд на ${r.moved}` : `ловушка! Назад на ${-r.moved}`} → клетка ${r.at}`;
}

/**
 * Что показать в карточке хода: клетка, где встала фишка. Бонус или ловушка привели на клетку без задания —
 * сама клетка бонуса или ловушки (что с фишкой случилось), а не та, куда она уехала.
 */
function cardOf(content: QuestContent, r: QuestResult): { cell: QuestCell | null; text: string; move: string | null } {
  const dest = cellAt(content, r.at);
  if (isTask(dest) || r.moved === 0) {
    const text = !dest ? "" : isTask(dest) ? "" : dest.kind === "skip" ? "Пропуск следующего хода" : dest.kind === "empty" ? "Отдых — заданий нет" : "";
    return { cell: dest, text, move: isTask(dest) ? moveLine(r) : null };
  }
  const hit = cellAt(content, r.hit);
  const tail = dest?.kind === "skip" ? " · и пропуск следующего хода" : "";
  return { cell: hit, text: `${r.moved > 0 ? `Бонус! Вперёд на ${r.moved}` : `Ловушка! Назад на ${-r.moved}`} → клетка ${r.at}${tail}`, move: null };
}

const movesWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "ход" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "хода" : "ходов");

const placeLabel = (n: number) => `${n}-е место`;
const nameOf = (session: Session, pid: string | null) => (pid ? (session.leaderboard[pid]?.name ?? "") : "");
const namesOf = (session: Session, list: string[]) => list.map((p) => nameOf(session, p)).filter(Boolean).join(", ");

function TaskCard({ content, result, session, showVideo = false }: { content: QuestContent; result: QuestResult; session: Session; showVideo?: boolean }) {
  const { cell, text } = cardOf(content, result);
  if (!cell) return null;
  // Видео со звуком — только на экране зала (на телефонах гостей звука нет).
  const video = showVideo && (cell.kind === "dance" || cell.kind === "karaoke") && cell.videoUrl ? embedUrl(cell.videoUrl) : null;
  return (
    <div className={`quest-task quest-task--${cell.kind}`}>
      <span className="quest-task__kind">
        {QUEST_EMOJI[cell.kind]} {QUEST_TITLES[cell.kind]}
        {cell.points > 0 && isTask(cell) ? ` · ${cell.points} очков` : ""}
      </span>
      <p className="quest-task__text">{isTask(cell) ? cellText(cell, session.playMode) || "Задание от ведущего" : text}</p>
      {video && result.mode === "cell" && <iframe className="quest-task__video" src={video} title={cell.text || "Видео"} allow="autoplay; fullscreen; encrypted-media" allowFullScreen />}
      {/* Ответ на вопрос — всем, когда ведущий уже решил. */}
      {result.outcome && cell.kind === "question" && cell.answer && (
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
              · <NameText name={nameOf(session, result.mover)} />
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

/** Легенда клеток (только те виды, что есть на поле). */
function Legend({ content }: { content: QuestContent }) {
  const kinds = (["task", "question", "dance", "karaoke", "bonus", "trap", "skip"] as QuestKind[]).filter((k) => content.cells.some((c) => c.kind === k));
  if (kinds.length === 0) return null;
  const icon: Record<QuestKind, string> = { task: "★", question: "?", dance: "♪", karaoke: "🎤", bonus: "+N", trap: "−N", skip: "II", empty: "" };
  const word: Record<QuestKind, string> = { task: "задание", question: "вопрос", dance: "танец", karaoke: "караоке", bonus: "вперёд", trap: "назад", skip: "пропуск хода", empty: "" };
  return (
    <ul className="qx-legend" aria-label="Что в клетках">
      {kinds.map((k) => (
        <li key={k} className={`qx-legend__item qx-legend__item--${k}`}>
          <span className="qx-legend__dot" aria-hidden="true">
            {icon[k]}
          </span>
          {word[k]}
        </li>
      ))}
    </ul>
  );
}

/** Изменилось ли значение, пока экран открыт (момент наступил при открытом экране — тогда анимации и задержки). */
function useFresh(key: string): boolean {
  const first = useRef(key);
  return first.current !== key;
}

/** `on` становится true через `ms` (фишка дошла) — салют и фанфары не раньше, чем фишка на финише. */
function useAfter(on: boolean, ms: number, key: string): boolean {
  const [ready, setReady] = useState(on && ms <= 0);
  useEffect(() => {
    if (!on) {
      setReady(false);
      return;
    }
    if (ms <= 0) {
      setReady(true);
      return;
    }
    setReady(false);
    const t = window.setTimeout(() => setReady(true), ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новый момент = новый отсчёт
  }, [on, key]);
  return ready;
}

export function QuestScreenView({ session, content }: ViewProps<QuestContent>) {
  const r = parseQuestResult(session.state.result);
  const { stage, step } = session.state;
  const cell = r.mode !== "roll" && r.mode !== "over" ? cellAt(content, r.at) : null;
  const card = cardOf(content, r);
  const mover = nameOf(session, r.mover);
  useFragment(cell?.trackId ?? null, cell?.trackStart ?? 0, cell?.trackLength ?? 30, cell?.trackId && r.mode === "cell" ? `quest:${step}` : null, { options: { fadeIn: cell?.fadeIn ?? 0, fadeOut: cell?.fadeOut ?? 0 } });
  const prev = useRef(`${step}:${r.mode}:${r.outcome}`);
  useEffect(() => {
    const key = `${step}:${r.mode}:${r.outcome}`;
    if (prev.current !== key) {
      // «Выполнено» / «Не выполнено» (бонус и ловушка звучат на поле сами).
      if (r.outcome && (r.mode === "done" || r.mode === "cell")) playSound(r.outcome === "ok" ? "correct" : "wrong");
      if (r.mode === "over") playSound("fanfare");
    }
    prev.current = key;
  }, [step, r.mode, r.outcome]);
  const ranked = rankedLeaderboard(session.leaderboard);
  const shownTeams = ranked.slice(0, 10);
  const left = finalLeft(r);
  // Задание выходит в центр, когда фишка дошла (только если ход случился при открытом экране).
  const fresh = useFresh(`${step}:${r.mode}`);
  const focus = r.mode === "cell" && !r.outcome && isTask(cell);
  const delay = fresh && (r.mode === "cell" || r.mode === "done" || r.mode === "finish") ? walkMs(r) : 0;
  // Финиш: салют и фанфары, когда фишка доехала до финиша.
  const cheer = useAfter(r.mode === "finish" || r.mode === "over", r.mode === "finish" ? delay : 0, `${step}:${r.mode}`);
  const cheered = useRef("");
  useEffect(() => {
    const key = `${step}:finish`;
    if (cheer && r.mode === "finish" && fresh && cheered.current !== key) playSound("fanfare");
    if (cheer && r.mode === "finish") cheered.current = key;
  }, [cheer, r.mode, step, fresh]);

  return (
    <div className={`quest-screen qx--${content.style}`}>
      {cheer && <Confetti burst={`quest:${step}`} />}
      <div className="quest-screen__board">
        <QuestBoard session={session} content={content} result={r} />
      </div>
      {ranked.length > 0 && (
        <aside className="qx-panel" aria-label="Команды">
          <p className="qx-panel__head">
            <span className="qx-panel__mark">J✦R</span> {session.playMode === "teams" ? "Команды" : "Игроки"} · {ranked.length}
            <span className="qx-panel__cols">клетка · очки</span>
          </p>
          <ol className="qx-panel__list">
            {shownTeams.map((e) => {
              const place = r.finished.indexOf(e.id) + 1;
              return (
                <li key={e.id} className={e.id === r.mover && r.mode !== "over" ? "qx-row is-mover" : "qx-row"}>
                  <span className="qx-row__place">{e.place}</span>
                  <span className="qx-row__chip" style={{ background: teamColor(session, r, e.id) }} aria-hidden="true">
                    {Array.from(e.name.trim())[0] ?? "?"}
                  </span>
                  <span className="qx-row__name">
                    <NameText name={e.name} />
                  </span>
                  <span className="qx-row__cell">{place > 0 ? `🏁 ${place}` : r.skip.includes(e.id) ? `⏸ ${r.pos[e.id] ?? 0}` : (r.pos[e.id] ?? 0)}</span>
                  <span className="qx-row__score">{e.score}</span>
                </li>
              );
            })}
          </ol>
          {ranked.length > shownTeams.length && <p className="qx-panel__more">и ещё {ranked.length - shownTeams.length}</p>}
          <Legend content={content} />
        </aside>
      )}
      {stage === "ready" ? (
        <div className="qx-center">
          <span className="qx-center__eyebrow">Активная настолка</span>
          <h2 className="qx-center__title">Начнём игру!</h2>
          <p className="qx-center__note">
            {session.playMode === "teams" ? "Команды по очереди бросают кубик на телефоне капитана." : "Игроки по очереди бросают кубик на своём телефоне."} В клетке — задание: выполнили — очки клетки.
          </p>
          <p className="qx-center__note">
            Первые на финише — бонус {content.finishPoints > 0 ? `+${content.finishPoints}` : ""}, круг доигрываем до конца. Побеждает больше очков.
          </p>
        </div>
      ) : r.mode === "over" ? (
        <div className="qx-center qx-center--finish">
          <span className="qx-center__eyebrow">Круг доигран</span>
          <h2 className="qx-center__title">Игра окончена!</h2>
          {r.finished.length > 0 && (
            <ol className="qx-finishers">
              {r.finished.map((p, i) => (
                <li key={p}>
                  🏁 {placeLabel(i + 1)} на финише — <NameText name={nameOf(session, p)} />
                </li>
              ))}
            </ol>
          )}
          <p className="qx-center__note">Награждение — по очкам</p>
        </div>
      ) : r.mode === "finish" ? (
        <div className="qx-center qx-center--finish qx-delayed" style={{ ["--qx-delay" as string]: `${delay}ms` }}>
          <span className="qx-center__eyebrow">🏁 Финиш! · {placeLabel(r.finished.length)}</span>
          <h2 className="qx-center__title">
            <NameText name={mover} />
          </h2>
          {r.points > 0 && <p className="qx-center__bonus">+{r.points} за финиш</p>}
          <p className="qx-center__note">
            {left.length > 0 ? (
              <>
                Доигрываем круг: <NameText name={namesOf(session, left)} />
              </>
            ) : (
              "Круг доигран — награждение!"
            )}
          </p>
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
          {(r.final || (r.mode === "roll" && r.skipped.length > 0)) && (
            <div className="qx-notes">
              {r.final && (
                <p className="qx-note qx-note--final">
                  🏁 Последний круг{left.length > 0 ? <> · ещё ходят: <NameText name={namesOf(session, left)} /></> : " · это последний ход"}
                </p>
              )}
              {r.mode === "roll" && r.skipped.length > 0 && (
                <p className="qx-note">
                  ⏸ Пропускают ход: <NameText name={namesOf(session, r.skipped)} />
                </p>
              )}
            </div>
          )}
          {r.mode !== "roll" && (
            <>
              {focus && <div className="qx-dim qx-delayed" style={{ ["--qx-delay" as string]: `${delay}ms` }} aria-hidden="true" />}
              <div className={`qx-card qx-delayed${focus ? " qx-card--focus" : ""}`} style={{ ["--qx-delay" as string]: `${delay}ms` }}>
                {card.move && <p className="qx-card__move">{card.move}</p>}
                <TaskCard content={content} result={r} session={session} showVideo />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Дорожка на телефоне: старт → финиш, фишки всех, своя крупнее; сколько до финиша. */
function QuestTrack({ session, content, result: r, pid }: { session: Session; content: QuestContent; result: QuestResult; pid: string }) {
  const finish = finishOf(content);
  const mine = Math.min(finish, r.pos[pid] ?? 0);
  const others = r.order.filter((p) => p !== pid);
  const pct = (n: number) => `${(Math.min(finish, Math.max(0, n)) / finish) * 100}%`;
  const done = r.finished.includes(pid);
  return (
    <div className="quest-track" aria-label={done ? "Вы на финише" : `Клетка ${mine} из ${finish - 1}`}>
      <div className="quest-track__line">
        <span className="quest-track__fill" style={{ width: pct(mine) }} />
        {others.map((p) => (
          <span key={p} className="quest-track__dot" style={{ left: pct(r.pos[p] ?? 0), background: teamColor(session, r, p) }} title={nameOf(session, p)} />
        ))}
        {r.order.includes(pid) && (
          <span className="quest-track__me" style={{ left: pct(mine), background: teamColor(session, r, pid) }} aria-hidden="true">
            {Array.from(nameOf(session, pid).trim())[0] ?? "★"}
          </span>
        )}
      </div>
      <div className="quest-track__ends">
        <span>Старт</span>
        <span>{done ? `🏁 ${placeLabel(r.finished.indexOf(pid) + 1)}` : `до финиша ${finish - mine}`}</span>
        <span>🏁</span>
      </div>
    </div>
  );
}

/** «Ваш ход через …» — чтобы команда успела приготовиться. */
function Queue({ r, pid, teams }: { r: QuestResult; pid: string; teams: boolean }) {
  const n = movesBefore(r, pid);
  const text =
    n === "skip"
      ? "⏸ Вы пропускаете следующий ход"
      : n === null
        ? r.final && !r.finished.includes(pid) && r.order.includes(pid)
          ? "В последнем круге вы уже сходили — ждём итогов"
          : null
        : n === 0
          ? null
          : n === 1
            ? teams
              ? "Вы ходите следующими — приготовьтесь!"
              : "Вы ходите следующим — приготовьтесь!"
            : `Ваш ход через ${n} ${movesWord(n)}`;
  if (!text) return null;
  return <p className={n === 1 ? "quest-phone__queue is-soon" : "quest-phone__queue"}>{text}</p>;
}

export function QuestPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<QuestContent, QuestAnswerValue>) {
  const r = parseQuestResult(session.state.result);
  const { stage, step } = session.state;
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const me = session.leaderboard[pid];
  const mine = r.mover === pid;
  const teams = session.playMode === "teams";
  const cell = r.mode !== "roll" && r.mode !== "over" ? cellAt(content, r.at) : null;
  const canRoll = r.mode === "roll" && mine && role !== "member" && !myAnswer && open;
  // Пришла очередь бросать — телефон коротко вибрирует (один раз на ход).
  const buzzed = useRef("");
  useEffect(() => {
    const key = canRoll ? `${step}` : "";
    if (key && buzzed.current !== key) navigator.vibrate?.([120, 80, 120]);
    buzzed.current = key;
  }, [canRoll, step]);
  const myPlace = r.finished.indexOf(pid) + 1;
  const head = <p className="eyebrow">Активная настолка{me ? ` · ${pointsLabel(me.score)}` : ""}</p>;
  const track = stage !== "ready" && r.order.includes(pid) ? <QuestTrack session={session} content={content} result={r} pid={pid} /> : null;
  const queue = stage !== "ready" ? <Queue r={r} pid={pid} teams={teams} /> : null;
  const board = session.screenMode === "none" ? <QuestBoard session={session} content={content} result={r} size="phone" /> : null;
  const final =
    r.final && r.mode !== "over" ? (
      <p className="quest-phone__final" role="status">
        🏁 Последний круг
        {finalLeft(r).length > 0 ? (
          <>
            {" "}
            · ещё ходят: <NameText name={namesOf(session, finalLeft(r))} />
          </>
        ) : null}
      </p>
    ) : null;

  if (stage === "ready") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Скоро начнём!</h2>
        <p className="muted">
          Когда будет {teams ? "ход вашей команды" : "ваш ход"}, {teams && role === "member" ? "капитан бросит кубик" : "здесь появится кнопка «Бросить кубик»"}. Выполнили задание клетки — очки. Первые на финише — бонус.
        </p>
      </div>
    );
  }
  if (r.mode === "over") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Игра окончена!</h2>
        {myPlace > 0 && <p className="success">🏁 {teams ? "Ваша команда" : "Вы"} на финише — {placeLabel(myPlace)}</p>}
        <p className="muted">Смотрите на экран — награждение по очкам.</p>
        {track}
      </div>
    );
  }
  if (r.mode === "roll") {
    if (canRoll) {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          {final}
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
          {track}
        </div>
      );
    }
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        {final}
        <h2>{mine ? (role === "member" ? "Бросает ваш капитан" : "Бросок отправлен — смотрите на экран") : <>Бросает <NameText name={nameOf(session, r.mover)} /></>}</h2>
        {r.skipped.length > 0 && (
          <p className="muted">
            ⏸ Пропускают ход: <NameText name={namesOf(session, r.skipped)} />
          </p>
        )}
        {queue}
        {track}
        {board}
      </div>
    );
  }
  if (r.mode === "finish") {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>{mine ? "Вы на финише! 🏁" : <>🏁 Финиш: <NameText name={nameOf(session, r.mover)} /></>}</h2>
        <p className={mine ? "success" : "muted"}>
          {placeLabel(r.finished.length)}
          {r.points > 0 ? ` · +${r.points} за финиш` : ""}
        </p>
        <p className="muted">{finalLeft(r).length > 0 ? <>Доигрываем круг: <NameText name={namesOf(session, finalLeft(r))} /></> : "Круг доигран — смотрите на экран: награждение."}</p>
        {queue}
        {track}
        {board}
      </div>
    );
  }
  const task = isTask(cell);
  const move = cardOf(content, r).move;
  return (
    <div className="quiz-phone quiz-phone--center">
      {head}
      {final}
      <p>
        Выпало: {r.roll} → клетка {r.at}
      </p>
      {task ? (
        <div className={mine ? "buzz__plate buzz__plate--glow" : "buzz__plate"} role="status">
          <strong>{mine ? (teams ? "Задание вашей команды" : "Ваше задание") : <>Задание для <NameText name={nameOf(session, r.mover)} /></>}</strong>
        </div>
      ) : (
        <p className="muted">{mine ? "Ваша клетка" : <>Клетка <NameText name={nameOf(session, r.mover)} /></>}</p>
      )}
      {move && <p className="muted">{move}</p>}
      <TaskCard content={content} result={r} session={session} />
      {!mine && queue}
      {track}
      {board}
    </div>
  );
}
