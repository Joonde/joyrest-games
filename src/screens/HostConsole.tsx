import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { snapshotContent } from "../core/games";
import { captainChanges, leaderboardAdditions, rankedLeaderboard } from "../core/leaderboard";
import { cleanName, isValidName, NAME_MAX_LENGTH } from "../core/names";
import { startState } from "../core/session";
import {
  answersRepo,
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
} from "../data";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HostGate } from "../components/HostGate";
import { ActionMenu, type MenuAction } from "../components/Menu";
import { QrCode } from "../components/QrCode";
import { VPN_HINT } from "../core/texts";
import { ConsoleSkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { Toast, useToast } from "../components/Toast";
import { SoundPad } from "../components/live/SoundPad";
import { TopBar } from "../components/TopBar";
import { playUrl, playUrlHint } from "../components/links";
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
  const [toast, showToast] = useToast();
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

  // Счётчик «Ответили: N» для экрана зала — не чаще раза в 2 секунды.
  const ownCount = answers.filter((a) => a.step === session.state.step).length;
  const lastCountWrite = useRef(0);
  useEffect(() => {
    if (session.state.stage !== "question" || ownCount === session.state.answered) return;
    const wait = Math.max(0, lastCountWrite.current + ANSWERED_THROTTLE_MS - Date.now());
    const timer = window.setTimeout(() => {
      lastCountWrite.current = Date.now();
      if (latest.current.state.stage === "question") {
        void sessionsRepo.apply(session.id, { state: { answered: ownCount } }).catch(() => undefined);
      }
    }, wait);
    return () => window.clearTimeout(timer);
  }, [ownCount, session.id, session.state.stage, session.state.answered]);

  const control: SessionControl = useMemo(
    () => ({
      apply: (change: SessionChange) => sessionsRepo.apply(session.id, change),
      clearAnswers: (step: number) => answersRepo.clearStep(session.id, step),
      requestFinish: () => setConfirmFinish(true),
    }),
    [session.id],
  );

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await sessionsRepo.apply(session.id, { state: { ...startState(), startedAt: null } });
    } catch {
      setError("Не удалось начать игру. Проверьте интернет.");
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

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      showToast("Ссылка скопирована");
    } catch {
      showToast("Не удалось скопировать. Покажите гостям QR-код.");
    }
  }

  const { phase } = session.state;
  const HostControls = mechanic?.HostControls;
  const menu: MenuAction[] = [{ label: "В студию", to: "/studio" }];
  if (session.screenMode !== "none") menu.unshift({ label: "Экран зала", onClick: () => window.open(`/screen/${session.code}`, "_blank") });

  return (
    <main className="page">
      <TopBar title="Пульт" actions={menu} />
      {session.gameTitle && <p className="muted small line-clamp">{session.gameTitle}</p>}

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

      {phase !== "finished" && session.screenMode !== "none" && (
        <SoundPad onCue={(cue) => sessionsRepo.apply(session.id, { state: { cue } })} />
      )}

      {phase !== "finished" && (
        <JoinCard session={session} link={link} compact={phase === "playing"} onCopy={() => void copyLink()} />
      )}

      <section className="card">
        {phase === "lobby" && (
          <>
            <h2>Управление</h2>
            <p className="muted">Когда гости подключатся, начните игру. Опоздавшие смогут войти и во время игры.</p>
            <button className="btn btn--block" disabled={busy || !mechanic} onClick={() => void start()}>
              Начать игру
            </button>
          </>
        )}
        {phase === "playing" && (
          <>
            <p className="muted small">Игру можно завершить в любой момент — итоги сохранятся.</p>
            <div className="actions">
              <button className="btn btn--secondary btn--block" disabled={busy} onClick={() => setConfirmFinish(true)}>
                Завершить игру
              </button>
            </div>
          </>
        )}
        {phase === "finished" && (
          <>
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
          </>
        )}
        {(error ?? dataError) && (
          <p className="error" role="alert">
            {error ?? dataError}
          </p>
        )}
      </section>

      <PeopleCard session={session} participants={participants} phones={phones} onToast={showToast} />

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
      <Toast text={toast} />
    </main>
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

type Edit = { kind: "rename"; pid: string; name: string } | { kind: "remove"; pid: string; name: string; team: boolean };

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const board = rankedLeaderboard(session.leaderboard);
  const teams = session.playMode === "teams";
  const finished = session.state.phase === "finished";

  const adjust = useCallback(
    (pid: string, entry: LeaderboardEntry, delta: number) => {
      void sessionsRepo
        .apply(session.id, { leaderboard: { [pid]: { ...entry, score: entry.score + delta } } })
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

  async function confirmEdit() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      if (edit.kind === "rename") {
        const name = cleanName(nameInput);
        if (!isValidName(name)) {
          setError("Введите имя.");
          setBusy(false);
          return;
        }
        const entry = session.leaderboard[edit.pid];
        await participantsRepo.rename(session.id, edit.pid, name);
        if (entry) await sessionsRepo.apply(session.id, { leaderboard: { [edit.pid]: { ...entry, name } } });
        onToast("Имя изменено");
      } else {
        await participantsRepo.remove(session.id, edit.pid);
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

  return (
    <section className="card">
      <h2>
        {teams ? "Команды" : "Игроки"}: {board.length}
      </h2>
      {teams && <p className="muted">Подключено телефонов: {phones}</p>}
      {board.length === 0 ? (
        <p className="muted">Пока никого. Попросите гостей отсканировать QR-код.</p>
      ) : (
        <ul className="people-list">
          {board.map((entry) => {
            const members = participants.filter((p) => p.kind === "player" && p.teamId === entry.id);
            const actions: MenuAction[] = [
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
                    {entry.kind === "team" && (
                      <span className="team-dot" style={{ "--team-color": teamColorVar(entry.colorIndex) } as CSSProperties} aria-hidden />
                    )}
                    {entry.name}
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
        title={edit?.kind === "rename" ? "Новое имя" : edit?.team ? "Убрать команду?" : "Убрать игрока?"}
        confirmLabel={edit?.kind === "rename" ? "Сохранить имя" : "Убрать"}
        busy={busy}
        error={error}
        onConfirm={() => void confirmEdit()}
        onCancel={() => setEdit(null)}
      >
        {edit?.kind === "rename" ? (
          <label className="field">
            Имя
            <input maxLength={NAME_MAX_LENGTH} value={nameInput} autoComplete="off" onChange={(e) => setNameInput(e.target.value)} />
          </label>
        ) : (
          <p>
            «{edit?.name}» пропадёт из таблицы вместе с очками.{" "}
            {edit?.team ? "Телефоны команды смогут войти заново в другую команду." : "Гость сможет войти заново."}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
