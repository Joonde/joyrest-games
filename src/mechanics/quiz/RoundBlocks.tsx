// Раунды в конструкторе квиза: карта раундов над списком и блок-заголовок раунда в списке вопросов
// (решение владельца 21 октября 2026 — макет «Раунды — отдельные блоки в списке»).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { teamColors } from "../../themes/brand";
import { roundTitle, type QuizQuestion, type QuizRound } from "./content";

/** Цвет раунда — пастель команд (текст на ней тёмный); первый раунд — золото. */
const ORDER = [1, 2, 3, 4, 0];
export function roundColor(index: number): string {
  return teamColors[ORDER[index % ORDER.length] ?? 0] ?? "#E3C68C";
}

export function roundName(round: QuizRound): string {
  return round.title || `Раунд ${round.number}`;
}

export function plural(n: number): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return "вопрос";
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return "вопроса";
  return "вопросов";
}

function span(round: QuizRound): string {
  return round.to > round.from ? `${round.from + 1}–${round.to + 1}` : `№ ${round.from + 1}`;
}

type MapView = "bar" | "grid";
const VIEW_KEY = "joyrest.quiz.roundMap";

function readView(): MapView {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "bar";
  } catch {
    return "bar";
  }
}

interface MapProps {
  questions: QuizQuestion[];
  rounds: QuizRound[];
  openIndex: number;
  editable: boolean;
  onPick: (index: number) => void;
  onSplit: () => void;
  /** Раунды (номер первого вопроса), где есть что исправить: на карте — «⚠». */
  issueFrom?: Set<number>;
}

/** Карта раундов: полосой (раунд — плашка) или сеткой (вопросы квадратиками, раунды — строками с подписью). */
export function RoundMap({ questions, rounds, openIndex, editable, onPick, onSplit, issueFrom }: MapProps) {
  const [view, setView] = useState<MapView>(readView);
  function choose(next: MapView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Нет хранилища — вид живёт до перезагрузки.
    }
  }
  const groups: Array<{ round: QuizRound | null; index: number }> = rounds.length > 0 ? rounds.map((round, index) => ({ round, index })) : [{ round: null, index: 0 }];

  return (
    <div id="quiz-round-map" className="round-map" aria-label="Карта раундов">
      <div className="round-map__tabs" role="group" aria-label="Вид карты">
        <button type="button" className="round-map__tab" aria-pressed={view === "bar"} onClick={() => choose("bar")}>
          Полосой раундов
        </button>
        <button type="button" className="round-map__tab" aria-pressed={view === "grid"} onClick={() => choose("grid")}>
          Сеткой
        </button>
      </div>

      {view === "bar" ? (
        rounds.length === 0 ? (
          <div className="round-map__none">
            <span>Раундов нет — игра одним списком.</span>
            {editable && questions.length > 1 && (
              <button type="button" className="btn btn--quiet round-map__split" onClick={onSplit}>
                + Разбить на раунды
              </button>
            )}
          </div>
        ) : (
          <div className="round-map__bar">
            {rounds.map((round, i) => {
              const current = openIndex >= round.from && openIndex <= round.to;
              const crown = questions.slice(round.from, round.to + 1).some((q) => q.kind === "super");
              const issue = issueFrom?.has(round.from) ?? false;
              return (
                <button
                  key={round.from}
                  type="button"
                  className={["round-map__seg", current ? "is-current" : "", issue ? "round-map__seg--issue" : ""].filter(Boolean).join(" ")}
                  style={{ "--rc": roundColor(i), flexGrow: round.to - round.from + 1 } as CSSProperties}
                  aria-label={`${roundName(round)}: вопросы ${span(round)}${issue ? ", есть что исправить" : ""}`}
                  onClick={() => onPick(round.from)}
                >
                  <span className="round-map__seg-name">
                    {issue ? "⚠ " : ""}
                    {crown ? "👑 " : ""}
                    {roundName(round)}
                  </span>
                  <span className="round-map__seg-span">{span(round).replace("№ ", "")}</span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="round-map__grid">
          {groups.map(({ round, index }) => {
            const from = round?.from ?? 0;
            const to = round?.to ?? questions.length - 1;
            const count = to - from + 1;
            const crown = questions.slice(from, to + 1).some((q) => q.kind === "super");
            return (
              <div key={from} className="round-map__group" style={{ "--rc": roundColor(round ? index : 0) } as CSSProperties}>
                {round && (
                  <span className={issueFrom?.has(round.from) ? "round-map__label round-map__label--issue" : "round-map__label"}>
                    {issueFrom?.has(round.from) ? "⚠" : "◆"} {roundName(round)} <em>· {count} {plural(count)}{crown ? " · 👑 суперигра" : ""}</em>
                  </span>
                )}
                <div className="round-map__cells">
                  {questions.slice(from, to + 1).map((q, k) => (
                    <button
                      key={q.id}
                      type="button"
                      className={["round-map__cell", q.kind === "super" ? "round-map__cell--super" : "", from + k === openIndex ? "is-current" : ""].filter(Boolean).join(" ")}
                      aria-label={`Вопрос ${from + k + 1}${q.kind === "super" ? ", суперигра" : ""}${round ? `, ${roundName(round)}` : ""}`}
                      onClick={() => onPick(from + k)}
                    >
                      {q.kind === "super" ? "👑" : from + k + 1}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {rounds.length === 0 && editable && questions.length > 1 && (
            <button type="button" className="btn btn--quiet round-map__split" onClick={onSplit}>
              + Разбить на раунды
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface HeaderProps {
  round: QuizRound;
  index: number;
  /** Раунд без своего блока: вопросы до первого названного раунда («Раунд 1»). */
  auto: boolean;
  folded: boolean;
  editable: boolean;
  onFold: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
  /** Сколько замечаний в вопросах раунда: «⚠ Исправить: N» видно и у свёрнутого раунда. */
  issues?: number;
}

/** Блок раунда в списке вопросов: все вопросы ниже — в этом раунде, пока не начнётся следующий блок. */
export function RoundHeader({ round, index, auto, folded, editable, onFold, onRename, onRemove, issues = 0 }: HeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const count = round.to - round.from + 1;
  const name = roundName(round);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function start() {
    setDraft(auto ? "" : name);
    setEditing(true);
  }
  function save() {
    setEditing(false);
    onRename(draft);
  }

  return (
    // Свёрнутый раунд с замечаниями помечен `edit-issue`: «Показать, что исправить» найдёт его, даже если вопросы скрыты.
    <li
      className={`q-round${auto ? " q-round--auto" : ""}${folded ? " is-folded" : ""}${issues > 0 ? " q-round--issue" : ""}${issues > 0 && folded ? " edit-issue" : ""}`}
      style={{ "--rc": roundColor(index) } as CSSProperties}
    >
      <span className="q-round__mark" aria-hidden="true">
        ◆
      </span>
      {editing ? (
        <form
          className="q-round__edit"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            ref={input}
            className="q-round__input"
            aria-label="Название раунда"
            maxLength={60}
            placeholder={`Например, «Кино»`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button type="submit" className="q-round__btn" aria-label="Сохранить название">
            ✓
          </button>
          <button type="button" className="q-round__btn q-round__btn--text" aria-label="Отменить переименование" onClick={() => setEditing(false)}>
            Отмена
          </button>
        </form>
      ) : (
        <>
          <button type="button" className="q-round__title" aria-expanded={!folded} onClick={onFold}>
            <span className="q-round__name">{auto ? roundTitle(round) : name}</span>
            <span className="q-round__sub">
              {count} {plural(count)} · {span(round)}
              {auto ? " · назовите раунд" : ""}
            </span>
            {issues > 0 && <span className="q-round__issue">⚠ Исправить: {issues}</span>}
          </button>
          {editable && (
            <button type="button" className="q-round__btn" aria-label={auto ? "Назвать раунд" : `Переименовать раунд «${name}»`} onClick={start}>
              ✎
            </button>
          )}
          {editable && !auto && (
            <button type="button" className="q-round__btn" aria-label={`Убрать раунд «${name}», вопросы останутся`} title="Убрать раунд — вопросы останутся в раунде выше" onClick={onRemove}>
              ✕
            </button>
          )}
          <button type="button" className="q-round__btn q-round__fold" aria-label={folded ? "Развернуть раунд" : "Свернуть раунд"} onClick={onFold}>
            ▾
          </button>
        </>
      )}
    </li>
  );
}
