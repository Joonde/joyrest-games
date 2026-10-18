/**
 * Вопросы квиза «Расставь по порядку» и «Угадай число» (решение владельца 15 октября 2026): экран зала, телефон гостя и
 * строки пульта. Логика и очки — `logic.ts` (`orderShown`, `orderHits`, `numberDeltas`).
 */
import { useState, type CSSProperties, type FormEvent } from "react";
import { NameText } from "../../components/NameText";
import { MediaImage } from "../../components/media/MediaImage";
import { pointsLabel } from "../../core/results";
import type { Answer, Leaderboard } from "../../data/types";
import type { QuizQuestion } from "./content";
import { numberDeltas, orderHits, orderShown, parseGuess, parseOrder, type QuizResult } from "./logic";

/** Буквы карточек — в том порядке, как они лежат на экране. */
export const CARD_LETTERS = ["А", "Б", "В", "Г", "Д", "Е"];

/** Число по-русски: «1 665», дробь через запятую. */
export function formatNumber(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 3 }).replace(/ /g, " ");
}

/** Число из поля телефона: пробелы и запятая допустимы. */
export function readNumber(text: string): number | null {
  const clean = text.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) && Math.abs(n) <= 1e12 ? n : null;
}

/** Буква карточки (по месту на экране) для номера в верном порядке. */
export function letterOf(q: QuizQuestion, card: number): string {
  return CARD_LETTERS[orderShown(q).indexOf(card)] ?? "?";
}

/** Верный ответ строкой: «В → Б → Г → А» или «1 665 ступеней». */
export function orderNumberText(q: QuizQuestion): string {
  if (q.kind === "order") return q.options.map((o, i) => `${i + 1}. ${o}`).join(" → ");
  if (q.kind === "number") return q.number === null || q.number === undefined ? "—" : `${formatNumber(q.number)}${q.unit ? ` ${q.unit}` : ""}`;
  return "";
}

// ---------------------------------------------------------------- экран зала

export function OrderScreenCards({ q, gameId, revealed, result }: { q: QuizQuestion; gameId: string | null; revealed: boolean; result: QuizResult }) {
  const shown = orderShown(q);
  const total = Math.max(1, result.total);
  if (!revealed) {
    return (
      <>
        {q.imageId && <MediaImage className="quiz-screen__image" gameId={gameId} mediaId={q.imageId} variant="full" alt="" />}
        <ol className="quiz-screen__order" data-count={q.options.length}>
          {shown.map((card, i) => (
            <li key={card} className="quiz-screen__order-card">
              <span className="quiz-screen__letter">{CARD_LETTERS[i]}</span>
              <span className="quiz-screen__text">{q.options[card] || "…"}</span>
            </li>
          ))}
        </ol>
        <p className="quiz-screen__hint">Коснитесь карточек на телефоне по порядку</p>
      </>
    );
  }
  return (
    <ol className="quiz-screen__order-answer">
      {q.options.map((text, card) => {
        const right = result.right?.[card] ?? 0;
        return (
          <li key={card} className="quiz-screen__order-row" style={{ "--d": `${card * 0.25}s` } as CSSProperties}>
            <span className="quiz-screen__order-place">{card + 1}</span>
            <span className="quiz-screen__letter">{letterOf(q, card)}</span>
            <span className="quiz-screen__text">{text}</span>
            <span className="quiz-screen__order-stat">
              <span className="quiz-screen__order-bar" aria-hidden="true">
                <span style={{ width: `${(right / total) * 100}%` }} />
              </span>
              верно поставили: {right} из {result.total}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function NumberScreen({ q, revealed, result, leaderboard }: { q: QuizQuestion; revealed: boolean; result: QuizResult; leaderboard: Leaderboard }) {
  if (!revealed) {
    return (
      <div className="quiz-screen__open">
        <span className="quiz-screen__hint">Напишите число на телефоне{q.unit ? ` · ${q.unit}` : ""}</span>
      </div>
    );
  }
  const target = q.number ?? 0;
  const answers: Answer[] = Object.entries(result.guesses ?? {}).map(([pid, guess], i) => ({ id: `${i}`, step: 0, pid, uid: "", value: { guess }, submittedAt: null }));
  const rows = numberDeltas(q, answers).sort((a, b) => a.diff - b.diff);
  // Шкала: от меньшего к большему из чисел и ответа, с запасом по краям.
  const values = [target, ...rows.map((r) => r.guess)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || Math.max(1, Math.abs(target) * 0.1);
  const from = min - pad;
  const span = max + pad - from;
  const at = (v: number) => `${((v - from) / span) * 100}%`;
  return (
    <div className="quiz-screen__number">
      <p className="quiz-screen__number-answer">
        <span className="quiz-screen__hint">Ответ</span>
        <strong>{formatNumber(target)}</strong>
        {q.unit && <span>{q.unit}</span>}
      </p>
      <div className="quiz-screen__scale" aria-hidden="true">
        <span className="quiz-screen__scale-line" />
        <span className="quiz-screen__scale-target" style={{ left: at(target) }} />
        {rows.slice(0, 12).map((r, i) => (
          <span key={r.pid} className={r.place === 1 ? "quiz-screen__chip is-best" : "quiz-screen__chip"} style={{ left: at(r.guess), "--row": i % 3 } as CSSProperties}>
            <NameText name={leaderboard[r.pid]?.name ?? "—"} /> · {formatNumber(r.guess)}
          </span>
        ))}
      </div>
      <ol className="quiz-screen__places">
        {rows
          .filter((r) => r.delta > 0)
          .slice(0, 6)
          .map((r) => (
            <li key={r.pid}>
              <span className="quiz-screen__places-n">{r.place}</span>
              <span className="quiz-screen__places-name">
                <NameText name={leaderboard[r.pid]?.name ?? "—"} />
                <small>{r.diff === 0 ? "точно в цель!" : `ошибка ${formatNumber(r.diff)}`}</small>
              </span>
              <span className="quiz-screen__places-pts">+{pointsLabel(r.delta)}</span>
            </li>
          ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- телефон

export function OrderPhone({
  q,
  mine,
  canAnswer,
  onAnswer,
}: {
  q: QuizQuestion;
  mine: number[] | null;
  canAnswer: boolean;
  onAnswer: (order: number[]) => void;
}) {
  const shown = orderShown(q);
  const [picked, setPicked] = useState<number[]>([]);
  const chosen = mine ?? picked;
  const left = q.options.length - chosen.length;
  function toggle(card: number) {
    if (!canAnswer) return;
    setPicked((cur) => (cur.includes(card) ? cur.filter((c) => c !== card) : [...cur, card]));
  }
  return (
    <div className="stack stack--tight">
      <p className="quiz-phone__status muted">Коснитесь по порядку: первым — то, что должно быть первым. Ошиблись — коснитесь ещё раз.</p>
      <div className="quiz-phone__options">
        {shown.map((card, i) => {
          const n = chosen.indexOf(card);
          return (
            <button
              key={card}
              type="button"
              className={n >= 0 ? "quiz-phone__option is-chosen" : "quiz-phone__option"}
              aria-pressed={n >= 0}
              aria-label={`${q.options[card] ?? ""}${n >= 0 ? `, номер ${n + 1}` : ""}`}
              disabled={!canAnswer}
              onClick={() => toggle(card)}
            >
              <span className={n >= 0 ? "quiz-phone__order-num is-set" : "quiz-phone__order-num"}>{n >= 0 ? n + 1 : ""}</span>
              <span>{q.options[card] || "…"}</span>
              <span className="muted small">{CARD_LETTERS[i]}</span>
            </button>
          );
        })}
      </div>
      {mine === null && (
        <div className="actions">
          <button type="button" className="btn btn--block" disabled={!canAnswer || left > 0} onClick={() => onAnswer(picked)}>
            {left > 0 ? `Отправить (осталось ${left})` : "Отправить порядок"}
          </button>
          {picked.length > 0 && canAnswer && (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setPicked([])}>
              Сбросить порядок
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function NumberPhone({ q, mine, canAnswer, onAnswer }: { q: QuizQuestion; mine: number | null; canAnswer: boolean; onAnswer: (guess: number) => void }) {
  const [text, setText] = useState("");
  const value = readNumber(text);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canAnswer && value !== null) onAnswer(value);
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        Ваше число{q.unit ? ` (${q.unit})` : ""}
        <input
          className="quiz-phone__number"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="send"
          value={mine !== null ? formatNumber(mine) : text}
          disabled={!canAnswer}
          placeholder="Например, 1 500"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {text.trim() !== "" && value === null && <p className="error small">Нужно число: только цифры, можно с запятой.</p>}
      {mine === null && (
        <button className="btn btn--block" type="submit" disabled={!canAnswer || value === null}>
          {value === null ? "Отправить число" : `Отправить ${formatNumber(value)}`}
        </button>
      )}
    </form>
  );
}

/** Телефон после ответа: что верно и как сыграл этот телефон. */
export function OrderNumberVerdict({ q, value, result }: { q: QuizQuestion; value: unknown; result: QuizResult }) {
  if (q.kind === "order") {
    const order = parseOrder(value, q.options.length);
    const hits = orderHits(q, value);
    return (
      <>
        {order && (
          <p className={hits === q.options.length ? "quiz-phone__verdict is-right" : "quiz-phone__verdict is-wrong"}>
            {hits === q.options.length ? "Всё верно!" : `На своём месте: ${hits} из ${q.options.length}`}
          </p>
        )}
        <ol className="quiz-phone__order-answer">
          {q.options.map((text, card) => (
            <li key={card} className={order?.[card] === card ? "is-right" : order ? "is-wrong" : undefined}>
              <strong>{card + 1}.</strong> {text}
              {order && order[card] !== card && <span className="muted small"> · у вас: {q.options[order[card] ?? -1] ?? "—"}</span>}
            </li>
          ))}
        </ol>
      </>
    );
  }
  const guess = parseGuess(value);
  const target = q.number ?? 0;
  const answers: Answer[] = Object.entries(result.guesses ?? {}).map(([pid, g], i) => ({ id: `${i}`, step: 0, pid, uid: "", value: { guess: g }, submittedAt: null }));
  const places = numberDeltas(q, answers);
  const place = guess === null ? null : (places.find((p) => p.guess === guess)?.place ?? null);
  return (
    <>
      {guess !== null && (
        <p className={guess === target ? "quiz-phone__verdict is-right" : "quiz-phone__verdict"}>
          {guess === target ? "Точно в цель!" : `Ошибка ${formatNumber(Math.abs(guess - target))}`}
        </p>
      )}
      <p>
        Ответ: <strong>{orderNumberText(q)}</strong>
        {guess !== null && <span className="muted"> · ваше: {formatNumber(guess)}</span>}
      </p>
      {place !== null && <p className="muted">{place}-е место по близости</p>}
    </>
  );
}

/** Пульт после ответа: по порядку — сколько участников поставили карточку верно; число — кто как близко. */
export function OrderNumberHost({ q, own, leaderboard }: { q: QuizQuestion; own: Answer[]; leaderboard: Leaderboard }) {
  if (q.kind === "order") {
    return (
      <ul className="host-quiz__dist">
        {q.options.map((text, card) => (
          <li key={card} className="is-correct">
            {card + 1}. {text} — верно поставили: <strong>{own.filter((a) => parseOrder(a.value, q.options.length)?.[card] === card).length}</strong> из {own.length}
          </li>
        ))}
      </ul>
    );
  }
  const rows = numberDeltas(q, own).sort((a, b) => a.diff - b.diff);
  return (
    <ul className="host-quiz__dist">
      {rows.map((r) => (
        <li key={r.pid} className={r.delta > 0 ? "is-correct" : undefined}>
          {r.place}. <NameText name={leaderboard[r.pid]?.name ?? "—"} /> — {formatNumber(r.guess)} (±{formatNumber(r.diff)}){r.delta > 0 ? ` · +${r.delta}` : ""}
        </li>
      ))}
    </ul>
  );
}
