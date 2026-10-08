import { useEffect, useRef } from "react";
import type { BuzzPhone } from "../../core/buzz";

interface Props {
  state: BuzzPhone;
  /** Место в очереди среди тех, кто ещё может ответить (1 — слово у него). */
  place: number;
  /** Кто отвечает сейчас (для очереди): «🐻 Костя». */
  speaker: string | null;
  sending: boolean;
  onPress: () => void;
}

const TITLES: Record<BuzzPhone, string> = {
  press: "Жми!",
  queued: "Нажато",
  turn: "Ваше слово!",
  out: "Мимо",
  won: "Верно!",
  lost: "Ответил другой",
  closed: "Ждём",
};

/**
 * Большая кнопка «кто первый» на телефоне и плашка прямо под ней — состояние нельзя пропустить:
 * очередь, «ваше слово» (кнопка и плашка светятся, телефон вибрирует), «мимо» до следующего шага.
 */
export function BuzzButton({ state, place, speaker, sending, onPress }: Props) {
  const previous = useRef(state);
  useEffect(() => {
    if (state === "turn" && previous.current !== "turn") {
      try {
        navigator.vibrate?.([220, 120, 220, 120, 220]);
      } catch {
        // Вибрации нет (iPhone) — хватает света и плашки.
      }
    }
    previous.current = state;
  }, [state]);

  let plateTitle: string;
  let plateText: string;
  if (state === "press") {
    plateTitle = "Знаете ответ — жмите";
    plateText = "Слово получит тот, кто нажал первым";
  } else if (state === "queued") {
    plateTitle = place > 1 ? `Вы ${place}-й в очереди` : "Нажато — ждите";
    plateText = speaker ? `Сейчас отвечает ${speaker}. Ошибётся — слово дальше` : "Ведущий сейчас даст слово";
  } else if (state === "turn") {
    plateTitle = "Отвечайте! Назовите ответ вслух";
    plateText = "Ведущий слушает вас — ваше имя на экране зала";
  } else if (state === "out") {
    plateTitle = "В этом вопросе вы больше не отвечаете";
    plateText = "Слово перешло к следующему. В новом вопросе кнопка снова загорится";
  } else if (state === "won") {
    plateTitle = "Верно! Очко ваше";
    plateText = "Смотрите на экран";
  } else if (state === "lost") {
    plateTitle = speaker ? `Ответил ${speaker}` : "Вопрос закрыт";
    plateText = "Ждите следующий вопрос";
  } else {
    plateTitle = "Ждём вопрос";
    plateText = "Кнопка загорится, когда ведущий откроет вопрос";
  }

  return (
    <div className={`buzz buzz--${state}`}>
      <div className="buzz__ring">
        <button type="button" className="buzz__button" disabled={state !== "press" || sending} onClick={onPress} aria-describedby="buzz-plate">
          {sending ? "…" : TITLES[state]}
        </button>
      </div>
      <div className="buzz__plate" id="buzz-plate" role="status" aria-live="assertive">
        <strong>{plateTitle}</strong>
        <span>{plateText}</span>
      </div>
    </div>
  );
}
