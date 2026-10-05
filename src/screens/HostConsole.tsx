import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { leaderboardAdditions, sortedLeaderboard } from "../core/leaderboard";
import {
  setSessionPhase,
  upsertLeaderboardEntries,
  useSessionByCode,
  watchParticipants,
  type AuthUser,
  type Participant,
  type Session,
  type SessionPhase,
} from "../data";
import { HostGate } from "../components/HostGate";
import { QrCode } from "../components/QrCode";
import { Loading, Message } from "../components/Status";
import { TopBar } from "../components/TopBar";
import { playUrl } from "../components/links";
import { teamColorVar, useTheme } from "../themes/registry";

export function HostConsole() {
  const { code = "" } = useParams();
  return <HostGate>{(user) => <HostConsoleContent code={code} user={user} />}</HostGate>;
}

function HostConsoleContent({ code, user }: { code: string; user: AuthUser }) {
  const state = useSessionByCode(code);

  if (state.status === "loading") return <Loading text="Открываем пульт…" />;
  if (state.status === "notFound") return <Message title="Сессия не найдена">Проверьте код: {code}</Message>;
  if (state.status === "error") return <Message title="Ошибка">{state.message}</Message>;
  if (state.session.hostId !== user.uid) {
    return <Message title="Чужая сессия">Эту сессию запускал другой ведущий.</Message>;
  }
  return <Console session={state.session} />;
}

function Console({ session }: { session: Session }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = playUrl(session.code);
  useTheme(session.themeId);

  // Ответы и участников слушает только пульт.
  useEffect(
    () => watchParticipants(session.id, setParticipants, () => setError("Потеряна связь. Обновите страницу.")),
    [session.id],
  );

  // Экран зала и гости слушают только документ сессии, поэтому новые участники
  // попадают туда через таблицу лидеров.
  useEffect(() => {
    const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
    if (Object.keys(additions).length > 0) {
      upsertLeaderboardEntries(session.id, additions).catch(() => setError("Не удалось обновить список игроков."));
    }
  }, [participants, session.id, session.leaderboard, session.playMode]);

  async function changePhase(phase: SessionPhase) {
    setBusy(true);
    setError(null);
    try {
      await setSessionPhase(session.id, phase);
    } catch {
      setError("Не удалось обновить сессию. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const board = sortedLeaderboard(session.leaderboard);
  const phones = participants.filter((p) => p.kind === "player").length;

  return (
    <main className="page">
      <TopBar title="Пульт" eyebrow="JoyRest Games">
        <Link className="btn btn--ghost btn--small" to="/studio">
          В студию
        </Link>
      </TopBar>

      <section className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <p className="eyebrow">Код игры</p>
        <div className="big-code">{formatSessionCode(session.code)}</div>
        <QrCode value={link} label={`QR-код для входа в игру ${session.code}`} />
        <p className="muted" style={{ wordBreak: "break-all" }}>
          {link}
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn btn--secondary" onClick={() => void copyLink()}>
            {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
          </button>
          {session.screenMode !== "none" && (
            <Link className="btn btn--secondary" to={`/screen/${session.code}`} target="_blank">
              Открыть экран зала
            </Link>
          )}
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
        {session.state.phase === "finished" && <p>Игра завершена.</p>}
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

    </main>
  );
}
