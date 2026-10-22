// Конструктор «Что скажет большинство»: режим (две команды у табло или «Весь зал»), раунды по порядку, вопрос и ответы табло с
// очками и синонимами, импорт списком, «Опрос гостей заранее». Очки шаблонов — оценка JoyRest, не опрос.
import { useEffect, useRef, useState } from "react";
import { ClampedNumber } from "../../components/ClampedNumber";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import { insertBack } from "../../components/undoRemove";
import { useDebouncedCommit } from "../../components/useDebouncedCommit";
import { useUndoRemove } from "../../components/useUndoRemove";
import type { EditorProps } from "../types";
import { ShowLookPicker } from "../ShowLookPicker";
import { SHOW_LOOK_TITLES, TABLE_LOOKS, type ShowLook } from "../showLook";
import {
  HUNDRED_LIMITS,
  IMPORT_EXAMPLE,
  importHundred,
  multiplierOf,
  newAnswer,
  newRound,
  ROUND_KINDS,
  ROUND_TITLES,
  roundsFromImport,
  sourceLine,
  type HundredAnswer,
  type HundredContent,
  type HundredQuestion,
  type HundredRound,
  type RoundKind,
} from "./content";
import { PollPanel } from "./PollPanel";
import { validateHundred } from "./validate";

const BUZZ_TIMES = [5, 10, 15, 20, 30] as const;

const LOOK_HINTS: Partial<Record<ShowLook, string>> = {
  classic: "Табло в цветах оформления игры.",
  studio: "Телестудия: синие прожекторы, светящиеся строки табло, золотые очки.",
  evening: "Тёмный зал в стиле ар-деко: золото и тёплый свет JoyRest.",
  table: "Игровой стол: карты, кубики и красная кнопка, золото на тёмном мраморе.",
};

const KIND_HINTS: Record<RoundKind, string> = {
  simple: "Очки банка как есть.",
  double: "Банк раунда ×2.",
  triple: "Банк раунда ×3.",
  reverse: "Дороже редкие ответы: самый популярный — 15, дальше 30, 60, 120, 180, самый редкий — 240.",
  big: "Финал команды-лидера: 5 вопросов, два игрока по очереди на время.",
};

/** Синонимы из текста поля: до `HUNDRED_LIMITS.synonyms` штук, лишние — отдельно (о них говорим, а не режем молча). */
function parseSynonyms(text: string): { list: string[]; extra: string[] } {
  const all = text
    .split(/[,;]/)
    .map((s) => s.trim().slice(0, HUNDRED_LIMITS.synonym))
    .filter(Boolean);
  return { list: all.slice(0, HUNDRED_LIMITS.synonyms), extra: all.slice(HUNDRED_LIMITS.synonyms) };
}

/**
 * Синонимы через запятую: пока поле в фокусе, текст — черновик (иначе запятая «съедается» при пересборке строки),
 * а в игру он уходит через 0,4 с после последней буквы и сразу при сворачивании приложения.
 */
function SynonymsField({ value, disabled, onChange }: { value: string[]; disabled: boolean; onChange: (list: string[]) => void }) {
  const [draft, setDraft] = useState(value.join(", "));
  const [editing, setEditing] = useState(false);
  const { schedule, flush } = useDebouncedCommit((text: string) => onChange(parseSynonyms(text).list));
  useEffect(() => {
    if (!editing) setDraft(value.join(", "));
  }, [value, editing]);
  const extra = parseSynonyms(draft).extra;
  return (
    <>
      <input
        className="hd-editor__syn"
        value={draft}
        placeholder="ещё засчитать: конверт, деньги"
        aria-label="Синонимы через запятую"
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setDraft(e.target.value);
          schedule(e.target.value);
        }}
        onBlur={() => {
          flush();
          setEditing(false);
        }}
      />
      {extra.length > 0 && (
        <span className="muted small hd-editor__syn-extra" role="status">
          Больше {HUNDRED_LIMITS.synonyms} синонимов не берём — лишние: {extra.join(", ")}
        </span>
      )}
    </>
  );
}

function QuestionForm({
  question,
  editable,
  errors,
  onChange,
  onRemoveAnswer,
}: {
  question: HundredQuestion;
  editable: boolean;
  errors: string[];
  onChange: (q: HundredQuestion) => void;
  onRemoveAnswer: (index: number) => void;
}) {
  const sum = question.answers.reduce((s, a) => s + a.points, 0);
  const setAnswer = (id: string, patch: Partial<HundredAnswer>) => onChange({ ...question, answers: question.answers.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  return (
    <div className="stack stack--tight hd-editor__question">
      <label className="field">
        Вопрос
        <textarea rows={2} maxLength={HUNDRED_LIMITS.question} value={question.text} disabled={!editable} placeholder="Что чаще всего дарят на свадьбу?" onChange={(e) => onChange({ ...question, text: e.target.value })} />
      </label>
      <p className={question.source === "poll" ? "muted small" : "muted small hd-editor__estimate"}>{sourceLine(question)}</p>
      <ol className="hd-editor__answers">
        {question.answers.map((a, i) => (
          <li key={a.id} className="hd-editor__answer">
            <span className="hd-editor__n">{i + 1}</span>
            <input value={a.text} maxLength={HUNDRED_LIMITS.answer} placeholder="Ответ" aria-label={`Ответ ${i + 1}`} disabled={!editable} onChange={(e) => setAnswer(a.id, { text: e.target.value })} />
            <input
              className="hd-editor__points"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={a.points || ""}
              placeholder="очки"
              aria-label={`Очки ответа ${i + 1}`}
              disabled={!editable}
              onChange={(e) => setAnswer(a.id, { points: Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
            />
            <SynonymsField value={a.synonyms} disabled={!editable} onChange={(synonyms) => setAnswer(a.id, { synonyms })} />
            {editable && question.answers.length > HUNDRED_LIMITS.minAnswers && (
              <button type="button" className="btn btn--quiet hd-editor__remove" aria-label={`Убрать ответ ${i + 1}`} onClick={() => onRemoveAnswer(i)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className={sum > 100 ? "error small edit-issue" : "muted small"}>
        Сумма очков: {sum} из 100 (очки — доля опрошенных, назвавших ответ). Табло показывает ответы по очкам — самые популярные сверху.
      </p>
      {editable && question.answers.length < HUNDRED_LIMITS.maxAnswers && (
        <button type="button" className="btn btn--quiet btn--block" onClick={() => onChange({ ...question, answers: [...question.answers, newAnswer()] })}>
          + Ответ ({question.answers.length} из {HUNDRED_LIMITS.maxAnswers})
        </button>
      )}
      {editable && question.source === "poll" && (
        <button type="button" className="btn btn--quiet btn--block" onClick={() => onChange({ ...question, source: "estimate", pollCount: 0 })}>
          Это уже не опрос — подписать «оценка JoyRest»
        </button>
      )}
      {errors.map((e) => (
        <p key={e} className="error small edit-issue" role="alert">
          {e}
        </p>
      ))}
    </div>
  );
}

export function HundredEditor({ gameId, content, onChange, editable }: EditorProps<HundredContent>) {
  const latest = useRef(content);
  latest.current = content;
  const [addKind, setAddKind] = useState<RoundKind>("simple");
  const [importText, setImportText] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const { offer, bar } = useUndoRemove();
  const errors = validateHundred(content);
  const roundErrors = errors.filter((e) => e.path === "rounds");

  function setRounds(rounds: HundredRound[]) {
    onChange({ ...latest.current, rounds });
  }

  function updateQuestion(q: HundredQuestion) {
    setRounds(latest.current.rounds.map((r) => ({ ...r, questions: r.questions.map((x) => (x.id === q.id ? q : x)) })));
  }

  /** Убрать ответ табло — 7 секунд «Вернуть» на то же место. */
  function removeAnswer(questionId: string, index: number) {
    const question = latest.current.rounds.flatMap((r) => r.questions).find((q) => q.id === questionId);
    const answer = question?.answers[index];
    if (!question || !answer) return;
    setRounds(latest.current.rounds.map((r) => ({ ...r, questions: r.questions.map((q) => (q.id === questionId ? { ...q, answers: q.answers.filter((_, j) => j !== index) } : q)) })));
    offer(`Ответ ${index + 1}${answer.text.trim() ? ` «${answer.text.trim()}»` : ""} убран`, () =>
      setRounds(
        latest.current.rounds.map((r) => ({
          ...r,
          questions: r.questions.map((q) => (q.id === questionId ? { ...q, answers: insertBack(q.answers, { item: answer, index }, (a) => a.id) } : q)),
        })),
      ),
    );
  }

  /** Убрать раунд целиком (у «Большой игры» — пять вопросов): 7 секунд «Вернуть» на то же место. */
  function removeRound(index: number) {
    const round = latest.current.rounds[index];
    if (!round) return;
    setRounds(latest.current.rounds.filter((_, j) => j !== index));
    const questions = round.questions.length;
    offer(`Раунд ${index + 1} · ${ROUND_TITLES[round.kind]} убран${questions > 1 ? ` (${questions} вопросов)` : ""}`, () =>
      setRounds(insertBack(latest.current.rounds, { item: round, index }, (r) => r.id)),
    );
  }

  function changeKind(round: HundredRound, kind: RoundKind) {
    const fresh = newRound(kind);
    // Вопросы сохраняем: у «Большой игры» — до пяти, у обычного раунда — первый.
    const keep = round.questions.slice(0, kind === "big" ? HUNDRED_LIMITS.bigQuestions : 1);
    const questions = [...keep, ...fresh.questions.slice(keep.length)];
    setRounds(latest.current.rounds.map((r) => (r.id === round.id ? { ...r, kind, questions } : r)));
  }

  function move(index: number, by: number) {
    const list = [...latest.current.rounds];
    const [item] = list.splice(index, 1);
    if (!item) return;
    list.splice(Math.max(0, Math.min(list.length, index + by)), 0, item);
    setRounds(list);
  }

  function runImport(replace: boolean) {
    const { questions, skipped } = importHundred(importText);
    if (questions.length === 0) {
      setImportNote("Не нашли ни одного вопроса. Вопрос — с новой строки, ответы — строками «- ответ = очки | синонимы».");
      return;
    }
    const rounds = roundsFromImport(questions);
    const all = replace ? rounds : [...latest.current.rounds, ...rounds];
    const lost = Math.max(0, all.length - HUNDRED_LIMITS.maxRounds);
    setRounds(all.slice(0, HUNDRED_LIMITS.maxRounds));
    const problems = questions.flatMap((q) => q.problems.map((p) => `Строка ${q.line}: ${p}`));
    setImportNote(
      [
        replace ? `Все раунды заменены: вопросов из списка — ${questions.length}.` : `Добавлено в конец: вопросов — ${questions.length}.`,
        lost > 0 ? `Больше ${HUNDRED_LIMITS.maxRounds} раундов не берём — последние ${lost} из списка не вошли.` : "",
        skipped.length > 0 ? `Пропущены строки: ${skipped.join(", ")}.` : "",
        ...problems,
      ]
        .filter(Boolean)
        .join(" "),
    );
    setImportText("");
  }

  return (
    <div className="stack hd-editor">
      <section className="card stack">
        <h2>⚙️ Правила и настройки</h2>
        <fieldset disabled={!editable}>
          <legend>Режим</legend>
          <label className="choice">
            <input type="radio" name="hundred-mode" checked={content.mode === "classic"} onChange={() => onChange({ ...latest.current, mode: "classic" })} />
            <span className="choice__text">
              <span className="choice__title">Классика: две команды у табло</span>
              <span className="choice__hint">Капитаны жмут «Жми первым!», команда отвечает вслух, три ошибки — шанс соперника. Для 2–6 команд или игроков.</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="hundred-mode" checked={content.mode === "hall"} onChange={() => onChange({ ...latest.current, mode: "hall" })} />
            <span className="choice__text">
              <span className="choice__title">Весь зал</span>
              <span className="choice__hint">Для большого зала: все капитаны (или все гости) пишут до трёх ответов с телефона, табло открывается по одному. «Большая игра» идёт обычными вопросами зала.</span>
            </span>
          </label>
        </fieldset>
        {content.mode === "classic" ? (
          <fieldset className="stack stack--tight">
            <legend>Время на «Жми первым!» после «Запустить отсчёт»</legend>
            <div className="row" role="radiogroup" aria-label="Секунд на кнопку">
              {BUZZ_TIMES.map((t) => (
                <button key={t} type="button" className="pick-chip" role="radio" aria-checked={content.buzzTime === t} aria-pressed={content.buzzTime === t} disabled={!editable} onClick={() => onChange({ ...latest.current, buzzTime: t })}>
                  {t} с
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <label className="field">
            Секунд на ответы зала
            <ClampedNumber value={content.hallTime} min={HUNDRED_LIMITS.minHall} max={HUNDRED_LIMITS.maxHall} fallback={60} disabled={!editable} onChange={(hallTime) => onChange({ ...latest.current, hallTime })} />
          </label>
        )}
        {content.mode === "classic" && content.rounds.some((r) => r.kind === "big") && (
          <Fold title="«Большая игра»" value={`${content.bigTimes[0]} и ${content.bigTimes[1]} с · цель ${content.bigGoal}`}>
            <div className="row hd-editor__big">
              <label className="field">
                Первому игроку, с
                <ClampedNumber value={content.bigTimes[0]} min={HUNDRED_LIMITS.minBigTime} max={HUNDRED_LIMITS.maxBigTime} fallback={20} disabled={!editable} onChange={(t) => onChange({ ...latest.current, bigTimes: [t, latest.current.bigTimes[1]] })} />
              </label>
              <label className="field">
                Второму игроку, с
                <ClampedNumber value={content.bigTimes[1]} min={HUNDRED_LIMITS.minBigTime} max={HUNDRED_LIMITS.maxBigTime} fallback={25} disabled={!editable} onChange={(t) => onChange({ ...latest.current, bigTimes: [latest.current.bigTimes[0], t] })} />
              </label>
              <label className="field">
                Цель, очков
                <ClampedNumber value={content.bigGoal} min={1} max={HUNDRED_LIMITS.maxGoal} fallback={200} disabled={!editable} onChange={(bigGoal) => onChange({ ...latest.current, bigGoal })} />
              </label>
              <label className="field">
                Бонус за цель
                <ClampedNumber value={content.bigBonus} min={0} max={HUNDRED_LIMITS.maxBonus} fallback={100} disabled={!editable} onChange={(bigBonus) => onChange({ ...latest.current, bigBonus })} />
              </label>
            </div>
            <p className="muted small">Команда получает очки ответов обоих игроков; набрали цель — ещё бонус.</p>
          </Fold>
        )}
        <Fold title="Оформление экрана зала" value={SHOW_LOOK_TITLES[content.look] ?? "Студия"}>
          <ShowLookPicker game="hundred" looks={TABLE_LOOKS} value={content.look} hints={LOOK_HINTS} editable={editable} onChange={(look) => onChange({ ...latest.current, look })} />
        </Fold>
      </section>

      <section className="card stack">
        <h2>Раунды</h2>
        <p className="muted small">Обычный раунд — один вопрос и табло из 4–8 ответов. Очки ответа — сколько опрошенных из 100 его назвали. Синонимы видит только ведущий: «конверт» засчитывается как «деньги в конверте».</p>
        {content.rounds.map((round, i) => {
          const errs = errors.filter((e) => e.path === `rounds/${round.id}`);
          return (
            <Fold key={round.id} className="hd-editor__round" title={`Раунд ${i + 1} · ${ROUND_TITLES[round.kind]}`} value={round.questions[0]?.text.slice(0, 40) ?? ""} open={i === 0 && !round.questions[0]?.text}>
              <div className="stack">
                <label className="field">
                  Вид раунда
                  <select value={round.kind} disabled={!editable} onChange={(e) => changeKind(round, e.target.value as RoundKind)}>
                    {ROUND_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ROUND_TITLES[k]}
                        {multiplierOf(k) > 1 ? ` (×${multiplierOf(k)})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small">{KIND_HINTS[round.kind]}</p>
                {round.questions.map((q, k) => (
                  <div key={q.id} className="stack stack--tight">
                    {round.kind === "big" && <h3 className="host-quiz__subtitle">Вопрос {k + 1}</h3>}
                    <QuestionForm
                      question={q}
                      editable={editable}
                      errors={errors.filter((e) => e.path.startsWith(`questions/${q.id}/`)).map((e) => e.message)}
                      onChange={updateQuestion}
                      onRemoveAnswer={(index) => removeAnswer(q.id, index)}
                    />
                  </div>
                ))}
                {errs.map((e) => (
                  <p key={e.message} className="error small edit-issue" role="alert">
                    {e.message}
                  </p>
                ))}
                {editable && (
                  <div className="actions">
                    {i > 0 && (
                      <button type="button" className="btn btn--quiet btn--block" onClick={() => move(i, -1)}>
                        ↑ Раньше
                      </button>
                    )}
                    {i < content.rounds.length - 1 && (
                      <button type="button" className="btn btn--quiet btn--block" onClick={() => move(i, 1)}>
                        ↓ Позже
                      </button>
                    )}
                    {content.rounds.length > 1 && (
                      <button type="button" className="btn btn--quiet btn--block" onClick={() => removeRound(i)}>
                        Убрать раунд
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Fold>
          );
        })}
        {editable && content.rounds.length < HUNDRED_LIMITS.maxRounds && (
          <div className="row hd-editor__add">
            <label className="field">
              Новый раунд
              <select value={addKind} onChange={(e) => setAddKind(e.target.value as RoundKind)}>
                {ROUND_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ROUND_TITLES[k]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => {
                const rounds = [...latest.current.rounds];
                const bigAt = rounds.findIndex((r) => r.kind === "big");
                // Обычный раунд — перед «Большой игрой» (она финал).
                if (addKind !== "big" && bigAt >= 0) rounds.splice(bigAt, 0, newRound(addKind));
                else rounds.push(newRound(addKind));
                setRounds(rounds);
              }}
            >
              + Добавить раунд
            </button>
          </div>
        )}
        {roundErrors.map((e) => (
          <p key={e.message} className="error edit-issue" role="alert">
            {e.message}
          </p>
        ))}
      </section>

      {editable && (
        <section className="card stack">
          <Fold title="Добавить или заменить списком" value="из заметок или таблицы">
            <div className="stack">
              <p className="muted small">Вопрос — с новой строки, ответы — строками «- ответ = очки | синоним, синоним». Строка «# Двойная игра» (или «# Большая игра») перед вопросом задаёт вид раунда.</p>
              <pre className="hd-editor__example">{IMPORT_EXAMPLE}</pre>
              <label className="field">
                Список
                <textarea rows={8} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={IMPORT_EXAMPLE} />
              </label>
              <div className="actions">
                <button type="button" className="btn btn--block" disabled={!importText.trim()} onClick={() => runImport(false)}>
                  Добавить списком
                </button>
                <button type="button" className="btn btn--secondary btn--block" disabled={!importText.trim()} onClick={() => setConfirmReplace(true)}>
                  Заменить всё списком
                </button>
              </div>
              {importNote && (
                <p className="muted small" role="status">
                  {importNote}
                </p>
              )}
            </div>
          </Fold>
        </section>
      )}

      <PollPanel gameId={gameId} content={content} editable={editable} onChange={onChange} latest={latest} />
      <ConfirmDialog
        open={confirmReplace}
        title="Заменить все раунды списком?"
        confirmLabel="Заменить всё"
        onCancel={() => setConfirmReplace(false)}
        onConfirm={() => {
          setConfirmReplace(false);
          runImport(true);
        }}
      >
        <p>Все раунды игры ({content.rounds.length}) пропадут, вместо них будут вопросы из списка. Чтобы дописать вопросы в конец, нажмите «Добавить списком».</p>
      </ConfirmDialog>
      {bar}
    </div>
  );
}
