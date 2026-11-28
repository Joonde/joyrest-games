/**
 * Запуск игры в режиме команд (ТЗ 7.1, макет 1 части 1б): как собираем команды, сколько команд и мест. Только свой
 * сервер; по умолчанию — «Гости сами», 6 команд по 10 мест (решение владельца 28 ноября 2026). Прежнее лобби спрятано
 * в «Ещё». Всего мест не больше 100: «+» не даёт превысить.
 */
import { TEAM_LIMITS } from "../core/teamFormation";
import type { TeamFormationMode } from "../data";
import "./live/teamLobby.css";

export interface FormationChoice {
  mode: TeamFormationMode | "legacy";
  teamCount: number;
  maxMembers: number;
}

export const DEFAULT_FORMATION: FormationChoice = { mode: "self", teamCount: TEAM_LIMITS.defaultTeams, maxMembers: TEAM_LIMITS.defaultMembers };

const MODES: Array<{ id: TeamFormationMode; title: string; hint: string }> = [
  { id: "self", title: "Гости сами", hint: "Кто-то создаёт команду и становится капитаном, остальные вступают." },
  { id: "randomTeams", title: "Случайно", hint: "Вы нажимаете «Разделить» — все гости на связи делятся поровну, капитанов выбирает система." },
];

export function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <>
      <span>{label}</span>
      <span className="stepper">
        <button type="button" className="stepper__btn" aria-label={`${label}: меньше`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button type="button" className="stepper__btn" aria-label={`${label}: больше`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
    </>
  );
}

/** Числа команд и мест с потолком 100 мест: «+» доступен, только пока произведение не больше 100. */
export function SeatSteppers({ teamCount, maxMembers, minTeams = TEAM_LIMITS.minTeams, minMembers = TEAM_LIMITS.minMembers, onChange }: {
  teamCount: number;
  maxMembers: number;
  minTeams?: number;
  minMembers?: number;
  onChange: (next: { teamCount: number; maxMembers: number }) => void;
}) {
  const teamsMax = Math.min(TEAM_LIMITS.maxTeams, Math.floor(TEAM_LIMITS.maxSeats / maxMembers));
  const membersMax = Math.min(TEAM_LIMITS.maxMembers, Math.floor(TEAM_LIMITS.maxSeats / teamCount));
  return (
    <>
      <div className="lob-steps">
        <Stepper label="Команд" value={teamCount} min={minTeams} max={teamsMax} onChange={(n) => onChange({ teamCount: n, maxMembers })} />
        <Stepper label="Мест в команде" value={maxMembers} min={minMembers} max={membersMax} onChange={(n) => onChange({ teamCount, maxMembers: n })} />
      </div>
      <p className="muted small">
        Всего мест: {teamCount * maxMembers} (не больше {TEAM_LIMITS.maxSeats} на игру).
      </p>
    </>
  );
}

export function TeamFormationPicker({ value, onChange }: { value: FormationChoice; onChange: (next: FormationChoice) => void }) {
  return (
    <fieldset>
      <legend>Как собираем команды</legend>
      {MODES.map((mode) => (
        <label key={mode.id} className="choice">
          <input type="radio" name="formationMode" checked={value.mode === mode.id} onChange={() => onChange({ ...value, mode: mode.id })} />
          <span className="choice__text">
            <span className="choice__title">{mode.title}</span>
            <span className="choice__hint">{mode.hint}</span>
          </span>
        </label>
      ))}
      {value.mode !== "legacy" && <SeatSteppers teamCount={value.teamCount} maxMembers={value.maxMembers} onChange={(n) => onChange({ ...value, ...n })} />}
      <details open={value.mode === "legacy"}>
        <summary className="muted small">Ещё: старое лобби</summary>
        <label className="choice">
          <input type="radio" name="formationMode" checked={value.mode === "legacy"} onChange={() => onChange({ ...value, mode: "legacy" })} />
          <span className="choice__text">
            <span className="choice__title">Как раньше, без ограничений</span>
            <span className="choice__hint">Гости создают команды без лимита мест и без случайного деления. Отвечает капитан.</span>
          </span>
        </label>
      </details>
    </fieldset>
  );
}
