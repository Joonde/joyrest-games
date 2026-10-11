// «Помощь зала» по QR (`/vote/:code`): гость наводит камеру на экран зала и голосует за вариант, не входя
// в игру — без имени, без места в таблице. Страница слушает документ сессии: голосование открылось —
// появляются варианты; голос можно поменять, пока идёт время. Только свой сервер (`audienceRepo`).
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatSessionCode } from "../core/code";
import { snapshotContent } from "../core/games";
import { acceptsAnswers, secondsLeft } from "../core/session";
import { audienceRepo, useGuestSignIn, useSessionByCode, type Session } from "../data";
import { useServerNow } from "../components/live/useServerNow";
import { Logo } from "../components/Logo";
import { PlaySkeleton } from "../components/Skeleton";
import { LoadFailed, Message, Pending } from "../components/Status";
import { LETTERS, parseMillionaire } from "../mechanics/millionaire/content";
import { parseMillionaireResult, questionOf } from "../mechanics/millionaire/logic";
import { useTheme } from "../themes/registry";

export function AudienceVote() {
  const { code = "" } = useParams();
  const [auth, retryAuth] = useGuestSignIn();
  const [state, retry] = useSessionByCode(code, { enabled: auth.status === "ready" });

  if (auth.status === "error") return <LoadFailed onRetry={retryAuth} />;
  if (auth.status === "loading" || state.status === "loading") return <Pending skeleton={<PlaySkeleton />} label="Подключаемся к голосованию" />;
  if (state.status === "notFound") {
    return (
      <Message title="Игра не найдена">
        <p>Проверьте код {formatSessionCode(code)} на экране зала.</p>
      </Message>
    );
  }
  if (state.status === "error") return <LoadFailed onRetry={retry}>{state.message}</LoadFailed>;
  return <VoteScreen session={state.session} />;
}

function VoteScreen({ session }: { session: Session }) {
  useTheme(session.themeId);
  const content = useMemo(() => parseMillionaire(snapshotContent(session.gameSnapshot)), [session.gameSnapshot]);
  const r = parseMillionaireResult(session.state.result);
  const { step, stage } = session.state;
  const now = useServerNow(500, stage === "question");
  const open = r.mode === "audience" && r.audienceVote && stage === "question" && acceptsAnswers(session.state, now);
  const left = r.mode === "audience" ? secondsLeft(session.state, now) : null;
  const q = questionOf(content, r);
  const [mine, setMine] = useState<{ step: number; choice: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voted = mine && mine.step === step ? mine.choice : null;

  async function vote(choice: number) {
    if (!audienceRepo) return;
    setBusy(true);
    setError(null);
    try {
      const result = await audienceRepo.vote(session.id, step, choice);
      if (result === "ok") setMine({ step, choice });
      else setError("Голосование уже закончилось.");
    } catch {
      setError("Не получилось отправить. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page stack vote-page">
      <Logo kind="full" className="logo--form" />
      <p className="eyebrow">Помощь зала · код {formatSessionCode(session.code)}</p>
      {session.mechanic !== "millionaire" || !audienceRepo ? (
        <p>Здесь голосуют в «Помощи зала» игры «Кто хочет стать миллионером».</p>
      ) : session.state.phase === "finished" ? (
        <h1>Игра окончена — спасибо!</h1>
      ) : open && q ? (
        <>
          <h1 className="vote-page__title">Как думаете, какой ответ верный?</h1>
          <p className="mil-question__text vote-page__question">{q.text}</p>
          <div className="mil-phone-options">
            {q.options.map((text, i) =>
              r.removed.includes(i) || text.trim() === "" ? null : (
                <button
                  key={i}
                  type="button"
                  className={`btn btn--secondary mil-phone-option${voted === i ? " is-chosen" : ""}`}
                  aria-pressed={voted === i}
                  disabled={busy || voted === i}
                  onClick={() => void vote(i)}
                >
                  <span className="mil-option__letter">{LETTERS[i]}</span> {text}
                </button>
              ),
            )}
          </div>
          <p className="mil-phone-status" role="status">
            {voted !== null ? `Голос за ${LETTERS[voted]} принят — смотрите на экран. Можно передумать.` : "Коснитесь варианта"}
            {left !== null ? ` · ${left} с` : ""}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <h1 className="vote-page__title">{voted !== null ? "Спасибо, голос учтён!" : "Ждём «Помощь зала»"}</h1>
          <p className="muted">Держите страницу открытой: когда команда возьмёт «Помощь зала», здесь появятся варианты ответа.</p>
        </>
      )}
      <Link className="btn btn--quiet btn--block" to={`/play/${session.code}`}>
        Хочу играть сам
      </Link>
    </main>
  );
}
