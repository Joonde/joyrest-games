import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { SESSION_CODE_LENGTH, isValidSessionCode, normalizeSessionCode } from "../core/code";

const TEXTS = {
  play: { title: "Вход в игру", label: "Код с экрана", hint: "Он показан на экране зала.", button: "Войти в игру", path: "/play/" },
  screen: {
    title: "Экран зала",
    label: "Код игры с пульта",
    hint: "Он показан на пульте ведущего.",
    button: "Открыть экран зала",
    path: "/screen/",
  },
} as const;

/**
 * Вход по коду: гость — `/j`, экран зала на чужом телевизоре или ноутбуке без входа — `/s`
 * (короткий адрес вместо games.joy-rest.ru/screen/482913).
 */
export function JoinByCode({ target = "play" }: { target?: "play" | "screen" }) {
  const t = TEXTS[target];
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeSessionCode(code);
    if (!isValidSessionCode(normalized)) {
      setError(`Код состоит из ${SESSION_CODE_LENGTH} цифр. ${t.hint}`);
      return;
    }
    navigate(`${t.path}${normalized}`);
  }

  return (
    <main className="page page--center">
      <Logo kind="full" className="logo--form" />
      <form className="card" onSubmit={onSubmit}>
        <h1>{t.title}</h1>
        <label className="field">
          {t.label}
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
          {t.button}
        </button>
      </form>
    </main>
  );
}
