/**
 * «Оформление под заказчика» при запуске (решение владельца 15 октября 2026): без оформления или одно из сохранённых
 * (логотип и 1–2 цвета компании или пары), «+ Новое оформление» — название, логотип (цвета подсказываются с логотипа),
 * цвета; сохранённые можно изменить и удалить (с подтверждением). Только свой сервер (`brandingsRepo`).
 */
import { useEffect, useState } from "react";
import { BRANDING_LIMITS, type SavedBranding, type SessionBranding } from "../core/branding";
import { brandingsRepo, useLoad } from "../data";
import { useConfirm } from "./ConfirmDialog";
import { Fold } from "./Fold";
import { ImageError } from "./media/compressImage";
import { prepareLogo } from "./media/logoImage";

const newId = () => `br${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

interface Draft {
  id: string;
  name: string;
  logo: string | null;
  colors: string[];
}

function Swatches({ colors }: { colors: string[] }) {
  return (
    <span className="brand-swatches" aria-hidden="true">
      {colors.map((c) => (
        <span key={c} className="brand-swatch" style={{ background: c }} />
      ))}
    </span>
  );
}

/** Выбранное оформление: null — без оформления. Список и правка — внутри. */
export function BrandingPicker({
  value,
  onChange,
}: {
  value: SessionBranding | null;
  onChange: (branding: SessionBranding | null, id: string | null) => void;
}) {
  const repo = brandingsRepo;
  const [state, retry, update] = useLoad(() => (repo ? repo.list() : Promise.resolve([] as SavedBranding[])), [repo]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, ask] = useConfirm();

  // Выбранное удалили или поменяли — выбор следует за списком.
  const list = state.status === "ready" ? state.data : [];
  useEffect(() => {
    if (!selected) return;
    const current = list.find((b) => b.id === selected);
    if (!current) onChange(null, null);
  }, [list, selected, onChange]);

  if (!repo) return null;

  function pick(b: SavedBranding | null) {
    setSelected(b?.id ?? null);
    onChange(b ? { name: b.name, colors: b.colors, logo: b.logo } : null, b?.id ?? null);
  }

  async function uploadLogo(file: File | null) {
    if (!file || !draft || !repo) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, colors } = await prepareLogo(file);
      const logo = await repo.uploadLogo(blob);
      // Цвета с логотипа — только если ведущий ещё не выбрал свои.
      setDraft((d) => (d ? { ...d, logo, colors: d.colors.length > 0 ? d.colors : colors } : d));
    } catch (e) {
      setError(e instanceof ImageError ? e.message : "Не получилось загрузить логотип. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft || !repo) return;
    if (!draft.logo && draft.colors.length === 0) {
      setError("Добавьте логотип или хотя бы один цвет.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await repo.save({ id: draft.id, name: draft.name.trim(), colors: draft.colors, logo: draft.logo });
      update((items) => [saved, ...items.filter((b) => b.id !== saved.id)]);
      setDraft(null);
      pick(saved);
    } catch {
      setError("Не получилось сохранить. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  function remove(b: SavedBranding) {
    ask({
      title: `Удалить оформление «${b.name || "без названия"}»?`,
      text: "Оно пропадёт из списка. Игры, которые уже идут с ним, не изменятся.",
      confirmLabel: "Удалить оформление",
      run: async () => {
        await repo?.remove(b.id);
        update((items) => items.filter((x) => x.id !== b.id));
        if (selected === b.id) pick(null);
      },
    });
  }

  const setColor = (i: number, color: string | null) =>
    setDraft((d) => {
      if (!d) return d;
      const colors = [...d.colors];
      if (color === null) colors.splice(i, 1);
      else colors[i] = color.toUpperCase();
      return { ...d, colors: colors.slice(0, BRANDING_LIMITS.colors) };
    });

  const title = value ? value.name || "Своё оформление" : "Без оформления";

  return (
    <>
      <Fold title="Оформление под заказчика" value={title}>
        <div className="stack stack--tight">
          <p className="muted small">Логотип и цвета компании или пары — на экране зала и телефонах гостей. Маленький знак JoyRest остаётся.</p>
          {state.status === "error" && (
            <button type="button" className="btn btn--quiet" onClick={retry}>
              Не загрузилось — повторить
            </button>
          )}
          <fieldset>
            <legend className="visually-hidden">Оформление под заказчика</legend>
            <label className="choice">
              <input type="radio" name="branding" checked={selected === null} onChange={() => pick(null)} />
              <span className="choice__text">
                <span className="choice__title">Без оформления</span>
                <span className="choice__hint">Только JoyRest</span>
              </span>
            </label>
            {list.map((b) => (
              <div key={b.id} className="brand-row">
                <label className="choice">
                  <input type="radio" name="branding" checked={selected === b.id} onChange={() => pick(b)} />
                  <span className="choice__text">
                    <span className="choice__title">
                      {b.logo && repo && <img className="brand-thumb" src={repo.logoUrl(b.logo)} alt="" />}
                      {b.name || "Без названия"}
                    </span>
                    <span className="choice__hint">
                      <Swatches colors={b.colors} />
                      {b.logo ? "логотип" : "без логотипа"}
                      {b.colors.length > 0 ? ` · цветов: ${b.colors.length}` : ""}
                    </span>
                  </span>
                </label>
                <div className="brand-row__actions">
                  <button type="button" className="btn btn--quiet" onClick={() => setDraft({ id: b.id, name: b.name, logo: b.logo, colors: b.colors })}>
                    Изменить
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={() => remove(b)}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </fieldset>

          {draft ? (
            <div className="card stack stack--tight brand-editor">
              <h3>{list.some((b) => b.id === draft.id) ? "Изменить оформление" : "Новое оформление"}</h3>
              <label className="field">
                Чьё оформление
                <input
                  value={draft.name}
                  maxLength={BRANDING_LIMITS.name}
                  placeholder="ООО «Ромашка», Свадьба Ани и Пети"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <div className="stack stack--tight">
                <span className="small">Логотип (PNG с прозрачным фоном — лучше всего)</span>
                {draft.logo && repo && <img className="brand-logo-preview" src={repo.logoUrl(draft.logo)} alt="Логотип" />}
                <label className="btn btn--secondary btn--block">
                  {busy ? "Загружаем…" : draft.logo ? "Заменить логотип" : "Выбрать логотип"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="visually-hidden"
                    disabled={busy}
                    onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)}
                  />
                </label>
                {draft.logo && (
                  <button type="button" className="btn btn--quiet" onClick={() => setDraft({ ...draft, logo: null })}>
                    Убрать логотип
                  </button>
                )}
              </div>
              <div className="brand-colors">
                {[0, 1].map((i) => {
                  const color = draft.colors[i];
                  if (color === undefined && i > draft.colors.length) return null;
                  return color === undefined ? (
                    <button key={i} type="button" className="btn btn--quiet" onClick={() => setColor(i, i === 0 ? "#C49E96" : "#E3C68C")}>
                      + {i === 0 ? "Цвет" : "Второй цвет"}
                    </button>
                  ) : (
                    <div key={i} className="brand-color">
                      <label className="field">
                        {i === 0 ? "Главный цвет" : "Второй цвет"}
                        <input type="color" value={color.toLowerCase()} onChange={(e) => setColor(i, e.target.value)} />
                      </label>
                      <button
                        type="button"
                        className="btn btn--quiet"
                        onClick={() => setColor(i, null)}
                        aria-label={`Убрать ${i === 0 ? "главный" : "второй"} цвет`}
                      >
                        Убрать
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="muted small">Цвета подстраиваются, чтобы надписи читались на любом экране: слишком светлые или тёмные чуть меняются.</p>
              <div className="actions">
                <button type="button" className="btn btn--block" disabled={busy} onClick={() => void save()}>
                  Сохранить и выбрать
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--block"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setError(null);
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setDraft({ id: newId(), name: "", logo: null, colors: [] })}>
              + Новое оформление
            </button>
          )}
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
        </div>
      </Fold>
      {confirm}
    </>
  );
}
