// Конструктор «Шпиона»: настройки партии (шпионов, время, партии, очки) и колода локаций с ролями.
import { ClampedNumber } from "../../components/ClampedNumber";
import { useConfirm } from "../../components/ConfirmDialog";
import { Fold } from "../../components/Fold";
import type { EditorProps } from "../types";
import { createSpy, DEFAULT_LOCATIONS, rolesOf, SPY_LIMITS, type SpyContent, type SpyLocation } from "./content";
import { validateSpy } from "./validate";

/** Роли в поле — через запятую. */
function rolesText(l: SpyLocation): string {
  return l.roles.join(", ");
}

function parseRoles(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((r) => r.trim().slice(0, SPY_LIMITS.role))
    .filter(Boolean)
    .slice(0, SPY_LIMITS.maxRoles);
}

export function SpyEditor({ content, onChange, editable }: EditorProps<SpyContent>) {
  const [dialog, confirm] = useConfirm();
  const errors = validateSpy(content);
  const errorAt = (path: string) => errors.find((e) => e.path === path)?.message;
  const setLocation = (i: number, next: SpyLocation) => onChange({ ...content, locations: content.locations.map((l, k) => (k === i ? next : l)) });
  const removeLocation = (i: number) => onChange({ ...content, locations: content.locations.filter((_, k) => k !== i) });
  const addLocation = () => onChange({ ...content, locations: [...content.locations, { name: "", roles: [] }] });
  const missingDefaults = DEFAULT_LOCATIONS.filter((d) => !content.locations.some((l) => l.name.trim().toLowerCase() === d.name.toLowerCase()));

  return (
    <div className="stack sp-editor">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Все игроки, кроме шпиона, получают на телефон одну и ту же локацию и свою роль в ней. Шпион не знает, где все. По очереди задаём друг другу вопросы: город ищет шпиона, шпион — пытается понять локацию. В любой момент шпион может нажать «Я знаю, где мы!». Голосованием город обвиняет подозреваемого. Игра для {SPY_LIMITS.minPlayers}–{SPY_LIMITS.maxPlayers} игроков, каждый за себя.
        </p>
      </section>

      <section className="card stack">
        <h2>Партия</h2>
        <fieldset className="stack stack--tight">
          <legend>Шпионов в партии</legend>
          {(["auto", 1, 2] as const).map((mode) => (
            <label key={String(mode)} className="choice">
              <input type="radio" name="spy-count" checked={content.spies === mode} disabled={!editable} onChange={() => onChange({ ...content, spies: mode })} />
              <span className="choice__text">
                <span className="choice__title">{mode === "auto" ? "По числу игроков (рекомендуем)" : mode === 1 ? "Один шпион" : "Два шпиона"}</span>
                <span className="choice__hint">{mode === "auto" ? `Один, с ${SPY_LIMITS.twoSpiesFrom} игроков — двое` : mode === 1 ? "Классика" : "Шпионы не знают друг друга. Меньше 6 игроков — всё равно один"}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="row board-editor__size">
          <label className="field">
            Обсуждение, минут
            <ClampedNumber value={content.roundMinutes} min={SPY_LIMITS.minMinutes} max={SPY_LIMITS.maxMinutes} fallback={8} disabled={!editable} onChange={(roundMinutes) => onChange({ ...content, roundMinutes })} />
          </label>
          <label className="field">
            Голосование, секунд
            <ClampedNumber value={content.voteSeconds} min={SPY_LIMITS.minVote} max={SPY_LIMITS.maxVote} fallback={45} disabled={!editable} onChange={(voteSeconds) => onChange({ ...content, voteSeconds })} />
          </label>
          <label className="field">
            Партий за игру
            <ClampedNumber value={content.parties} min={1} max={10} fallback={3} disabled={!editable} onChange={(parties) => onChange({ ...content, parties })} />
          </label>
        </div>
        <Fold title="Очки" value={`город ${content.townPoints} · шпион ${content.spyPoints} · угадал +${content.guessBonus}`}>
          <div className="row board-editor__size">
            <label className="field">
              Победил город — каждому
              <ClampedNumber value={content.townPoints} min={0} max={1000} fallback={100} disabled={!editable} onChange={(townPoints) => onChange({ ...content, townPoints })} />
            </label>
            <label className="field">
              Победил шпион — каждому шпиону
              <ClampedNumber value={content.spyPoints} min={0} max={1000} fallback={300} disabled={!editable} onChange={(spyPoints) => onChange({ ...content, spyPoints })} />
            </label>
            <label className="field">
              Шпион угадал локацию — сверху
              <ClampedNumber value={content.guessBonus} min={0} max={1000} fallback={100} disabled={!editable} onChange={(guessBonus) => onChange({ ...content, guessBonus })} />
            </label>
          </div>
        </Fold>
      </section>

      <section className="card stack">
        <h2>Локации</h2>
        <p className="muted small">
          В каждой партии — новая локация из колоды, в одной игре они не повторяются. Роли — через запятую: игроков больше, чем ролей, — роли повторяются. Список всех локаций видят все игроки.
        </p>
        {errorAt("locations") && (
          <p className="error" role="alert">
            {errorAt("locations")}
          </p>
        )}
        <Fold title="Колода" value={`${content.locations.length} локаций`}>
          <ol className="sp-editor__list">
            {content.locations.map((l, i) => {
              const err = errorAt(`locations/${i}/name`) ?? errorAt(`locations/${i}/roles`);
              return (
                <li key={i} className="sp-editor__item stack stack--tight">
                  <div className="sp-editor__head">
                    <input className="input" aria-label={`Локация ${i + 1}`} placeholder="Название локации" value={l.name} maxLength={SPY_LIMITS.name} disabled={!editable} onChange={(e) => setLocation(i, { ...l, name: e.target.value })} />
                    {editable && (
                      <button type="button" className="btn btn--quiet" aria-label={`Убрать локацию ${l.name || i + 1}`} onClick={() => removeLocation(i)}>
                        Убрать
                      </button>
                    )}
                  </div>
                  <label className="field">
                    <span className="muted small">Роли ({rolesOf(l).length})</span>
                    <textarea className="input" rows={2} value={rolesText(l)} disabled={!editable} onChange={(e) => setLocation(i, { ...l, roles: e.target.value.split(",").map((r) => r.trimStart()).slice(0, SPY_LIMITS.maxRoles) })} onBlur={(e) => setLocation(i, { ...l, roles: parseRoles(e.target.value) })} />
                  </label>
                  {err && <p className="error small">{err}</p>}
                </li>
              );
            })}
          </ol>
          {editable && (
            <div className="actions">
              <button type="button" className="btn btn--secondary btn--block" disabled={content.locations.length >= SPY_LIMITS.maxLocations} onClick={addLocation}>
                + Локация
              </button>
              {missingDefaults.length > 0 && (
                <button
                  type="button"
                  className="btn btn--quiet btn--block"
                  disabled={content.locations.length >= SPY_LIMITS.maxLocations}
                  onClick={() => onChange({ ...content, locations: [...content.locations, ...missingDefaults.map((d) => ({ name: d.name, roles: [...d.roles] }))].slice(0, SPY_LIMITS.maxLocations) })}
                >
                  Вернуть стандартные локации ({missingDefaults.length})
                </button>
              )}
              <button type="button" className="btn btn--quiet btn--block" onClick={() => confirm({ title: "Сбросить колоду?", text: "Свои локации и правки ролей пропадут — вернётся стандартная колода.", confirmLabel: "Сбросить", run: () => onChange({ ...content, locations: createSpy().locations }) })}>
                Сбросить колоду к стандартной
              </button>
            </div>
          )}
        </Fold>
      </section>
      {dialog}
    </div>
  );
}
