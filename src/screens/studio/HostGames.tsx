/**
 * «Итоги игр» человека для владельца (`/studio/host-games?uid=`, решение владельца 16 октября 2026; «⋯ → Итоги игр» на
 * карточке в «Команде» и в «Управлении»): сводка, ближайшие закреплённые за ним мероприятия (планировщик, только свой
 * сервер) и прошедшие игры (итоги из «Истории игр»). Логика — `src/core/hostOverview.ts`.
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { dayTitle, rangeLabel } from "../../core/calendar";
import { formatDate } from "../../core/format";
import { hostGamesSummary, recentResults, upcomingOf } from "../../core/hostOverview";
import { experienceLabel, levelTitle } from "../../core/levels";
import { eventsRepo, permissions, resultsRepo, useLoad, usersRepo, type AgencyEvent, type HostAccount, type UserProfile } from "../../data";
import { HostGate } from "../../components/HostGate";
import { ListSkeleton, StudioSkeleton } from "../../components/Skeleton";
import { LoadFailedInline } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { ResultCard } from "./History";
import { studioActions } from "./Studio";

const PAGE = 10;

export function HostGames() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page">
          <TopBar title="Итоги игр" actions={[{ label: "К команде", to: "/studio/team?tab=manage" }, ...studioActions(profile)]} />
          {permissions.canManageHosts(profile) ? <HostGamesFor profile={profile} /> : <p className="muted">Этот раздел — только для владельца JoyRest.</p>}
        </main>
      )}
    </HostGate>
  );
}

function HostGamesFor({ profile }: { profile: UserProfile }) {
  const [params] = useSearchParams();
  const uid = params.get("uid") ?? "";
  const [people, retryPeople] = useLoad(() => usersRepo.listHosts(), []);
  if (!uid) return <p className="muted">Не выбран человек. Откройте «Итоги игр» из «⋯» на его карточке.</p>;
  if (people.status === "loading") return <ListSkeleton />;
  if (people.status === "error") return <LoadFailedInline onRetry={retryPeople} />;
  const host = people.data.find((h) => h.uid === uid);
  if (!host) return <p className="muted">Человек не найден.</p>;
  return <Overview host={host} owner={profile} />;
}

function Overview({ host, owner }: { host: HostAccount; owner: UserProfile }) {
  const [results, retryResults] = useLoad(() => resultsRepo.listByHost(host.uid), [host.uid]);
  const withEvents = eventsRepo !== null && permissions.canManageEvents(owner);
  const [events, retryEvents] = useLoad(() => (eventsRepo && withEvents ? eventsRepo.list("upcoming") : Promise.resolve<AgencyEvent[]>([])), [withEvents]);
  const [shown, setShown] = useState(PAGE);
  const [toast, showToast] = useToast();
  const now = Date.now();

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(done);
    } catch {
      showToast("Не удалось скопировать");
    }
  }

  const summary = results.status === "ready" ? hostGamesSummary(results.data, now) : null;
  const upcoming = events.status === "ready" ? upcomingOf(events.data, host.uid, now) : [];
  const recent = results.status === "ready" ? recentResults(results.data, shown) : [];

  return (
    <>
      <section className="card stack stack--tight" aria-labelledby="host-games-name">
        <h1 id="host-games-name">{host.name || "Без имени"}</h1>
        <ul className="meta">
          {!host.active && <li className="error">доступ отключён</li>}
          {host.level !== undefined && <li>{levelTitle(host.level) ?? "Без квалификации"}</li>}
          {host.experienceSince ? <li>Стаж: {experienceLabel(host.experienceSince, now)}</li> : null}
          {typeof host.points === "number" && <li>{host.points} баллов</li>}
        </ul>
        {summary && (
          <dl className="host-games__stats">
            <div>
              <dt>Игр всего</dt>
              <dd>{summary.games}</dd>
            </div>
            <div>
              <dt>За 30 дней</dt>
              <dd>{summary.last30}</dd>
            </div>
            <div>
              <dt>Гостей всего</dt>
              <dd>{summary.guests}</dd>
            </div>
            <div>
              <dt>В среднем</dt>
              <dd>{summary.average}</dd>
            </div>
          </dl>
        )}
        {summary?.lastPlayedAt ? <p className="muted small">Последняя игра — {formatDate(summary.lastPlayedAt)}.</p> : null}
      </section>

      {withEvents && (
        <section className="card stack stack--tight" aria-labelledby="host-games-upcoming">
          <h2 id="host-games-upcoming">Ближайшие мероприятия</h2>
          {events.status === "loading" && <ListSkeleton />}
          {events.status === "error" && <LoadFailedInline onRetry={retryEvents} />}
          {events.status === "ready" && upcoming.length === 0 && <p className="muted">За ним пока ничего не закреплено.</p>}
          {upcoming.length > 0 && (
            <ul className="list">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <span className="stack stack--none">
                    <span className="line-clamp">
                      {e.title || "Мероприятие"}
                      {e.guests ? ` · ${e.guests} гостей` : ""}
                    </span>
                    <span className="muted small">
                      {dayTitle(e.day)}, {rangeLabel(e.start, e.end)}
                      {e.place ? ` · ${e.place}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link className="btn btn--secondary btn--block" to="/studio/calendar?tab=events">
            Все мероприятия
          </Link>
        </section>
      )}

      <section className="card">
        <h2>Прошедшие игры</h2>
        <p className="muted">Итоги сохраняются, когда ведущий завершает игру на пульте. Новые — сверху.</p>
      </section>
      {results.status === "loading" && <ListSkeleton />}
      {results.status === "error" && <LoadFailedInline onRetry={retryResults} />}
      {results.status === "ready" && results.data.length === 0 && <p className="muted empty">Прошедших игр пока нет.</p>}
      {recent.length > 0 && (
        <ul className="cards" aria-label="Прошедшие игры">
          {recent.map((result) => (
            <li key={result.id}>
              <ResultCard result={result} onCopy={copy} />
            </li>
          ))}
        </ul>
      )}
      {results.status === "ready" && results.data.length > shown && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => setShown((n) => n + PAGE)}>
          Показать ещё {Math.min(PAGE, results.data.length - shown)}
        </button>
      )}
      <Toast text={toast} />
    </>
  );
}
