import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { GamePreview } from "./GamePreview";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AGE_RATINGS, cleanGameTitle, copyOfGame, GAME_TITLE_MAX_LENGTH, isValidGameTitle } from "../../core/games";
import {
  gamesRepo,
  permissions,
  useLoad,
  type AgeRating,
  type Game,
  type GamePatch,
  type PlayMode,
  type UserProfile,
} from "../../data";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { LoadFailed, Message, Pending } from "../../components/Status";
import { Toast, useToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import { TopBar } from "../../components/TopBar";
import { dropDraft, readDraft, useAutosave, type SaveStatus } from "../../components/useAutosave";
import { gameMediaIds, stepsLabel, getMechanic, mechanicTitle, supportedPlayMode, validateGame } from "../../mechanics/registry";
import { getTheme, THEME_HINTS, themesForRating } from "../../themes/registry";

const AGE_HINTS: Record<AgeRating, string> = {
  "0+": "Для всех, в том числе детские праздники.",
  "12+": "Без детей младше 12 лет.",
  "18+": "Только для взрослых: откроются темы и вопросы 18+.",
};

const PLAY_MODES: Array<{ id: PlayMode; title: string; hint: string }> = [
  { id: "solo", title: "Каждый сам за себя", hint: "Каждый гость отвечает со своего телефона." },
  { id: "teams", title: "Команды", hint: "Отвечает капитан команды, остальные видят вопрос." },
];

const SAVE_TEXT: Record<SaveStatus, string> = {
  saved: "Все изменения сохранены автоматически",
  saving: "Сохраняется…",
  offline: "Нет связи — правки сохранятся, когда появится интернет",
  error: "Не удалось сохранить — пробуем ещё раз",
  conflict: "Игру изменил другой человек — ваши правки ждут решения",
};

/** Кто-то правил игру за последние 10 минут — предупредить, что можно столкнуться правками. */
const RECENT_EDIT_MS = 10 * 60_000;

export function GameEditor() {
  const { gameId = "" } = useParams();
  return (
    <HostGate skeleton={<StudioSkeleton />}>{(_user, profile) => <EditorLoader gameId={gameId} profile={profile} />}</HostGate>
  );
}

function EditorLoader({ gameId, profile }: { gameId: string; profile: UserProfile }) {
  const [state, retry] = useLoad(() => gamesRepo.get(gameId), [gameId]);
  if (state.status === "loading") return <Pending skeleton={<StudioSkeleton />} label="Открываем игру" />;
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
  const mechanic = getMechanic(initial.mechanic);
  // Содержимое сразу приводим к формату механики: дальше с ним работает только она.
  // Правки, которые в прошлый раз не дошли до сервера (вкладку закрыли без связи), возвращаются и уходят снова —
  // если игра на сервере с тех пор не менялась (иначе свежее — на сервере).
  const [draft] = useState(() => {
    const d = readDraft<GamePatch>(`game.${initial.id}`);
    if (d && (initial.updatedAt === null || d.at > initial.updatedAt)) return d.patch;
    if (d) dropDraft(`game.${initial.id}`);
    return null;
  });
  const [game, setGame] = useState<Game>(() => {
    const merged = { ...initial, ...(draft ?? {}) };
    return { ...merged, content: mechanic ? mechanic.parse(merged.content) : merged.content };
  });
  const [titleInput, setTitleInput] = useState(game.title);
  const [copying, setCopying] = useState(false);
  const [toast, showToast] = useToast();
  const editable = permissions.canEditGame(profile, game);
  // Роли без профессии ведущего (создатель игр, тестировщик) игры не проводят — только репетиция.
  const launchable = permissions.canLaunchGame(profile, game);
  const copyable = permissions.canCopyToPersonal(profile, game);
  const { status, change, flush, resume } = useAutosave<GamePatch>((patch) => gamesRepo.update(game.id, patch), `game.${initial.id}`);
  // Совместная работа (владелец и заместитель в библиотеке): кто правил игру недавно и кто изменил её, пока правили вы.
  const [openedAt] = useState(() => Date.now());
  const recentEditor =
    initial.editedBy && initial.editedBy !== profile.uid && initial.updatedAt && openedAt - initial.updatedAt < RECENT_EDIT_MS ? initial.editedByName || "другой человек" : null;
  const [conflictBy, setConflictBy] = useState<string | null>(null);
  useEffect(() => {
    if (status !== "conflict") return;
    let alive = true;
    gamesRepo
      .get(initial.id)
      .then((fresh) => alive && setConflictBy(fresh?.editedByName || "другой человек"))
      .catch(() => alive && setConflictBy("другой человек"));
    return () => {
      alive = false;
    };
  }, [status, initial.id]);
  useEffect(() => {
    if (!draft) return;
    edited.current = true;
    change(draft);
    showToast("Вернули правки, которые не успели сохраниться");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии
  }, []);
  // Какой игра была при открытии: «← К играм» предложит сохранить правки или вернуть как было.
  const original = useRef<GamePatch>({ title: initial.title, content: mechanic ? mechanic.parse(initial.content) : initial.content, themeId: initial.themeId, ageRating: initial.ageRating, playMode: initial.playMode });
  const edited = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [leaveError, setLeaveError] = useState(false);
  /** «Готово — назвать игру»: своё название (сама игра уже сохранена автоматически). */
  const [saveStep, setSaveStep] = useState<"name" | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  /** Дождаться, пока правки дойдут до сервера (до 6 с), — потом уходить. */
  async function settled(): Promise<void> {
    const end = Date.now() + 6000;
    await new Promise((r) => setTimeout(r, 50));
    while (statusRef.current !== "saved" && statusRef.current !== "error" && statusRef.current !== "conflict" && Date.now() < end) await new Promise((r) => setTimeout(r, 150));
  }
  const back = game.scope === "agency" ? "/studio?tab=agency" : "/studio";
  const titleValid = isValidGameTitle(cleanGameTitle(titleInput));
  const errors = useMemo(() => validateGame(game.mechanic, game.content), [game.mechanic, game.content]);
  const stepsText = stepsLabel(game.mechanic, game.content);

  function edit(patch: GamePatch) {
    edited.current = true;
    setGame((g) => ({ ...g, ...patch }));
    change(patch);
  }

  /**
   * «← К играм»: правки сохраняются сами (решение владельца 14 октября 2026 — не нужно листать вниз и нажимать
   * «Сохранить»). Уходим, как только последние правки дошли до сервера; сервер отказал — остаёмся и говорим.
   */
  function goBack(to: string = back) {
    leaveTo.current = to;
    if (!editable || !edited.current) return navigate(to);
    setLeaving(true);
    setRestoring(true);
    flush(true);
    leaveWhenSettled();
  }
  /** «Отменить правки»: вернуть игру к виду на момент открытия (с подтверждением). */
  const [undoAsk, setUndoAsk] = useState(false);
  const leaveTo = useRef(back);

  /** Уйти, когда правки дошли (или лежат в очереди без связи); сервер отказал — остаться и сказать. */
  function leaveWhenSettled() {
    setLeaveError(false);
    void settled().then(() => {
      if (statusRef.current === "error" || statusRef.current === "conflict") {
        setRestoring(false);
        setLeaveError(true);
        return;
      }
      setLeaving(false);
      setRestoring(false);
      navigate(leaveTo.current, edited.current ? { state: { toast: "Изменения сохранены" } } : undefined);
    });
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
      const id = await gamesRepo.copy(game.id, gameMediaIds(game.mechanic, game.content), copyOfGame(game, "personal", profile.uid));
      navigate(`/studio/games/${id}`, { replace: true });
    } catch {
      showToast("Не удалось скопировать. Проверьте интернет.");
      setCopying(false);
    }
  }

  /** Сохранить под своим названием и вернуться к своим играм. */
  async function saveGame() {
    const clean = cleanGameTitle(saveName);
    if (!isValidGameTitle(clean)) {
      setSaveError("Введите название — так игра будет называться в ваших играх.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setTitleInput(clean);
    edit({ title: clean });
    flush(true);
    await settled();
    if (statusRef.current === "error") {
      setSaving(false);
      setSaveError("Сервер не принял изменения. Проверьте интернет и нажмите ещё раз.");
      return;
    }
    edited.current = false;
    setSaving(false);
    setSaveStep(null);
    // Нет связи: правка ждёт в очереди устройства и уйдёт сама — честно об этом и говорим.
    const where = game.scope === "agency" ? "библиотеке" : "ваших играх";
    const toast = statusRef.current === "saved" ? `Игра «${clean}» сохранена в ${where}` : `Игра «${clean}» сохранится в ${where}, когда появится связь`;
    navigate(game.scope === "agency" ? "/studio?tab=agency" : "/studio?tab=mine", { state: { toast } });
  }

  const launchBlocked = errors.length > 0;
  const [previewOpen, setPreviewOpen] = useState(false);
  const canPreview = Boolean(mechanic?.preview) && !launchBlocked;
  const MechanicEditor = mechanic?.Editor;

  return (
    <main className="page">
      <TopBar title={editable ? "Игра" : "Игра JoyRest"} actions={[{ label: "В студию", onClick: () => goBack(back) }]} onHome={() => goBack("/studio")} />
      <button type="button" className="btn btn--quiet back-link" onClick={() => goBack()}>
        ← К играм
      </button>
      {editable ? (
        <>
          <p className={`save-status save-status--${status}`} role="status" aria-live="polite">
            <span className="save-status__dot" aria-hidden="true" />
            {SAVE_TEXT[status]}
          </p>
          {recentEditor && status !== "conflict" && (
            <p className="small clients-late" role="status">
              Эту игру недавно правил(а) {recentEditor}. Если правите одновременно — при сохранении спросим, чью версию оставить.
            </p>
          )}
          {status === "conflict" && (
            <div className="card stack stack--tight clients-conflict" role="alert">
              <p>
                <b>Пока вы правили, эту игру изменил(а) {conflictBy ?? "другой человек"}.</b> Ваши последние правки не потерялись — они на этом
                устройстве и ещё не сохранены.
              </p>
              <button
                type="button"
                className="btn btn--block"
                onClick={() => {
                  // Свежая версия с сервера: свои несохранённые правки — убрать, иначе вернутся при открытии.
                  dropDraft(`game.${initial.id}`);
                  window.location.reload();
                }}
              >
                Открыть свежую версию (мои правки убрать)
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--block"
                onClick={() => {
                  gamesRepo.overwriteNext?.(initial.id);
                  resume();
                }}
              >
                Сохранить мою версию поверх
              </button>
            </div>
          )}
          {edited.current && (
            <button type="button" className="btn btn--quiet back-link" onClick={() => setUndoAsk(true)}>
              ↶ Отменить правки — вернуть, как было при открытии
            </button>
          )}
        </>
      ) : (
        <p className="muted small">Игра из библиотеки JoyRest. Чтобы изменить её, скопируйте в «Мои игры».</p>
      )}

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
          <li>{stepsText}</li>
          <li>{game.scope === "agency" ? "Библиотека JoyRest" : "Мои игры"}</li>
        </ul>
        {launchBlocked && (
          <div className="notice" role="note">
            <p>
              <strong>Пока нельзя запустить.</strong>{" "}
              {errors.length === 1 ? errors[0]?.message : `Исправьте замечания: ${errors.length}. Они отмечены у вопросов ниже.`}
            </p>
          </div>
        )}
        <div className="actions">
          {editable ? (
            launchBlocked ? (
              <button type="button" className="btn btn--block" disabled>
                Запустить
              </button>
            ) : (
              <>
                {launchable && (
                  <Link className="btn btn--block" to={`/studio/launch/${game.id}`}>
                    Запустить
                  </Link>
                )}
                <Link className={launchable ? "btn btn--secondary btn--block" : "btn btn--block"} to={`/studio/rehearsal/${game.id}`}>
                  Репетиция без гостей
                </Link>
              </>
            )
          ) : (
            <>
              {copyable && (
                <button type="button" className="btn btn--block" disabled={copying} onClick={() => void copyToMine()}>
                  {copying ? "Копируем…" : "Скопировать в мои игры"}
                </button>
              )}
              {!launchBlocked && (
                <>
                  {launchable && (
                    <Link className="btn btn--secondary btn--block" to={`/studio/launch/${game.id}`}>
                      Запустить как есть
                    </Link>
                  )}
                  <Link className="btn btn--quiet btn--block" to={`/studio/rehearsal/${game.id}`}>
                    Репетиция без гостей
                  </Link>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {canPreview && mechanic && (
        <section className="card stack stack--tight">
          <h2>Как игра пойдёт</h2>
          <p className="muted small">Игра проходит сама с тестовыми командами: листайте моменты и смотрите экран зала и телефоны.</p>
          <button type="button" className="btn btn--secondary btn--block" onClick={() => setPreviewOpen(true)}>
            Предпросмотр игры
          </button>
          <Link className="btn btn--quiet btn--block" to={`/studio/guide#${game.mechanic}`}>
            Как проводить эту игру
          </Link>
          <GamePreview open={previewOpen} onClose={() => setPreviewOpen(false)} mechanic={mechanic} gameId={game.id} content={game.content} playMode={supportedPlayMode(game.mechanic, game.playMode)} themeId={game.themeId} />
        </section>
      )}
      {/* Инструкция нужна и там, где предпросмотра нет (квиз с ошибками, «Мафия», вечер из блоков…). */}
      {!(canPreview && mechanic) && (
        <Link className="btn btn--quiet btn--block" to={`/studio/guide#${game.mechanic}`}>
          Как проводить эту игру
        </Link>
      )}

      {MechanicEditor ? (
        <Suspense fallback={<section className="card" aria-busy="true"><span className="skeleton skeleton--choice" /></section>}>
          <MechanicEditor
            gameId={game.id}
            themeId={game.themeId}
            content={game.content}
            editable={editable}
            scope={game.scope}
            onChange={(content) => edit({ content })}
          />
        </Suspense>
      ) : (
        <section className="card">
          <p className="muted">Эта механика пока не поддерживается конструктором.</p>
        </section>
      )}

      {editable && (
        <section className="card">
          <h2>Настройки</h2>
          {/* Самостоятельная игра («Олимп») — со своим видом, оформление не выбирается. */}
          {!mechanic?.standalone && (
          <Fold title="Оформление по умолчанию" value={getTheme(game.themeId).title}>
          <fieldset>
            <legend className="visually-hidden">Оформление по умолчанию</legend>
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
                  <span className="choice__hint">{THEME_HINTS[theme.id] ?? "Можно поменять при запуске сессии."}</span>
                </span>
              </label>
            ))}
          </fieldset>
          </Fold>
          )}
          <fieldset>
            <legend>Участники по умолчанию</legend>
            {/* Только режимы, которые поддерживает механика: «Мафия» — каждый сам, «Шашки» — команды. */}
            {PLAY_MODES.filter((mode) => mechanic?.supports[mode.id] ?? true).map((mode) => (
              <label key={mode.id} className="choice">
                <input
                  type="radio"
                  name="playMode"
                  checked={supportedPlayMode(game.mechanic, game.playMode) === mode.id}
                  onChange={() => edit({ playMode: mode.id })}
                />
                <span className="choice__text">
                  <span className="choice__title">{mode.title}</span>
                  <span className="choice__hint">{mode.hint}</span>
                </span>
              </label>
            ))}
            {mechanic && !mechanic.supports.solo && <p className="muted small">Эта игра — только для команд.</p>}
            {mechanic && !mechanic.supports.teams && <p className="muted small">Эта игра — только каждый сам за себя.</p>}
            <p className="muted small">Тему и режим можно поменять при запуске сессии.</p>
          </fieldset>
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
        </section>
      )}

      <div className="actions">
        {editable && (
          <button
            type="button"
            className="btn btn--block"
            onClick={() => {
              setSaveName(cleanGameTitle(titleInput) || game.title);
              setSaveError(null);
              setSaveStep("name");
            }}
          >
            Готово — назвать игру
          </button>
        )}
        <button type="button" className="btn btn--secondary btn--block" onClick={() => goBack()}>
          ← К играм
        </button>
      </div>
      <ConfirmDialog
        open={saveStep === "name"}
        title="Как назовём игру?"
        confirmLabel={saving ? "Сохраняем…" : "Сохранить"}
        cancelLabel="Отмена"
        busy={saving}
        onConfirm={() => void saveGame()}
        onCancel={() => setSaveStep(null)}
      >
        <p className="muted small">Игра сделана под вас — назовите её так, чтобы легко найти в своих играх (например, «Квиз на свадьбу Ани и Димы»).</p>
        {/* «Готово» на клавиатуре телефона сохраняет. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) void saveGame();
          }}
        >
          <label className="field">
            Название
            <input maxLength={GAME_TITLE_MAX_LENGTH} autoComplete="off" autoFocus enterKeyHint="done" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          </label>
        </form>
        {saveError && (
          <p className="error" role="alert">
            {saveError}
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={leaving && leaveError}
        title="Изменения не сохранились"
        confirmLabel="Попробовать ещё раз"
        cancelLabel="Остаться в игре"
        busy={restoring}
        onConfirm={() => {
          setRestoring(true);
          flush(true);
          leaveWhenSettled();
        }}
        onCancel={() => {
          setLeaving(false);
          setLeaveError(false);
        }}
      >
        <p className="error" role="alert">
          Сервер не принял изменения. Проверьте интернет и нажмите ещё раз — правки не потеряются, пока вы в игре.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={undoAsk}
        title="Отменить правки?"
        confirmLabel={restoring ? "Возвращаем…" : "Вернуть как было"}
        cancelLabel="Оставить правки"
        busy={restoring}
        onConfirm={() => {
          const before = original.current;
          setGame((g) => ({ ...g, ...before }));
          setTitleInput(typeof before.title === "string" ? before.title : titleInput);
          change(before);
          flush(true);
          edited.current = false;
          setUndoAsk(false);
          showToast("Игра возвращена к виду на момент открытия");
        }}
        onCancel={() => setUndoAsk(false)}
      >
        <p>Все изменения с момента, как вы открыли игру, пропадут — игра станет такой, какой была.</p>
      </ConfirmDialog>
      <Toast text={toast} />
    </main>
  );
}
