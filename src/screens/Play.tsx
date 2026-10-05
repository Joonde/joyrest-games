import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { cleanName, isValidName, NAME_MAX_LENGTH } from "../core/names";
import {
  createTeam,
  ensureSignedIn,
  getMyParticipant,
  joinAsPlayer,
  listTeams,
  useSessionByCode,
  type Participant,
  type Session,
} from "../data";
import { Logo } from "../components/Logo";
import { Loading, Message } from "../components/Status";
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
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    ensureSignedIn()
      .then((user) => setUid(user.uid))
      .catch(() => setAuthError(true));
  }, []);

  const state = useSessionByCode(code, uid !== null);

  if (authError) return <Message title="Нет связи">Проверьте интернет и обновите страницу.</Message>;
  if (!uid || state.status === "loading") return <Loading text="Подключаемся к игре…" />;
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
  if (state.status === "error") return <Message title="Нет связи">{state.message}</Message>;
  return <PlayerScreen session={state.session} uid={uid} />;
}

function PlayerScreen({ session, uid }: { session: Session; uid: string }) {
  const [me, setMe] = useState<Participant | null | undefined>(undefined);
  const [team, setTeam] = useState<Participant | null>(null);
  useTheme(session.themeId);

  const reload = useCallback(async () => {
    const participant = await getMyParticipant(session.id, uid);
    setMe(participant);
    if (participant?.teamId) {
      const teams = await listTeams(session.id);
      setTeam(teams.find((t) => t.id === participant.teamId) ?? null);
    }
  }, [session.id, uid]);

  useEffect(() => {
    reload().catch(() => setMe(null));
  }, [reload]);

  if (me === undefined) return <Loading text="Проверяем, играли ли вы уже…" />;

  if (!me || (session.playMode === "teams" && !me.teamId)) {
    if (session.state.phase === "finished") {
      return <Message title="Игра уже завершена">Спасибо, что были с нами!</Message>;
    }
    return <JoinForm session={session} uid={uid} initialName={me?.name ?? rememberedName()} onJoined={reload} />;
  }

  return <Waiting session={session} me={me} team={team} uid={uid} />;
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
  const [name, setName] = useState(initialName);
  const [teams, setTeams] = useState<Participant[]>([]);
  const [teamId, setTeamId] = useState<string>("new");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeams = useCallback(() => {
    if (!teamsMode) return;
    listTeams(session.id)
      .then((list) => {
        setTeams(list);
        setTeamId((current) => (current === "new" && list[0] ? list[0].id : current));
      })
      .catch(() => setError("Не удалось загрузить команды."));
  }, [session.id, teamsMode]);

  useEffect(loadTeams, [loadTeams]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const cleanPlayer = cleanName(name);
    if (!isValidName(cleanPlayer)) {
      setError("Напишите своё имя.");
      return;
    }
    const cleanTeam = cleanName(teamName);
    if (teamsMode && teamId === "new" && !isValidName(cleanTeam)) {
      setError("Придумайте название команды.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let joinTeamId: string | null = null;
      if (teamsMode) {
        joinTeamId = teamId === "new" ? await createTeam(session.id, uid, cleanTeam) : teamId;
      }
      await joinAsPlayer(session.id, uid, cleanPlayer, joinTeamId);
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
        <label className="field">
          Имя
          <input
            autoComplete="given-name"
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

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
            <button type="button" className="btn btn--ghost" onClick={loadTeams}>
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

function Waiting({
  session,
  me,
  team,
  uid,
}: {
  session: Session;
  me: Participant;
  team: Participant | null;
  uid: string;
}) {
  const scoreId = session.playMode === "teams" ? me.teamId : me.id;
  const score = scoreId ? session.leaderboard[scoreId]?.score : undefined;
  const isCaptain = team?.captainUid === uid;
  const teamColor = me.teamId ? session.leaderboard[me.teamId]?.colorIndex : undefined;

  return (
    <main className="page page--center">
      <Logo kind="monogram" className="logo--mark" title="JoyRest" />
      <div className="card" style={{ textAlign: "center", alignItems: "center" }}>
        <p className="eyebrow">Игра {formatSessionCode(session.code)}</p>
        <h1>{me.name}</h1>
        {team && (
          <p>
            <span
              className="team-badge"
              style={{ "--team-color": teamColorVar(teamColor) } as CSSProperties}
            >
              Команда «{team.name}»
            </span>
            {isCaptain && <span className="muted"> · вы капитан</span>}
          </p>
        )}
        <div aria-live="polite">
          {session.state.phase === "lobby" && <p>Вы в игре! Ждём, когда ведущий начнёт.</p>}
          {session.state.phase === "playing" && <p>Игра началась. Смотрите на экран зала.</p>}
          {session.state.phase === "finished" && <p>Игра завершена. Спасибо!</p>}
        </div>
        {score !== undefined && <p className="muted">Очки: {score}</p>}
      </div>
    </main>
  );
}
