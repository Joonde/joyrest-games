/**
 * «Технический перерыв» на пульте (решение владельца 14 октября 2026): без времени или на 3 / 5 / 10 / 15 / 20 минут
 * (отсчёт по часам сервера на экране зала); пока идёт — та же кнопка «Закончить перерыв — вернуться к игре»: слайд
 * уходит, экран возвращается к игре с того же места. Время вышло — пульт сам убирает перерыв на любой вкладке
 * (`useTechBreakAutoEnd` смонтирован в пульте всегда, QA 22 октября 2026, M3).
 */
import { useEffect, useRef } from "react";
import { countdownLabel, techSlide } from "../../core/slides";
import { clock, type SessionChange, type SlideState } from "../../data";
import { useServerNow } from "./useServerNow";
import { shouldCloseTechBreak, techBreakDue } from "./techBreakAuto";

/**
 * Время перерыва вышло — убираем его сами, на какой бы вкладке ни был пульт. Перед записью сверяемся со свежим
 * слайдом (`current()`): второй пульт мог уже убрать перерыв или показать другой слайд — тогда ничего не трогаем.
 */
export function useTechBreakAutoEnd(slide: SlideState | null, current: () => SlideState | null, onApply: (change: SessionChange) => Promise<unknown>): void {
  const timed = slide?.kind === "tech" && slide.endsAt !== null;
  const now = useServerNow(1000, timed);
  const due = techBreakDue(slide, now);
  const closed = useRef<string | null>(null);
  const apply = useRef(onApply);
  apply.current = onApply;
  const read = useRef(current);
  read.current = current;
  useEffect(() => {
    if (!due || !shouldCloseTechBreak(due, read.current(), closed.current)) return;
    closed.current = due;
    // Не вышло (нет связи) — попробуем снова на следующем тике.
    void apply.current({ state: { slide: null } }).catch(() => {
      if (closed.current === due) closed.current = null;
    });
  }, [due, now]);
}

export const TECH_MINUTES = [3, 5, 10, 15, 20] as const;

export function TechBreak({ slide, busy, newId, onApply, onError }: { slide: SlideState | null; busy: boolean; newId: () => string; onApply: (change: SessionChange) => Promise<void>; onError: (text: string) => void }) {
  const tech = slide?.kind === "tech" ? slide : null;
  const now = useServerNow(1000, tech !== null && tech.endsAt !== null);

  function start(minutes: number | null) {
    const endsAt = minutes === null ? null : Date.now() + clock.offset() + minutes * 60_000;
    void onApply({ state: { slide: { ...techSlide(newId()), endsAt } } }).catch(() => onError("Не получилось показать перерыв. Проверьте интернет."));
  }

  function stop() {
    void onApply({ state: { slide: null } }).catch(() => onError("Не получилось закончить перерыв. Проверьте интернет."));
  }

  if (tech) {
    const left = tech.endsAt !== null ? countdownLabel(tech, now) : null;
    return (
      <div className="stack stack--tight">
        <button type="button" className="btn btn--block" disabled={busy} aria-pressed="true" onClick={stop}>
          ▶ Закончить перерыв — вернуться к игре
        </button>
        <p className="muted small">{left ? `Перерыв идёт · осталось ${left}. Экран вернётся к игре сам.` : "Перерыв без времени — закончите, когда будете готовы."}</p>
      </div>
    );
  }
  return (
    <div className="stack stack--tight">
      <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => start(null)}>
        Технический перерыв
      </button>
      <div className="pick-chips" role="group" aria-label="Технический перерыв на время">
        {TECH_MINUTES.map((m) => (
          <button key={m} type="button" className="pick-chip" disabled={busy} onClick={() => start(m)}>
            {m} мин
          </button>
        ))}
      </div>
    </div>
  );
}
