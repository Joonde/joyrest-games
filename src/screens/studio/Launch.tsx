import { Fold } from "../../components/Fold";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { gameSnapshot } from "../../core/games";
import {
  gamesRepo,
  isPermanentError,
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
import { getMechanic, mechanicTitle, validateGame } from "../../mechanics/registry";
import { EVENING_MECHANIC } from "../../core/program";
import { NOT_IN_EVENING, parseEvening } from "../../mechanics/evening/content";
import { getTheme, THEME_HINTS, themesForRating, themeStyle } from "../../themes/registry";
import { Scene } from "../../components/live/Scene";

const AGE_ORDER = ["0+", "12+", "18+"];

const SCREEN_MODES: Array<{ id: ScreenMode; title: string; hint: string }> = [
  { id: "laptop", title: "С экраном зала", hint: "Ноутбук, планшет или телевизор показывают вопросы, телефон — пульт." },
  { id: "none", title: "Без экрана", hint: "Вопросы на телефонах гостей, вы читаете вслух." },
];

const PLAY_MODES: Array<{ id: PlayMode; title: string; hint: string }> = [
  { id: "solo", title: "Каждый сам за себя", hint: "Каждый гость играет со своего телефона." },
  { id: "teams", title: "Команды", hint: "Отвечает капитан, остальные видят вопрос." },
];

export function Launch() {
  const { gameId = "" } = useParams();
  return (
    <HostGate skeleton={<StudioSkeleton />}>{(_user, profile) => <LaunchLoader gameId={gameId} profile={profile} />}</HostGate>
  );
}

function LaunchLoader({ gameId, profile }: { gameId: string; profile: UserProfile }) {
  const [state, retry] = useLoad(() => gamesRepo.get(gameId), [gameId]);
  if (state.status === "loading") return <Pending skeleton={<StudioSkeleton />} label="Готовим запуск" />;
  if (state.status === "error") return <LoadFailed onRetry={retry} />;
  const game = state.data;
  if (game && permissions.canReadGame(profile, game) && !permissions.canCreateSession(profile)) {
    return (
      <Message title="Проводить игры могут только ведущие">
        <p>Вы можете открыть игру и пройти репетицию без гостей.</p>
        <div className="actions">
          <Link className="btn btn--block" to={`/studio/rehearsal/${game.id}`}>
            Репетиция без гостей
          </Link>
          <Link className="btn btn--secondary btn--block" to="/studio">
            В студию
          </Link>
        </div>
      </Message>
    );
  }
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
  const errors = validateGame(game.mechanic, game.content);
  if (errors.length > 0) {
    const fixable = permissions.canEditGame(profile, game);
    return (
      <Message title="Игру пока нельзя запустить">
        <p>{fixable ? "Исправьте в конструкторе:" : "В игре есть ошибки. Сообщите администратору агентства:"}</p>
        <ul className="error-list">
          {errors.slice(0, 5).map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
          {errors.length > 5 && <li>И ещё замечаний: {errors.length - 5}.</li>}
        </ul>
        <div className="actions">
          <Link className="btn btn--block" to={`/studio/games/${game.id}`}>
            {fixable ? "Исправить игру" : "Открыть игру"}
          </Link>
          <Link className="btn btn--secondary btn--block" to="/studio">
            В студию
          </Link>
        </div>
      </Message>
    );
  }
  if (game.mechanic === EVENING_MECHANIC) return <EveningLoader game={game} profile={profile} />;
  return <LaunchForm game={game} profile={profile} />;
}

/** Мероприятие из блоков: игры вечера загружаются и проверяются до запуска — каждая станет снимком. */
function EveningLoader({ game, profile }: { game: Game; profile: UserProfile }) {
  const refs = parseEvening(game.content).blocks;
  // Нет доступа к игре блока (чужая личная игра) — как «не найдена», а не общая ошибка загрузки.
  const [state, retry] = useLoad(
    () => Promise.all(refs.map((r) => gamesRepo.get(r.gameId).catch((e: unknown) => (isPermanentError(e) ? null : Promise.reject(e))))),
    [game.id, refs.map((r) => r.gameId).join(",")],
  );
  if (state.status === "loading") return <Pending skeleton={<StudioSkeleton />} label="Собираем вечер" />;
  if (state.status === "error") return <LoadFailed onRetry={retry} />;
  const problems: string[] = [];
  const blocks: Game[] = [];
  state.data.forEach((g, i) => {
    const title = refs[i]?.title ?? "";
    if (!g || !permissions.canLaunchGame(profile, g)) problems.push(`Блок ${i + 1}: игра «${title}» не найдена — уберите или замените её.`);
    else if (NOT_IN_EVENING.has(g.mechanic)) problems.push(`Блок ${i + 1}: «${g.title}» (${mechanicTitle(g.mechanic)}) проводится отдельно.`);
    else if (validateGame(g.mechanic, g.content).length > 0) problems.push(`Блок ${i + 1}: в игре «${g.title}» есть ошибки — откройте её в конструкторе.`);
    else blocks.push(g);
  });
  const soloOnly = blocks.filter((g) => !getMechanic(g.mechanic)?.supports.teams);
  const teamsOnly = blocks.filter((g) => !getMechanic(g.mechanic)?.supports.solo);
  if (soloOnly.length > 0 && teamsOnly.length > 0) {
    problems.push(
      `Игры не сочетаются: ${soloOnly.map((g) => `«${g.title}»`).join(", ")} — только каждый сам за себя, ${teamsOnly.map((g) => `«${g.title}»`).join(", ")} — только команды. Проведите их в разных вечерах.`,
    );
  }
  if (problems.length > 0 || !sessionsRepo.program) {
    return (
      <Message title="Вечер пока нельзя запустить">
        <ul className="error-list">
          {!sessionsRepo.program && <li>Мероприятия из блоков работают только на сервере JoyRest.</li>}
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="actions">
          <Link className="btn btn--block" to={`/studio/games/${game.id}`}>
            Открыть программу
          </Link>
          <Link className="btn btn--secondary btn--block" to="/studio">
            В студию
          </Link>
        </div>
      </Message>
    );
  }
  return <LaunchForm game={game} profile={profile} blocks={blocks} />;
}

function LaunchForm({ game, profile, blocks }: { game: Game; profile: UserProfile; blocks?: Game[] }) {
  const navigate = useNavigate();
  // Вечер из блоков: режимы, которые подходят всем его играм (одна «Мафия» — без команд).
  const supports = (blocks ?? [game]).reduce(
    (acc, g) => {
      const s = getMechanic(g.mechanic)?.supports ?? { solo: true, teams: true, noScreen: true };
      return { solo: acc.solo && s.solo, teams: acc.teams && s.teams, noScreen: acc.noScreen && s.noScreen };
    },
    { solo: true, teams: true, noScreen: true },
  );
  const screenModes = SCREEN_MODES.filter((m) => m.id !== "none" || supports.noScreen);
  const playModes = PLAY_MODES.filter((m) => supports[m.id]);
  // Вечер из блоков: оформление — по самой «взрослой» игре вечера.
  const rating = (blocks ?? [game]).map((g) => g.ageRating).reduce((a, b) => (AGE_ORDER.indexOf(b) > AGE_ORDER.indexOf(a) ? b : a), game.ageRating);
  const themeChoices = themesForRating(rating);
  const [screenMode, setScreenMode] = useState<ScreenMode>(screenModes[0]?.id ?? "laptop");
  const [playMode, setPlayMode] = useState<PlayMode>(
    playModes.some((m) => m.id === game.playMode) ? game.playMode : (playModes[0]?.id ?? "solo"),
  );
  const standalone = getMechanic(game.mechanic)?.standalone ?? null;
  const [themeId, setThemeId] = useState(standalone?.themeId ?? getTheme(game.themeId).id);
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
        ...(blocks
          ? { program: { title: game.title, blocks: blocks.map((g) => ({ title: g.title, mechanic: g.mechanic, gameId: g.id, snapshot: gameSnapshot(g) })) } }
          : {}),
      });
      // С экраном зала — сразу выбор: это устройство пульт или экран.
      navigate(screenMode === "none" ? `/host/${code}` : `/host/${code}?pick=1`);
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
          <p className="eyebrow">{blocks ? "Мероприятие из блоков" : "Новая сессия"}</p>
          <h2>{game.title}</h2>
          {blocks && (
            <ol className="ev-launch">
              {blocks.map((g, i) => (
                <li key={`${g.id}-${i}`}>
                  {g.title} <span className="muted small">· {mechanicTitle(g.mechanic)}</span>
                </li>
              ))}
            </ol>
          )}
          {blocks && <p className="muted small">Один код на весь вечер. Режим и оформление — общие для всех блоков.</p>}
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
        {/* У самостоятельной игры («Олимп») свой вид — выбирать оформление не нужно. */}
        {!standalone && (
          <>
        <Fold title="Оформление" value={getTheme(themeId).title}>
        <fieldset>
          <legend className="visually-hidden">Оформление</legend>
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
        </Fold>
        <div
          className="preview-screen"
          style={themeStyle(themeId)}
          data-shine={getTheme(themeId).effects?.shine ? "on" : undefined}
          aria-label={`Так выглядит экран зала: ${getTheme(themeId).title}`}
          role="img"
        >
          <Scene themeId={themeId} />
          <div className="theme-preview__content">
            <p className="eyebrow">Код игры</p>
            <div className="big-code">482 913</div>
          </div>
        </div>
          </>
        )}
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
