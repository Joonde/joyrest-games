import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { leaderboardAdditions, sortedLeaderboard } from "../core/leaderboard";
import {
  participantsRepo,
  permissions,
  sessionsRepo,
  useSessionByCode,
  type AuthUser,
  type Participant,
  type Session,
  type SessionPhase,
} from "../data";
import { HostGate } from "../components/HostGate";
import { QrCode } from "../components/QrCode";
import { ConsoleSkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { Toast, useToast } from "../components/Toast";
import { TopBar } from "../components/TopBar";
import { playUrl, playUrlHint } from "../components/links";
import { teamColorVar, useTheme } from "../themes/registry";

export function HostConsole() {
  const { code = "" } = useParams();
  return (
    <HostGate skeleton={<ConsoleSkeleton />}>{(user) => <HostConsoleContent code={code} user={user} />}</HostGate>
  );
}

function HostConsoleContent({ code, user }: { code: string; user: AuthUser }) {
  const [state, retry] = useSessionByCode(code, { hostId: user.uid });

  if (state.status === "loading") return <Pending skeleton={<ConsoleSkeleton />} onRetry={retry} label="Открываем пульт" />;
  if (state.status === "notFound") return <Message title="Сессия не найдена">Проверьте код: {code}</Message>;
  if (state.status === "error") return <LoadFailed onRetry={retry}>{state.message}</LoadFailed>;
  if (!permissions.canControlSession(user.uid, state.session)) {
    return <Message title="Чужая сессия">Эту сессию запускал другой ведущий.</Message>;
  }
  return <Console session={state.session} />;
}

function Console({ session }: { session: Session }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const link = playUrl(session.code);
  const phones = participants.filter((p) => p.kind === "player").length;
  useTheme(session.themeId);

  // Ответы и участников слушает только пульт.
  useEffect(
    () => participantsRepo.watch(session.id, setParticipants, () => setError("Потеряна связь. Обновите страницу.")),
    [session.id],
  );

  // Экран зала и гости слушают только документ сессии, поэтому новые участники
  // попадают туда через таблицу лидеров.
  useEffect(() => {
    const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
    if (Object.keys(additions).length > 0) {
      sessionsRepo.upsertLeaderboard(session.id, additions).catch(() => setError("Не удалось обновить список игроков."));
    }
  }, [participants, session.id, session.leaderboard, session.playMode]);

  async function changePhase(phase: SessionPhase) {
    setBusy(true);
    setError(null);
    try {
      // Завершение сразу сохраняет компактные итоги для «Истории игр».
      if (phase === "finished") await sessionsRepo.finish(session, phones);
      else await sessionsRepo.setPhase(session.id, phase);
    } catch {
      setError("Не удалось обновить сессию. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      showToast("Ссылка скопирована");
    } catch {
      showToast("Не удалось скопировать. Покажите гостям QR-код.");
    }
  }

  const board = sortedLeaderboard(session.leaderboard);

  return (
    <main className="page">
      <TopBar title="Пульт" actions={[{ label: "В студию", to: "/studio" }]} />
      {session.gameTitle && <p className="muted small line-clamp">{session.gameTitle}</p>}

      <section className="card card--center" aria-label="Вход для гостей">
        <p className="eyebrow">Код игры</p>
        <div className="big-code">{formatSessionCode(session.code)}</div>
        <QrCode value={link} label={`QR-код для входа в игру ${formatSessionCode(session.code)}`} />
        <p className="link-hint muted">{playUrlHint(session.code)}</p>
        <div className="actions">
          {session.screenMode !== "none" && (
            <Link className="btn btn--block" to={`/screen/${session.code}`} target="_blank">
              Открыть экран зала
            </Link>
          )}
          <button
            type="button"
            className={session.screenMode === "none" ? "btn btn--block" : "btn btn--secondary btn--block"}
            onClick={() => void copyLink()}
          >
            Скопировать ссылку
          </button>
        </div>
        {session.screenMode === "none" && (
          <p className="muted">Режим без экрана: покажите гостям этот QR-код со своего телефона.</p>
        )}
      </section>

      <section className="card">
        <h2>Управление</h2>
        {session.state.phase === "lobby" && (
          <button className="btn btn--block" disabled={busy} onClick={() => void changePhase("playing")}>
            Начать игру
          </button>
        )}
        {session.state.phase === "playing" && (
          <>
            <p className="success">Игра идёт. Шаги игры появятся вместе с квизом.</p>
            <button className="btn btn--block" disabled={busy} onClick={() => void changePhase("finished")}>
              Завершить игру
            </button>
          </>
        )}
        {session.state.phase === "finished" && (
          <>
            <p>Игра завершена. Итоги сохранены в «Истории игр».</p>
            <div className="actions">
              <Link className="btn btn--block" to={`/results/${session.id}`}>
                Открыть итоги
              </Link>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card">
        <h2>
          {session.playMode === "teams" ? "Команды" : "Игроки"}: {board.length}
        </h2>
        {session.playMode === "teams" && <p className="muted">Подключено телефонов: {phones}</p>}
        {board.length === 0 ? (
          <p className="muted">Пока никого. Попросите гостей отсканировать QR-код.</p>
        ) : (
          <ul className="list">
            {board.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.kind === "team" && (
                    <span
                      className="team-dot"
                      style={{ "--team-color": teamColorVar(entry.colorIndex) } as CSSProperties}
                      aria-hidden
                    />
                  )}
                  {entry.name}
                </span>
                <span className="muted">{entry.score}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Toast text={toast} />
    </main>
  );
}
