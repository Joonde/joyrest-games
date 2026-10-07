import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { randomEmoji, splitEmoji, withEmoji } from "../core/emoji";
import { cleanName, isValidName, NAME_MAX_LENGTH } from "../core/names";
import { VPN_HINT } from "../core/texts";
import { snapshotContent } from "../core/games";
import { placeOf } from "../core/leaderboard";
import { pointsLabel } from "../core/results";
import {
  answersRepo,
  participantsRepo,
  useGuestSignIn,
  useSessionByCode,
  withRetry,
  type Participant,
  type Session,
} from "../data";
import { useWakeLock } from "../components/live/useWakeLock";
import { EmojiPicker } from "../components/EmojiPicker";
import { Logo } from "../components/Logo";
import { getMechanic } from "../mechanics/registry";
import type { PhoneRole } from "../mechanics/types";
import { PlaySkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { teamColorVar, useTheme } from "../themes/registry";

const NAME_STORAGE_KEY = "joyrest.playerName";

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // Приватный режим браузера: имя просто не запомнится.
  }
}

export function Play() {
  const { code = "" } = useParams();
  const [auth, retryAuth] = useGuestSignIn();
  const [state, retry] = useSessionByCode(code, { enabled: auth.status === "ready" });

  if (auth.status === "error") return <LoadFailed onRetry={retryAuth} />;
  if (auth.status === "loading" || state.status === "loading") {
    return (
      <Pending
        skeleton={<PlaySkeleton />}
        label="Подключаемся к игре"
      />
    );
  }
  if (state.status === "notFound") {
    return (
      <Message title="Игра не найдена">
        <p>Проверьте код {formatSessionCode(code)} на экране зала.</p>
        <Link className="btn btn--block" to="/j">
          Ввести код заново
        </Link>
      </Message>
    );
  }
  if (state.status === "error") return <LoadFailed onRetry={retry}>{state.message}</LoadFailed>;
  return <PlayerScreen session={state.session} uid={auth.uid} />;
}

function PlayerScreen({ session, uid }: { session: Session; uid: string }) {
  const [me, setMe] = useState<Participant | null | undefined>(undefined);
  const [team, setTeam] = useState<Participant | null>(null);
  useTheme(session.themeId);

  const reload = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      // Медленная сеть — не повод показать форму входа тому, кто уже в игре: ждём ответа.
      const participant = await withRetry(() => participantsRepo.getMine(session.id, uid), isCancelled);
      let found: Participant | null = null;
      if (participant?.teamId) {
        const teamId = participant.teamId;
        const teams = await withRetry(() => participantsRepo.listTeams(session.id), isCancelled);
        found = teams.find((t) => t.id === teamId) ?? null;
      }
      if (isCancelled()) return;
      setTeam(found);
      setMe(participant);
    },
    [session.id, uid],
  );

  useEffect(() => {
    let cancelled = false;
    reload(() => cancelled).catch(() => !cancelled && setMe(null));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  if (me === undefined) return <Pending skeleton={<PlaySkeleton />} label="Проверяем, играли ли вы уже" />;

  // В режиме команд телефон без команды (или команду убрал ведущий) выбирает команду заново.
  if (!me || (session.playMode === "teams" && (!me.teamId || !team))) {
    if (session.state.phase === "finished") {
      return <Message title="Игра уже завершена">Спасибо, что были с нами!</Message>;
    }
    return <JoinForm session={session} uid={uid} initialName={me?.name ?? rememberedName()} onJoined={reload} />;
  }

  return <InGame session={session} me={me} team={team} uid={uid} onRejoin={() => setMe(null)} />;
}

function JoinForm({
  session,
  uid,
  initialName,
  onJoined,
}: {
  session: Session;
  uid: string;
  initialName: string;
  onJoined: () => Promise<void>;
}) {
  const teamsMode = session.playMode === "teams";
  // Смайлик к имени: прежний (повторный вход) или случайный — в зале разнообразно.
  const remembered = splitEmoji(initialName);
  const [name, setName] = useState(remembered.name);
  const [emoji, setEmoji] = useState<string | null>(() => remembered.emoji ?? randomEmoji());
  const [teamEmoji, setTeamEmoji] = useState<string | null>(() => randomEmoji());
  const [teams, setTeams] = useState<Participant[]>([]);
  const [teamId, setTeamId] = useState<string>("new");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeams = useCallback(() => {
    if (!teamsMode) return;
    participantsRepo
      .listTeams(session.id)
      .then((list) => {
        setTeams(list);
        setTeamId((current) => (current === "new" && list[0] ? list[0].id : current));
      })
      .catch(() => setError("Не удалось загрузить команды."));
  }, [session.id, teamsMode]);

  useEffect(loadTeams, [loadTeams]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const plainPlayer = cleanName(name);
    // В режиме команд смайлик — у команды, имя игрока без него.
    const cleanPlayer = teamsMode ? plainPlayer : withEmoji(emoji, plainPlayer);
    if (!isValidName(plainPlayer)) {
      setError("Напишите своё имя.");
      return;
    }
    const plainTeam = cleanName(teamName);
    const cleanTeam = withEmoji(teamEmoji, plainTeam);
    if (teamsMode && teamId === "new" && !isValidName(plainTeam)) {
      setError("Придумайте название команды.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let joinTeamId: string | null = null;
      if (teamsMode) {
        joinTeamId = teamId === "new" ? await participantsRepo.createTeam(session.id, uid, cleanTeam) : teamId;
      }
      await participantsRepo.joinAsPlayer(session.id, uid, cleanPlayer, joinTeamId);
      rememberName(cleanPlayer);
      await onJoined();
    } catch {
      setError("Не получилось войти. Проверьте интернет и попробуйте снова.");
      setBusy(false);
    }
  }

  return (
    <main className="page page--center">
      <Logo kind="full" className="logo--form" />
      <form className="card" onSubmit={onSubmit}>
        <p className="eyebrow">Игра {formatSessionCode(session.code)}</p>
        <h1>Как вас зовут?</h1>
        <p className="muted small">{VPN_HINT}</p>
        <label className="field">
          Имя
          <input
            autoComplete="given-name"
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!teamsMode && <EmojiPicker label="Смайлик к имени" value={emoji} onChange={setEmoji} preview={name} previewLabel="Так вас увидят" />}

        {teamsMode && (
          <fieldset>
            <legend>Команда</legend>
            {teams.map((t) => (
              <label key={t.id} className="choice">
                <input type="radio" name="team" checked={teamId === t.id} onChange={() => setTeamId(t.id)} />
                <span>{t.name}</span>
              </label>
            ))}
            <label className="choice">
              <input type="radio" name="team" checked={teamId === "new"} onChange={() => setTeamId("new")} />
              <span>Новая команда (вы станете капитаном)</span>
            </label>
            {teamId === "new" && (
              <label className="field">
                Название команды
                <input maxLength={NAME_MAX_LENGTH} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              </label>
            )}
            {teamId === "new" && (
              <EmojiPicker label="Смайлик команды" value={teamEmoji} onChange={setTeamEmoji} preview={teamName} previewLabel="Так увидят команду" />
            )}
            <button type="button" className="btn btn--secondary" onClick={loadTeams}>
              Обновить список команд
            </button>
          </fieldset>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--block" type="submit" disabled={busy}>
          {busy ? "Входим…" : "Играть"}
        </button>
      </form>
    </main>
  );
}

const ANSWER_KEY = "joyrest.answer";
/** Как часто телефон капитана сообщает «я на связи». */
const HEARTBEAT_MS = 30_000;

/** Ответ на шаг запоминается на телефоне: после перезагрузки гость видит, что ответил. */
function rememberedAnswer(sessionId: string, step: number): { value: unknown } | null {
  try {
    const raw = localStorage.getItem(`${ANSWER_KEY}.${sessionId}.${step}`);
    return raw === null ? null : { value: JSON.parse(raw) as unknown };
  } catch {
    return null;
  }
}

function rememberAnswer(sessionId: string, step: number, value: unknown): void {
  try {
    localStorage.setItem(`${ANSWER_KEY}.${sessionId}.${step}`, JSON.stringify(value));
  } catch {
    // Приватный режим: ответ узнаем у сервера.
  }
}

/** Ответ на текущий шаг: с телефона, а если его нет — с сервера (после перезагрузки, у участника команды). */
function useMyAnswer(session: Session, pid: string, ask: boolean) {
  const { step } = session.state;
  const [answer, setAnswer] = useState<{ step: number; value: { value: unknown } | null } | null>(null);

  useEffect(() => {
    const local = rememberedAnswer(session.id, step);
    if (local) {
      setAnswer({ step, value: local });
      return;
    }
    setAnswer(null);
    if (!ask) {
      setAnswer({ step, value: null });
      return;
    }
    let cancelled = false;
    withRetry(() => answersRepo.getOwn(session.id, step, pid), () => cancelled)
      .then((found) => !cancelled && setAnswer({ step, value: found ? { value: found.value } : null }))
      .catch(() => !cancelled && setAnswer({ step, value: null }));
    return () => {
      cancelled = true;
    };
  }, [session.id, step, pid, ask]);

  const current = answer?.step === step ? answer.value : undefined;
  return [current, (value: unknown) => setAnswer({ step, value: { value } })] as const;
}

function InGame({
  session,
  me,
  team,
  uid,
  onRejoin,
}: {
  session: Session;
  me: Participant;
  team: Participant | null;
  uid: string;
  onRejoin: () => void;
}) {
  const teams = session.playMode === "teams";
  const pid = teams ? (me.teamId ?? me.id) : me.id;
  const entry = session.leaderboard[pid];
  // Капитана телефоны узнают из таблицы лидеров (её пульт держит в актуальном виде).
  const captainUid = teams ? (entry?.captainUid ?? team?.captainUid ?? "") : uid;
  const role: PhoneRole = !teams ? "player" : captainUid === uid ? "captain" : "member";
  const { phase, stage } = session.state;
  const mechanic = getMechanic(session.mechanic);
  const content = useMemo(
    () => (mechanic ? mechanic.parse(snapshotContent(session.gameSnapshot)) : null),
    [mechanic, session.gameSnapshot],
  );
  // С сервера ответ спрашиваем только в двух случаях: телефон открыли заново посреди шага
  // (ответ мог уйти до перезагрузки) и участник команды при показе ответа (отвечал капитан).
  const firstStep = useRef(session.state.step);
  const ask =
    (session.state.step === firstStep.current && stage !== "ready") ||
    (role === "member" && (stage === "reveal" || stage === "board"));
  const [myAnswer, setMyAnswer] = useMyAnswer(session, pid, phase === "playing" && ask);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useWakeLock(phase !== "finished");

  // Ведущий убрал гостя: запись была в таблице и пропала.
  const seen = useRef(false);
  if (entry) seen.current = true;
  const removed = seen.current && !entry && phase !== "finished";

  // Капитан раз в 30 секунд сообщает «я на связи»; пропадёт — капитаном станет следующий.
  useEffect(() => {
    if (role !== "captain" || phase === "finished") return;
    const touch = () => {
      if (document.visibilityState === "visible") void participantsRepo.touch(session.id, uid).catch(() => undefined);
    };
    touch();
    const timer = window.setInterval(touch, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", touch);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", touch);
    };
  }, [role, phase, session.id, uid]);

  async function answer(value: unknown) {
    const step = session.state.step;
    setSending(true);
    setError(null);
    rememberAnswer(session.id, step, value);
    setMyAnswer(value);
    try {
      const result = await answersRepo.submit(session.id, step, pid, uid, value);
      if (result === "rejected") {
        // Ответ уже есть (повторное нажатие) или время вышло: узнаём, что записано на сервере.
        const saved = await answersRepo.getOwn(session.id, step, pid).catch(() => null);
        if (saved) {
          rememberAnswer(session.id, step, saved.value);
          setMyAnswer(saved.value);
        } else {
          forgetAnswer(session.id, step);
          setError("Ответ не принят: время вышло.");
        }
      }
    } catch {
      setError("Не удалось отправить. Проверьте интернет.");
    } finally {
      setSending(false);
    }
  }

  const teamColor = me.teamId ? session.leaderboard[me.teamId]?.colorIndex : undefined;
  const name = teams ? me.name : (entry?.name ?? me.name);
  const PlayerView = mechanic?.PlayerView;

  if (removed) {
    return (
      <Message title="Вас нет в списке игроков">
        <p>Ведущий убрал вас из игры. Если это ошибка — войдите снова.</p>
        <div className="actions">
          <button type="button" className="btn btn--block" onClick={onRejoin}>
            Войти снова
          </button>
        </div>
      </Message>
    );
  }

  return (
    <main className="page page--play">
      <header className="play-head">
        <Logo kind="monogram" className="logo--mark" title="JoyRest" />
        <div className="play-head__who">
          <span className="play-head__name">{name}</span>
          {team && (
            <span className="team-badge team-badge--small" style={{ "--team-color": teamColorVar(teamColor) } as CSSProperties}>
              {entry?.name ?? team.name}
              {role === "captain" ? " · капитан" : ""}
            </span>
          )}
        </div>
      </header>

      {phase === "lobby" && (
        <div className="card card--center">
          <p className="eyebrow">Игра {formatSessionCode(session.code)}</p>
          <h1>Вы в игре!</h1>
          <p>Ждём, когда ведущий начнёт.</p>
          {role === "captain" && <p className="muted">Вы капитан: отвечать за команду будете вы.</p>}
          {role === "member" && <p className="muted">Отвечает капитан, вопросы увидите и вы.</p>}
        </div>
      )}

      {phase === "playing" && PlayerView && content !== null && (
        <div className="card">
          <PlayerView
            session={session}
            content={content}
            participant={me}
            pid={pid}
            role={role}
            myAnswer={myAnswer}
            sending={sending}
            onAnswer={(value) => void answer(value)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {phase === "finished" && <FinalCard session={session} pid={pid} />}
    </main>
  );
}

function forgetAnswer(sessionId: string, step: number): void {
  try {
    localStorage.removeItem(`${ANSWER_KEY}.${sessionId}.${step}`);
  } catch {
    // Нечего забывать.
  }
}

function FinalCard({ session, pid }: { session: Session; pid: string }) {
  const place = placeOf(session.leaderboard, pid);
  const entry = session.leaderboard[pid];
  return (
    <div className="card card--center">
      <p className="eyebrow">Игра завершена</p>
      {place && entry ? (
        <>
          <p className="quiz-phone__place">{place.place}</p>
          <p className="quiz-phone__score">
            место из {place.total} · {pointsLabel(entry.score)}
          </p>
          <p>{place.place === 1 ? "Поздравляем с победой!" : "Спасибо за игру!"}</p>
        </>
      ) : (
        <p>Спасибо, что были с нами!</p>
      )}
      <div className="actions">
        <Link className="btn btn--secondary btn--block" to={`/results/${session.id}`}>
          Итоги игры
        </Link>
      </div>
    </div>
  );
}
