import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { gameSnapshot } from "../../core/games";
import {
  gamesRepo,
  permissions,
  sessionsRepo,
  useLoad,
  type Game,
  type PlayMode,
  type ScreenMode,
  type UserProfile,
} from "../../data";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { LoadFailed, Message, Pending } from "../../components/Status";
import { TopBar } from "../../components/TopBar";
import { getMechanic } from "../../mechanics/registry";
import { getTheme, themesForRating } from "../../themes/registry";

const SCREEN_MODES: Array<{ id: ScreenMode; title: string; hint: string }> = [
  { id: "laptop", title: "Ноутбук + экран", hint: "Экран зала на ноутбуке, управление с ноутбука или телефона." },
  { id: "remote", title: "Телефон-пульт + отдельный экран", hint: "Экран зала открыт на любом устройстве." },
  { id: "none", title: "Без экрана", hint: "Вопросы на телефонах гостей, вы читаете вслух." },
];

const PLAY_MODES: Array<{ id: PlayMode; title: string; hint: string }> = [
  { id: "solo", title: "Каждый сам за себя", hint: "Каждый гость играет со своего телефона." },
  { id: "teams", title: "Команды", hint: "Отвечает капитан, остальные видят вопрос." },
];

const THEME_HINTS: Record<string, string> = {
  joyrest: "Тёмное, для вечера и затемнённого зала.",
  "joyrest-day": "Светлое, для дневных мероприятий и яркого света.",
};

export function Launch() {
  const { gameId = "" } = useParams();
  return (
    <HostGate skeleton={<StudioSkeleton />}>{(_user, profile) => <LaunchLoader gameId={gameId} profile={profile} />}</HostGate>
  );
}

function LaunchLoader({ gameId, profile }: { gameId: string; profile: UserProfile }) {
  const [state, retry] = useLoad(() => gamesRepo.get(gameId), [gameId]);
  if (state.status === "loading") return <Pending skeleton={<StudioSkeleton />} onRetry={retry} label="Готовим запуск" />;
  if (state.status === "error") return <LoadFailed onRetry={retry} />;
  const game = state.data;
  if (!game || !permissions.canLaunchGame(profile, game)) {
    return (
      <Message title="Игра не найдена">
        <p>Возможно, её удалили.</p>
        <div className="actions">
          <Link className="btn btn--block" to="/studio">
            В студию
          </Link>
        </div>
      </Message>
    );
  }
  return <LaunchForm game={game} profile={profile} />;
}

function LaunchForm({ game, profile }: { game: Game; profile: UserProfile }) {
  const navigate = useNavigate();
  const supports = getMechanic(game.mechanic)?.supports ?? { solo: true, teams: true, noScreen: true };
  const screenModes = SCREEN_MODES.filter((m) => m.id !== "none" || supports.noScreen);
  const playModes = PLAY_MODES.filter((m) => supports[m.id]);
  const themeChoices = themesForRating(game.ageRating);
  const [screenMode, setScreenMode] = useState<ScreenMode>(screenModes[0]?.id ?? "laptop");
  const [playMode, setPlayMode] = useState<PlayMode>(playModes[0]?.id ?? "solo");
  const [themeId, setThemeId] = useState(getTheme(game.themeId).id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Игра копируется в сессию: правка в студии не ломает идущую игру.
      const { code } = await sessionsRepo.create(profile.uid, {
        gameId: game.id,
        gameTitle: game.title,
        mechanic: game.mechanic,
        gameSnapshot: gameSnapshot(game),
        themeId,
        playMode,
        screenMode,
      });
      navigate(`/host/${code}`);
    } catch {
      setError("Не удалось создать сессию. Проверьте интернет и попробуйте снова.");
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <TopBar title="Запуск" actions={[{ label: "В студию", to: "/studio" }]} />
      <form className="card" onSubmit={onSubmit}>
        <div className="stack stack--tight">
          <p className="eyebrow">Новая сессия</p>
          <h2>{game.title}</h2>
        </div>
        <fieldset>
          <legend>Как проводим</legend>
          {screenModes.map((mode) => (
            <label key={mode.id} className="choice">
              <input type="radio" name="screenMode" checked={screenMode === mode.id} onChange={() => setScreenMode(mode.id)} />
              <span className="choice__text">
                <span className="choice__title">{mode.title}</span>
                <span className="choice__hint">{mode.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Участники</legend>
          {playModes.map((mode) => (
            <label key={mode.id} className="choice">
              <input type="radio" name="playMode" checked={playMode === mode.id} onChange={() => setPlayMode(mode.id)} />
              <span className="choice__text">
                <span className="choice__title">{mode.title}</span>
                <span className="choice__hint">{mode.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Оформление</legend>
          {themeChoices.map((theme) => (
            <label key={theme.id} className="choice">
              <input type="radio" name="themeId" checked={themeId === theme.id} onChange={() => setThemeId(theme.id)} />
              <span className="choice__text">
                <span className="choice__title">{theme.title}</span>
                <span className="choice__hint">{THEME_HINTS[theme.id] ?? ""}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--block" type="submit" disabled={busy}>
          {busy ? "Создаём…" : "Создать сессию"}
        </button>
      </form>
    </main>
  );
}
