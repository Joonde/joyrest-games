/**
 * «Опрос гостей заранее» для «100 к 1» (`/poll/:pollId`): без входа, имя не спрашиваем. Гость пишет первое, что
 * приходит в голову, на каждый вопрос. Черновик и номер ответившего — на телефоне: повторная отправка правит ту же
 * запись. Только свой сервер (`pollsRepo`).
 */
import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { useDraft } from "../components/venues/useDraft";
import { POLL_LIMITS } from "../core/polls";
import { pollsRepo, useLoad } from "../data";
import { FormFailed, PublicSkeleton } from "./venues/PublicParts";

interface Draft {
  rid: string;
  answers: Record<string, string>;
  sent: boolean;
}

function newRespondentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "g" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

function parseDraft(raw: unknown): Draft {
  const d = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const answers: Record<string, string> = {};
  const a = typeof d.answers === "object" && d.answers !== null ? (d.answers as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(a)) if (typeof v === "string") answers[k] = v.slice(0, POLL_LIMITS.answer);
  return { rid: typeof d.rid === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(d.rid) ? d.rid : newRespondentId(), answers, sent: d.sent === true };
}

export function PollPage() {
  const { pollId = "" } = useParams();
  const [state, retry] = useLoad(() => (pollsRepo ? pollsRepo.form(pollId) : Promise.resolve(null)), [pollId]);
  if (state.status === "loading") return <PublicSkeleton />;
  if (state.status === "error") return <FormFailed onRetry={retry} />;
  const form = state.data;
  if (!form || !form.open) {
    return (
      <main className="page page--center">
        <Logo kind="full" className="logo--form" />
        <section className="card card--center">
          <h2>{form ? "Опрос закрыт" : "Опрос не найден"}</h2>
          <p>{form ? "Ведущий уже собрал ответы. Спасибо — увидимся на празднике!" : "Проверьте ссылку или QR-код у организатора."}</p>
        </section>
      </main>
    );
  }
  return <PollForm pollId={form.id} questions={form.questions} />;
}

function PollForm({ pollId, questions }: { pollId: string; questions: Array<{ id: string; text: string }> }) {
  const [draft, setDraft] = useDraft<Draft>(`jr-poll-${pollId}`, () => ({ rid: newRespondentId(), answers: {}, sent: false }), parseDraft);
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const filled = questions.filter((q) => (draft.answers[q.id] ?? "").trim()).length;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!pollsRepo || sending) return;
    if (filled === 0) {
      setError("Напишите хотя бы один ответ.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await pollsRepo.submit({ pollId, respondentId: draft.rid, answers: draft.answers, website });
      setDraft({ ...draft, sent: true });
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (problem) {
      const code = problem instanceof Error ? problem.message : "";
      setError(
        code === "resource-exhausted"
          ? "Слишком много ответов подряд. Попробуйте чуть позже."
          : code === "failed-precondition"
            ? "Опрос уже закрыт — ведущий собрал ответы."
            : "Не получилось отправить: нет связи. Ответы сохранены на телефоне — нажмите «Отправить» ещё раз.",
      );
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <main className="page page--center">
        <Logo kind="full" className="logo--form" />
        <section className="card card--center stack">
          <h2>Спасибо!</h2>
          <p>Ответы сохранены. На празднике узнаете, совпали ли вы с большинством.</p>
          <button type="button" className="btn btn--secondary btn--block" onClick={() => setDone(false)}>
            Изменить ответы
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page poll-page">
      <Logo kind="full" className="logo--form" />
      <form className="card stack" onSubmit={(e) => void onSubmit(e)}>
        <h1>Опрос гостей</h1>
        <p className="muted">Отвечайте первое, что приходит в голову, — одним-двумя словами. Имя не спрашиваем. Самые частые ответы попадут на табло игры «100 к 1» на празднике.</p>
        {draft.sent && <p className="success">Вы уже отвечали — можно исправить и отправить ещё раз.</p>}
        {questions.map((q, i) => (
          <label key={q.id} className="field">
            <span className="field__label">
              {i + 1}. {q.text}
            </span>
            <input
              value={draft.answers[q.id] ?? ""}
              maxLength={POLL_LIMITS.answer}
              autoComplete="off"
              onChange={(e) => setDraft({ ...draft, answers: { ...draft.answers, [q.id]: e.target.value } })}
            />
          </label>
        ))}
        <label className="visually-hidden" aria-hidden="true">
          Сайт
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--block" disabled={sending}>
          {sending ? "Отправляем…" : `Отправить ответы (${filled} из ${questions.length})`}
        </button>
      </form>
    </main>
  );
}
