/**
 * Анкета площадки по QR-коду ведущего (`/v?from=<ведущий>`): без входа, около 3 минут.
 * Черновик хранится на телефоне; фото уменьшаются на телефоне и уходят после анкеты.
 */
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { emptyVenue, newFormId, parseVenue, venueMissing, type VenueData } from "../../core/venues";
import { useLoad, venuesRepo, type VenueUpload } from "../../data";
import { Logo } from "../../components/Logo";
import { FilePicker } from "../../components/venues/FilePicker";
import { Section } from "../../components/venues/Fields";
import { useDraft } from "../../components/venues/useDraft";
import { VenueEditor } from "../../components/venues/VenueEditor";
import { FormClosed, FormFailed, PublicSkeleton } from "./PublicParts";

interface Draft {
  id: string;
  data: VenueData;
}

function parseDraft(raw: unknown): Draft {
  const d = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { id: typeof d.id === "string" && d.id.length >= 8 ? d.id : newFormId(), data: parseVenue(d.data) };
}

export function VenueForm() {
  const [state, retry] = useLoad(() => (venuesRepo ? venuesRepo.formsOpen() : Promise.resolve(false)), []);
  if (state.status === "loading") return <PublicSkeleton />;
  if (state.status === "error") return <FormFailed onRetry={retry} />;
  if (!state.data) return <FormClosed />;
  return <VenueFormOpen />;
}

type Phase = { kind: "edit" } | { kind: "sending"; done: number; total: number } | { kind: "done"; failedFiles: number };

function VenueFormOpen() {
  const [params] = useSearchParams();
  const from = params.get("from");
  const [draft, setDraft, clearDraft] = useDraft<Draft>("jr-venue-form", () => ({ id: newFormId(), data: emptyVenue() }), parseDraft);
  const [photos, setPhotos] = useState<VenueUpload[]>([]);
  const [menu, setMenu] = useState<VenueUpload[]>([]);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!venuesRepo || phase.kind === "sending") return;
    const lacking = venueMissing(draft.data, menu.length);
    if (!consent) lacking.push("согласие на обработку данных");
    setMissing(lacking);
    setError(null);
    if (lacking.length > 0) {
      document.getElementById("venue-form-errors")?.scrollIntoView({ block: "center" });
      return;
    }
    setPhase({ kind: "sending", done: 0, total: photos.length + menu.length });
    try {
      const result = await venuesRepo.submitVenue({ id: draft.id, from, data: draft.data, files: [...menu, ...photos], website }, (done, total) =>
        setPhase({ kind: "sending", done, total }),
      );
      clearDraft();
      setPhase({ kind: "done", failedFiles: result.failedFiles });
      window.scrollTo({ top: 0 });
    } catch (problem) {
      const code = problem instanceof Error ? problem.message : "";
      setError(
        code === "resource-exhausted"
          ? "Слишком много анкет подряд. Попробуйте через час или напишите нам в Telegram: t.me/JoyRest."
          : code === "invalid-argument"
            ? "Проверьте обязательные поля и отправьте ещё раз."
            : "Не получилось отправить: нет связи. Анкета сохранена на телефоне — нажмите «Отправить» ещё раз.",
      );
      setPhase({ kind: "edit" });
    }
  }

  if (phase.kind === "done") {
    return (
      <main className="page">
        <Logo kind="full" className="logo--form" />
        <section className="card card--center" aria-live="polite">
          <h2>Спасибо! Анкета у нас</h2>
          <p>Мы посмотрим её и свяжемся с вами, когда появится подходящее мероприятие.</p>
          {phase.failedFiles > 0 && (
            <p className="notice">
              Не загрузилось файлов: {phase.failedFiles}. Анкета сохранена — пришлите фото или меню нам в Telegram:{" "}
              <a href="https://t.me/JoyRest">t.me/JoyRest</a>.
            </p>
          )}
        </section>
      </main>
    );
  }

  const sending = phase.kind === "sending";
  return (
    <main className="page">
      <Logo kind="full" className="logo--form" />
      <header className="stack stack--tight">
        <p className="eyebrow">JoyRest · анкета площадки</p>
        <h1>Расскажите о вашем заведении</h1>
        <p className="muted">
          Около 3 минут. Мы проводим свадьбы и корпоративы и подбираем площадки для клиентов. Звёздочкой отмечено обязательное. Заполненное
          сохраняется на этом телефоне, пока вы не отправите анкету.
        </p>
      </header>
      <form className="stack" onSubmit={onSubmit} noValidate>
        <VenueEditor
          value={draft.data}
          onChange={(data) => setDraft({ ...draft, data })}
          menuFiles={<FilePicker kind="menu" label="Фото страниц или PDF меню" files={menu} onChange={setMenu} />}
        />
        <Section title="9. Фото" hint="До 5 фото зала. Они уменьшаются прямо на телефоне перед отправкой.">
          <FilePicker kind="photo" label="Фото зала" files={photos} onChange={setPhotos} />
          <label className="field">
            <span className="field__label">Или ссылка на альбом</span>
            <input
              type="text"
              inputMode="url"
              value={draft.data.album}
              placeholder="сайт, Яндекс Диск, соцсети"
              onChange={(e) => setDraft({ ...draft, data: { ...draft.data, album: e.target.value } })}
            />
          </label>
        </Section>

        {/* Ловушка для ботов: людям не видна. */}
        <label className="visually-hidden" aria-hidden="true">
          Сайт компании
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>

        <label className="choice">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="choice__text">
            <span className="choice__title">Согласен на обработку персональных данных</span>
            <span className="choice__hint">Контакты нужны только нам для связи. Клиентам мы их не передаём.</span>
          </span>
        </label>

        <div id="venue-form-errors" aria-live="polite">
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
          {sending ? (phase.total > 0 && phase.done > 0 ? `Загружаем файлы: ${phase.done} из ${phase.total}` : "Отправляем…") : "Отправить анкету"}
        </button>
      </form>
    </main>
  );
}
