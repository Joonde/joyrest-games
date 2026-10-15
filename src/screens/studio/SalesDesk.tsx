/**
 * «Рабочее место менеджера» в студии (роль `sales`, решение владельца 15 октября 2026): сколько новых анкет ждут ответа,
 * сколько клиентов в работе, и кнопки во все нужные разделы — «Клиенты», «Заявки клиентов», «Кто может», «Мероприятия»,
 * «Инструкция менеджера».
 */
import { Link } from "react-router-dom";
import { clientsRepo, useLoad, type ClientRecord } from "../../data";

export function SalesDesk() {
  const [state] = useLoad(() => (clientsRepo ? clientsRepo.list(false) : Promise.resolve([] as ClientRecord[])), []);
  const list = state.status === "ready" ? state.data : null;
  const fresh = list?.filter((c) => c.status === "new").length ?? null;
  const work = list?.filter((c) => c.status === "work").length ?? null;
  return (
    <section className="card stack" aria-labelledby="sales-desk">
      <p className="eyebrow">Менеджер по продажам</p>
      <h2 id="sales-desk">Рабочее место</h2>
      <div className="stack stack--tight">
        <div>
          <span className="sales-desk__count">{fresh ?? "…"}</span> <span className="muted">новых анкет ждут ответа</span>
        </div>
        <div>
          <span className="sales-desk__count">{work ?? "…"}</span> <span className="muted">клиентов в работе</span>
        </div>
      </div>
      {fresh !== null && fresh > 0 && <p className="small">Ответьте новым в течение 30 минут и поставьте им «В работе».</p>}
      <div className="actions">
        <Link className="btn btn--block" to="/studio/clients">
          Клиенты
        </Link>
        <Link className="btn btn--secondary btn--block" to="/venues?tab=requests">
          Заявки на подбор площадок
        </Link>
        <Link className="btn btn--secondary btn--block" to="/studio/calendar">
          Кто может в дату
        </Link>
        <Link className="btn btn--secondary btn--block" to="/studio/calendar?tab=events">
          Мероприятия
        </Link>
        <Link className="btn btn--quiet btn--block" to="/studio/sales-guide">
          Инструкция менеджера
        </Link>
      </div>
    </section>
  );
}
