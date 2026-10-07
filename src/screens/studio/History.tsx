import { Link } from "react-router-dom";
import { formatSessionCode } from "../../core/code";
import { formatDate } from "../../core/format";
import { formatResultsText, participantsLabel } from "../../core/results";
import { resultsRepo, sessionsRepo, useLoad, type GameResult, type UserProfile } from "../../data";
import { ActionMenu } from "../../components/Menu";
import { ResultsTable } from "../../components/Results";
import { ListSkeleton } from "../../components/Skeleton";
import { LoadFailedInline, NOT_YET_TEXT } from "../../components/Status";
import { resultsUrl } from "../../components/links";
import { SESSION_RETENTION_DAYS } from "../../core/retention";

const PHASE_TITLES = { lobby: "ждёт начала", playing: "идёт" } as const;

interface Props {
  profile: UserProfile;
  onToast: (text: string) => void;
}

/** «История игр»: идущие сессии и итоги прошедших. */
export function History({ profile, onToast }: Props) {
  const [active, retryActive] = useLoad(
    () => sessionsRepo.listByHost(profile.uid).then((list) => list.filter((s) => s.state.phase !== "finished")),
    [profile.uid],
  );
  const [results, retryResults] = useLoad(() => resultsRepo.listByHost(profile.uid), [profile.uid]);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast(done);
    } catch {
      onToast("Не удалось скопировать");
    }
  }

  return (
    <>
      {active.status === "error" && (
        <LoadFailedInline onRetry={retryActive} text={active.notYet ? NOT_YET_TEXT : "Не удалось загрузить идущие сессии."} />
      )}
      {active.status === "ready" && active.data.length > 0 && (
        <section className="card">
          <h2>Сейчас идут</h2>
          <ul className="list">
            {active.data.map((s) => (
              <li key={s.id}>
                <span className="stack stack--none">
                  <span className="line-clamp">{s.gameTitle || "Без игры"}</span>
                  <span className="muted small">
                    {formatSessionCode(s.code)} · {PHASE_TITLES[s.state.phase as keyof typeof PHASE_TITLES]}
                  </span>
                </span>
                <Link className="btn btn--secondary" to={`/host/${s.code}`}>
                  Пульт
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Прошедшие игры</h2>
        <p className="muted">
          Итоги сохраняются, когда вы завершаете игру на пульте. Сами сессии с ответами хранятся{" "}
          {SESSION_RETENTION_DAYS} дней, итоги — всегда.
        </p>
      </section>

      {results.status === "loading" && <ListSkeleton />}
      {results.status === "error" && <LoadFailedInline onRetry={retryResults} text={results.notYet ? NOT_YET_TEXT : undefined} />}
      {results.status === "ready" && results.data.length === 0 && (
        <p className="muted empty">Прошедших игр пока нет.</p>
      )}
      {results.status === "ready" && results.data.length > 0 && (
        <ul className="cards" aria-label="Прошедшие игры">
          {results.data.map((result) => (
            <li key={result.id}>
              <ResultCard result={result} onCopy={copy} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ResultCard({ result, onCopy }: { result: GameResult; onCopy: (text: string, done: string) => Promise<void> }) {
  const link = resultsUrl(result.id);
  return (
    <article className="card game-card">
      <div className="game-card__head">
        <h3 className="game-card__title">
          <Link to={`/results/${result.id}`}>{result.gameTitle || "Игра без названия"}</Link>
        </h3>
        <ActionMenu
          icon="dots"
          label={`Поделиться итогами «${result.gameTitle}»`}
          actions={[
            { label: "Скопировать ссылку", onClick: () => void onCopy(link, "Ссылка на итоги скопирована") },
            {
              label: "Скопировать текстом",
              onClick: () => void onCopy(formatResultsText(result, link), "Итоги скопированы текстом"),
            },
          ]}
        />
      </div>
      <ul className="meta" aria-label="Об игре">
        {result.playedAt !== null && <li>{formatDate(result.playedAt)}</li>}
        <li>{participantsLabel(result.participantsCount)}</li>
        {result.playMode === "teams" && <li>команды</li>}
      </ul>
      <ResultsTable result={result} limit={3} />
      <div className="actions">
        <Link className="btn btn--secondary btn--block" to={`/results/${result.id}`}>
          Открыть итоги
        </Link>
      </div>
    </article>
  );
}
