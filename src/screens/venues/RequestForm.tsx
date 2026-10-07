/**
 * Запрос клиента на подбор площадки (`/r?from=<ведущий>`): без входа. После отправки клиент
 * видит номер заявки, владелец получает её во вкладке «Заявки клиентов».
 */
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { DISTRICTS, emptyRequest, EVENT_TYPES, FORMATS, newFormId, parseRequest, requestMissing, TEXT_LIMITS, type RequestData } from "../../core/venues";
import { useLoad, venuesRepo } from "../../data";
import { Logo } from "../../components/Logo";
import { ChoiceChips, NumberField, Section, TextField, WishPicker } from "../../components/venues/Fields";
import { useDraft } from "../../components/venues/useDraft";
import { FormClosed, FormFailed, PublicSkeleton } from "./PublicParts";

interface Draft {
  id: string;
  data: RequestData;
}

function parseDraft(raw: unknown): Draft {
  const d = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { id: typeof d.id === "string" && d.id.length >= 8 ? d.id : newFormId(), data: parseRequest(d.data) };
}

export function RequestForm() {
  const [state, retry] = useLoad(() => (venuesRepo ? venuesRepo.formsOpen() : Promise.resolve(false)), []);
  if (state.status === "loading") return <PublicSkeleton />;
  if (state.status === "error") return <FormFailed onRetry={retry} />;
  if (!state.data) return <FormClosed />;
  return <RequestFormOpen />;
}

const today = () => new Date().toISOString().slice(0, 10);

function RequestFormOpen() {
  const [params] = useSearchParams();
  const from = params.get("from");
  const [draft, setDraft, clearDraft] = useDraft<Draft>("jr-request-form", () => ({ id: newFormId(), data: emptyRequest() }), parseDraft);
  const [ack, setAck] = useState(false);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [number, setNumber] = useState<number | null>(null);
  const r = draft.data;
  const set = <K extends keyof RequestData>(key: K, value: RequestData[K]) => setDraft({ ...draft, data: { ...r, [key]: value } });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!venuesRepo || sending) return;
    const lacking = requestMissing(parseRequest(r));
    if (!ack) lacking.push("отметку о подтверждении заведением");
    if (!consent) lacking.push("согласие на обработку данных");
    setMissing(lacking);
    setError(null);
    if (lacking.length > 0) {
      document.getElementById("request-form-errors")?.scrollIntoView({ block: "center" });
      return;
    }
    setSending(true);
    try {
      const result = await venuesRepo.submitRequest({ id: draft.id, from, data: parseRequest(r), website });
      clearDraft();
      setNumber(result);
      window.scrollTo({ top: 0 });
    } catch (problem) {
      const code = problem instanceof Error ? problem.message : "";
      setError(
        code === "resource-exhausted"
          ? "Слишком много заявок подряд. Попробуйте позже или напишите нам в Telegram: t.me/JoyRest."
          : code === "invalid-argument"
            ? "Проверьте обязательные поля и отправьте ещё раз."
            : "Не получилось отправить: нет связи. Заявка сохранена на телефоне — нажмите «Отправить» ещё раз.",
      );
    } finally {
      setSending(false);
    }
  }

  if (number !== null) {
    return (
      <main className="page">
        <Logo kind="full" className="logo--form" />
        <section className="card card--center" aria-live="polite">
          <p className="eyebrow">Заявка принята</p>
          {number > 0 && <p className="big-code big-code--small">№{number}</p>}
          <h2>Спасибо! Мы подберём площадки и позвоним</h2>
          <p className="muted">Назовите номер заявки, если будете писать нам. Telegram: <a href="https://t.me/JoyRest">t.me/JoyRest</a>.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <Logo kind="full" className="logo--form" />
      <header className="stack stack--tight">
        <p className="eyebrow">JoyRest · ваш праздник</p>
        <h1>Подберём площадку под ваше мероприятие</h1>
        <p className="muted">Заполните то, что знаете. Остальное уточним по телефону.</p>
      </header>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <Section title="Контакты">
          <TextField label="Как к вам обращаться" required value={r.name} maxLength={TEXT_LIMITS.person} autoComplete="name" onChange={(x) => set("name", x)} />
          <TextField label="Телефон" required type="tel" inputMode="tel" value={r.phone} maxLength={TEXT_LIMITS.phone} placeholder="+7" autoComplete="tel" onChange={(x) => set("phone", x)} />
        </Section>

        <Section title="Мероприятие">
          <ChoiceChips label="Что празднуем" required options={EVENT_TYPES} value={r.eventType} onChange={(x) => set("eventType", x)} />
          <div className="two-cols">
            <label className="field">
              <span className="field__label">Дата</span>
              <input type="date" min={today()} value={r.date} onChange={(e) => set("date", e.target.value)} />
            </label>
            <NumberField label="Гостей" required value={r.guests} max={5000} onChange={(x) => set("guests", x)} />
          </div>
          <div className="two-cols">
            <label className="field">
              <span className="field__label">Начало, примерно</span>
              <input type="time" value={r.from} onChange={(e) => set("from", e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Окончание, примерно</span>
              <input type="time" value={r.to} onChange={(e) => set("to", e.target.value)} />
            </label>
          </div>
          <p className="venue-note">
            <strong>Дата и время подтверждаются заведением.</strong> Мы созваниваемся с каждой площадкой и уточняем, свободна ли она в ваш день. Заведение может
            отказать — тогда предложим другие варианты.
          </p>
          <ChoiceChips
            label="Формат"
            options={FORMATS.map((f) => f.label)}
            value={FORMATS.find((f) => f.id === r.format)?.label ?? ""}
            onChange={(x) => set("format", FORMATS.find((f) => f.label === x)?.id ?? "")}
          />
          <NumberField label="Бюджет на гостя до, ₽" hint="примерно" value={r.budget} onChange={(x) => set("budget", x)} />
          <ChoiceChips label="Где удобнее" hint="если не важно — пропустите" options={DISTRICTS} value={r.district} onChange={(x) => set("district", x)} />
        </Section>

        <Section
          title="Пожелания"
          hint="По отмеченным пунктам мы отбираем площадки. «Обязательно» убирает все площадки без этого пункта — ставьте его только на то, без чего праздник не состоится. Сомневаетесь — напишите в комментарии."
        >
          <WishPicker value={r.wishes} onChange={(x) => set("wishes", x)} />
          <TextField label="Что ещё важно" multiline value={r.comment} maxLength={TEXT_LIMITS.comment} placeholder="Своими словами" onChange={(x) => set("comment", x)} />
        </Section>

        <label className="visually-hidden" aria-hidden="true">
          Сайт компании
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>

        <label className="choice">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span className="choice__text">
            <span className="choice__title">Понимаю, что дату, время и условия подтверждает заведение после звонка менеджера</span>
          </span>
        </label>
        <label className="choice">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="choice__text">
            <span className="choice__title">Согласен на обработку персональных данных</span>
            <span className="choice__hint">Имя и телефон нужны, чтобы позвонить вам с вариантами. Площадкам их не передаём.</span>
          </span>
        </label>

        <div id="request-form-errors" aria-live="polite">
          {missing.length > 0 && (
            <p className="error" role="alert">
              Заполните: {missing.join(", ")}.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button className="btn btn--block" type="submit" disabled={sending}>
          {sending ? "Отправляем…" : "Отправить заявку"}
        </button>
      </form>
    </main>
  );
}
