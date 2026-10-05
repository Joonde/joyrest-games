import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { isStrongEnough, PASSWORD_MIN_LENGTH } from "../../core/password";
import { authService } from "../../data";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { TopBar } from "../../components/TopBar";

export function ChangePassword() {
  return <HostGate skeleton={<StudioSkeleton />}>{() => <PasswordForm />}</HostGate>;
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isStrongEnough(next)) {
      setError(`Новый пароль — не меньше ${PASSWORD_MIN_LENGTH} символов.`);
      return;
    }
    if (next !== repeat) {
      setError("Пароли не совпадают.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authService.changePassword(current, next);
      setDone(true);
    } catch (e) {
      setError(authService.describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <TopBar title="Пароль" actions={[{ label: "В студию", to: "/studio" }]} />
      {done ? (
        <section className="card">
          <h2>Пароль изменён</h2>
          <p>В следующий раз входите с новым паролем.</p>
          <div className="actions">
            <Link className="btn btn--block" to="/studio">
              В студию
            </Link>
          </div>
        </section>
      ) : (
        <form className="card" onSubmit={onSubmit}>
          <h2>Сменить пароль</h2>
          <p className="muted">Если вам выдали временный пароль, замените его на свой.</p>
          <label className="field">
            Текущий пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="field">
            Новый пароль
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label className="field">
            Новый пароль ещё раз
            <input
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn--block" type="submit" disabled={busy}>
            {busy ? "Меняем…" : "Сменить пароль"}
          </button>
        </form>
      )}
    </main>
  );
}
