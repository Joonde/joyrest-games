// «Рулетка судьбы»: экран зала и телефоны. Этап 1 — выбор тем и собранное колесо (список секторов и очередь);
// колесо, вращение и задания — следующие этапы (паспорт, п. 5).
import { useEffect, useState } from "react";
import { NameText } from "../../components/NameText";
import { pointsLabel } from "../../core/results";
import type { Session } from "../../data/types";
import type { PlayerViewProps, ViewProps } from "../types";
import { catalogThemes, MAX_TEAMS, sectorLabel, themeById, type RouletteContent } from "./content";
import { isReady, parseRouletteResult, parseThemesAnswer, themesNeeded, type RouletteResult, type ThemesAnswer } from "./logic";
import "./roulette.css";

export type RouletteAnswerValue = ThemesAnswer | { spin: true };

const nameOf = (session: Session, pid: string | null | undefined) => (pid ? (session.leaderboard[pid]?.name ?? "Команда") : "");

const themeNames = (content: RouletteContent, ids: readonly string[]) => ids.map((id) => themeById(content, id)?.name ?? "—").join(", ");

/** Команды на выборе тем: очередь, которую записал пульт (порядок входа, до восьми), потом остальные — «не в игре». */
function teamsOf(session: Session, r: RouletteResult): { queue: string[]; extra: string[] } {
  const queue = r.queue.length > 0 ? r.queue.filter((pid) => pid in session.leaderboard) : Object.keys(session.leaderboard).slice(0, MAX_TEAMS);
  return { queue, extra: Object.keys(session.leaderboard).filter((pid) => !queue.includes(pid) && (r.queue.length >= MAX_TEAMS || queue.length >= MAX_TEAMS)) };
}

/** Команда сверх восьми — в эту игру не попадает (Р-8). */
function outOfQueue(session: Session, r: RouletteResult, pid: string): boolean {
  return teamsOf(session, r).extra.includes(pid);
}

function Wheelplan({ session, content, r }: { session: Session; content: RouletteContent; r: RouletteResult }) {
  return (
    <div className="fr-plan">
      <ol className="fr-plan__sectors" aria-label="Темы колеса">
        {r.sectors.map((id, i) => {
          const th = themeById(content, id);
          return (
            <li key={id} className={"fr-sector fr-sector--" + (i % 6)}>
              {th ? sectorLabel(th) : "—"}
            </li>
          );
        })}
      </ol>
      <p className="fr-plan__turn">
        Крутит: <strong><NameText name={nameOf(session, r.turn?.team)} /></strong>
      </p>
      <ol className="fr-plan__queue" aria-label="Очередь">
        {r.order.map((pid) => (
          <li key={pid} className={pid === r.turn?.team ? "is-now" : undefined}>
            <NameText name={nameOf(session, pid)} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RouletteScreenView({ session, content }: ViewProps<RouletteContent>) {
  const r = parseRouletteResult(session.state.result);
  const { stage, step } = session.state;
  if (stage === "ready" && step === 0) {
    return (
      <div className="fr-screen">
        <span className="quiz-screen__badge">Рулетка судьбы</span>
        <h2 className="fr-screen__title">Скоро выбираем темы</h2>
        <p className="fr-screen__note">Капитаны выберут темы на телефонах — из них соберём общее колесо.</p>
      </div>
    );
  }
  if (r.mode === "themes") {
    const { queue, extra } = teamsOf(session, r);
    const need = themesNeeded(content);
    return (
      <div className="fr-screen">
        <span className="quiz-screen__badge">Рулетка судьбы · выбор тем</span>
        <h2 className="fr-screen__title">Капитаны, выберите {need === 1 ? "тему" : need + " темы"} на телефоне</h2>
        <ul className="fr-teams">
          {queue.map((pid) => {
            const choice = r.choices[pid];
            return (
              <li key={pid} className={"fr-team" + (isReady(choice) ? " is-ready" : "")}>
                <span className="fr-team__name">
                  <NameText name={nameOf(session, pid)} />
                </span>
                <span className="fr-team__state">{isReady(choice) ? "✓ " + themeNames(content, choice.themes) : "выбирает…"}</span>
              </li>
            );
          })}
        </ul>
        {extra.length > 0 && <p className="fr-screen__note">Команд больше {MAX_TEAMS}: в этой игре не участвуют — {extra.map((pid) => nameOf(session, pid)).join(", ")}.</p>}
      </div>
    );
  }
  return (
    <div className="fr-screen">
      <span className="quiz-screen__badge">Рулетка судьбы{r.turn ? " · ход " + r.turn.n + " · круг " + r.turn.round : ""}</span>
      <Wheelplan session={session} content={content} r={r} />
      <p className="fr-screen__note">Колесо собрано.</p>
    </div>
  );
}

/**
 * Выбор тем на телефоне капитана: ровно нужное число тем и «Подтвердить»; после — «Изменить» (Р-5). Что показать,
 * решает сессия, а не память телефона: выбор ведущего (сделан или снят) важнее своего ответа; после «Назад к выбору
 * тем» и перезагрузки готовность видна по сессии.
 */
function ThemesPicker({ content, r, pid, myAnswer, sending, onAnswer }: { content: RouletteContent; r: RouletteResult; pid: string; myAnswer: ThemesAnswer | null; sending: boolean; onAnswer: (v: ThemesAnswer) => void }) {
  const catalog = catalogThemes(content);
  const need = themesNeeded(content);
  const choice = r.choices[pid];
  const byHost = choice?.by === "host";
  const mineReady = myAnswer?.confirmed === true && myAnswer.themes.length === need;
  // Готово: ведущий выбрал за команду; или свой подтверждённый ответ; или своего ответа нет, а в сессии — выбор капитана.
  // Капитан подтвердил свой выбор поверх выбора ведущего: показываем его, пока пульт не перенёс ответ в сессию.
  const choiceKey = (choice?.by ?? "") + ":" + (choice?.at ?? 0) + ":" + (choice?.themes.join(",") ?? "");
  const [over, setOver] = useState<{ key: string; themes: string[] } | null>(null);
  const overHost = over && over.key === choiceKey && myAnswer?.confirmed ? over.themes : null;
  const shown: string[] | null = overHost ?? (byHost ? (isReady(choice) ? choice.themes : null) : myAnswer ? (mineReady ? myAnswer.themes : null) : isReady(choice) ? choice.themes : null);
  const [picked, setPicked] = useState<string[]>(() => myAnswer?.themes ?? choice?.themes ?? []);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (byHost) setPicked(choice?.themes ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при смене выбора ведущего
  }, [byHost, choice?.themes.join(",")]);
  useEffect(() => {
    if (shown === null) setEditing(false);
  }, [shown === null]);

  if (shown && !editing) {
    return (
      <div className="stack stack--tight">
        <p className="success">{byHost && !overHost ? "Ведущий выбрал за вас: " : "Готово: "}{themeNames(content, shown)}</p>
        <p className="muted small">Пока ведущий не собрал колесо, выбор можно поменять.</p>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={sending}
          onClick={() => {
            setPicked(shown);
            setOver(null);
            if (byHost) setEditing(true);
            else onAnswer({ themes: shown, confirmed: false });
          }}
        >
          Изменить
        </button>
      </div>
    );
  }
  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < need ? [...list, id] : list));
  return (
    <div className="stack stack--tight">
      <h2>Выберите {need === 1 ? "тему" : need + " темы"}</h2>
      {byHost && !isReady(choice) && <p className="muted small">Ведущий снял выбор — выберите заново.</p>}
      <div className="fr-pick" role="group" aria-label="Темы">
        {catalog.map((t) => {
          const on = picked.includes(t.id);
          return (
            <label key={t.id} className="choice">
              <input type="checkbox" checked={on} disabled={sending || (!on && picked.length >= need)} onChange={() => toggle(t.id)} />
              <span className="choice__text">
                <span className="choice__title">{t.name}</span>
              </span>
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn--block"
        disabled={sending || picked.length !== need}
        onClick={() => {
          setEditing(false);
          if (byHost) setOver({ key: choiceKey, themes: picked });
          onAnswer({ themes: picked, confirmed: true });
        }}
      >
        Подтвердить
      </button>
    </div>
  );
}

export function RoulettePlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<RouletteContent, RouletteAnswerValue>) {
  const r = parseRouletteResult(session.state.result);
  const { stage, step } = session.state;
  const me = session.leaderboard[pid];
  const head = (
    <p className="eyebrow">
      Рулетка судьбы{me ? " · " + pointsLabel(me.score) : ""}
    </p>
  );
  if (stage === "ready" && step === 0) {
    return (
      <div className="quiz-phone quiz-phone--center">
        {head}
        <h2>Скоро начнём</h2>
        <p className="muted">{role === "member" ? "Капитан выберет темы для колеса." : "Сейчас вы выберете темы для общего колеса."}</p>
      </div>
    );
  }
  if (r.mode === "themes") {
    const choice = r.choices[pid];
    const mine = myAnswer ? parseThemesAnswer(myAnswer.value, content) : null;
    if (outOfQueue(session, r, pid)) {
      return (
        <div className="quiz-phone quiz-phone--center">
          {head}
          <h2>Команд уже {MAX_TEAMS}</h2>
          <p className="muted">В этой игре ваша команда не участвует — попросите ведущего объединить команды.</p>
        </div>
      );
    }
    return (
      <div className="quiz-phone">
        {head}
        {role === "member" ? (
          <>
            <h2>Капитан выбирает темы</h2>
            <p className="muted">{isReady(choice) ? "Выбрано: " + themeNames(content, choice.themes) : "Подскажите капитану, что вам по душе."}</p>
          </>
        ) : (
          <ThemesPicker key={step} content={content} r={r} pid={pid} myAnswer={mine} sending={sending} onAnswer={onAnswer} />
        )}
      </div>
    );
  }
  return (
    <div className="quiz-phone">
      {head}
      <h2>{r.turn?.team === pid ? "Ваш ход!" : "Колесо собрано"}</h2>
      <p className="muted">Темы: {themeNames(content, r.sectors)}.</p>
      {r.turn && r.turn.team !== pid && (
        <p>
          Крутит: <NameText name={nameOf(session, r.turn.team)} />
        </p>
      )}
    </div>
  );
}
