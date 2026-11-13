/**
 * Деньги под контролем владельца (решение владельца 12 ноября 2026): на главной студии — сколько предоплат нужно вернуть
 * клиентам (менеджер нажал «Вернуть предоплату», владелец ещё не отметил «вернул») и у скольких проведённых мероприятий
 * остаток на месте получен не полностью. Касание — в «Мероприятия».
 */
import { Link } from "react-router-dom";
import { eventsRepo, useLoad, type AgencyEvent } from "../../data";

export function OwnerMoney() {
  const [state] = useLoad(
    async () => (eventsRepo ? (await Promise.all([eventsRepo.list("cancelled"), eventsRepo.list("past")])).flat() : ([] as AgencyEvent[])),
    [],
  );
  if (!eventsRepo || state.status !== "ready") return null;
  const refunds = state.data.filter((e) => e.refundAt && !e.refundDoneAt).length;
  const debts = state.data.filter((e) => !e.cancelled && e.held === true && (e.restPaid === "no" || e.restPaid === "part")).length;
  // Отзыв ещё не попросили — проведённые за последние 14 дней.
  const since = new Date(Date.now() + 3 * 3_600_000 - 14 * 86_400_000).toISOString().slice(0, 10);
  const reviews = state.data.filter((e) => !e.cancelled && e.held === true && !e.review && e.day >= since).length;
  if (refunds === 0 && debts === 0 && reviews === 0) return null;
  return (
    <section className="card stack stack--tight owner-money" aria-labelledby="owner-money">
      <p className="eyebrow">Деньги и отзывы</p>
      <h2 id="owner-money">Нужно ваше внимание</h2>
      {refunds > 0 && (
        <Link className="owner-money__row" to="/studio/calendar?tab=events">
          💸 Вернуть предоплату: <b>{refunds}</b> →
        </Link>
      )}
      {debts > 0 && (
        <Link className="owner-money__row" to="/studio/calendar?tab=events">
          💰 Остаток на месте получен не полностью: <b>{debts}</b> →
        </Link>
      )}
      {reviews > 0 && (
        <Link className="owner-money__row" to="/studio/calendar?tab=events">
          ⭐ Отзыв ещё не попросили: <b>{reviews}</b> →
        </Link>
      )}
      <p className="muted small">В «Мероприятиях» такие карточки помечены. Вернули деньги клиенту — «✅ Отметить: вернул предоплату».</p>
    </section>
  );
}
