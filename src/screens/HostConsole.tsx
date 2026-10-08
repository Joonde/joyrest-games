import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { snapshotContent } from "../core/games";
import { captainChanges, leaderboardAdditions, rankedLeaderboard } from "../core/leaderboard";
import { cleanName, isValidName, NAME_MAX_LENGTH } from "../core/names";
import { startState } from "../core/session";
import { isOnline } from "../core/presence";
import { awardNow, canAwardNow, hasPodium } from "../core/podium";
import { presentationDone, teamOrder, teamsReveal } from "../core/teams";
import {
  answersRepo,
  errorCodeOf,
  clock,
  participantsRepo,
  permissions,
  sessionsRepo,
  useSessionByCode,
  type Answer,
  type AuthUser,
  type LeaderboardEntry,
  type Participant,
  type Session,
  type SessionChange,
  type TeamsReveal,
} from "../data";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HostGate } from "../components/HostGate";
import { ActionMenu, type MenuAction } from "../components/Menu";
import { QrCode } from "../components/QrCode";
import { VPN_HINT } from "../core/texts";
import { ConsoleSkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { Toast, useToast } from "../components/Toast";
import { screenStatusLabel, useScreenStatus } from "../components/live/screenStatus";
import { SoundPad } from "../components/live/SoundPad";
import { useWakeLock } from "../components/live/useWakeLock";
import { SlidesPanel } from "../components/live/SlidesPanel";
import { MusicPanel } from "../components/music/MusicPanel";
import { TopBar } from "../components/TopBar";
import { joinHost, playUrl, playUrlHint } from "../components/links";
import { Icon, type IconName } from "../components/Icon";
import { NameText } from "../components/NameText";
import { getMechanic } from "../mechanics/registry";
import type { SessionControl } from "../mechanics/types";
import { teamColorVar, useTheme } from "../themes/registry";

/** Счётчик ответов на экране обновляется не чаще раза в 2 секунды: экономим записи и чтения. */
const ANSWERED_THROTTLE_MS = 2000;
/** Как часто пульт проверяет, на связи ли капитаны команд. */
const CAPTAIN_CHECK_MS = 15_000;
/** Шаг ручной корректировки очков. */
const SCORE_STEP = 10;

export function HostConsole() {
  const { code = "" } = useParams();
  return (
    <HostGate skeleton={<ConsoleSkeleton />}>{(user) => <HostConsoleContent code={code} user={user} />}</HostGate>
  );
}

function HostConsoleContent({ code, user }: { code: string; user: AuthUser }) {
  const [state, retry] = useSessionByCode(code, { hostId: user.uid });

  if (state.status === "loading") return <Pending skeleton={<ConsoleSkeleton />} label="Открываем пульт" />;
  if (state.status === "notFound") return <Message title="Сессия не найдена">Проверьте код: {code}</Message>;
  if (state.status === "error") return <LoadFailed onRetry={retry}>{state.message}</LoadFailed>;
  if (!permissions.canControlSession(user.uid, state.session)) {
    return <Message title="Чужая сессия">Эту сессию запускал другой ведущий.</Message>;
  }
  return <Console session={state.session} />;
}

/** Пульт слушает участников и ответы на текущий шаг — гости и экран зала их не слушают. */
function useHostData(session: Session): { participants: Participant[]; answers: Answer[]; error: string | null } {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const playing = session.state.phase === "playing";

  useEffect(
    () => participantsRepo.watch(session.id, setParticipants, () => setError("Нет доступа к участникам сессии.")),
    [session.id],
  );

  useEffect(() => {
    setAnswers([]);
    if (!playing) return;
    return answersRepo.watch(session.id, session.state.step, setAnswers, () => setError("Нет доступа к ответам."));
  }, [session.id, session.state.step, playing]);

  return { participants, answers, error };
}

function Console({ session }: { session: Session }) {
  const { participants, answers, error: dataError } = useHostData(session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmAward, setConfirmAward] = useState(false);
  const [toast, showToast] = useToast();
  const [params, setParams] = useSearchParams();
  const [picking, setPickingState] = useState(params.get("pick") === "1");
  const [tab, setTab] = useState<PultTab>("game");
  const setPicking = (value: boolean) => {
    setPickingState(value);
    if (!value && params.has("pick")) setParams({}, { replace: true });
  };
  const link = playUrl(session.code);
  const phones = participants.filter((p) => p.kind === "player").length;
  const mechanic = getMechanic(session.mechanic);
  const content = useMemo(
    () => (mechanic ? mechanic.parse(snapshotContent(session.gameSnapshot)) : null),
    [mechanic, session.gameSnapshot],
  );
  const latest = useRef(session);
  latest.current = session;
  useTheme(session.themeId);

  useEffect(() => {
    void clock.sync();
  }, []);

  // Экран зала и гости слушают только документ сессии, поэтому новые участники попадают туда
  // через таблицу лидеров (с номером при одинаковых именах и с капитаном команды).
  useEffect(() => {
    if (session.state.phase === "finished") return;
    const additions = leaderboardAdditions(session.leaderboard, participants, session.playMode);
    if (Object.keys(additions).length > 0) {
      sessionsRepo.upsertLeaderboard(session.id, additions).catch(() => setError("Не удалось обновить список игроков."));
    }
  }, [participants, session.id, session.leaderboard, session.playMode, session.state.phase]);

  // Капитан команды вышел (телефон давно молчит) — капитаном становится следующий участник.
  const participantsRef = useRef(participants);
  participantsRef.current = participants;
  useEffect(() => {
    if (session.playMode !== "teams" || session.state.phase === "finished") return;
    const check = () => {
      const changes = captainChanges(participantsRef.current, Date.now() + clock.offset());
      for (const [teamId, uid] of Object.entries(changes)) {
        void participantsRepo.setCaptain(session.id, teamId, uid).catch(() => undefined);
      }
    };
    const timer = window.setInterval(check, CAPTAIN_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [session.id, session.playMode, session.state.phase]);

  // Названия команд скрыты: экран зала показывает «Команда 1 ★★★» — звёздочки по числу телефонов.
  const reveal = teamsReveal(session.state);
  const sizesKey = sizesString(
    Object.fromEntries(
      participants
        .filter((p) => p.kind === "team")
        .map((t) => [t.id, Math.min(100, participants.filter((p) => p.kind === "player" && p.teamId === t.id).length)]),
    ),
  );
  useEffect(() => {
    if (!reveal.hidden || session.state.phase !== "lobby") return;
    // Сравнение без учёта порядка ключей: база (jsonb) возвращает их в своём порядке.
    if (sizesString(reveal.sizes ?? {}) === sizesKey) return;
    const timer = window.setTimeout(() => {
      const current = teamsReveal(latest.current.state);
      if (!current.hidden) return;
      void sessionsRepo
        .apply(session.id, { state: { teams: { ...current, sizes: JSON.parse(sizesKey) as Record<string, number> } }, expect: { phase: "lobby" } })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [sizesKey, reveal.hidden, reveal.sizes, session.id, session.state.phase]);

  // Счётчик «Ответили: N» для экрана зала — не чаще раза в 2 секунды.
  const ownCount = answers.filter((a) => a.step === session.state.step).length;
  const lastCountWrite = useRef(0);
  useEffect(() => {
    if (session.state.stage !== "question" || ownCount === session.state.answered) return;
    const wait = Math.max(0, lastCountWrite.current + ANSWERED_THROTTLE_MS - Date.now());
    const timer = window.setTimeout(() => {
      lastCountWrite.current = Date.now();
      if (latest.current.state.stage === "question") {
        const { step } = latest.current.state;
        void sessionsRepo.apply(session.id, { state: { answered: ownCount }, expect: { step, stage: "question" } }).catch(() => undefined);
      }
    }, wait);
    return () => window.clearTimeout(timer);
  }, [ownCount, session.id, session.state.stage, session.state.answered]);

  const control: SessionControl = useMemo(
    () => ({
      apply: (change: SessionChange) => sessionsRepo.apply(session.id, change),
      clearAnswers: (step: number) => answersRepo.clearStep(session.id, step),
      freshAnswers: (step: number) => answersRepo.list(session.id, step),
      requestFinish: () => setConfirmFinish(true),
    }),
    [session.id],
  );

  async function start() {
    setBusy(true);
    setError(null);
    try {
      // Только из лобби: отставший второй пульт не вернёт идущую игру к первому вопросу.
      // Начало игры открывает названия команд, даже если их не представили.
      const teams = session.state.teams ? { teams: null } : {};
      await sessionsRepo.apply(session.id, { state: { ...startState(), startedAt: null, ...teams }, expect: { phase: "lobby" } });
    } catch (e) {
      if (errorCodeOf(e) !== "failed-precondition") setError("Не удалось начать игру. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      // Завершение сразу сохраняет компактные итоги для «Истории игр».
      await sessionsRepo.finish(latest.current, phones);
      setConfirmFinish(false);
    } catch {
      setError("Не удалось завершить игру. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  /** Досрочное награждение: пьедестал по текущему счёту с любого этапа игры. */
  async function award() {
    setBusy(true);
    setError(null);
    try {
      const { step, stage } = latest.current.state;
      await sessionsRepo.apply(session.id, { ...awardNow(latest.current), expect: { phase: "playing", step, stage } });
      setConfirmAward(false);
    } catch (e) {
      if (errorCodeOf(e) !== "failed-precondition") setError("Не получилось. Проверьте интернет.");
      else setConfirmAward(false);
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

  const { phase } = session.state;
  // Игра завершилась (с этого пульта или с другого) — показываем итоги и «В студию».
  useEffect(() => {
    if (phase === "finished") setTab("game");
  }, [phase]);
  const HostControls = mechanic?.HostControls;
  const withScreen = session.screenMode !== "none";
  const menu: MenuAction[] = [{ label: "В студию", to: "/studio" }];
  if (withScreen) menu.unshift({ label: "Открыть экран зала здесь", onClick: () => window.open(`/screen/${session.code}`, "_blank") });
  const tabs = PULT_TABS.filter((t) => withScreen || !t.screenOnly);
  const apply = (change: SessionChange) => sessionsRepo.apply(session.id, change);
  const slide = session.state.slide ?? null;
  const screen = useScreenStatus(session.id, withScreen && phase !== "finished");
  // Телефон ведущего не гаснет, пока идёт вечер.
  useWakeLock(phase !== "finished");
  const screenLabel = screen === undefined ? null : screenStatusLabel(screen);

  return (
    <main className="page page--pult">
      <TopBar title="Пульт" actions={menu} leaveWarning="Игра продолжится: гости играют дальше, пульт откроете снова из «Идёт игра» в студии." />
      <p className="pult-status" aria-live="polite">
        <span className="pult-status__code">{formatSessionCode(session.code)}</span>
        <span>{session.playMode === "teams" ? `телефонов: ${phones}` : `игроков: ${phones}`}</span>
        <span>{phase === "lobby" ? "ждём гостей" : phase === "playing" ? "идёт игра" : "завершена"}</span>
        {screenLabel && <span className={screenLabel.ok ? "pult-status__screen is-ok" : "pult-status__screen"}>{screenLabel.text}</span>}
      </p>

      {picking && withScreen && phase !== "finished" && (
        <RolePicker code={session.code} onPult={() => setPicking(false)} />
      )}

      {session.state.peek && (
        <div className="pult-banner" role="status">
          <span className="line-clamp">На экране {session.state.peek === "round" ? "счёт раунда" : "таблица"}</span>
          <button type="button" className="btn btn--secondary" onClick={() => void apply({ state: { peek: null } }).catch(() => undefined)}>
            Убрать
          </button>
        </div>
      )}

      {slide && (
        <div className="pult-banner" role="status">
          <span className="line-clamp">На экране слайд{slide.title ? ` «${slide.title}»` : ""}</span>
          <button type="button" className="btn btn--secondary" onClick={() => void apply({ state: { slide: null } }).catch(() => undefined)}>
            Убрать
          </button>
        </div>
      )}

      <div className="pult-panel" role="tabpanel" id={`pult-panel-${tab}`} aria-labelledby={`pult-tab-${tab}`}>
        {tab === "game" && (
          <>
            {phase === "lobby" && (
              <>
                <JoinCard session={session} link={link} compact={false} onCopy={() => void copyLink()} />
                {session.playMode === "teams" && <TeamsCard session={session} onApply={apply} />}
                <LobbyNames session={session} onMore={() => setTab("people")} />
                <button className="btn btn--block" disabled={busy || !mechanic} onClick={() => void start()}>
                  Начать игру
                </button>
              </>
            )}
            {phase === "playing" && HostControls && content !== null && (
              <section className="card">
                <Suspense fallback={null}>
                  <HostControls
                    session={session}
                    content={content}
                    answers={answers}
                    participants={participants}
                    control={control}
                    rehearsal={false}
                  />
                </Suspense>
              </section>
            )}
            {phase === "playing" && withScreen && !mechanic?.ownPeek && <PeekCard session={session} onApply={apply} />}
            {phase === "playing" && session.state.stage !== "podium" && hasPodium(session.leaderboard) && (
              <>
                <button className="btn btn--secondary btn--block" disabled={busy || !canAwardNow(session.state)} onClick={() => setConfirmAward(true)}>
                  Наградить сейчас
                </button>
                {!canAwardNow(session.state) && <p className="muted small">Наградить можно после того, как покажете ответ.</p>}
              </>
            )}
            {phase === "playing" && (
              <>
                <JoinCard session={session} link={link} compact onCopy={() => void copyLink()} />
                <button className="btn btn--quiet btn--block" disabled={busy} onClick={() => setConfirmFinish(true)}>
                  Завершить игру досрочно
                </button>
              </>
            )}
            {phase === "finished" && (
              <section className="card">
                <h2>Игра завершена</h2>
                <p>Итоги сохранены в «Истории игр».</p>
                <div className="actions">
                  <Link className="btn btn--block" to={`/results/${session.id}`}>
                    Открыть итоги
                  </Link>
                  <Link className="btn btn--secondary btn--block" to="/studio">
                    В студию
                  </Link>
                </div>
              </section>
            )}
          </>
        )}
        {tab === "sounds" && <SoundPad onCue={(cue) => apply({ state: { cue } })} />}
        {tab === "music" && <MusicPanel session={session} onApply={apply} />}
        {tab === "slides" && <SlidesPanel session={session} onApply={apply} />}
        {tab === "people" && <PeopleCard session={session} participants={participants} phones={phones} onToast={showToast} />}
        {(error ?? dataError) && (
          <p className="error" role="alert">
            {error ?? dataError}
          </p>
        )}
      </div>

      <nav className="pult-tabs" aria-label="Разделы пульта">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            id={`pult-tab-${t.id}`}
            className="pult-tabs__btn"
            aria-current={tab === t.id ? "page" : undefined}
            aria-controls={`pult-panel-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} className="pult-tabs__icon" />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <ConfirmDialog
        open={confirmFinish}
        title="Завершить игру?"
        confirmLabel="Завершить игру"
        busy={busy}
        error={error}
        onConfirm={() => void finish()}
        onCancel={() => setConfirmFinish(false)}
      >
        <p>Гости увидят финал и итоговую таблицу. Продолжить эту игру после завершения нельзя.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmAward}
        title="Наградить сейчас?"
        confirmLabel="Перейти к награждению"
        busy={busy}
        error={error}
        onConfirm={() => void award()}
        onCancel={() => setConfirmAward(false)}
      >
        <p>
          Оставшиеся вопросы пропускаются, экран перейдёт к пьедесталу по текущему счёту.
          {session.state.stage === "question" ? " Ответы на открытый сейчас вопрос не засчитаются." : ""} «Назад» на пульте вернёт к таблице.
        </p>
      </ConfirmDialog>
      <Toast text={toast} />
    </main>
  );
}

/**
 * Команды в лобби: «Скрыть названия команд» (экран показывает «Команда 1 ★★★») и «Представить
 * команды» — по одной, крупно, в порядке подключения; в конце — все вместе.
 */
function TeamsCard({ session, onApply }: { session: Session; onApply: (change: SessionChange) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const reveal = teamsReveal(session.state);
  const ordered = teamOrder(session.leaderboard);
  const presenting = reveal.shown !== null;
  const done = presentationDone(session.state, ordered.length);

  async function set(teams: TeamsReveal | null) {
    setBusy(true);
    try {
      await onApply({ state: { teams }, expect: { phase: "lobby" } });
    } catch {
      // Связь вернётся — ведущий нажмёт ещё раз.
    } finally {
      setBusy(false);
    }
  }

  if (presenting) {
    const shown = reveal.shown ?? 0;
    const current = ordered[shown];
    return (
      <section className="card teams-card" aria-live="polite">
        <p className="eyebrow">Представление команд</p>
        <p className="teams-card__now">
          {current ? (
            <>
              На экране: команда {current.number} из {ordered.length} — <NameText name={current.entry.name} />
            </>
          ) : (
            "На экране все команды"
          )}
        </p>
        <div className="actions">
          {!done && (
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void set({ ...reveal, shown: shown + 1 })}>
              {shown + 1 >= ordered.length ? "Показать все команды" : "Следующая команда"}
            </button>
          )}
          <button type="button" className="btn btn--secondary btn--block" disabled={busy || shown === 0} onClick={() => void set({ ...reveal, shown: Math.max(0, shown - 1) })}>
            Назад
          </button>
          <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void set({ hidden: false, shown: null })}>
            Закончить представление
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card teams-card">
      <label className="choice teams-card__hide">
        <input type="checkbox" checked={reveal.hidden} disabled={busy} onChange={(e) => void set({ hidden: e.target.checked, shown: null })} />
        <span className="choice__text">
          <span className="choice__title">Скрыть названия команд</span>
          <span className="choice__hint">Пока все подключаются, экран показывает «Команда 1 ★★★». Названия откроются на представлении.</span>
        </span>
      </label>
      <button type="button" className="btn btn--secondary btn--block" disabled={busy || ordered.length === 0} onClick={() => void set({ ...reveal, shown: 0 })}>
        Представить команды
      </button>
    </section>
  );
}

/** Таблица поверх игры по кнопке: общий счёт или счёт текущего раунда. */
function PeekCard({ session, onApply }: { session: Session; onApply: (change: SessionChange) => Promise<unknown> }) {
  const peek = session.state.peek ?? null;
  const hasRounds = Object.values(session.leaderboard).some((e) => (e.roundBase ?? 0) > 0);
  const toggle = (view: "total" | "round") => void onApply({ state: { peek: peek === view ? null : view } }).catch(() => undefined);
  return (
    <div className="row peek-card" role="group" aria-label="Таблица на экран">
      <button type="button" className={peek === "total" ? "btn btn--block" : "btn btn--secondary btn--block"} aria-pressed={peek === "total"} onClick={() => toggle("total")}>
        {peek === "total" ? "Убрать таблицу" : "Таблица на экран"}
      </button>
      {hasRounds && (
        <button type="button" className={peek === "round" ? "btn btn--block" : "btn btn--secondary btn--block"} aria-pressed={peek === "round"} onClick={() => toggle("round")}>
          {peek === "round" ? "Убрать счёт раунда" : "Счёт раунда"}
        </button>
      )}
    </div>
  );
}

const LOBBY_NAMES = 12;

/** Кто уже подключился — коротко, на главной вкладке пульта; все и правки — во вкладке «Гости». */
function LobbyNames({ session, onMore }: { session: Session; onMore: () => void }) {
  const board = rankedLeaderboard(session.leaderboard);
  if (board.length === 0) return <p className="muted small">Гости появятся здесь, как только отсканируют код.</p>;
  const rest = board.length - LOBBY_NAMES;
  return (
    <ul className="chips" aria-label={session.playMode === "teams" ? "Команды" : "Игроки"}>
      {board.slice(0, LOBBY_NAMES).map((entry) => (
        <li key={entry.id} className={entry.kind === "team" ? "chip chip--team" : "chip"} style={entry.colorIndex !== undefined ? ({ "--team-color": teamColorVar(entry.colorIndex) } as CSSProperties) : undefined}>
          {entry.name}
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button type="button" className="chip chip--more" onClick={onMore}>
            и ещё {rest}
          </button>
        </li>
      )}
    </ul>
  );
}

type PultTab = "game" | "sounds" | "music" | "slides" | "people";

const PULT_TABS: Array<{ id: PultTab; label: string; icon: IconName; screenOnly?: boolean }> = [
  { id: "game", label: "Игра", icon: "game" },
  { id: "sounds", label: "Звуки", icon: "sound", screenOnly: true },
  { id: "music", label: "Музыка", icon: "music", screenOnly: true },
  { id: "slides", label: "Слайды", icon: "slides", screenOnly: true },
  { id: "people", label: "Гости", icon: "people" },
];

/**
 * Что это устройство: пульт или экран зала (после «Создать сессию»). Второе устройство — вход в
 * студию → «Идёт игра» → нужная роль, или games.joy-rest.ru/s и код.
 */
function RolePicker({ code, onPult }: { code: string; onPult: () => void }) {
  const navigate = useNavigate();
  return (
    <section className="card role-picker" aria-labelledby="role-title">
      <h2 id="role-title">Это устройство —</h2>
      <div className="tiles tiles--two">
        <button type="button" className="tile tile--big" onClick={onPult}>
          <Icon name="remote" className="tile__icon" />
          <span className="tile__label">Пульт</span>
        </button>
        <button type="button" className="tile tile--big" onClick={() => navigate(`/screen/${code}`)}>
          <Icon name="screen" className="tile__icon" />
          <span className="tile__label">Экран зала</span>
        </button>
      </div>
      <p className="muted small">
        Второе устройство: войдите в студию — сверху будет «Идёт игра» с кнопками «Пульт» и «Экран зала». Без входа —
        откройте {joinHost()}/s и введите код {formatSessionCode(code)}.
      </p>
    </section>
  );
}

function JoinCard({ session, link, compact, onCopy }: { session: Session; link: string; compact: boolean; onCopy: () => void }) {
  const [qrOpen, setQrOpen] = useState(!compact);
  useEffect(() => setQrOpen(!compact), [compact]);
  return (
    <section className="card card--center" aria-label="Вход для гостей">
      <p className="eyebrow">{compact ? "Код для опоздавших" : "Код игры"}</p>
      <div className={compact ? "big-code big-code--small" : "big-code"}>{formatSessionCode(session.code)}</div>
      {qrOpen && <QrCode value={link} label={`QR-код для входа в игру ${formatSessionCode(session.code)}`} />}
      {qrOpen && <p className="link-hint muted">{playUrlHint(session.code)}</p>}
      {qrOpen && <p className="muted small">{VPN_HINT}</p>}
      <div className="actions">
        {!compact && session.screenMode !== "none" && (
          <Link className="btn btn--block" to={`/screen/${session.code}`} target="_blank">
            Открыть экран зала
          </Link>
        )}
        {compact && (
          <button type="button" className="btn btn--quiet btn--block" aria-expanded={qrOpen} onClick={() => setQrOpen((v) => !v)}>
            {qrOpen ? "Скрыть QR-код" : "Показать QR-код"}
          </button>
        )}
        <button
          type="button"
          className={session.screenMode === "none" && !compact ? "btn btn--block" : "btn btn--secondary btn--block"}
          onClick={onCopy}
        >
          Скопировать ссылку
        </button>
      </div>
      {session.screenMode === "none" && !compact && (
        <p className="muted">Режим без экрана: покажите гостям этот QR-код со своего телефона.</p>
      )}
    </section>
  );
}

function PresenceDot({ state }: { state: "on" | "off" | "manual" }) {
  if (state === "manual") return <span className="presence presence--manual" title="Без телефона" aria-label="без телефона" />;
  return <span className={`presence presence--${state}`} title={state === "on" ? "На связи" : "Не на связи"} aria-label={state === "on" ? "на связи" : "не на связи"} />;
}

type Edit =
  | { kind: "rename"; pid: string; name: string }
  | { kind: "remove"; pid: string; name: string; team: boolean }
  | { kind: "points"; pid: string; name: string }
  | { kind: "add" };

/** id участника, которого ведущий добавил вручную (гость без телефона). */
function manualId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return "m" + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

/** Игроки или команды: очки ±, переименовать, убрать, назначить капитана. */
function PeopleCard({
  session,
  participants,
  phones,
  onToast,
}: {
  session: Session;
  participants: Participant[];
  phones: number;
  onToast: (text: string) => void;
}) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [pointsInput, setPointsInput] = useState("");
  const now = Date.now() + clock.offset();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const board = rankedLeaderboard(session.leaderboard);
  const teams = session.playMode === "teams";
  const finished = session.state.phase === "finished";

  const adjust = useCallback(
    (pid: string, _entry: LeaderboardEntry, delta: number) => {
      // Прибавка на сервере: три быстрых «+10» — это +30, а не +10.
      void sessionsRepo
        .apply(session.id, { addScore: { [pid]: delta } })
        .catch(() => onToast("Не удалось изменить очки. Проверьте интернет."));
    },
    [session.id, onToast],
  );

  async function makeCaptain(teamId: string, phone: Participant) {
    try {
      await participantsRepo.setCaptain(session.id, teamId, phone.id);
      onToast(`Капитан — ${phone.name}`);
    } catch {
      onToast("Не удалось назначить капитана.");
    }
  }

  async function confirmEdit(sign: 1 | -1 = 1) {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      if (edit.kind === "rename" || edit.kind === "add") {
        const name = cleanName(nameInput);
        if (!isValidName(name)) {
          setError("Введите имя.");
          setBusy(false);
          return;
        }
        if (edit.kind === "add") {
          // Гость без телефона: только в таблице, очки ставит ведущий.
          const used = Object.values(session.leaderboard).map((e) => e.colorIndex ?? -1);
          const entry: LeaderboardEntry = teams
            ? { name, kind: "team", score: 0, colorIndex: Math.max(-1, ...used) + 1 }
            : { name, kind: "player", score: 0 };
          await sessionsRepo.apply(session.id, { leaderboard: { [manualId()]: entry } });
          onToast(teams ? "Команда добавлена" : "Игрок добавлен");
        } else {
          const entry = session.leaderboard[edit.pid];
          // Участник, добавленный вручную, есть только в таблице.
          if (participants.some((p) => p.id === edit.pid)) await participantsRepo.rename(session.id, edit.pid, name);
          if (entry) await sessionsRepo.apply(session.id, { rename: { [edit.pid]: name } });
          onToast("Имя изменено");
        }
      } else if (edit.kind === "points") {
        const amount = Number.parseInt(pointsInput.replace(/\s/g, ""), 10);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
          setError("Введите число от 1 до 100 000.");
          setBusy(false);
          return;
        }
        await sessionsRepo.apply(session.id, { addScore: { [edit.pid]: sign * amount } });
        onToast(`${sign > 0 ? "+" : "−"}${amount} — ${edit.name}`);
      } else {
        if (participants.some((p) => p.id === edit.pid)) await participantsRepo.remove(session.id, edit.pid);
        if (session.leaderboard[edit.pid]) await sessionsRepo.apply(session.id, { leaderboard: { [edit.pid]: null } });
        onToast(edit.team ? "Команда убрана" : "Игрок убран");
      }
      setEdit(null);
    } catch {
      setError("Не получилось. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  /** На связи ли телефон игрока или хотя бы один телефон команды. */
  function presence(pid: string): "on" | "off" | "manual" {
    if (teams) {
      const phones = participants.filter((p) => p.kind === "player" && p.teamId === pid);
      if (!participants.some((p) => p.id === pid)) return "manual";
      return phones.some((p) => isOnline(p, now)) ? "on" : "off";
    }
    const phone = participants.find((p) => p.id === pid);
    if (!phone) return "manual";
    return isOnline(phone, now) ? "on" : "off";
  }

  return (
    <section className="card">
      <h2>
        {teams ? "Команды" : "Игроки"}: {board.length}
      </h2>
      {teams && <p className="muted">Подключено телефонов: {phones}</p>}
      {!finished && (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => {
            setNameInput("");
            setError(null);
            setEdit({ kind: "add" });
          }}
        >
          {teams ? "+ Добавить команду" : "+ Добавить игрока"}
        </button>
      )}
      {board.length === 0 ? (
        <p className="muted">Пока никого. Попросите гостей отсканировать QR-код.</p>
      ) : (
        <ul className="people-list">
          {board.map((entry) => {
            const members = participants.filter((p) => p.kind === "player" && p.teamId === entry.id);
            const actions: MenuAction[] = [
              {
                label: "Очки: добавить или снять",
                onClick: () => {
                  setPointsInput("");
                  setError(null);
                  setEdit({ kind: "points", pid: entry.id, name: entry.name });
                },
              },
              {
                label: "Переименовать",
                onClick: () => {
                  setNameInput(entry.name);
                  setError(null);
                  setEdit({ kind: "rename", pid: entry.id, name: entry.name });
                },
              },
              {
                label: teams ? "Убрать команду" : "Убрать из игры",
                onClick: () => {
                  setError(null);
                  setEdit({ kind: "remove", pid: entry.id, name: entry.name, team: teams });
                },
              },
            ];
            return (
              <li key={entry.id} className="people-list__item">
                <div className="people-list__head">
                  <span className="people-list__place">{entry.place}</span>
                  <span className="people-list__name">
                    <PresenceDot state={presence(entry.id)} />
                    {entry.kind === "team" && (
                      <span className="team-dot" style={{ "--team-color": teamColorVar(entry.colorIndex) } as CSSProperties} aria-hidden />
                    )}
                    <NameText name={entry.name} />
                  </span>
                  <strong className="people-list__score">{entry.score}</strong>
                </div>
                {!finished && (
                  <div className="people-list__tools">
                    <button
                      type="button"
                      className="btn btn--secondary people-list__btn"
                      aria-label={`Минус ${SCORE_STEP} очков: ${entry.name}`}
                      onClick={() => adjust(entry.id, entry, -SCORE_STEP)}
                    >
                      −{SCORE_STEP}
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary people-list__btn"
                      aria-label={`Плюс ${SCORE_STEP} очков: ${entry.name}`}
                      onClick={() => adjust(entry.id, entry, SCORE_STEP)}
                    >
                      +{SCORE_STEP}
                    </button>
                    <ActionMenu icon="dots" label={`Действия: ${entry.name}`} actions={actions} />
                  </div>
                )}
                {teams && members.length > 0 && (
                  <ul className="people-list__members">
                    {members.map((m) => {
                      const captain = m.id === (entry.captainUid ?? "");
                      return (
                        <li key={m.id}>
                          <span>
                            <PresenceDot state={isOnline(m, now) ? "on" : "off"} />
                            {m.name}
                            {captain && <span className="muted"> · капитан</span>}
                          </span>
                          {!captain && !finished && (
                            <button type="button" className="btn btn--quiet" onClick={() => void makeCaptain(entry.id, m)}>
                              Сделать капитаном
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={edit !== null}
        title={
          edit?.kind === "rename"
            ? "Новое имя"
            : edit?.kind === "add"
              ? teams
                ? "Новая команда"
                : "Новый игрок"
              : edit?.kind === "points"
                ? `Очки: ${edit.name}`
                : edit?.kind === "remove" && edit.team
                  ? "Убрать команду?"
                  : "Убрать игрока?"
        }
        confirmLabel={edit?.kind === "rename" ? "Сохранить имя" : edit?.kind === "add" ? "Добавить" : edit?.kind === "points" ? "Добавить очки" : "Убрать"}
        cancelLabel={edit?.kind === "points" ? "Закрыть" : "Отмена"}
        busy={busy}
        error={error}
        onConfirm={() => void confirmEdit(1)}
        onCancel={() => setEdit(null)}
      >
        {edit?.kind === "rename" || edit?.kind === "add" ? (
          <>
            <label className="field">
              {teams && edit.kind === "add" ? "Название команды" : "Имя"}
              <input maxLength={NAME_MAX_LENGTH} value={nameInput} autoComplete="off" onChange={(e) => setNameInput(e.target.value)} />
            </label>
            {edit.kind === "add" && <p className="muted small">Без телефона: участник есть в таблице, очки ставите вы.</p>}
          </>
        ) : edit?.kind === "points" ? (
          <>
            <label className="field">
              Сколько очков
              <input inputMode="numeric" pattern="[0-9]*" value={pointsInput} autoComplete="off" onChange={(e) => setPointsInput(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void confirmEdit(-1)}>
              Снять очки
            </button>
          </>
        ) : (
          <p>
            «{edit?.name}» пропадёт из таблицы вместе с очками.{" "}
            {edit?.kind === "remove" && edit.team ? "Телефоны команды смогут войти заново в другую команду." : "Гость сможет войти заново."}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}

/** Число телефонов по командам — строкой с ключами по порядку (jsonb меняет порядок ключей). */
function sizesString(sizes: Record<string, number>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}
