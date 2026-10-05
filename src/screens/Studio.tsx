import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import {
  createSession,
  listHostSessions,
  signOutUser,
  type AuthUser,
  type PlayMode,
  type ScreenMode,
  type Session,
  type UserProfile,
} from "../data";
import { HostGate } from "../components/HostGate";
import { StudioSkeleton } from "../components/Skeleton";
import { TopBar, type TopBarAction } from "../components/TopBar";
import { DEFAULT_THEME_ID, themes } from "../themes/registry";

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

const PHASE_TITLES: Record<Session["state"]["phase"], string> = {
  lobby: "ждёт начала",
  playing: "идёт",
  finished: "завершена",
};

export function Studio() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(user, profile) => <StudioContent user={user} profile={profile} />}
    </HostGate>
  );
}

function StudioContent({ user, profile }: { user: AuthUser; profile: UserProfile }) {
  const navigate = useNavigate();
  const [playMode, setPlayMode] = useState<PlayMode>("solo");
  const [screenMode, setScreenMode] = useState<ScreenMode>("laptop");
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    listHostSessions(user.uid)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [user.uid]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { code } = await createSession(user.uid, {
        playMode,
        screenMode,
        themeId,
        mechanic: null,
        gameSnapshot: null,
      });
      navigate(`/host/${code}`);
    } catch {
      setError("Не удалось создать сессию. Проверьте интернет и попробуйте снова.");
      setBusy(false);
    }
  }

  const actions: TopBarAction[] = [
    ...(profile.role === "admin" ? [{ label: "Ведущие", to: "/admin" }] : []),
    { label: "Выйти", onClick: () => void signOutUser() },
  ];

  return (
    <main className="page">
      <TopBar title="Студия" actions={actions} />
      <p className="muted small">
        {profile.name} · {user.email}
      </p>

      <form className="card" onSubmit={onCreate}>
        <h2>Новая сессия</h2>
        <p className="muted">Конструктор игр появится позже. Пока можно проверить вход гостей и экран зала.</p>
        <fieldset>
          <legend>Как проводим</legend>
          {SCREEN_MODES.map((mode) => (
            <label key={mode.id} className="choice">
              <input
                type="radio"
                name="screenMode"
                checked={screenMode === mode.id}
                onChange={() => setScreenMode(mode.id)}
              />
              <span className="choice__text">
                <span className="choice__title">{mode.title}</span>
                <span className="choice__hint">{mode.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Участники</legend>
          {PLAY_MODES.map((mode) => (
            <label key={mode.id} className="choice">
              <input
                type="radio"
                name="playMode"
                checked={playMode === mode.id}
                onChange={() => setPlayMode(mode.id)}
              />
              <span className="choice__text">
                <span className="choice__title">{mode.title}</span>
                <span className="choice__hint">{mode.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Оформление</legend>
          {themes.map((theme) => (
            <label key={theme.id} className="choice">
              <input
                type="radio"
                name="themeId"
                checked={themeId === theme.id}
                onChange={() => setThemeId(theme.id)}
              />
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

      <section className="card">
        <h2>Мои сессии</h2>
        {sessions === null && <p className="muted">Загружаем…</p>}
        {sessions?.length === 0 && <p className="muted">Сессий пока нет.</p>}
        {sessions && sessions.length > 0 && (
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link className="nowrap" to={`/host/${s.code}`}>
                  {formatSessionCode(s.code)}
                </Link>
                <span className="muted small">
                  {PHASE_TITLES[s.state.phase]}
                  {s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString("ru-RU")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
