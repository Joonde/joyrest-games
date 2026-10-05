import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { SESSION_CODE_LENGTH, isValidSessionCode, normalizeSessionCode } from "../core/code";

export function JoinByCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeSessionCode(code);
    if (!isValidSessionCode(normalized)) {
      setError(`Код состоит из ${SESSION_CODE_LENGTH} цифр. Он показан на экране зала.`);
      return;
    }
    navigate(`/play/${normalized}`);
  }

  return (
    <main className="page page--center">
      <Logo kind="full" className="logo--form" />
      <form className="card" onSubmit={onSubmit}>
        <h1>Вход в игру</h1>
        <label className="field">
          Код с экрана
          <input
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 \-]*"
            maxLength={SESSION_CODE_LENGTH + 2}
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--block" type="submit">
          Войти в игру
        </button>
      </form>
    </main>
  );
}
