// Пульт «Рулетки судьбы». Этап 1: «Открыть выбор тем» → капитаны выбирают (или ведущий за команду) → «К колесу» →
// колесо собрано, «Назад к выбору тем» до первого вращения. Вращение и задания — следующие этапы.
import { useEffect, useRef, useState } from "react";
import { PodiumHostList } from "../../components/live/Podium";
import { NameText } from "../../components/NameText";
import { podiumDone, podiumNext } from "../../core/podium";
import { resultKey } from "../../core/session";
import type { Session, SessionChange } from "../../data/types";
import type { HostControlsProps } from "../types";
import { catalogThemes, MAX_TEAMS, themeById, type RouletteContent } from "./content";
import { backToThemes, effectiveChoices, hostChoose, hostToggleAdded, openThemes, parseRouletteResult, planWheel, rouletteAction, syncThemes, themesNeeded, themesStatus } from "./logic";

const isConflict = (e: unknown) => typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "failed-precondition";
const pause = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

export function RouletteHostControls({ session, content, answers, participants, control, rehearsal }: HostControlsProps<RouletteContent>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const latest = useRef<Session>(session);
  const waiters = useRef<Array<() => void>>([]);
  useEffect(() => {
    latest.current = session;
    const done = waiters.current;
    waiters.current = [];
    done.forEach((w) => w());
  }, [session]);

  const r = parseRouletteResult(session.state.result);
  const action = rouletteAction(session);
  const name = (pid: string | null | undefined) => (pid ? (session.leaderboard[pid]?.name ?? participants.find((p) => p.id === pid)?.name ?? "Команда") : "—");
  const themeName = (id: string) => themeById(content, id)?.name ?? "—";
  const catalog = catalogThemes(content);
  const need = themesNeeded(content);

  // Выбор капитанов → в сессию (экран и телефоны видят только её) и счётчик «Ответили».
  const own = answers.filter((a) => a.step === 0);
  const syncKey = action === "toWheel" ? own.map((a) => a.id + ":" + (a.submittedAt ?? 0)).join(",") + "|" + resultKey(session.state.result) + "|" + session.state.answered : "";
  useEffect(() => {
    if (!syncKey || busy) return;
    const change = syncThemes(latest.current, content, answers);
    if (!change) return;
    void control.apply(change).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при новых ответах или новой сессии
  }, [syncKey, busy]);

  function nextSession(): Promise<void> {
    return new Promise((done) => {
      const timer = window.setTimeout(done, 3000);
      waiters.current.push(() => {
        window.clearTimeout(timer);
        done();
      });
    });
  }

  async function run(make: () => SessionChange | null, clear?: number) {
    if (busy) return;
    const change = make();
    if (!change) return;
    setBusy(true);
    setError(null);
    try {
      const arrived = rehearsal ? Promise.resolve() : nextSession();
      await control.apply(change);
      // Ответы покидаемого шага — только после записи шага назад (Р-43, Н-3).
      if (clear !== undefined) await control.clearAnswers(clear).catch(() => control.clearAnswers(clear).catch(() => undefined));
      await arrived;
    } catch (e) {
      if (!isConflict(e)) setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  /** «К колесу» по свежим ответам; пришёл ответ, пока пульт считал, — заново (О-8, до трёх попыток). */
  async function toWheel() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const fresh = await control.freshAnswers(0);
        const plan = planWheel(latest.current, content, participants, fresh);
        if (!plan.ok) {
          setError(plan.problems.join(" "));
          return;
        }
        try {
          const arrived = rehearsal ? Promise.resolve() : nextSession();
          await control.apply(plan.change);
          await arrived;
          return;
        } catch (e) {
          if (!isConflict(e)) throw e;
          await pause(300);
        }
      }
      setError("Игра изменилась — нажмите ещё раз.");
    } catch {
      setError("Не получилось. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(team: string, themes: string[]) {
    setEditing(team);
    setDraft(themes);
  }

  if (session.state.stage === "podium") {
    const done = podiumDone(session);
    return (
      <div className="stack host-quiz">
        <PodiumHostList session={session} />
        <div className="actions">
          {done ? (
            <button type="button" className="btn btn--block host-quiz__primary" onClick={() => control.requestFinish()}>
              Завершить игру
            </button>
          ) : (
            <button type="button" className="btn btn--block host-quiz__primary" disabled={busy} onClick={() => void run(() => podiumNext(session))}>
              Открыть следующее место
            </button>
          )}
        </div>
      </div>
    );
  }

  if (action === "openThemes") {
    const teams = participants.filter((p) => p.kind === "team").length + Object.keys(session.leaderboard).filter((id) => !participants.some((p) => p.id === id)).length;
    return (
      <div className="stack host-quiz">
        <p className="eyebrow">Рулетка судьбы</p>
        <p className="muted">
          Капитаны выберут по {need === 1 ? "одной теме" : need + " темы"} на телефонах, из них соберётся общее колесо. Команд — от 2 до {MAX_TEAMS}.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          {teams === 0 && <p className="muted small">Ждём команды.</p>}
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || teams === 0} onClick={() => void run(() => openThemes(latest.current, participants))}>
            Открыть выбор тем
          </button>
        </div>
      </div>
    );
  }

  if (action === "toWheel") {
    const choices = effectiveChoices(content, r, answers);
    const status = themesStatus(content, session, participants, choices, r.added);
    const short = status.sectors.length < 3;
    return (
      <div className="stack host-quiz">
        <p className="eyebrow">Рулетка судьбы · выбор тем</p>
        <ul className="stack stack--tight">
          {status.queue.map((pid) => {
            const choice = choices[pid];
            return (
              <li key={pid} className="card stack stack--tight">
                <div className="fr-host-team">
                  <strong>
                    <NameText name={name(pid)} />
                  </strong>
                  <span className={choice ? "success" : "muted"}>{choice ? (choice.by === "host" ? "выбрал ведущий: " : "✓ ") + choice.themes.map(themeName).join(", ") : "выбирает…"}</span>
                  {editing !== pid && (
                    <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => startEdit(pid, choice?.themes ?? [])}>
                      За команду
                    </button>
                  )}
                </div>
                {editing === pid && (
                  <div className="stack stack--tight">
                    <div className="fr-host-chips">
                      {catalog.map((t) => {
                        const on = draft.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={on ? "btn" : "btn btn--secondary"}
                            aria-pressed={on}
                            disabled={busy || (!on && draft.length >= need)}
                            onClick={() => setDraft((d) => (on ? d.filter((x) => x !== t.id) : [...d, t.id]))}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="fr-host-chips">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || draft.length !== need}
                        onClick={() => {
                          setEditing(null);
                          void run(() => hostChoose(latest.current, content, answers, pid, draft));
                        }}
                      >
                        Сохранить
                      </button>
                      {choice && (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy}
                          onClick={() => {
                            setEditing(null);
                            void run(() => hostChoose(latest.current, content, answers, pid, []));
                          }}
                        >
                          Снять выбор
                        </button>
                      )}
                      <button type="button" className="btn btn--quiet" onClick={() => setEditing(null)}>
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {status.overflow.length > 0 && (
          <p className="error" role="status">
            Команд больше {MAX_TEAMS}: не попадут в игру — {status.overflow.map(name).join(", ")}. Объедините команды или уберите лишние в «Гостях».
          </p>
        )}
        <section className="stack stack--tight">
          <p className="eyebrow">В колесе: {status.sectors.length > 0 ? status.sectors.map(themeName).join(", ") : "пока пусто"}</p>
          {(short || r.added.length > 0) && (
            <>
              <p className="muted small">{short ? "Нужно хотя бы 3 темы — добавьте из каталога:" : "Темы, добавленные вами:"}</p>
              <div className="fr-host-chips">
                {catalog
                  .filter((t) => r.added.includes(t.id) || (short && !status.sectors.includes(t.id)))
                  .map((t) => {
                    const on = r.added.includes(t.id);
                    return (
                      <button key={t.id} type="button" className={on ? "btn" : "btn btn--secondary"} aria-pressed={on} disabled={busy} onClick={() => void run(() => hostToggleAdded(latest.current, content, answers, t.id))}>
                        {on ? "✓ " : "+ "}
                        {t.name}
                      </button>
                    );
                  })}
              </div>
            </>
          )}
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          {status.problems.length > 0 && <p className="muted small">{status.problems.join(" ")}</p>}
          <button type="button" className="btn btn--block host-quiz__primary" disabled={busy || status.problems.length > 0} onClick={() => void toWheel()}>
            К колесу
          </button>
        </div>
      </div>
    );
  }

  const back = backToThemes(session);
  return (
    <div className="stack host-quiz">
      <p className="eyebrow">Рулетка судьбы{r.turn ? " · ход " + r.turn.n + " · круг " + r.turn.round + " из " + content.rounds : ""}</p>
      <div className="card stack stack--tight">
        <p>
          Колесо: <strong>{r.sectors.map(themeName).join(", ")}</strong>
        </p>
        <p>
          Очередь: {r.order.map(name).join(" → ")}
        </p>
        <p>
          Крутит: <strong><NameText name={name(r.turn?.team)} /></strong>
        </p>
        <p className="muted small">Вращение колеса и задания появятся на следующем этапе разработки.</p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--secondary btn--block" disabled={busy || back === null} onClick={() => back && void run(() => back.change, back.clearAnswers)}>
          Назад к выбору тем
        </button>
      </div>
    </div>
  );
}
