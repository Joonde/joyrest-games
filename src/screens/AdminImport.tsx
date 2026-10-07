import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { authService, firebaseImport, NotOwnerError, permissions, type ImportProgress, type ImportReport, type ImportStage, type UserProfile } from "../data";
import { gameMediaIds } from "../mechanics/registry";
import { HostGate } from "../components/HostGate";
import { useWakeLock } from "../components/live/useWakeLock";
import { StudioSkeleton } from "../components/Skeleton";
import { TopBar } from "../components/TopBar";

/** Перенос из Firebase на свой сервер (PR 5): только владелец агентства, только свой сервер. */
export function AdminImport() {
  return (
    <HostGate requireAdmin skeleton={<StudioSkeleton />}>
      {(_user, profile) => <ImportContent profile={profile} />}
    </HostGate>
  );
}

const STAGES: Array<{ stage: ImportStage; label: string }> = [
  { stage: "signin", label: "Вход в Firebase" },
  { stage: "users", label: "Ведущие" },
  { stage: "games", label: "Игры" },
  { stage: "media", label: "Картинки" },
  { stage: "results", label: "История игр" },
  { stage: "verify", label: "Сверка" },
];

const KIND_LABELS: Record<ImportReport["counts"][number]["kind"], string> = {
  users: "Ведущие",
  games: "Игры",
  media: "Картинки",
  results: "Итоги игр",
};

type RunState =
  | { status: "form"; error: string | null }
  | { status: "running"; progress: ImportProgress }
  | { status: "done"; report: ImportReport };

function ImportContent({ profile }: { profile: UserProfile }) {
  const [state, setState] = useState<RunState>({ status: "form", error: null });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  useWakeLock(state.status === "running");

  const header = <TopBar title="Перенос из Firebase" actions={[{ label: "К ведущим", to: "/admin" }]} />;

  if (!firebaseImport || !permissions.canImportFromFirebase(profile)) {
    return (
      <main className="page">
        {header}
        <section className="card">
          <h2>Перенос недоступен</h2>
          <p className="muted">
            {firebaseImport
              ? "Переносить данные может только владелец агентства."
              : "Перенос работает только на новом сервере (games.joy-rest.ru)."}
          </p>
        </section>
      </main>
    );
  }
  const importer = firebaseImport;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setState({ status: "running", progress: { stage: "signin", done: 0, total: 1 } });
    try {
      const report = await importer.run(email, password, gameMediaIds, (progress) => setState({ status: "running", progress }));
      setPassword("");
      setState({ status: "done", report });
    } catch (error) {
      setState({
        status: "form",
        error: error instanceof NotOwnerError ? "Войдите аккаунтом владельца агентства — тем же, что в Firebase-версии." : authService.describeError(error),
      });
    }
  }

  return (
    <main className="page">
      {header}

      {state.status === "form" && (
        <form className="card" onSubmit={onSubmit}>
          <h2>Перенести данные из Firebase</h2>
          <p>
            Ведущие, игры с картинками и история игр скопируются на новый сервер. В Firebase ничего не меняется. Запускать
            можно сколько угодно раз: повтор обновит данные без дублей и не затрёт правки, сделанные уже здесь.
          </p>
          <p className="muted small">
            Войдите аккаунтом владельца так же, как в старой версии. Пароль нужен только Firebase и нигде не сохраняется.
          </p>
          <label className="field">
            Почта в Firebase
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            Пароль в Firebase
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {state.error && (
            <p className="error" role="alert">
              {state.error}
            </p>
          )}
          <button className="btn btn--block" type="submit">
            Перенести
          </button>
        </form>
      )}

      {state.status === "running" && <ProgressCard progress={state.progress} />}

      {state.status === "done" && (
        <ReportCard report={state.report} onAgain={() => setState({ status: "form", error: null })} />
      )}
    </main>
  );
}

function ProgressCard({ progress }: { progress: ImportProgress }) {
  const current = STAGES.findIndex((s) => s.stage === progress.stage);
  return (
    <section className="card" aria-live="polite">
      <h2>Переносим…</h2>
      <p className="muted">Не закрывайте вкладку и не блокируйте телефон, пока перенос не закончится.</p>
      <ol className="import-steps">
        {STAGES.map((step, index) => {
          const status = index < current ? "done" : index === current ? "active" : "wait";
          return (
            <li key={step.stage} className={`import-steps__item import-steps__item--${status}`}>
              <span>{step.label}</span>
              <span className="small">
                {status === "done" && "готово"}
                {status === "active" && (progress.total > 1 ? `${progress.done} из ${progress.total}` : "…")}
              </span>
            </li>
          );
        })}
      </ol>
      {progress.total > 1 && <progress className="import-progress" max={progress.total} value={progress.done} />}
    </section>
  );
}

function ReportCard({ report, onAgain }: { report: ImportReport; onAgain: () => void }) {
  const allMatch = report.counts.every((c) => c.server >= c.firebase);
  return (
    <section className="card" aria-live="polite">
      <h2>{allMatch ? "Перенос закончен" : "Перенесено не всё"}</h2>
      <table className="import-table">
        <thead>
          <tr>
            <th scope="col">Что</th>
            <th scope="col">В Firebase</th>
            <th scope="col">Здесь</th>
          </tr>
        </thead>
        <tbody>
          {report.counts.map((c) => (
            <tr key={c.kind}>
              <th scope="row">{KIND_LABELS[c.kind]}</th>
              <td>{c.firebase}</td>
              <td className={c.server >= c.firebase ? "success" : "error"}>
                {c.server}
                {c.server >= c.firebase ? " ✓" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!allMatch && (
        <p className="error">Часть данных не перенеслась. Нажмите «Перенести ещё раз» — повтор доносит недостающее.</p>
      )}
      {report.withoutPassword > 0 && (
        <p>
          Ведущих без пароля: {report.withoutPassword}. Пароли Firebase не переносятся — на странице «Ведущие» у них
          написано «пароль не выдан». Выдайте каждому «⋯ → Новый временный пароль».
        </p>
      )}
      {report.skippedHosts.length > 0 && (
        <>
          <p>Эти ведущие не перенесены: их почта уже занята другим аккаунтом здесь или не указана.</p>
          <ul className="small">
            {report.skippedHosts.map((h) => (
              <li key={`${h.email}-${h.name}`}>
                {h.name} — {h.email || "почта не указана"}
              </li>
            ))}
          </ul>
        </>
      )}
      {report.lostImages > 0 && (
        <p className="muted small">
          Картинок не нашлось в Firebase или они повреждены: {report.lostImages}. В этих вопросах картинку нужно загрузить заново.
        </p>
      )}

      <div className="actions">
        <Link className="btn btn--block" to="/admin">
          К ведущим
        </Link>
        <button type="button" className="btn btn--secondary btn--block" onClick={onAgain}>
          Перенести ещё раз
        </button>
      </div>
    </section>
  );
}
