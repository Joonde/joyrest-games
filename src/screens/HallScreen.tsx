import type { CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { sortedLeaderboard } from "../core/leaderboard";
import { useGuestSignIn, useSessionByCode, type Session } from "../data";
import { Logo } from "../components/Logo";
import { QrCode } from "../components/QrCode";
import { ScreenSkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { joinHint, playUrl } from "../components/links";
import { teamColorVar, useTheme } from "../themes/registry";

export function HallScreen() {
  const { code = "" } = useParams();
  const [auth, retryAuth] = useGuestSignIn();
  const [state, retry] = useSessionByCode(code, { enabled: auth.status === "ready" });

  if (auth.status === "error") return <LoadFailed onRetry={retryAuth} />;
  if (auth.status === "loading" || state.status === "loading") {
    return (
      <Pending
        skeleton={<ScreenSkeleton />}
        onRetry={auth.status === "loading" ? retryAuth : retry}
        label="Подключаем экран"
      />
    );
  }
  if (state.status === "notFound") return <Message title="Сессия не найдена">Проверьте код: {code}</Message>;
  if (state.status === "error") return <LoadFailed onRetry={retry}>{state.message}</LoadFailed>;
  return <Screen session={state.session} />;
}

function teamStyle(colorIndex: number | undefined): CSSProperties {
  return { "--team-color": teamColorVar(colorIndex) } as CSSProperties;
}

function Screen({ session }: { session: Session }) {
  useTheme(session.themeId);
  const board = sortedLeaderboard(session.leaderboard);
  const teams = session.playMode === "teams";

  if (session.state.phase === "finished") {
    return (
      <main className="screen-center">
        <Logo kind="monogram" className="logo--corner" title="" />
        <h1 className="screen-title">Игра завершена</h1>
        <ol className="list" style={{ width: "min(720px, 100%)", fontSize: "clamp(18px, 2vw, 30px)" }}>
          {board.map((e) => (
            <li key={e.id}>
              <span>
                {e.kind === "team" && <span className="team-dot" style={teamStyle(e.colorIndex)} aria-hidden />}
                {e.name}
              </span>
              <strong>{e.score}</strong>
            </li>
          ))}
        </ol>
      </main>
    );
  }

  if (session.state.phase === "playing") {
    // Содержимое шагов покажет механика; монограмма остаётся в углу.
    return (
      <main className="screen-center">
        <Logo kind="monogram" className="logo--corner" title="" />
        <h1 className="screen-title">Игра идёт</h1>
        <p className="screen-text">Смотрите на экран и отвечайте с телефона</p>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="screen__brand">
        <Logo kind="emblem" className="logo--splash" />
      </div>
      <div className="screen__join">
        <h1 className="screen-title">Присоединяйтесь к игре</h1>
        <p className="screen-text">Отсканируйте QR-код или откройте {joinHint()} и введите код</p>
        <div className="screen__code">
          <div className="big-code">{formatSessionCode(session.code)}</div>
          <QrCode value={playUrl(session.code)} label={`QR-код для входа в игру ${formatSessionCode(session.code)}`} />
        </div>
        <p className="screen-text">
          {teams ? "Команд" : "Игроков"}: {board.length}
        </p>
        <div className="chips" aria-live="polite">
          {board.map((e) => (
            <span
              key={e.id}
              className={e.kind === "team" ? "chip chip--team" : "chip"}
              style={e.kind === "team" ? teamStyle(e.colorIndex) : undefined}
            >
              {e.name}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}
