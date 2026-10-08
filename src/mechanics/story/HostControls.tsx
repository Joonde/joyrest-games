import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { scoringParticipants } from "../../core/leaderboard";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import type { StoryContent } from "./content";
import { authorOf, nextStory, parseStoryResult, revealAuthor, startGuessing, startWriting, storyBack, storyPrimary, toggleHidden, writtenStories } from "./logic";

/**
 * Пульт «Не моей истории»: «Пишем истории» → ведущий видит истории (может убрать неподходящие) →
 * «Начать угадывание» → история на экране, гости голосуют → «Открыть автора» → «Следующая история» →
 * награждение.
 */
export function StoryHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<StoryContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);
  const { stage, step } = session.state;
  const r = parseStoryResult(session.state.result);
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? "Игрок") : "—");
  const noPlayers = scoringParticipants(participants, session.playMode).length === 0 && Object.keys(session.leaderboard).length === 0;

  // Истории шага записи: на записи — из текущих ответов, потом — один раз с сервера.
  const [written, setWritten] = useState<Answer[]>([]);
  const writing = r.mode === "write" && stage === "question";
  useEffect(() => {
    if (r.writeStep === null) return;
    if (writing) {
      setWritten(answers.filter((a) => a.step === r.writeStep));
      return;
    }
    let live = true;
    void control
      .freshAnswers(r.writeStep)
      .then((list) => live && setWritten(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [r.writeStep, writing, writing ? answers : null]);
  // Репетиция: телефонов нет — истории тестовых игроков из примеров игры.
  const sample: Answer[] = rehearsal && r.writeStep !== null ? Object.keys(session.leaderboard).flatMap((pid, i) => {
    const text = content.examples[i % Math.max(1, content.examples.length)];
    return text ? [{ id: `${r.writeStep}_${pid}`, step: r.writeStep as number, pid, uid: pid, value: { story: `${text} (${i + 1})` }, submittedAt: i }] : [];
  }) : [];
  const source = rehearsal && written.length === 0 ? sample : written;
  const all = writtenStories(source, { ...r, hidden: [] });
  const shown = all.filter((s) => !r.hidden.includes(s.id));
  const story = r.stories[r.current];
  const author = story ? authorOf(story.text, all) : null;
  const votes = answers.filter((a) => a.step === step && a.pid !== author).length;

  function nextSession(): Promise<void> {
    return new Promise((done) => {
      const timer = window.setTimeout(done, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        done();
      });
    });
  }

  async function run(make: SessionChange | null | (() => Promise<SessionChange | null>), clear?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { phase, step: atStep, stage: atStage } = session.state;
    try {
      const change = typeof make === "function" ? await make() : make;
      if (!change) return;
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      if (clear !== undefined) await control.clearAnswers(clear);
      await control.apply({ ...change, expect: { phase, step: atStep, stage: atStage } });
      await arrived;
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "failed-precondition")) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const action = storyPrimary(session);
  const back = storyBack(session);

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">Не моя история{r.mode === "guess" ? ` · история ${r.current + 1} из ${r.stories.length}` : ""}</p>

      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : stage === "ready" ? (
        <p className="muted">Гости тайно пишут на телефоне случай из жизни. Потом истории по одной показываются на экране без имён, все угадывают автора.</p>
      ) : r.mode === "write" ? (
        <section className="stack stack--tight">
          <p>
            Историй: <strong>{shown.length}</strong>
            {all.length > shown.length ? ` (убрано ${all.length - shown.length})` : ""}. Играем {content.maxStories > 0 ? `до ${content.maxStories}` : "все"}.
          </p>
          {all.length > 0 && (
            <details className="quest-host__places">
              <summary>Истории и авторы (видите только вы)</summary>
              <ul className="st-host__list">
                {all.map((s) => (
                  <li key={s.id} className={r.hidden.includes(s.id) ? "is-hidden" : undefined}>
                    <span className="small">
                      <NameText name={name(s.pid)} />
                    </span>
                    <span>{s.text}</span>
                    <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void run(toggleHidden(session, s.id))}>
                      {r.hidden.includes(s.id) ? "Вернуть" : "Убрать"}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ) : (
        story && (
          <div className="card stack stack--tight">
            <p className="host-quiz__question">«{story.text}»</p>
            <details>
              <summary>Автор (видите только вы)</summary>
              <p>{author ? <NameText name={name(author)} /> : "не найден — автор ушёл или изменил историю"}</p>
            </details>
            {stage === "question" && <p className="small">Проголосовали: {votes}</p>}
            {stage === "reveal" && r.reveal && (
              <p className={r.reveal.right.length ? "success" : "muted"}>
                {r.reveal.right.length ? `Угадали: ${r.reveal.right.map(name).join(", ")}` : "Никто не угадал — очки автору"}
              </p>
            )}
          </div>
        )
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {action === "write" && (
          <>
            {noPlayers && <p className="muted small">Ждём гостей.</p>}
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || noPlayers} onClick={() => void run(startWriting(session, participants))}>
              Пишем истории
            </button>
          </>
        )}
        {action === "start" && (
          <button
            type="button"
            className="btn btn--block host-quiz__primary"
            disabled={busy || shown.length < 2}
            onClick={() => void run(async () => startGuessing(latest.current, content, rehearsal ? source : await control.freshAnswers(step).then((l) => (l.length ? l : answers)).catch(() => answers), participants))}
          >
            Начать угадывание ({Math.min(shown.length, content.maxStories || shown.length)})
          </button>
        )}
        {action === "reveal" && (
          <button
            type="button"
            className="btn btn--block host-quiz__primary"
            disabled={busy}
            onClick={() => void run(async () => revealAuthor(latest.current, content, await control.freshAnswers(step).then((l) => (l.length ? l : answers)).catch(() => answers), all))}
          >
            Открыть автора
          </button>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextStory(session, content))}>
            Следующая история
          </button>
        )}
        {(action === "podium" || action === "podiumNext") && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(action === "podium" ? awardNow(session) : podiumNext(session))}>
            {action === "podium" ? "Награждение" : "Открыть следующее место"}
          </button>
        )}
        {action === "finish" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => control.requestFinish()}>
            Завершить игру
          </button>
        )}
        {stage === "reveal" && action === "next" && (
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void run(awardNow(session))}>
            Закончить и наградить
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || back === null} onClick={() => back && void run(back.change, back.clearAnswers)}>
          Назад
        </button>
      </div>
    </div>
  );
}
