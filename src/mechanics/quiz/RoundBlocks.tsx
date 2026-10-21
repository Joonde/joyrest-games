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
}

/** Карта раундов: полосой (раунд — плашка) или сеткой (вопросы квадратиками, раунды — строками с подписью). */
export function RoundMap({ questions, rounds, openIndex, editable, onPick, onSplit }: MapProps) {
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
    <div className="round-map" aria-label="Карта раундов">
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
              return (
                <button
                  key={round.from}
                  type="button"
                  className={current ? "round-map__seg is-current" : "round-map__seg"}
                  style={{ "--rc": roundColor(i), flexGrow: round.to - round.from + 1 } as CSSProperties}
                  aria-label={`${roundName(round)}: вопросы ${span(round)}`}
                  onClick={() => onPick(round.from)}
                >
                  <span className="round-map__seg-name">{roundName(round)}</span>
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
            return (
              <div key={from} className="round-map__group" style={{ "--rc": roundColor(round ? index : 0) } as CSSProperties}>
                {round && (
                  <span className="round-map__label">
                    ◆ {roundName(round)} <em>· {count} {plural(count)}</em>
                  </span>
                )}
                <div className="round-map__cells">
                  {questions.slice(from, to + 1).map((q, k) => (
                    <button
                      key={q.id}
                      type="button"
                      className={from + k === openIndex ? "round-map__cell is-current" : "round-map__cell"}
                      aria-label={`Вопрос ${from + k + 1}${round ? `, ${roundName(round)}` : ""}`}
                      onClick={() => onPick(from + k)}
                    >
                      {from + k + 1}
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
}

/** Блок раунда в списке вопросов: все вопросы ниже — в этом раунде, пока не начнётся следующий блок. */
export function RoundHeader({ round, index, auto, folded, editable, onFold, onRename, onRemove }: HeaderProps) {
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
    <li className={`q-round${auto ? " q-round--auto" : ""}${folded ? " is-folded" : ""}`} style={{ "--rc": roundColor(index) } as CSSProperties}>
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
          <button type="button" className="q-round__btn" aria-label="Отменить" onClick={() => setEditing(false)}>
            ✕
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
          </button>
          {editable && (
            <button type="button" className="q-round__btn" aria-label={auto ? "Назвать раунд" : `Переименовать раунд «${name}»`} onClick={start}>
              ✎
            </button>
          )}
          {editable && !auto && (
            <button type="button" className="q-round__btn" aria-label={`Убрать раунд «${name}»`} onClick={onRemove}>
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
