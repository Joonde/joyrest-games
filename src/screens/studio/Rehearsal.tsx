import { Suspense, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { applyChange, startState } from "../../core/session";
import { roundLeaderboard } from "../../core/rounds";
import { gamesRepo, permissions, useLoad, type Game, type Session, type UserProfile } from "../../data";
import { Podium } from "../../components/live/Podium";
import { PeekCard } from "../../components/live/PeekCard";
import { Scene } from "../../components/live/Scene";
import { useSoundUnlock } from "../../components/live/sound";
import { BoardView } from "../../components/live/BoardView";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { LoadFailed, Message, Pending } from "../../components/Status";
import { TopBar } from "../../components/TopBar";
import { getMechanic, validateGame } from "../../mechanics/registry";
import type { SessionControl } from "../../mechanics/types";
import type { Participant } from "../../data";
import { rehearsalParticipants } from "./rehearsalTeams";
import { themeStyle } from "../../themes/registry";

export function Rehearsal() {
  const { gameId = "" } = useParams();
  return (
    <HostGate skeleton={<StudioSkeleton />}>{(_user, profile) => <RehearsalLoader gameId={gameId} profile={profile} />}</HostGate>
  );
}

function RehearsalLoader({ gameId, profile }: { gameId: string; profile: UserProfile }) {
  const [state, retry] = useLoad(() => gamesRepo.get(gameId), [gameId]);
  if (state.status === "loading") return <Pending skeleton={<StudioSkeleton />} label="Готовим репетицию" />;
  if (state.status === "error") return <LoadFailed onRetry={retry} />;
  const game = state.data;
  if (!game || !permissions.canReadGame(profile, game)) return <Message title="Игра не найдена">Возможно, её удалили.</Message>;
  const errors = validateGame(game.mechanic, game.content);
  if (errors.length > 0) {
    return (
      <Message title="Репетиция пока невозможна">
        <p>{errors[0]?.message}</p>
        <div className="actions">
          <Link className="btn btn--block" to={`/studio/games/${game.id}`}>
            Открыть игру
          </Link>
        </div>
      </Message>
    );
  }
  return <RehearsalRun game={game} hostId={profile.uid} launchable={permissions.canLaunchGame(profile, game)} />;
}

/** Сессия в памяти: тот же пульт и тот же экран зала, но без гостей и без записи в базу. */
function initialSession(game: Game, hostId: string): Session {
  return {
    id: "rehearsal",
    code: "000000",
    hostId,
    gameId: game.id,
    gameTitle: game.title,
    mechanic: game.mechanic,
    gameSnapshot: null,
    themeId: game.themeId,
    playMode: game.playMode,
    screenMode: "laptop",
    state: startState(),
    leaderboard: {},
    createdAt: Date.now(),
  };
}

function RehearsalRun({ game, hostId, launchable }: { game: Game; hostId: string; launchable: boolean }) {
  const mechanic = getMechanic(game.mechanic);
  const content = useMemo(() => (mechanic ? mechanic.parse(game.content) : null), [mechanic, game.content]);
  const [session, setSession] = useState(() => initialSession(game, hostId));
  // Игры по очереди команд без участников не начать — на репетиции за них играют тестовые команды.
  const demo: Participant[] = useMemo(() => rehearsalParticipants(game.mechanic, game.playMode), [game.mechanic, game.playMode]);
  // Звуки и фрагменты «Угадай мелодию» на репетиции — после первого касания, как на экране зала.
  useSoundUnlock();
  const control: SessionControl = useMemo(
    () => ({
      apply: async (change) => setSession((s) => applyChange(s, change, Date.now())),
      clearAnswers: async () => undefined,
      freshAnswers: async () => [],
      requestFinish: () => setSession((s) => ({ ...s, state: { ...s.state, phase: "finished" } })),
    }),
    [],
  );
  if (!mechanic || content === null) return <Message title="Механика не поддерживается" />;
  const { ScreenView, HostControls } = mechanic;
  const finished = session.state.phase === "finished";

  return (
    <main className="page page--wide">
      <TopBar title="Репетиция" actions={[{ label: "К игре", to: `/studio/games/${game.id}` }]} leaveWarning="Репетиция закончится, её можно начать заново." />
      <p className="muted small">
        Прогон игры без гостей: ничего не сохраняется, никто не подключается. Так игра пойдёт на экране зала и на пульте.
      </p>
      <div className="rehearsal">
        <section className="rehearsal__screen" aria-label="Экран зала">
          <p className="eyebrow">Экран зала</p>
          <div className="preview-screen" style={themeStyle(game.themeId)}>
            <Scene themeId={game.themeId} />
            {finished ? (
              <div className="quiz-screen quiz-screen--board">
                <BoardView leaderboard={session.leaderboard} title="Игра завершена" />
              </div>
            ) : session.state.peek ? (
              // «Таблица очков на экран» — как на настоящем экране зала (HallScreen).
              <div className="quiz-screen quiz-screen--board">
                <BoardView
                  leaderboard={session.state.peek === "round" ? roundLeaderboard(session.leaderboard) : session.leaderboard}
                  title={session.state.peek === "round" ? "Счёт текущего раунда" : "Таблица сейчас"}
                  showLast={false}
                  showMoves={session.state.peek === "total"}
                />
              </div>
            ) : session.state.stage === "podium" ? (
              <Podium session={session} />
            ) : (
              <ScreenView session={session} content={content} />
            )}
          </div>
        </section>
        <section className="card rehearsal__console" aria-label="Пульт">
          <p className="eyebrow">Пульт</p>
          {finished ? (
            <>
              <h2>Репетиция закончена</h2>
              <div className="actions">
                <button type="button" className="btn btn--block" onClick={() => setSession(initialSession(game, hostId))}>
                  Начать заново
                </button>
                {launchable && (
                  <Link className="btn btn--secondary btn--block" to={`/studio/launch/${game.id}`}>
                    Запустить игру
                  </Link>
                )}
              </div>
            </>
          ) : (
            <Suspense fallback={null}>
              {!mechanic.ownPeek && session.state.phase === "playing" && <PeekCard session={session} onApply={control.apply} />}
              <HostControls session={session} content={content} answers={[]} participants={demo} control={control} rehearsal />
            </Suspense>
          )}
        </section>
      </div>
    </main>
  );
}
