import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { GamePreview } from "./GamePreview";
import { Link, useNavigate, useParams } from "react-router-dom";
import { editorGuideFor } from "../../core/editorGuideSkip";
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
import { draftRestoreMode, dropDraft, readDraft, useAutosave, type Draft, type SaveStatus } from "../../components/useAutosave";
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
  slow: "Сохраняется дольше обычного — сервер отвечает медленно",
  offline: "Нет связи — правки сохранятся, когда появится интернет",
  error: "Не удалось сохранить — пробуем ещё раз",
  conflict: "Игру изменил другой человек — ваши правки ждут решения",
  denied: "Сервер не принимает правки — они остались на этом телефоне",
};

/** Короткий статус, когда плашка прилипла к верху экрана: не закрывает кнопки и текст под ней. */
const SAVE_SHORT: Record<SaveStatus, string> = {
  saved: "✓ Сохранено",
  saving: "Сохраняется…",
  slow: "Сохраняется…",
  offline: "Нет связи",
  error: "Пробуем ещё раз",
  conflict: "Нужно решение",
  denied: "Не сохраняется",
};

/** Почему сервер отказал насовсем — понятным языком. */
function deniedText(code: string | null): string {
  if (code === "not-found" || code === "permission-denied") return "Игру удалили или у вас больше нет доступа — правки остались на этом телефоне.";
  if (code === "unauthenticated") return "Вы вышли из аккаунта — войдите снова и откройте игру: правки остались на этом телефоне.";
  if (code === "resource-exhausted") return "На сервере закончилось место для ваших игр — правки остались на этом телефоне. Освободите место и нажмите «Попробовать ещё раз».";
  return "Сервер не принимает эти правки — они остались на этом телефоне. Обновите страницу или напишите владельцу.";
}

/** Выход без сохранения при отказе сервера: правки не уйдут сами — честно говорим, где они остались. */
function deniedLeaveText(code: string | null): string {
  if (code === "unauthenticated") return "Правки не сохранены: вы вышли из аккаунта. Они остались только на этом телефоне — войдите снова и откройте игру.";
  if (code === "resource-exhausted") return "Правки не сохранены: на сервере закончилось место. Они остались только на этом телефоне.";
  if (code === "not-found" || code === "permission-denied") return "Правки не сохранены: игру удалили или у вас нет доступа. Они остались только на этом телефоне.";
  return "Правки не сохранены: сервер их не принял. Они остались только на этом телефоне.";
}

/** Время черновика для человека: «22 октября, 14:05». */
function draftTime(at: number): string {
  try {
    return new Date(at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "прошлого раза";
  }
}

/** Что мешает уйти из игры: правки ещё не на сервере. */
type LeaveIssue = "error" | "offline" | "slow" | "conflict" | "denied";

/** Плашка статуса прилипла к верху (страницу прокрутили ниже неё). */
function useStuck() {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, stuck] as const;
}

/** Кто-то правил игру за последние 10 минут — предупредить, что можно столкнуться правками. */
const RECENT_EDIT_MS = 10 * 60_000;

/**
 * Где конструкторы помечают ошибки: общий класс `edit-issue` и прежние метки. Сообщения окна «вставить списком»
 * («Не разобрали строки…») помечены `import-note` — это не ошибки игры, туда «Показать, что исправить» не ведёт.
 */
const ISSUE_SELECTOR = ".edit-issue, .q-card__issue, .has-error, [aria-invalid='true'], .field .error:not(.import-note), p.error:not(.import-note)";

/** Первое место с ошибкой игры (не сообщение окна импорта). */
function findIssue(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(ISSUE_SELECTOR)).find((el) => !el.closest(".import-note, .import-list")) ?? null;
}

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
  const [statusSentinel, statusStuck] = useStuck();
  const navigate = useNavigate();
  const mechanic = getMechanic(initial.mechanic);
  // Содержимое сразу приводим к формату механики: дальше с ним работает только она.
  // Правки, которые в прошлый раз не дошли до сервера (вкладку закрыли без связи), возвращаются и уходят снова —
  // молча, только если игра на сервере с тех пор не менялась: черновик помнит версию сервера, с которой начат
  // (`base`), часам телефона не верим. Игру меняли (или черновик старый, без версии) — спрашиваем, чью версию оставить.
  const draftKey = `game.${initial.id}`;
  const [draftChoice] = useState<{ restore: GamePatch | null; ask: Draft<GamePatch> | null }>(() => {
    const d = readDraft<GamePatch>(draftKey);
    if (!d) return { restore: null, ask: null };
    if (!permissions.canEditGame(profile, initial)) {
      dropDraft(draftKey);
      return { restore: null, ask: null };
    }
    // Молча — только если версия на сервере та же, поверх которой лежат правки (после своих сохранений черновик помнит
    // новую версию). Иначе спрашиваем — даже если последним правил сам человек: с другого устройства он мог сделать новее.
    return draftRestoreMode(d, initial.updatedAt) === "restore" ? { restore: d.patch, ask: null } : { restore: null, ask: d };
  });
  const draft = draftChoice.restore;
  const [draftAsk, setDraftAsk] = useState<Draft<GamePatch> | null>(draftChoice.ask);
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
  const { status, deniedCode, pendingChanges, change, flush, resume } = useAutosave<GamePatch>((patch) => gamesRepo.update(game.id, patch), draftKey, initial.updatedAt);
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
  const [restoring, setRestoring] = useState(false);
  /** Что мешает уйти и что делать после решения: выйти или закончить «Готово — назвать игру». */
  const [leaveIssue, setLeaveIssue] = useState<LeaveIssue | null>(null);
  const afterIssue = useRef<"leave" | "save">("leave");
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
    while (statusRef.current !== "saved" && statusRef.current !== "error" && statusRef.current !== "conflict" && statusRef.current !== "denied" && Date.now() < end) await new Promise((r) => setTimeout(r, 150));
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
    setRestoring(true);
    flush(true);
    leaveWhenSettled();
  }
  /** «Отменить правки»: вернуть игру к виду на момент открытия (с подтверждением). */
  const [undoAsk, setUndoAsk] = useState(false);
  const leaveTo = useRef(back);

  /** Что мешает уйти сейчас (null — всё на сервере). */
  function issueNow(): LeaveIssue | null {
    const st = statusRef.current;
    if (st === "conflict" || st === "denied" || st === "error" || st === "offline") return st;
    // Связь есть, сервер отвечает, но запись ещё идёт — «сохраняется дольше обычного», а не «нет связи».
    if (st !== "saved" || pendingChanges()) return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "slow";
    return null;
  }

  /** Уйти, когда правки дошли; не дошли за 6 с — не делать вид, что сохранено, а сказать почему и спросить. */
  function leaveWhenSettled() {
    afterIssue.current = "leave";
    setLeaveIssue(null);
    void settled().then(() => {
      const issue = issueNow();
      setRestoring(false);
      if (issue) {
        setLeaveIssue(issue);
        return;
      }
      navigate(leaveTo.current, edited.current ? { state: { toast: "Изменения сохранены" } } : undefined);
    });
  }

  /** «Выйти всё равно» без связи: правки лежат в черновике на этом телефоне. */
  function leaveAnyway() {
    setLeaveIssue(null);
    // Сервер отказал насовсем — сами правки не уйдут: не обещаем «когда появится интернет».
    if (statusRef.current === "denied") {
      navigate(afterIssue.current === "save" ? (game.scope === "agency" ? "/studio?tab=agency" : "/studio?tab=mine") : leaveTo.current, {
        state: { toast: deniedLeaveText(deniedCode) },
      });
      return;
    }
    // Запись ещё идёт (связь есть) — она может успеть; не успеет — правки на этом телефоне.
    if (statusRef.current === "slow" || statusRef.current === "saving") {
      navigate(afterIssue.current === "save" ? (game.scope === "agency" ? "/studio?tab=agency" : "/studio?tab=mine") : leaveTo.current, {
        state: { toast: "Правки ещё сохранялись. Если не успели — они остались на этом телефоне и уйдут, когда вы снова откроете игру" },
      });
      return;
    }
    if (afterIssue.current === "save") {
      const where = game.scope === "agency" ? "библиотеке" : "ваших играх";
      navigate(game.scope === "agency" ? "/studio?tab=agency" : "/studio?tab=mine", {
        state: { toast: `Игра «${cleanGameTitle(saveName) || game.title}» сохранится в ${where}, когда появится интернет и вы снова её откроете` },
      });
      return;
    }
    navigate(leaveTo.current, edited.current ? { state: { toast: "Правки остались на этом телефоне и уйдут, когда появится интернет и вы снова откроете игру" } } : undefined);
  }

  /** «Сохранить мою версию поверх» из окна выхода: снять остановку и дождаться записи. */
  function overwriteAndContinue() {
    gamesRepo.overwriteNext?.(initial.id);
    resume();
    setLeaveIssue(null);
    setRestoring(true);
    if (afterIssue.current === "save") void finishSave();
    else leaveWhenSettled();
  }

  /** «Подождать»: запись идёт дольше обычного — ждём ещё и уходим, когда дойдёт. */
  function waitMore() {
    setLeaveIssue(null);
    setRestoring(true);
    if (afterIssue.current === "save") void finishSave();
    else leaveWhenSettled();
  }

  /** «Попробовать ещё раз»: при отказе насовсем — снять остановку и повторить. */
  function retryAndContinue() {
    if (statusRef.current === "denied") resume();
    else flush(true);
    setLeaveIssue(null);
    setRestoring(true);
    if (afterIssue.current === "save") void finishSave();
    else leaveWhenSettled();
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
    await finishSave(clean);
  }

  /**
   * Дождаться, пока название и правки дошли до сервера, и уйти к своим играм. Конфликт с чужой правкой, отказ сервера
   * или нет связи — не уходить молча (правки потом потерялись бы или легли поверх чужих), а спросить.
   */
  async function finishSave(title: string = cleanGameTitle(saveName) || game.title) {
    afterIssue.current = "save";
    await settled();
    const issue = issueNow();
    setSaving(false);
    setRestoring(false);
    if (issue) {
      setSaveStep(null);
      setLeaveIssue(issue);
      return;
    }
    edited.current = false;
    setSaveStep(null);
    const where = game.scope === "agency" ? "библиотеке" : "ваших играх";
    navigate(game.scope === "agency" ? "/studio?tab=agency" : "/studio?tab=mine", { state: { toast: `Игра «${title}» сохранена в ${where}` } });
  }

  const launchBlocked = errors.length > 0;
  const [previewOpen, setPreviewOpen] = useState(false);
  const canPreview = Boolean(mechanic?.preview) && !launchBlocked;

  /** Замечания текстом, если на странице не нашлось, куда вести (чтобы не было тупика). */
  const [issuesList, setIssuesList] = useState(false);

  /**
   * «Показать, что исправить»: конструкторы помечают ошибочные места классом `edit-issue` (и старыми `.q-card__issue`,
   * `.has-error`, `aria-invalid`). Сначала просим их раскрыть свёрнутое (`joyrest:reveal-issues`), через два кадра ищем,
   * раскрываем родительские `<details>` и свёрнутые блоки, прокручиваем и ставим фокус. Не нашли — список замечаний текстом.
   */
  function toFirstIssue() {
    window.dispatchEvent(new CustomEvent("joyrest:reveal-issues"));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = findIssue();
        if (!el) {
          setIssuesList(true);
          return;
        }
        setIssuesList(false);
        for (let d = el.closest<HTMLDetailsElement>("details"); d; d = d.parentElement?.closest<HTMLDetailsElement>("details") ?? null) d.open = true;
        // Свёрнутые карточки и блоки: замечание в самой кнопке-заголовке или кнопка-заголовок рядом с содержимым
        // (aria-expanded="false", класс `…__head`); меню «⋯» и прочие кнопки не трогаем.
        el.closest<HTMLButtonElement>("button[aria-expanded='false']")?.click();
        let node: HTMLElement | null = el;
        while (node && node !== document.body) {
          const parent: HTMLElement | null = node.parentElement;
          const toggle = parent
            ? Array.from(parent.children).find(
                (c): c is HTMLButtonElement => c instanceof HTMLButtonElement && c !== node && c.getAttribute("aria-expanded") === "false" && /__head\b|fold/.test(c.className),
              )
            : undefined;
          if (toggle && !toggle.contains(el)) toggle.click();
          node = parent;
        }
        requestAnimationFrame(() => {
          const target = findIssue() ?? el;
          const field = target.matches("input, textarea, select") ? target : target.querySelector<HTMLElement>("[aria-invalid='true'], input, textarea, select, button");
          target.scrollIntoView({ block: "center" });
          (field ?? target).focus({ preventScroll: true });
        });
      }),
    );
  }
  const MechanicEditor = mechanic?.Editor;

  return (
    <main className="page">
      <TopBar title={editable ? "Игра" : "Игра JoyRest"} actions={[{ label: "В студию", onClick: () => goBack(back) }]} onHome={() => goBack("/studio")} />
      <button type="button" className="btn btn--quiet back-link" onClick={() => goBack()}>
        ← К играм
      </button>
      {editable ? (
        <>
          <span ref={statusSentinel} className="save-status__sentinel" aria-hidden="true" />
          <p className={`save-status save-status--${status}${statusStuck ? " is-stuck" : ""}`} role="status" aria-live="polite" title={SAVE_TEXT[status]}>
            <span className="save-status__dot" aria-hidden="true" />
            {statusStuck ? SAVE_SHORT[status] : SAVE_TEXT[status]}
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
          {status === "denied" && (
            <div className="card stack stack--tight clients-conflict" role="alert">
              <p>
                <b>{deniedText(deniedCode)}</b>
              </p>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => resume()}>
                Попробовать ещё раз
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
            {editable && (
              <button type="button" className="btn btn--secondary btn--block" onClick={toFirstIssue}>
                Показать, что исправить
              </button>
            )}
            {issuesList && <IssueList errors={errors} />}
          </div>
        )}
        <div className="actions">
          {editable ? (
            launchBlocked ? (
              <button type="button" className="btn btn--block" disabled>
                ▶ Запустить игру
              </button>
            ) : (
              <>
                {launchable && (
                  <Link className="btn btn--block" to={`/studio/launch/${game.id}`}>
                    ▶ Запустить игру
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
                      ▶ Запустить как есть
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
          <GamePreview open={previewOpen} onClose={() => setPreviewOpen(false)} mechanic={mechanic} gameId={game.id} content={game.content} playMode={supportedPlayMode(game.mechanic, game.playMode)} themeId={game.themeId} />
        </section>
      )}
      {mechanic?.preview && launchBlocked && (
        <section className="card stack stack--tight">
          <h2>Как игра пойдёт</h2>
          <p className="muted small">
            Предпросмотр игры откроется, когда исправите {errors.length === 1 ? "замечание" : `замечания (${errors.length})`} — с ошибками игра не пройдёт до конца.
          </p>
          <button type="button" className="btn btn--secondary btn--block" disabled>
            Предпросмотр игры
          </button>
          {editable && (
            <button type="button" className="btn btn--quiet btn--block" onClick={toFirstIssue}>
              Показать, что исправить
            </button>
          )}
          {issuesList && <IssueList errors={errors} />}
        </section>
      )}
      {/* Инструкция нужна и там, где предпросмотра нет (квиз с ошибками, «Мафия», вечер из блоков…). */}
      {/* Инструкции к этой игре — одним блоком: как создать (конструктор) и как провести (пульт), не путаются с настройками. */}
      <nav className="card guide-pins" aria-labelledby="game-guides-title">
        <h2 id="game-guides-title" className="guide-pins__title">📘 Инструкции к этой игре</h2>
        <div className="guide-pins__grid">
          {editorGuideFor(game.mechanic) && (
            <Link className="guide-pins__item" to={`/studio/editor-guide#${game.mechanic}`}>
              <span className="guide-pins__icon" aria-hidden="true">✍️</span>
              <span className="guide-pins__text">
                <strong>Как создать</strong>
                <span>Поля, картинки, музыка — по шагам</span>
              </span>
            </Link>
          )}
          <Link className="guide-pins__item" to={`/studio/guide#${game.mechanic}`}>
            <span className="guide-pins__icon" aria-hidden="true">🎤</span>
            <span className="guide-pins__text">
              <strong>Как провести на празднике</strong>
              <span>Пульт, что видят гости, как объяснить правила</span>
            </span>
          </Link>
        </div>
      </nav>

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
        <p className="muted small">Игра сделана под вас — назовите её так, чтобы легко найти {game.scope === "agency" ? "в библиотеке JoyRest" : "в своих играх"} (например, «Квиз на свадьбу Ани и Димы»).</p>
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
        open={leaveIssue === "error"}
        title="Изменения не сохранились"
        confirmLabel="Попробовать ещё раз"
        cancelLabel="Остаться в игре"
        busy={restoring}
        onConfirm={retryAndContinue}
        onCancel={() => setLeaveIssue(null)}
      >
        <p className="error" role="alert">
          Сервер не принял изменения. Проверьте интернет и нажмите ещё раз — правки не потеряются, пока вы в игре.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={leaveIssue === "offline"}
        title="Нет связи"
        confirmLabel="Выйти всё равно"
        cancelLabel="Остаться"
        onConfirm={leaveAnyway}
        onCancel={() => setLeaveIssue(null)}
      >
        <p role="alert">Нет связи — правки сохранятся на этом телефоне и уйдут, когда появится интернет и вы снова откроете эту игру.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={leaveIssue === "slow"}
        title="Правки ещё сохраняются"
        confirmLabel="Подождать"
        cancelLabel="Выйти всё равно"
        busy={restoring}
        onConfirm={waitMore}
        onCancel={leaveAnyway}
      >
        <p role="status">
          Связь есть, но сервер отвечает дольше обычного. Подождите несколько секунд — выйдем, как только правки сохранятся. Выйдете сейчас —
          недошедшие правки останутся на этом телефоне.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={leaveIssue === "conflict"}
        title="Игру изменил другой человек"
        confirmLabel="Сохранить мою версию поверх"
        cancelLabel="Остаться в игре"
        busy={restoring}
        onConfirm={overwriteAndContinue}
        onCancel={() => setLeaveIssue(null)}
      >
        <p>
          Пока вы правили, эту игру изменил(а) {conflictBy ?? "другой человек"}. Ваши правки не потерялись — они на этом устройстве. Выберите, чью
          версию оставить.
        </p>
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => {
            dropDraft(draftKey);
            window.location.reload();
          }}
        >
          Открыть свежую версию (мои правки убрать)
        </button>
      </ConfirmDialog>
      <ConfirmDialog
        open={leaveIssue === "denied"}
        title="Правки не сохраняются"
        confirmLabel="Попробовать ещё раз"
        cancelLabel="Выйти"
        busy={restoring}
        onConfirm={retryAndContinue}
        onCancel={leaveAnyway}
      >
        <p className="error" role="alert">
          {deniedText(deniedCode)}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={draftAsk !== null}
        title="Есть несохранённые правки"
        confirmLabel="Вернуть мои правки поверх"
        cancelLabel="Оставить версию с сервера"
        onConfirm={() => {
          const d = draftAsk;
          setDraftAsk(null);
          if (!d) return;
          gamesRepo.overwriteNext?.(initial.id);
          const patch = d.patch;
          setGame((g) => ({ ...g, ...patch, content: mechanic && patch.content !== undefined ? mechanic.parse(patch.content) : (patch.content ?? g.content) }));
          if (typeof patch.title === "string") setTitleInput(patch.title);
          edited.current = true;
          change(patch);
          showToast("Вернули ваши правки — они сохраняются поверх");
        }}
        onCancel={() => {
          setDraftAsk(null);
          dropDraft(draftKey);
          showToast("Оставили версию с сервера");
        }}
      >
        <p>
          На этом устройстве есть несохранённые правки от {draftAsk ? draftTime(draftAsk.at) : "прошлого раза"}.{" "}
          {draftAsk?.base === undefined ? "Не знаем, меняли ли игру с тех пор." : "Игру с тех пор изменили."} Вернуть ваши правки поверх или
          оставить версию с сервера?
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

/** Замечания проверки списком — когда на странице не нашлось, куда прокрутить. */
function IssueList({ errors }: { errors: Array<{ path: string; message: string }> }) {
  const messages = [...new Set(errors.map((e) => e.message))];
  return (
    <div className="stack stack--tight" role="alert">
      <p className="small">Что исправить:</p>
      <ul className="small">
        {messages.slice(0, 20).map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      {messages.length > 20 && <p className="muted small">И ещё {messages.length - 20}.</p>}
    </div>
  );
}
