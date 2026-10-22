// «Опрос гостей заранее» в конструкторе «Что скажет большинство» (только свой сервер — `pollsRepo`): ссылка и QR на анкету без
// входа (`/poll/<id>`), сводка ответов по группам, объединение похожих, переименование и «Взять 6 лучших в табло» —
// очки из доли ответивших, подпись «Опрос гостей · N человек».
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import { QrCode } from "../../components/QrCode";
import { Toast, useToast } from "../../components/Toast";
import { groupPollAnswers, pollKey, topAnswers, type PollEdits } from "../../core/polls";
import { pollsRepo, type PollSummary } from "../../data";
import { allQuestions, newAnswer, type HundredContent, type HundredQuestion } from "./content";

function newPollId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "p" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

/** Вопросы игры для опроса: с текстом, по порядку. */
function pollQuestions(content: HundredContent) {
  return allQuestions(content)
    .map(({ question }) => ({ id: question.id, text: question.text.trim() }))
    .filter((q) => q.text.length > 0);
}

interface Props {
  gameId: string;
  content: HundredContent;
  editable: boolean;
  onChange: (content: HundredContent) => void;
  latest: { current: HundredContent };
}

export function PollPanel({ gameId, content, editable, onChange, latest }: Props) {
  const [summary, setSummary] = useState<PollSummary | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "missing" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // «Взять 6 лучших в табло» поверх уже заполненного табло — только после вопроса (QA 22 октября 2026).
  const [replaceFor, setReplaceFor] = useState<HundredQuestion | null>(null);
  const [toast, showToast] = useToast();
  const pollId = content.pollId;

  const load = useCallback(async () => {
    if (!pollsRepo || !pollId) return;
    setState("loading");
    try {
      const got = await pollsRepo.get(pollId);
      setSummary(got);
      setState(got ? "idle" : "missing");
    } catch {
      setState("error");
    }
  }, [pollId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!pollsRepo) return null;
  const repo = pollsRepo;
  const link = pollId ? `${window.location.origin}/poll/${pollId}` : "";

  async function save(next: Partial<Pick<PollSummary, "open" | "edits">> & { questions?: PollSummary["questions"] }, id = pollId) {
    if (!id) return;
    setBusy(true);
    try {
      await repo.save({
        id,
        gameId,
        title: "Опрос гостей",
        questions: next.questions ?? summary?.questions ?? pollQuestions(latest.current),
        open: next.open ?? summary?.open ?? true,
        edits: next.edits ?? summary?.edits ?? {},
      });
      await load();
    } catch {
      showToast("Не получилось сохранить опрос. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const questions = pollQuestions(latest.current);
    if (questions.length === 0) {
      showToast("Сначала напишите вопросы — их и увидят гости.");
      return;
    }
    const id = newPollId();
    setBusy(true);
    try {
      await repo.save({ id, gameId, title: "Опрос гостей", questions, open: true, edits: {} });
      onChange({ ...latest.current, pollId: id });
    } catch {
      showToast("Не получилось создать опрос. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      showToast("Ссылка скопирована");
    } catch {
      showToast("Скопируйте ссылку вручную");
    }
  }

  function editsOf(qid: string): PollEdits {
    return summary?.edits[qid] ?? { merges: {}, labels: {} };
  }

  function setEdits(qid: string, edits: PollEdits) {
    void save({ edits: { ...(summary?.edits ?? {}), [qid]: edits } });
  }

  /** «Взять 6 лучших в табло»: очки — доля ответивших на этот вопрос, подпись — «Опрос гостей · N человек». */
  function takeTop(question: HundredQuestion, confirmed = false) {
    const fresh = allQuestions(latest.current).find(({ question: q }) => q.id === question.id)?.question ?? question;
    if (!confirmed && fresh.answers.some((a) => a.text.trim())) {
      setReplaceFor(fresh);
      return;
    }
    const texts = summary?.responses[question.id] ?? [];
    const top = topAnswers(groupPollAnswers(texts, editsOf(question.id)), texts.length, 6);
    if (top.length < 4) {
      showToast("Нужно хотя бы 4 разных ответа гостей.");
      return;
    }
    const answers = top.map((a) => ({ ...newAnswer(a.text, a.points, a.synonyms) }));
    const next: HundredQuestion = { ...fresh, answers, source: "poll", pollCount: texts.length };
    onChange({ ...latest.current, rounds: latest.current.rounds.map((r) => ({ ...r, questions: r.questions.map((q) => (q.id === question.id ? next : q)) })) });
    showToast("Табло заполнено из опроса");
  }

  if (!pollId) {
    return (
      <section className="card stack">
        <h2>Опрос гостей заранее</h2>
        <p className="muted small">Для свадьбы и большого мероприятия: отправьте гостям ссылку или QR до праздника — каждый напишет свой ответ на вопросы игры (имя не спрашиваем). Потом возьмите 6 самых частых ответов в табло — очки посчитаются из доли ответивших.</p>
        {editable ? (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void create()}>
            Опрос гостей заранее
          </button>
        ) : (
          <p className="muted small">Скопируйте игру в «Мои игры», чтобы провести свой опрос.</p>
        )}
        <Toast text={toast} />
      </section>
    );
  }

  const questions = allQuestions(content).map(({ question }) => question);
  return (
    <section className="card stack hd-poll">
      <h2>Опрос гостей заранее</h2>
      {state === "missing" ? (
        <>
          <p className="muted">Опрос этой игры недоступен: его завёл другой ведущий или он удалён.</p>
          {editable && (
            <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void create()}>
              Создать новый опрос
            </button>
          )}
        </>
      ) : state === "error" ? (
        <>
          <p className="error">Не удалось загрузить опрос. Проверьте интернет.</p>
          <button type="button" className="btn btn--secondary btn--block" onClick={() => void load()}>
            Попробовать ещё раз
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            {summary ? `Ответили: ${summary.respondents} · приём ответов ${summary.open ? "открыт" : "закрыт"}` : "Загружаем…"}
          </p>
          <div className="hd-poll__qr">
            <QrCode value={link} label="QR-код опроса гостей" />
          </div>
          <p className="hd-poll__link">{link}</p>
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={() => void copy()}>
              Скопировать ссылку
            </button>
            <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void load()}>
              Обновить ответы
            </button>
            {editable && (
              <>
                <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => void save({ questions: pollQuestions(latest.current) })}>
                  Обновить вопросы опроса из игры
                </button>
                <button type="button" className="btn btn--quiet btn--block" disabled={busy || !summary} onClick={() => void save({ open: !summary?.open })}>
                  {summary?.open ? "Закрыть приём ответов" : "Открыть приём ответов"}
                </button>
                <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  Удалить опрос
                </button>
              </>
            )}
          </div>
          {summary &&
            questions
              .filter((q) => summary.questions.some((x) => x.id === q.id))
              .map((q) => {
                const texts = summary.responses[q.id] ?? [];
                const edits = editsOf(q.id);
                const groups = groupPollAnswers(texts, edits);
                return (
                  <Fold key={q.id} title={q.text || "Вопрос"} value={`${texts.length} ответов`}>
                    <div className="stack stack--tight">
                      {groups.length === 0 && <p className="muted small">Пока никто не ответил.</p>}
                      <ol className="hd-poll__groups">
                        {groups.map((g, i) => (
                          <li key={g.key} className={i < 6 ? "is-top" : undefined}>
                            <input
                              defaultValue={g.label}
                              key={`${g.key}:${g.label}`}
                              aria-label={`Название группы «${g.label}»`}
                              disabled={!editable || busy}
                              onBlur={(e) => {
                                const label = e.target.value.trim();
                                if (label && label !== g.label) setEdits(q.id, { ...edits, labels: { ...edits.labels, [g.key]: label } });
                              }}
                            />
                            <span className="hd-poll__count">
                              {g.count} · {texts.length > 0 ? Math.round((g.count / texts.length) * 100) : 0}%
                            </span>
                            {g.variants.length > 0 && <small className="muted">ещё писали: {g.variants.join(", ")}</small>}
                            {editable && groups.length > 1 && (
                              <select
                                value=""
                                aria-label={`Объединить «${g.label}» с другой группой`}
                                disabled={busy}
                                onChange={(e) => {
                                  const to = e.target.value;
                                  if (to) setEdits(q.id, { ...edits, merges: { ...edits.merges, [g.key]: to } });
                                }}
                              >
                                <option value="">Объединить с…</option>
                                {groups
                                  .filter((x) => x.key !== g.key)
                                  .map((x) => (
                                    <option key={x.key} value={x.key}>
                                      {x.label}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </li>
                        ))}
                      </ol>
                      {editable && Object.keys(edits.merges).length > 0 && (
                        <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => setEdits(q.id, { merges: {}, labels: edits.labels })}>
                          Разъединить все группы
                        </button>
                      )}
                      {editable && (
                        <button type="button" className="btn btn--secondary btn--block" disabled={busy || groups.length < 4} onClick={() => takeTop(q)}>
                          Взять 6 лучших в табло
                        </button>
                      )}
                      <p className="muted small">Очки = доля ответивших на этот вопрос, в пересчёте на 100. На экране — «Опрос гостей · {texts.length} человек».</p>
                    </div>
                  </Fold>
                );
              })}
          {summary && summary.questions.some((x) => !questions.some((q) => q.id === x.id && pollKey(q.text) === pollKey(x.text))) && (
            <p className="muted small">Вопросы игры поменялись после создания опроса — «Обновить вопросы опроса из игры», чтобы гости видели новые.</p>
          )}
        </>
      )}
      <ConfirmDialog
        open={replaceFor !== null}
        title="Заменить ответы табло результатами опроса?"
        confirmLabel="Заменить ответы табло"
        onCancel={() => setReplaceFor(null)}
        onConfirm={() => {
          const q = replaceFor;
          setReplaceFor(null);
          if (q) takeTop(q, true);
        }}
      >
        <p>
          В табло вопроса «{replaceFor?.text.trim() || "Вопрос"}» уже есть ответы: {replaceFor?.answers.filter((a) => a.text.trim()).map((a) => a.text.trim()).join(", ")}. Они и синонимы
          заменятся шестью самыми частыми ответами гостей.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить опрос?"
        confirmLabel="Удалить опрос"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          setBusy(true);
          void repo
            .remove(pollId)
            .then(() => {
              setSummary(null);
              onChange({ ...latest.current, pollId: null });
            })
            .catch(() => showToast("Не получилось удалить опрос. Проверьте интернет."))
            .finally(() => setBusy(false));
        }}
      >
        <p>Ответы гостей удалятся. Табло, уже заполненное из опроса, останется в игре.</p>
      </ConfirmDialog>
      <Toast text={toast} />
    </section>
  );
}
