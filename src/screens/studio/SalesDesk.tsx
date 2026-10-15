/**
 * «Рабочее место менеджера» в студии (роль `sales`, решение владельца 15 октября 2026): сколько новых анкет ждут ответа,
 * сколько клиентов в работе, и кнопки во все нужные разделы — «Клиенты», «Заявки клиентов», «Кто может», «Мероприятия»,
 * «Инструкция менеджера».
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { clientsRepo, useLoad, type ClientRecord } from "../../data";

export function SalesDesk() {
  const [state] = useLoad(() => (clientsRepo ? clientsRepo.list(false) : Promise.resolve([] as ClientRecord[])), []);
  const list = state.status === "ready" ? state.data : null;
  const fresh = list?.filter((c) => c.status === "new").length ?? null;
  const work = list?.filter((c) => c.status === "work").length ?? null;
  // Сколько новых ждут ответа дольше 30 минут (срок из инструкции) — на момент открытия студии.
  const [opened] = useState(() => Date.now());
  const late = list?.filter((c) => c.status === "new" && opened - c.lastContactAt > 30 * 60_000).length ?? 0;
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
      {late > 0 && <p className="clients-late">⏰ Ждут ответа дольше 30 минут: {late}</p>}
      {fresh !== null && fresh > 0 && <p className="small">Ответьте новым в течение 30 минут и поставьте им «В работе» — прямо в карточке, одним касанием.</p>}
      <div className="actions">
        <Link className="btn btn--block" to={fresh ? "/studio/clients?f=new" : "/studio/clients?f=work"}>
          {fresh ? `Новые анкеты (${fresh})` : "Клиенты в работе"}
        </Link>
        <Link className="btn btn--secondary btn--block" to="/studio/clients">
          Все клиенты
        </Link>
        <Link className="btn btn--secondary btn--block" to="/venues?tab=requests">
          Подбор площадок («под ключ»)
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
