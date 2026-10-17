/**
 * «Как прошло мероприятие?» на главной студии (решение владельца 17 октября 2026): ведущий сразу после мероприятия
 * отмечает «Проведено» или «Не состоялось» одним касанием, без поиска в планировщике. Владельцу — все неотмеченные.
 * «Проведено» само ставит клиенту статус «Провели» в «Клиентах»; ведущему ещё приходит напоминание в Telegram
 * через полчаса после конца. На пульте после «Завершить игру» (`hostId`) — мероприятия этого ведущего, которые уже
 * начались вчера или сегодня: отметить можно прямо на площадке, не дожидаясь конца по расписанию.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { dayTitle, rangeLabel } from "../../core/calendar";
import { eventStatus } from "../../core/events";
import { eventsRepo, useLoad, type AgencyEvent } from "../../data";

/** Сколько дней назад ещё спрашиваем (дальше — только в «Итогах» планировщика). */
const ASK_DAYS = 14;

const dayMsk = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

export function HeldPrompt({ owner, onToast, hostId }: { owner: boolean; onToast: (text: string) => void; hostId?: string }) {
  const onPult = hostId !== undefined;
  const [state, , update] = useLoad(() => {
    if (!eventsRepo) return Promise.resolve([] as AgencyEvent[]);
    const now = Date.now();
    return onPult ? eventsRepo.range(dayMsk(now - 86_400_000), dayMsk(now)) : eventsRepo.list("past");
  }, [onPult]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!eventsRepo || state.status !== "ready") return null;
  const now = Date.now();
  const since = new Date(now + 3 * 3_600_000 - ASK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const open = state.data
    .filter((e) => !e.cancelled && e.held === null && e.day >= since && (onPult ? e.hostId === hostId && eventStatus(e, now) !== "upcoming" : eventStatus(e, now) === "past"))
    .sort((a, b) => b.day.localeCompare(a.day) || b.start - a.start);
  if (open.length === 0) return null;

  async function mark(e: AgencyEvent, held: boolean) {
    if (!eventsRepo || busy) return;
    setBusy(e.id);
    setError(null);
    try {
      const saved = await eventsRepo.setHeld(e.id, held);
      update((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      onToast(held ? (e.clientPhone ? "Отмечено: проведено. Клиенту — статус «Провели»" : "Отмечено: проведено") : "Отмечено: не состоялось");
    } catch {
      setError("Не получилось отметить. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card stack held-prompt" aria-labelledby="held-prompt">
      <p className="eyebrow">{onPult ? "Мероприятие из календаря" : "Мероприятия"}</p>
      <h2 id="held-prompt">{onPult ? "Вечер закончился? Отметьте, как прошло" : open.length === 1 ? "Как прошло мероприятие?" : `Отметьте прошедшие мероприятия: ${open.length}`}</h2>
      <p className="muted small">«Проведено» попадает в итоги, а менеджер сразу видит, что клиенту пора написать за отзывом. Отметку можно снять в «Мероприятиях».</p>
      <ul className="held-prompt__list">
        {open.slice(0, 5).map((e) => (
          <li key={e.id} className="held-prompt__item">
            <div>
              <b>{e.title || "Мероприятие"}</b>
              {e.guests ? ` · ${e.guests} гостей` : ""}
              <div className="small muted">
                {dayTitle(e.day)}, {rangeLabel(e.start, e.end)}
                {owner && e.hostName ? ` · ведёт ${e.hostName}` : ""}
              </div>
            </div>
            <div className="actions" role="group" aria-label="Состоялось ли">
              <button type="button" className="btn btn--block" disabled={busy !== null} onClick={() => void mark(e, true)}>
                {busy === e.id ? "Отмечаем…" : "✓ Проведено"}
              </button>
              {!onPult && (
                <button type="button" className="btn btn--quiet btn--block" disabled={busy !== null} onClick={() => void mark(e, false)}>
                  Не состоялось
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {open.length > 5 && (
        <Link className="btn btn--quiet btn--block" to="/studio/calendar?tab=events">
          Ещё {open.length - 5} — в «Мероприятиях»
        </Link>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
