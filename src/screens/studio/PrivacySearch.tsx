/**
 * «Данные по номеру» (`/studio/privacy`, решение владельца 15 октября 2026) — только владелец.
 * Человек написал на почту «удалите мои данные»: владелец вводит его телефон, ник или почту, видит всё,
 * что по нему есть (клиенты, заявки на подбор, мероприятия, контакты площадок), открывает любую запись и
 * одной кнопкой удаляет всё навсегда. Сообщения в Telegram владелец удаляет сам.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { phoneLabel } from "../../core/clients";
import { clientsRepo, permissions, type ContactMatches } from "../../data";
import { useConfirm } from "../../components/ConfirmDialog";
import { HostGate } from "../../components/HostGate";
import { StudioSkeleton } from "../../components/Skeleton";
import { Toast, useToast } from "../../components/Toast";
import { TopBar } from "../../components/TopBar";
import { studioActions } from "./Studio";

const dayLabel = (day: string) => {
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : day;
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export function PrivacySearch() {
  return (
    <HostGate skeleton={<StudioSkeleton />}>
      {(_user, profile) => (
        <main className="page">
          <TopBar title="Данные по номеру" actions={[{ label: "В студию", to: "/studio" }, ...studioActions(profile)]} />
          {!clientsRepo ? (
            <p className="muted">Доступно на своём сервере JoyRest.</p>
          ) : !permissions.canManageClients(profile) ? (
            <p className="muted">Этот раздел открыт только владельцу агентства.</p>
          ) : (
            <Finder />
          )}
        </main>
      )}
    </HostGate>
  );
}

type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; text: string } | { kind: "ready"; query: string; data: ContactMatches };

function Finder() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [confirm, ask] = useConfirm();
  const [toast, showToast] = useToast();

  async function search(query: string) {
    if (!clientsRepo || !query.trim()) return;
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", query, data: await clientsRepo.findContact(query) });
    } catch (e) {
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
      setState({
        kind: "error",
        text: code === "invalid-argument" ? "Не похоже на телефон, ник или почту. Введите номер (например, 8 915 241-59-99), @ник или почту." : "Не получилось найти. Проверьте связь и попробуйте ещё раз.",
      });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void search(text);
  }

  const data = state.kind === "ready" ? state.data : null;
  const total = data ? data.clients.length + data.requests.length + data.events.length + data.venues.length : 0;

  function erase() {
    if (state.kind !== "ready" || !clientsRepo) return;
    const query = state.query;
    ask({
      title: `Удалить всё по ${state.data.label} навсегда?`,
      text: (
        <>
          Клиент с историей обращений и заявки на подбор удалятся целиком. В мероприятиях сотрутся имя и телефон клиента, у площадок — контактное лицо:
          сами мероприятия и площадки останутся. Вернуть нельзя. Из резервных копий данные уйдут сами не позже чем через 3 месяца и неделю.
        </>
      ),
      confirmLabel: "Удалить навсегда",
      run: async () => {
        const report = await clientsRepo!.eraseContact(query);
        const removed = report.clients + report.requests + report.events + report.venues;
        showToast(removed > 0 ? `Удалено: ${removed} ${plural(removed, "запись", "записи", "записей")}` : "Удалять нечего");
        await search(query);
      },
    });
  }

  return (
    <>
      <p className="muted">
        Человек попросил удалить свои данные (такие просьбы приходят на почту joyrest@mail.ru)? Введите телефон, @ник или почту из письма — здесь будет всё,
        что о нём есть в базе. Ответить ему нужно в течение 10 рабочих дней.
      </p>
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">Телефон, @ник или почта</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            value={text}
            maxLength={200}
            placeholder="8 915 241-59-99"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn--block" disabled={!text.trim() || state.kind === "loading"}>
          {state.kind === "loading" ? "Ищем…" : "Найти"}
        </button>
      </form>

      {state.kind === "error" && (
        <p className="notice" role="alert">
          {state.text}
        </p>
      )}

      {data && (
        <section className="stack" aria-live="polite">
          <p className="small muted">
            {total === 0 ? `По ${data.label} ничего нет — данных этого человека в базе нет.` : `Найдено по ${data.label}: ${total} ${plural(total, "запись", "записи", "записей")}`}
          </p>

          {data.clients.length > 0 && (
            <Group title="Клиенты">
              {data.clients.map((c) => (
                <Row key={c.id} title={c.name || "Без имени"} hint={[phoneLabel(c.phone), `обращений: ${c.contacts}`, c.archived ? "в архиве" : ""].filter(Boolean).join(" · ")} to={`/studio/clients?q=${encodeURIComponent(c.phone || data.label)}`} />
              ))}
            </Group>
          )}
          {data.requests.length > 0 && (
            <Group title="Заявки на подбор площадки">
              {data.requests.map((r) => (
                <Row key={r.id} title={`Заявка №${r.number}${r.name ? ` · ${r.name}` : ""}`} hint={[r.title, r.archived ? "в архиве" : ""].filter(Boolean).join(" · ")} to={`/venues/r/${encodeURIComponent(r.id)}`} />
              ))}
            </Group>
          )}
          {data.events.length > 0 && (
            <Group title="Мероприятия">
              {data.events.map((e) => (
                <Row key={e.id} title={e.title || "Мероприятие"} hint={[dayLabel(e.day), e.clientName, e.cancelled ? "отменено" : ""].filter(Boolean).join(" · ")} to="/studio/calendar?tab=events" />
              ))}
            </Group>
          )}
          {data.venues.length > 0 && (
            <Group title="Контакт площадки">
              {data.venues.map((v) => (
                <Row key={v.id} title={v.name || "Площадка"} hint={v.person ? `контакт: ${v.person}` : "контакт площадки"} to={`/venues/v/${encodeURIComponent(v.id)}`} />
              ))}
            </Group>
          )}

          {total > 0 && (
            <div className="actions">
              <button type="button" className="btn btn--secondary btn--block" onClick={erase}>
                Удалить всё по этому номеру навсегда
              </button>
            </div>
          )}
          {total > 0 && <p className="small muted">Сообщение с заявкой в Telegram-боте удалите сами — бот старые сообщения удалить не может.</p>}
        </section>
      )}
      {confirm}
      <Toast text={toast} />
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="stack stack--tight">
      <p className="eyebrow">{title}</p>
      {children}
    </div>
  );
}

function Row({ title, hint, to }: { title: string; hint: string; to: string }) {
  return (
    <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
      <div style={{ minWidth: 0 }}>
        <b>{title}</b>
        {hint && <p className="small muted" style={{ margin: 0 }}>{hint}</p>}
      </div>
      <Link to={to} style={{ flex: "0 0 auto" }}>
        Открыть →
      </Link>
    </div>
  );
}
