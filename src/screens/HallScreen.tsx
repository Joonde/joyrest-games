import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { sortedLeaderboard } from "../core/leaderboard";
import { ensureSignedIn, useSessionByCode, type Session } from "../data";
import { QrCode } from "../components/QrCode";
import { Loading, Message } from "../components/Status";
import { joinHint, playUrl } from "../components/links";

export function HallScreen() {
  const { code = "" } = useParams();
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    ensureSignedIn()
      .then(() => setReady(true))
      .catch(() => setAuthError(true));
  }, []);

  const state = useSessionByCode(code, ready);

  if (authError) return <Message title="Нет связи">Проверьте интернет и обновите страницу.</Message>;
  if (!ready || state.status === "loading") return <Loading text="Подключаем экран…" />;
  if (state.status === "notFound") return <Message title="Сессия не найдена">Проверьте код: {code}</Message>;
  if (state.status === "error") return <Message title="Ошибка">{state.message}</Message>;
  return <Screen session={state.session} />;
}

function Screen({ session }: { session: Session }) {
  const board = sortedLeaderboard(session.leaderboard);
  const names = board.map((e) => e.name);

  if (session.state.phase === "finished") {
    return (
      <main className="page page--wide">
        <h1 className="screen-title">Игра завершена</h1>
        <ol className="list">
          {board.map((e) => (
            <li key={e.id}>
              <span>{e.name}</span>
              <strong>{e.score}</strong>
            </li>
          ))}
        </ol>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="stack">
        <h1 className="screen-title">
          {session.state.phase === "playing" ? "Игра идёт" : "Присоединяйтесь к игре"}
        </h1>
        <p className="muted" style={{ fontSize: "clamp(18px, 2vw, 32px)", margin: 0 }}>
          Отсканируйте QR-код или откройте {joinHint()} и введите код
        </p>
        <div className="big-code">{formatSessionCode(session.code)}</div>
        <p className="muted" style={{ fontSize: "clamp(18px, 2vw, 28px)" }}>
          {session.playMode === "teams" ? "Команд" : "Игроков"}: {names.length}
        </p>
        <div className="chips" aria-live="polite">
          {names.map((name, i) => (
            <span key={`${name}-${i}`} className="chip">
              {name}
            </span>
          ))}
        </div>
      </div>
      <QrCode value={playUrl(session.code)} label={`QR-код для входа в игру ${session.code}`} />
    </main>
  );
}
