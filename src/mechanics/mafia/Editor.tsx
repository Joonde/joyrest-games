// Конструктор «Мафии»: роли (по числу игроков или свои), открывать ли роль выбывшего, таймеры речи и
// голосования, очки победителям, название города.
import { ClampedNumber } from "../../components/ClampedNumber";
import type { EditorProps } from "../types";
import { autoCounts, MAFIA_LIMITS, ROLES, type MafiaContent, type RoleCounts } from "./content";

const SIZES = [6, 8, 10, 12, 16, 20];

export function MafiaEditor({ content, onChange, editable }: EditorProps<MafiaContent>) {
  const setCount = (role: keyof RoleCounts, value: number) => onChange({ ...content, counts: { ...content.counts, [role]: value } });
  const sec = (label: string, value: number, fallback: number, set: (v: number) => void) => (
    <label className="field">
      {label}
      <ClampedNumber value={value} min={MAFIA_LIMITS.minSeconds} max={MAFIA_LIMITS.maxSeconds} fallback={fallback} disabled={!editable} onChange={set} />
    </label>
  );
  return (
    <div className="stack">
      <section className="card stack">
        <h2>Как играем</h2>
        <p className="muted small">
          Клубная классика: Мафия, Дон, Комиссар, Доктор и мирные жители. Роли тайные — каждый видит свою карту только на своём телефоне. Ночью ход делают все (мирные — для вида), убийство состоится, только если вся семья мафии выберет одного. Днём ведущий даёт слово, выставляет кандидатов, город голосует тайно. Игра для {MAFIA_LIMITS.minPlayers}–{MAFIA_LIMITS.maxPlayers} игроков, каждый играет за себя.
        </p>
        <label className="field">
          Название города на экране
          <input className="input" value={content.city} maxLength={MAFIA_LIMITS.city} disabled={!editable} onChange={(e) => onChange({ ...content, city: e.target.value })} />
        </label>
      </section>

      <section className="card stack">
        <h2>Роли</h2>
        <fieldset className="stack stack--tight">
          <legend className="visually-hidden">Роли</legend>
          {(["auto", "custom"] as const).map((mode) => (
            <label key={mode} className="choice">
              <input type="radio" name="mafia-roles" checked={content.roles === mode} disabled={!editable} onChange={() => onChange({ ...content, roles: mode })} />
              <span className="choice__text">
                <span className="choice__title">{mode === "auto" ? "По числу игроков (рекомендуем)" : "Задать вручную"}</span>
                <span className="choice__hint">{mode === "auto" ? "Мафии — около трети без одного, Дон и Доктор — с 7 игроков" : "Лишние места — мирные; мафии всегда меньше половины"}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {content.roles === "auto" ? (
          <div className="mf-editor__scroll">
            <table className="mf-editor__table">
              <thead>
                <tr>
                  <th>Игроков</th>
                  <th>{ROLES.don.title}</th>
                  <th>{ROLES.mafia.title}</th>
                  <th>{ROLES.commissar.title}</th>
                  <th>{ROLES.doctor.title}</th>
                </tr>
              </thead>
              <tbody>
                {SIZES.map((n) => {
                  const c = autoCounts(n);
                  return (
                    <tr key={n}>
                      <td>{n}</td>
                      <td>{c.don}</td>
                      <td>{c.mafia}</td>
                      <td>{c.commissar}</td>
                      <td>{c.doctor}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="row board-editor__size">
            <label className="field">
              Мафия (без Дона)
              <ClampedNumber value={content.counts.mafia} min={0} max={10} fallback={2} disabled={!editable} onChange={(v) => setCount("mafia", v)} />
            </label>
            {(["don", "commissar", "doctor"] as const).map((role) => (
              <label key={role} className="choice">
                <input type="checkbox" checked={content.counts[role] > 0} disabled={!editable} onChange={(e) => setCount(role, e.target.checked ? 1 : 0)} />
                <span className="choice__text">
                  <span className="choice__title">{ROLES[role].title}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <label className="choice">
          <input type="checkbox" checked={content.revealOnDeath} disabled={!editable} onChange={(e) => onChange({ ...content, revealOnDeath: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Открывать роль выбывшего</span>
            <span className="choice__hint">Веселее на празднике. В клубной игре роли открываются только в конце.</span>
          </span>
        </label>
      </section>

      <section className="card stack">
        <h2>Время и очки</h2>
        <div className="row board-editor__size">
          {sec("Речь игрока, секунд", content.speechSeconds, 60, (speechSeconds) => onChange({ ...content, speechSeconds }))}
          {sec("Последнее слово, секунд", content.lastWordSeconds, 45, (lastWordSeconds) => onChange({ ...content, lastWordSeconds }))}
          {sec("Голосование, секунд", content.voteSeconds, 30, (voteSeconds) => onChange({ ...content, voteSeconds }))}
        </div>
        <div className="row board-editor__size">
          <label className="field">
            Партий за игру
            <ClampedNumber value={content.parties} min={1} max={10} fallback={3} disabled={!editable} onChange={(parties) => onChange({ ...content, parties })} />
          </label>
          <label className="field">
            Очки каждому из победившей стороны
            <ClampedNumber value={content.winPoints} min={0} max={1000} fallback={100} disabled={!editable} onChange={(winPoints) => onChange({ ...content, winPoints })} />
          </label>
          <label className="field">
            Бонус выжившим победителям
            <ClampedNumber value={content.survivorBonus} min={0} max={1000} fallback={50} disabled={!editable} onChange={(survivorBonus) => onChange({ ...content, survivorBonus })} />
          </label>
        </div>
      </section>
    </div>
  );
}
