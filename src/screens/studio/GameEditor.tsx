import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AGE_RATINGS, cleanGameTitle, copyOfGame, GAME_TITLE_MAX_LENGTH, isValidGameTitle } from "../../core/games";
import { questionsLabel } from "../../core/results";
import {
  gamesRepo,
  permissions,
  useLoad,
  type AgeRating,
  type Game,
  type GamePatch,
  type UserProfile,
} from "../../data";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { LoadFailed, Message, Pending } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { useAutosave, type SaveStatus } from "../../components/useAutosave";
import { countQuestions, mechanicTitle } from "../../mechanics/registry";
import { themesForRating } from "../../themes/registry";

const AGE_HINTS: Record<AgeRating, string> = {
  "0+": "Для всех, в том числе детские праздники.",
  "12+": "Без детей младше 12 лет.",
  "18+": "Только для взрослых: откроются темы и вопросы 18+.",
};

const SAVE_TEXT: Record<SaveStatus, string> = {
  saved: "Все изменения сохранены",
  saving: "Сохраняем…",
  error: "Нет связи — сохраним, как только появится интернет",
};

export function GameEditor() {
  const { gameId = "" } = useParams();
  return (
    <HostGate skeleton={<StudioSkeleton />}>{(_user, profile) => <EditorLoader gameId={gameId} profile={profile} />}</HostGate>
  );
}

function EditorLoader({ gameId, profile }: { gameId: string; profile: UserProfile }) {
  const [state, retry] = useLoad(() => gamesRepo.get(gameId), [gameId]);
  if (state.status === "loading") return <Pending skeleton={<StudioSkeleton />} onRetry={retry} label="Открываем игру" />;
  if (state.status === "error") return <LoadFailed onRetry={retry} />;
  const game = state.data;
  if (!game || !permissions.canReadGame(profile, game)) {
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
  return <Editor key={game.id} initial={game} profile={profile} />;
}

function Editor({ initial, profile }: { initial: Game; profile: UserProfile }) {
  const navigate = useNavigate();
  const [game, setGame] = useState(initial);
  const [titleInput, setTitleInput] = useState(initial.title);
  const [copying, setCopying] = useState(false);
  const [toast, showToast] = useToast();
  const editable = permissions.canEditGame(profile, game);
  const { status, change } = useAutosave<GamePatch>((patch) => gamesRepo.update(game.id, patch));
  const back = game.scope === "agency" ? "/studio?tab=agency" : "/studio";
  const titleValid = isValidGameTitle(cleanGameTitle(titleInput));

  function edit(patch: GamePatch) {
    setGame((g) => ({ ...g, ...patch }));
    change(patch);
  }

  function onTitle(value: string) {
    setTitleInput(value);
    const clean = cleanGameTitle(value);
    if (isValidGameTitle(clean)) edit({ title: clean });
  }

  function onAgeRating(rating: AgeRating) {
    const allowed = themesForRating(rating);
    // Тема 18+ не остаётся в игре, которая стала детской.
    const themeId = allowed.some((t) => t.id === game.themeId) ? game.themeId : (allowed[0]?.id ?? game.themeId);
    edit(themeId === game.themeId ? { ageRating: rating } : { ageRating: rating, themeId });
  }

  async function copyToMine() {
    setCopying(true);
    try {
      const id = await gamesRepo.create(copyOfGame(game, "personal", profile.uid));
      navigate(`/studio/games/${id}`, { replace: true });
    } catch {
      showToast("Не удалось скопировать. Проверьте интернет.");
      setCopying(false);
    }
  }

  const questions = countQuestions(game.mechanic, game.content);

  return (
    <main className="page">
      <TopBar title={editable ? "Игра" : "Игра JoyRest"} actions={[{ label: "В студию", to: back }]} />
      <p className="muted small" aria-live="polite">
        {editable ? SAVE_TEXT[status] : "Игра из библиотеки JoyRest. Чтобы изменить её, скопируйте в «Мои игры»."}
      </p>

      <section className="card">
        {editable ? (
          <label className="field">
            Название
            <input
              maxLength={GAME_TITLE_MAX_LENGTH}
              autoComplete="off"
              value={titleInput}
              aria-invalid={!titleValid}
              onChange={(e) => onTitle(e.target.value)}
            />
            {!titleValid && <span className="error small">Введите название — без него игра не сохранится.</span>}
          </label>
        ) : (
          <h2>{game.title}</h2>
        )}
        <ul className="meta" aria-label="Об игре">
          <li>{mechanicTitle(game.mechanic)}</li>
          <li>{questionsLabel(questions)}</li>
          <li>{game.scope === "agency" ? "Библиотека JoyRest" : "Мои игры"}</li>
        </ul>
        <div className="actions">
          {editable ? (
            <Link className="btn btn--block" to={`/studio/launch/${game.id}`}>
              Запустить
            </Link>
          ) : (
            <>
              <button type="button" className="btn btn--block" disabled={copying} onClick={() => void copyToMine()}>
                {copying ? "Копируем…" : "Скопировать в мои игры"}
              </button>
              <Link className="btn btn--secondary btn--block" to={`/studio/launch/${game.id}`}>
                Запустить как есть
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Вопросы</h2>
        <p className="muted">
          {questions > 0
            ? questionsLabel(questions)
            : "Конструктор вопросов появится на следующем этапе. Пока игру можно запустить, чтобы проверить вход гостей и экран зала."}
        </p>
      </section>

      {editable && (
        <section className="card">
          <fieldset>
            <legend>Возраст гостей</legend>
            {AGE_RATINGS.map((rating) => (
              <label key={rating} className="choice">
                <input
                  type="radio"
                  name="ageRating"
                  checked={game.ageRating === rating}
                  onChange={() => onAgeRating(rating)}
                />
                <span className="choice__text">
                  <span className="choice__title">{rating}</span>
                  <span className="choice__hint">{AGE_HINTS[rating]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Оформление по умолчанию</legend>
            {themesForRating(game.ageRating).map((theme) => (
              <label key={theme.id} className="choice">
                <input
                  type="radio"
                  name="themeId"
                  checked={game.themeId === theme.id}
                  onChange={() => edit({ themeId: theme.id })}
                />
                <span className="choice__text">
                  <span className="choice__title">{theme.title}</span>
                  <span className="choice__hint">Можно поменять при запуске сессии.</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>
      )}

      <Toast text={toast} />
    </main>
  );
}
