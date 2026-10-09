import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { NameText } from "../../components/NameText";
import { awardNow, podiumNext } from "../../core/podium";
import { leaderboardAdditions, scoringParticipants } from "../../core/leaderboard";
import type { Answer, Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { fillTemplate, SECTION_HINTS, SECTION_TITLES, type StoryContent } from "./content";
import { authorOf, kindOf, nextPart, withEnding, withLies, nextStory, parseStoryResult, peopleOf, personName, revealAuthor, startGuessing, startWriting, storyBack, storyPrimary, teamOfPhone, toggleHidden, withWords, writtenStories } from "./logic";
import { endingNext, endingReveal, endingStart, endingVote, endingWrite, fakeOf, writtenEndings } from "./ending";
import { liesNext, liesReveal, liesStart, liesWrite, writtenFacts } from "./lies";
import { finishRating, newSentence, showSentence, spinWheel, startRating, tallyStars, wordOf, wordsIntro } from "./words";

/**
 * Пульт «Давайте знакомиться» (разделы по порядку). Раздел «Чья история?»: «Пишем истории» → ведущий видит истории (может убрать неподходящие) →
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
  const name = (p: string | null) => (p ? (session.leaderboard[p]?.name ?? participants.find((x) => x.id === p)?.name ?? personName(session, p)) : "—");
  const kind = kindOf(content, r.part);
  const teamOf = teamOfPhone(participants);
  const w = r.words;
  const noPlayers = scoringParticipants(participants, session.playMode).length === 0 && Object.keys(session.leaderboard).length === 0;

  // Ответы шага записи раздела: на записи — из текущих ответов, потом — один раз с сервера.
  const writeStep = kind === "lies" ? (r.lies?.writeStep ?? null) : kind === "ending" ? (r.ending?.writeStep ?? null) : kind === "words" ? null : r.writeStep;
  const writing = stage === "question" && (kind === "lies" ? r.lies?.phase === "write" : kind === "ending" ? r.ending?.phase === "write" : r.mode === "write");
  const [written, setWritten] = useState<Answer[]>([]);
  useEffect(() => {
    if (writeStep === null) return;
    if (writing) {
      setWritten(answers.filter((a) => a.step === writeStep));
      return;
    }
    let live = true;
    void control
      .freshAnswers(writeStep)
      .then((list) => live && setWritten(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [writeStep, writing, writing ? answers : null]);
  // «Что было дальше?»: выдуманные концовки текущей истории.
  const fakeStep = kind === "ending" ? (r.ending?.fakeStep ?? null) : null;
  const faking = stage === "question" && r.ending?.phase === "fake";
  const [fakes, setFakes] = useState<Answer[]>([]);
  useEffect(() => {
    if (fakeStep === null) return;
    if (faking) {
      setFakes(answers.filter((a) => a.step === fakeStep));
      return;
    }
    let live = true;
    void control
      .freshAnswers(fakeStep)
      .then((list) => live && setFakes(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fakeStep, faking, faking ? answers : null]);
  // Репетиция: телефонов нет — ответы тестовых игроков.
  const testers = Object.keys(session.leaderboard);
  const sample: Answer[] =
    rehearsal && writeStep !== null
      ? testers.map((pid, i) => ({
          id: `${writeStep}_${pid}`,
          step: writeStep,
          pid,
          uid: pid,
          submittedAt: i,
          value:
            kind === "lies"
              ? { facts: [`Я прыгал с парашютом (${i + 1})`, `Я знаю три языка (${i + 1})`, `Я ни разу не был на море (${i + 1})`], lie: i % 3 }
              : kind === "ending"
                ? { start: `Однажды в отпуске я потерял паспорт, и тут (${i + 1})`, end: "его принесла чайка" }
                : { story: `${content.examples[i % Math.max(1, content.examples.length)] ?? "История"} (${i + 1})` },
        }))
      : [];
  const sampleFakes: Answer[] = rehearsal && fakeStep !== null ? testers.map((pid, i) => ({ id: `${fakeStep}_${pid}`, step: fakeStep, pid, uid: pid, submittedAt: i, value: { fake: ["его нашёл таксист", "я улетел без него", "пришлось жить в аэропорту"][i % 3] } })) : [];
  const source = rehearsal && written.length === 0 ? sample : written;
  const fakeSource = rehearsal && fakes.length === 0 ? sampleFakes : fakes;
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

  const action = storyPrimary(session, content);
  const back = storyBack(session, content);
  const fresh = async () => {
    const list = await control.freshAnswers(step).catch(() => [] as Answer[]);
    return list.length > 0 ? list : answers;
  };
  const order = scoringParticipants(participants, session.playMode).sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0)).map((p) => p.id);
  const own = answers.filter((a) => a.step === step);
  const excludedFromRating = (phone: string) => phone === w?.performer || (session.playMode === "teams" && w?.scoreTo !== null && teamOf(phone) === w?.scoreTo);

  const facts = writtenFacts(source, writeStep ?? -1);
  const endings = writtenEndings(source, writeStep ?? -1);
  const l = r.lies;
  const e = r.ending;
  const lieItem = l?.items[l.current];
  const lieOwn = lieItem ? facts.find((f) => f.pid === lieItem.pid) : undefined;
  const endItem = e?.items[e.current];
  const endOwn = endItem ? endings.find((x) => x.pid === endItem.pid) : undefined;
  const voted = answers.filter((a) => a.step === step).length;

  const LiesPanel = () =>
    !l || l.phase === "write" ? (
      <section className="stack stack--tight">
        <p>
          Прислали факты: <strong>{facts.length}</strong>. Покажем {Math.min(facts.length, content.liesMax)}.
        </p>
        {facts.length > 0 && (
          <details className="quest-host__places">
            <summary>Факты и где ложь (видите только вы)</summary>
            <ul className="st-host__list">
              {facts.map((f) => (
                <li key={f.pid}>
                  <span className="small">
                    <NameText name={name(f.pid)} />
                  </span>
                  {f.facts.map((t, i) => (
                    <span key={i}>{i === f.lie ? `✗ ${t}` : `✓ ${t}`}</span>
                  ))}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    ) : (
      <div className="card stack stack--tight">
        <p>
          <strong><NameText name={name(lieItem?.pid ?? null)} /></strong> · {l.current + 1} из {l.items.length}
        </p>
        <details>
          <summary>Где ложь (видите только вы)</summary>
          <p>{lieOwn ? lieOwn.facts[lieOwn.lie] : "не найдено"}</p>
        </details>
        {stage === "question" && <p className="small">Выбрали: {voted}</p>}
        {l.reveal && <p className={l.reveal.right.length ? "success" : "muted"}>{l.reveal.right.length ? `Раскусили: ${l.reveal.right.map(name).join(", ")}` : "Никто не угадал — очки игроку"}</p>}
      </div>
    );

  const EndingPanel = () =>
    !e || e.phase === "write" ? (
      <section className="stack stack--tight">
        <p>
          Историй: <strong>{endings.length}</strong>. Сыграем {Math.min(endings.length, content.endingMax)}.
        </p>
        {endings.length > 0 && (
          <details className="quest-host__places">
            <summary>Истории и концовки (видите только вы)</summary>
            <ul className="st-host__list">
              {endings.map((x) => (
                <li key={x.pid}>
                  <span className="small">
                    <NameText name={name(x.pid)} />
                  </span>
                  <span>{x.start}…</span>
                  <span className="success">{x.end}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    ) : (
      <div className="card stack stack--tight">
        <p>
          История <strong><NameText name={name(endItem?.pid ?? null)} /></strong> · {e.current + 1} из {e.items.length}
        </p>
        <p className="host-quiz__question">«{endItem?.start}…»</p>
        <details>
          <summary>Настоящая концовка (видите только вы)</summary>
          <p>{endOwn?.end ?? "не найдена"}</p>
        </details>
        {e.phase === "fake" && <p className="small">Придумали концовок: {fakeSource.filter((a) => a.step === e.fakeStep && fakeOf(a.value)).length}</p>}
        {e.phase === "vote" && !e.reveal && <p className="small">Проголосовали: {voted}</p>}
        {e.reveal && <p className={e.reveal.right.length ? "success" : "muted"}>{e.reveal.right.length ? `Угадали: ${e.reveal.right.map(name).join(", ")}` : "Никто не угадал — бонус автору"}</p>}
      </div>
    );

  return (
    <div className="stack host-quiz">
      <p className="eyebrow">
        Давайте знакомиться · раздел {r.part + 1} из {content.sections.length}: {SECTION_TITLES[kind]}
        {kind === "author" && r.mode === "guess" ? ` · ${r.current + 1} из ${r.stories.length}` : ""}
      </p>

      {stage === "podium" ? (
        <PodiumHostList session={session} />
      ) : stage === "ready" ? (
        <p className="muted">{SECTION_HINTS[kind]}</p>
      ) : kind === "lies" ? (
        LiesPanel()
      ) : kind === "ending" ? (
        EndingPanel()
      ) : kind === "words" ? (
        !w || w.mode === "intro" ? (
          <p className="muted">Каждый участник получит бумажку на свой пропуск в истории и выберет слово. Потом рулетка выберет, кто покажет историю, а зал поставит звёзды.</p>
        ) : (
          <div className="card stack stack--tight">
            <p className="host-quiz__question">
              {fillTemplate(w.template, w.mode === "pick" ? w.papers.map((p) => `[${p.label}]`) : w.filled).map((part) => part.text).join("")}
            </p>
            {w.mode === "pick" && (
              <ul className="st-host__list">
                {w.papers.map((p) => {
                  const a = p.pid ? own.find((x) => x.pid === p.pid) : undefined;
                  const i = a ? wordOf(a.value) : null;
                  return (
                    <li key={p.slot}>
                      <span className="small">
                        [{p.label}] · {p.pid ? <NameText name={name(p.pid)} /> : "случай"}
                      </span>
                      <span>{i !== null ? `✓ ${p.words[i]}` : p.words.join(" · ")}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {(w.mode === "spin" || w.mode === "rate" || w.mode === "rated") && (
              <p>
                Показывает: <strong><NameText name={name(w.performer)} /></strong>
              </p>
            )}
            {w.mode === "rate" && <p className="small">Оценили: {tallyStars(answers, step, excludedFromRating).votes}</p>}
            {w.mode === "rated" && <p className="success">{w.avg !== null ? `★ ${w.avg} · +${w.points}` : "Оценок нет"}</p>}
          </div>
        )
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
              {kind === "said" ? "Первый вопрос" : "Пишем истории"}
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
            onClick={() => void run(async () => revealAuthor(latest.current, content, await control.freshAnswers(step).then((l) => (l.length ? l : answers)).catch(() => answers), all, teamOf))}
          >
            Открыть автора
          </button>
        )}
        {action === "next" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextStory(session, content))}>
            Следующая история
          </button>
        )}
        {action === "wordsSentence" && (
          <>
            <button
              type="button"
              className="btn btn--block host-quiz__primary"
              disabled={busy}
              onClick={() =>
                void run(() => {
                  const cur = latest.current;
                  const rr = parseStoryResult(cur.state.result);
                  const made = newSentence(cur, content, rr.words ?? wordsIntro(), order);
                  const change = withWords(cur, made.words, made.change);
                  const who = peopleOf(cur, participants);
                  return Promise.resolve({ ...change, state: { ...change.state, result: { ...(change.state?.result as object), ...who } } });
                })
              }
            >
              {w && w.mode !== "intro" ? "Следующая история" : "Новая история: раздать бумажки"}
            </button>
            {w && w.mode === "rated" && content.sections.length > r.part + 1 && (
              <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void run(nextPart(session))}>
                Следующий раздел
              </button>
            )}
          </>
        )}
        {action === "wordsShow" && w && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(async () => { const m = showSentence(latest.current, w, await fresh()); return withWords(latest.current, m.words, m.change); })}>
            Показать историю
          </button>
        )}
        {(action === "wordsSpin" || action === "wordsRate") && w && (
          <button type="button" className={`btn btn--block ${action === "wordsSpin" ? "host-quiz__primary" : "btn--secondary"}`} disabled={busy} onClick={() => void run(withWords(session, spinWheel(session, w, r.people.length ? r.people : peopleOf(session, participants).people, teamOf).words))}>
            {action === "wordsSpin" ? "Крутить рулетку" : "Крутить ещё раз"}
          </button>
        )}
        {action === "wordsRate" && w && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => { const m = startRating(session, content, w); void run(withWords(session, m.words, m.change)); }}>
            Оценить показ
          </button>
        )}
        {action === "wordsRated" && w && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(async () => { const m = finishRating(latest.current, content, w, await fresh(), excludedFromRating); return withWords(latest.current, m.words, m.change); })}>
            Итог
          </button>
        )}
        {action === "nextQuestion" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(startWriting(session, participants, r.q + 1))}>
            Следующий вопрос
          </button>
        )}
        {action === "liesWrite" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || noPlayers} onClick={() => { const m = liesWrite(session); void run({ ...withLies(session, m.lies, m.change), leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode) }); }}>
            Пишем факты
          </button>
        )}
        {action === "liesStart" && l && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || facts.length < 2} onClick={() => void run(async () => { const list = rehearsal ? source : await control.freshAnswers(l.writeStep).catch(() => source); const m = liesStart(latest.current, content, l, list.length ? list : source); return m ? withLies(latest.current, m.lies, m.change) : null; })}>
            Показать игроков ({Math.min(facts.length, content.liesMax)})
          </button>
        )}
        {action === "liesReveal" && l && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(async () => { const m = liesReveal(latest.current, content, l, await fresh(), facts, teamOf); return withLies(latest.current, m.lies, m.change); })}>
            Открыть ложь
          </button>
        )}
        {action === "liesNext" && l && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => { const m = liesNext(session, content, l); void run(withLies(session, m.lies, m.change)); }}>
            Следующий игрок
          </button>
        )}
        {action === "endingWrite" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || noPlayers} onClick={() => { const m = endingWrite(session); void run({ ...withEnding(session, m.ending, m.change), leaderboard: leaderboardAdditions(session.leaderboard, participants, session.playMode) }); }}>
            Пишем истории
          </button>
        )}
        {action === "endingStart" && e && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || endings.length < 1} onClick={() => void run(async () => { const list = rehearsal ? source : await control.freshAnswers(e.writeStep).catch(() => source); const m = endingStart(latest.current, content, e, list.length ? list : source); return m ? withEnding(latest.current, m.ending, m.change) : null; })}>
            Начать ({Math.min(endings.length, content.endingMax)} ист.)
          </button>
        )}
        {action === "endingVote" && e && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(async () => { const list = rehearsal ? fakeSource : await fresh(); const m = endingVote(latest.current, content, e, list.length ? list : fakeSource, endings); return withEnding(latest.current, m.ending, m.change); })}>
            Голосуем: где правда?
          </button>
        )}
        {action === "endingReveal" && e && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(async () => { const m = endingReveal(latest.current, content, e, await fresh(), fakeSource, endings, teamOf); return withEnding(latest.current, m.ending, m.change); })}>
            Открыть правду
          </button>
        )}
        {action === "endingNext" && e && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => { const m = endingNext(session, content, e); void run(withEnding(session, m.ending, m.change)); }}>
            Следующая история
          </button>
        )}
        {action === "nextPart" && (
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(nextPart(session))}>
            Следующий раздел: {SECTION_TITLES[kindOf(content, r.part + 1)]}
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
        {stage === "reveal" && (action === "next" || action === "nextPart" || action === "nextQuestion" || action === "liesNext" || action === "endingNext" || (action === "wordsSentence" && w?.mode === "rated")) && (
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
