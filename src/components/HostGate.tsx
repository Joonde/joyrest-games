import { useState, type FormEvent, type ReactNode } from "react";
import {
  describeAuthError,
  signInHost,
  signOutUser,
  useAuth,
  type AuthUser,
  type UserProfile,
} from "../data";
import { Logo } from "./Logo";
import { LoadFailed, Message, Pending } from "./Status";

interface Props {
  requireAdmin?: boolean;
  /** Каркас экрана, который показывается, пока проверяется вход. */
  skeleton: ReactNode;
  children: (user: AuthUser, profile: UserProfile) => ReactNode;
}

/** Пускает дальше только вошедшего активного ведущего (или admin). */
export function HostGate({ requireAdmin = false, skeleton, children }: Props) {
  const [auth, retry] = useAuth();

  if (auth.status === "loading") return <Pending skeleton={skeleton} onRetry={retry} label="Проверяем вход" />;
  if (auth.status === "error") return <LoadFailed onRetry={retry} />;
  if (auth.status === "signedOut" || auth.user.anonymous) return <LoginForm />;

  const { user, profile } = auth;
  if (!profile || !profile.active) {
    return (
      <Message title="Нет доступа">
        <p>Аккаунт {user.email} не подключён как ведущий. Попросите администратора добавить вас.</p>
        <button className="btn btn--secondary" onClick={() => void signOutUser()}>
          Выйти
        </button>
      </Message>
    );
  }
  if (requireAdmin && profile.role !== "admin") {
    return (
      <Message title="Только для администратора">
        <p>Этот раздел доступен владельцу агентства.</p>
      </Message>
    );
  }
  return <>{children(user, profile)}</>;
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInHost(email, password);
    } catch (e) {
      setError(describeAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page--center">
      <Logo kind="monogram" className="logo--mark" title="" />
      <form className="card" onSubmit={onSubmit}>
        <h1>Вход для ведущего</h1>
        <label className="field">
          Почта
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--block" type="submit" disabled={busy}>
          {busy ? "Входим…" : "Войти"}
        </button>
        <p className="muted">Аккаунт ведущего создаёт администратор агентства.</p>
      </form>
    </main>
  );
}
