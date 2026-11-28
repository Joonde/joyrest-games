/**
 * Карточка «Команды» на пульте в управляемом лобби (ТЗ 7.2–7.4, макеты 2–5 части 1б). «Случайно»: до деления — список
 * гостей с галочками (кого делим), кнопка «Разделить»; после — команды полным составом. «Гости сами» — команды компактно
 * («Капитан — Аня · ещё 5»), полный состав по касанию (решения владельца 28 ноября 2026). У игрока — «Сделать капитаном»
 * и перевод в другую команду; без команды — «Распределить оставшихся»; «Сбросить команды» — с подтверждением.
 *
 * Действия идут через `teamLobbyRepo` с `revision`, которую видел пульт: игра ушла вперёд (второй пульт) — сервер
 * отказывает, карточка берёт свежий состав и просит нажать ещё раз. Исключения хранятся на сервере, «добавить гостя не
 * на связи» — только у этого пульта до нажатия.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { lobbyRoster, plural, unwillingCaptains } from "../../core/teamFormation";
import { isOnline } from "../../core/presence";
import {
  clock,
  errorCodeOf,
  participantsRepo,
  sessionsRepo,
  teamLobbyRepo,
  type Participant,
  type Session,
  type TeamFormation,
  type TeamFormationResult,
  type TeamLobbyPublic,
} from "../../data";
import { ConfirmDialog } from "../ConfirmDialog";
import { NameText } from "../NameText";
import { SeatSteppers } from "../TeamFormationPicker";
import "./teamLobby.css";

/** Сколько гостей без команды показывать сразу; остальные — «Показать всех» (решение владельца 28 ноября 2026). */
export const WAITING_PREVIEW = 7;

const ERRORS: Record<string, string> = {
  "team-full": "В этой команде уже нет мест.",
  "team-limit": "Команд уже столько, сколько разрешено. Увеличьте число команд в настройках.",
  "team-name-taken": "Такое название уже есть.",
  "capacity-exceeded": "Гостей больше, чем мест: увеличьте число команд или мест.",
  "capacity-limit": "Не больше 100 мест на игру: уменьшите число команд или мест.",
  "not-enough-players": "Гостей с галочкой меньше, чем команд: уменьшите число команд или отметьте больше гостей.",
  "already-assigned": "Этот гость уже в команде.",
  "already-distributed": "Гостей уже разделили. Чтобы разделить заново — «Сбросить команды».",
  "formation-changed": "Состав только что изменился — мы показали свежий. Нажмите ещё раз.",
  "failed-precondition": "Сейчас нельзя: идёт вопрос или игра уже в другом состоянии.",
  "invalid-argument": "Такую команду уже убрали. Обновили список.",
  "not-found": "Этого гостя уже нет в игре.",
  unavailable: "Нет связи. Проверьте интернет и нажмите ещё раз.",
};

export function teamLobbyError(error: unknown): string {
  return ERRORS[errorCodeOf(error)] ?? "Не получилось. Проверьте интернет и попробуйте снова.";
}

/** Настройки и исключения из потока лобби (у пульта — с исключёнными); пока поток не пришёл — из снимка сессии. */
export function useLobbyFormation(session: Session): { formation: TeamFormation | null; lobby: TeamLobbyPublic | null } {
  const [lobby, setLobby] = useState<TeamLobbyPublic | null>(null);
  const managed = session.teamFormation != null;
  useEffect(() => {
    if (!managed || !teamLobbyRepo) return;
    return teamLobbyRepo.watch(session.id, setLobby, () => undefined);
  }, [session.id, managed]);
  const fromSession = session.teamFormation ?? null;
  const fromLobby = lobby?.formation ?? null;
  // Свежее — с большей revision (поток лобби и снимок сессии приходят разными путями); исключённых в снимке сессии нет —
  // они всегда из потока лобби (иначе галочки мигали бы).
  const newest = fromLobby && (!fromSession || fromLobby.revision >= fromSession.revision) ? fromLobby : fromSession;
  const formation = newest ? { ...newest, excluded: fromLobby?.excluded ?? [] } : null;
  return { formation: managed ? formation : null, lobby };
}

/**
 * Убранная команда (сброс, расформирование, пустая после выхода) — её запись уходит из таблицы (ТЗ 7.2). Запись команды с
 * телефонами несёт `captainUid` (`leaderboardAdditions`), ручная «без телефона» — нет: её не трогаем. Работает на любой
 * вкладке и при открытии пульта (команду могли убрать, пока пульт был закрыт); не дошло — повтор через 5 с при следующем
 * изменении. `loaded` — пришёл первый список участников (до него пустой список — не «все команды убраны»).
 */
export function useRemovedTeamsCleanup(session: Session, participants: Participant[], managed: boolean, loaded: boolean) {
  const sent = useRef<{ key: string; at: number } | null>(null);
  // Когда пульт впервые не увидел команду среди участников. Удаляем только пропавшую дольше REMOVED_GRACE_MS: второй пульт
  // с отстающим списком (переподключение, опрос) не сотрёт запись команды, только что созданной на первом.
  const missingSince = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!managed || !loaded) return;
    const real = new Set(participants.filter((p) => p.kind === "team").map((t) => t.id));
    const at = Date.now();
    const missing = Object.entries(session.leaderboard)
      .filter(([id, e]) => e.kind === "team" && e.captainUid !== undefined && !real.has(id))
      .map(([id]) => id);
    for (const id of [...missingSince.current.keys()]) if (!missing.includes(id)) missingSince.current.delete(id);
    for (const id of missing) if (!missingSince.current.has(id)) missingSince.current.set(id, at);
    const gone = missing.filter((id) => at - (missingSince.current.get(id) ?? at) >= REMOVED_GRACE_MS).sort();
    const waiting = missing.length > gone.length;
    // Ждём срока — проверим ещё раз, даже если ничего не изменится.
    const timer = waiting ? window.setTimeout(() => setTick((n) => n + 1), REMOVED_GRACE_MS / 2) : undefined;
    if (gone.length > 0) {
      const key = gone.join(",");
      if (!sent.current || sent.current.key !== key || at - sent.current.at >= 5000) {
        sent.current = { key, at };
        void sessionsRepo.apply(session.id, { leaderboard: Object.fromEntries(gone.map((id) => [id, null])) }).catch(() => undefined);
      }
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [participants, session.id, session.leaderboard, managed, loaded, tick]);
}

/** Сколько команда должна отсутствовать среди участников, прежде чем пульт уберёт её запись из таблицы. */
export const REMOVED_GRACE_MS = 10_000;

function Presence({ on }: { on: boolean }) {
  return <span role="img" className={on ? "presence presence--on" : "presence presence--off"} title={on ? "На связи" : "Не на связи"} aria-label={on ? "на связи" : "не на связи"} />;
}

export function TeamFormationCard({
  session,
  participants,
  formation,
  onToast,
  onBusy,
}: {
  session: Session;
  participants: Participant[];
  formation: TeamFormation;
  onToast: (text: string) => void;
  /** Идёт действие формирования — пульт не даёт «Начать игру» (ТЗ 7.3). */
  onBusy?: (busy: boolean) => void;
}) {
  const repo = teamLobbyRepo;
  const phase = session.state.phase;
  const lobbyPhase = phase === "lobby";
  const now = Date.now() + clock.offset();
  const { teams, members, waiting } = useMemo(() => lobbyRoster(participants), [participants]);
  const unwilling = useMemo(() => new Set(unwillingCaptains(participants)), [participants]);
  const excluded = useMemo(() => new Set(formation.excluded ?? []), [formation.excluded]);
  const [includeOffline, setIncludeOffline] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState({ teamCount: formation.teamCount, maxMembers: formation.maxMembers, mode: formation.mode });
  const [confirmReset, setConfirmReset] = useState(false);
  const [disband, setDisband] = useState<Participant | null>(null);
  const [busy, setBusyState] = useState(false);
  // Двойное касание: второй запрос не уходит, пока идёт первый (состояние обновится только после перерисовки).
  const inFlight = useRef(false);
  const setBusy = (value: boolean) => {
    inFlight.current = value;
    setBusyState(value);
    onBusy?.(value);
  };
  const [error, setError] = useState<string | null>(null);
  // revision из ответа сервера: следующее действие не ждёт, пока поток принесёт новую (иначе лишний 409).
  const [knownRevision, setKnownRevision] = useState(0);
  const revision = Math.max(formation.revision, knownRevision);
  const random = formation.mode === "randomTeams";
  const beforeSplit = random && teams.length === 0 && lobbyPhase;
  // Во время игры исключения не действуют (ТЗ 6.4).
  const isExcluded = (p: Participant) => lobbyPhase && excluded.has(p.id);
  const online = (p: Participant) => isOnline(p, now);
  const checked = (p: Participant) => !isExcluded(p) && (online(p) || includeOffline.has(p.id));
  const chosen = waiting.filter(checked);
  const offlineChosen = chosen.filter((p) => !online(p)).map((p) => p.id);

  useEffect(() => {
    if (!settingsOpen) setDraft({ teamCount: formation.teamCount, maxMembers: formation.maxMembers, mode: formation.mode });
  }, [settingsOpen, formation.teamCount, formation.maxMembers, formation.mode]);

  if (!repo) return null;

  async function run<T>(action: () => Promise<T>, done?: (result: T) => void, failText?: (e: unknown) => string | null) {
    if (inFlight.current) return false;
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result && typeof result === "object" && "revision" in result && typeof result.revision === "number") {
        setKnownRevision((r) => Math.max(r, result.revision as number));
      }
      done?.(result);
      return true;
    } catch (e) {
      setError(failText?.(e) ?? teamLobbyError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Во время игры исключений нет: галочку гостя на связи не снять, можно только добавить гостя не на связи. */
  const lockedOn = (p: Participant) => !lobbyPhase && online(p);

  function toggle(p: Participant) {
    if (!repo || lockedOn(p)) return;
    if (!lobbyPhase) {
      setIncludeOffline((s) => (s.has(p.id) ? new Set([...s].filter((x) => x !== p.id)) : new Set([...s, p.id])));
      return;
    }
    if (checked(p)) {
      if (includeOffline.has(p.id)) setIncludeOffline((s) => new Set([...s].filter((x) => x !== p.id)));
      else void run(() => repo.exclude(session.id, p.id, true));
      return;
    }
    if (!online(p)) setIncludeOffline((s) => new Set([...s, p.id]));
    if (isExcluded(p)) void run(() => repo.exclude(session.id, p.id, false));
  }

  const summary = (result: TeamFormationResult, what: string) => {
    const placed = Object.keys(result.assigned ?? {}).length;
    const rest = (result.rest?.length ?? 0) + (result.skippedOffline?.length ?? 0);
    onToast(rest > 0 ? `${what}: ${placed}. Без команды осталось ${rest}.` : `${what}: ${placed}.`);
    setIncludeOffline(new Set());
  };

  const distribute = () =>
    run(() => repo.distribute(session.id, revision, offlineChosen), (r) => summary(r, `Разделили на ${formation.teamCount} ${plural(formation.teamCount, "команду", "команды", "команд")}`));
  const autoAssign = () => run(() => repo.autoAssign(session.id, revision, offlineChosen), (r) => summary(r, "Распределили"));
  const reset = () =>
    run(
      () => repo.reset(session.id, revision),
      () => {
        setConfirmReset(false);
        onToast("Команды сброшены");
      },
    );
  const saveSettings = () =>
    run(
      () => repo.settings(session.id, revision, draft),
      () => {
        setSettingsOpen(false);
        onToast("Настройки сохранены");
      },
    );
  const move = (p: Participant, teamId: string | null) =>
    run(
      () => repo.move(session.id, p.id, teamId, revision),
      () => {
        setMenuFor(null);
        onToast(teamId ? `${p.name} — в «${teams.find((t) => t.id === teamId)?.name ?? ""}»` : `${p.name} — без команды`);
      },
    );
  const makeCaptain = (team: Participant, p: Participant) =>
    run(
      () => participantsRepo.setCaptain(session.id, team.id, p.id),
      () => {
        setMenuFor(null);
        onToast(`Капитан «${team.name}» — ${p.name}`);
      },
    );
  const removeTeam = (team: Participant) =>
    run(
      async () => {
        await participantsRepo.remove(session.id, team.id);
        if (session.leaderboard[team.id]) await sessionsRepo.apply(session.id, { leaderboard: { [team.id]: null } });
      },
      () => {
        setDisband(null);
        onToast(`«${team.name}» расформирована`);
      },
      (e) => (errorCodeOf(e) === "failed-precondition" && !lobbyPhase ? "Последнюю команду с людьми нельзя расформировать — сначала создайте другую." : null),
    );
  // Ведущий сам создаёт команду с капитаном из ожидающих (ТЗ 7.4): в «Гости сами», после деления и во время игры.
  const canAddTeam = teams.length < formation.teamCount && !beforeSplit;
  const addTeam = (p: Participant) =>
    run(
      () => repo.addTeam(session.id, revision, p.id),
      () => onToast(`Новая команда — капитан ${p.name}`),
    );

  const largest = Math.max(0, ...teams.map((t) => members(t.id).length));
  const title = beforeSplit
    ? `${formation.teamCount} ${plural(formation.teamCount, "команда", "команды", "команд")} по ${formation.maxMembers} ${plural(formation.maxMembers, "место", "места", "мест")}`
    : random
      ? `Команд: ${teams.length}`
      : `${teams.length} ${plural(teams.length, "команда", "команды", "команд")} из ${formation.teamCount} возможных`;
  const visibleWaiting = showAll ? waiting : waiting.slice(0, WAITING_PREVIEW);
  const inTeams = participants.filter((p) => p.kind === "player").length - waiting.length;

  function memberMenu(team: Participant, p: Participant) {
    return (
      <div className="card lob-sheet" role="group" aria-label={`Действия: ${p.name}`}>
        <p className="eyebrow">{p.name}</p>
        {team.captainUid !== p.id && (
          <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void makeCaptain(team, p)}>
            Сделать капитаном «{team.name}»
          </button>
        )}
        <p className="muted small">Перевести в команду:</p>
        {teams
          .filter((t) => t.id !== team.id)
          .map((t) => {
            const size = members(t.id).length;
            const full = size >= formation.maxMembers;
            return (
              <button key={t.id} type="button" className="btn btn--secondary btn--block" disabled={busy || full} onClick={() => void move(p, t.id)}>
                {t.name} · {size} / {formation.maxMembers}
                {full ? " — мест нет" : ""}
              </button>
            );
          })}
        <button type="button" className="btn btn--secondary btn--block" disabled={busy} onClick={() => void move(p, null)}>
          Без команды
        </button>
        {!lobbyPhase && <p className="muted small">Во время вопроса переводить нельзя — только между вопросами. Очки остаются у команды.</p>}
        <button type="button" className="btn btn--quiet btn--block" onClick={() => setMenuFor(null)}>
          Отмена
        </button>
      </div>
    );
  }

  function teamCard(team: Participant) {
    const crew = members(team.id).sort((a, b) => (a.id === team.captainUid ? -1 : b.id === team.captainUid ? 1 : (a.joinedAt ?? 0) - (b.joinedAt ?? 0)));
    const captain = crew.find((m) => m.id === team.captainUid);
    const expanded = random || open.has(team.id);
    return (
      <div key={team.id} className="lob-team">
        <div className="lob-team__head">
          <button
            type="button"
            className="lob-team__toggle"
            aria-expanded={random ? undefined : expanded}
            onClick={() => !random && setOpen((s) => (s.has(team.id) ? new Set([...s].filter((x) => x !== team.id)) : new Set([...s, team.id])))}
          >
            {/* Одной строкой: смайлик и название — один элемент колонки, а не два. */}
            <span>
              <NameText name={team.name} />
            </span>
            {!expanded && (
              <span className="lob-note">
                {captain ? `Капитан — ${captain.name}` : "Без капитана"}
                {crew.length > 1 ? ` · ещё ${crew.length - 1}` : ""}
              </span>
            )}
          </button>
          <span className="lob-team__seats">
            {crew.length} / {formation.maxMembers}
          </span>
          <button type="button" className="btn btn--quiet" aria-label={`Расформировать «${team.name}»`} title="Расформировать" disabled={busy} onClick={() => setDisband(team)}>
            ✕
          </button>
        </div>
        {expanded && (
          <ul className="lob-team__members">
            {crew.map((m) => (
              <li key={m.id}>
                <button type="button" aria-expanded={menuFor === m.id} onClick={() => setMenuFor((cur) => (cur === m.id ? null : m.id))}>
                  <Presence on={online(m)} />
                  <span className="lob-grow">
                    <NameText name={m.name} />
                  </span>
                  {m.noCaptain && <span className="lob-note">не хочет быть капитаном</span>}
                  {m.id === team.captainUid && <span className="lob-cap">капитан</span>}
                  <span aria-hidden>⋯</span>
                </button>
                {menuFor === m.id && memberMenu(team, m)}
              </li>
            ))}
          </ul>
        )}
        {unwilling.has(team.id) && captain && (
          <p className="lob-warn">
            {captain.name} отметил(а) «Не хочу быть капитаном». Коснитесь другого игрока → «Сделать капитаном».
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="card">
      <p className="eyebrow">Команды · {random ? "случайно" : "гости сами"}</p>
      <h2>{title}</h2>
      <div className="lob-row" aria-live="polite">
        {beforeSplit ? (
          <>
            <span className="lob-stat">В лобби: {waiting.length}</span>
            <span className="lob-stat">
              <Presence on /> на связи: {waiting.filter(online).length}
            </span>
            <span className="lob-stat">без галочки: {waiting.length - chosen.length}</span>
          </>
        ) : (
          <>
            <span className="lob-stat">в командах: {inTeams}</span>
            <span className="lob-stat">без команды: {waiting.length}</span>
            <span className="lob-stat">мест: по {formation.maxMembers}</span>
            {lobbyPhase && excluded.size > 0 && <span className="lob-stat">исключены: {waiting.filter(isExcluded).length}</span>}
          </>
        )}
      </div>

      {!beforeSplit && teams.map(teamCard)}

      {waiting.length > 0 && (
        <>
          {!beforeSplit && <h3>Без команды: {waiting.length}</h3>}
          {random && lobbyPhase && (
            <p className="muted small">
              {beforeSplit ? "Делим тех, у кого галочка. " : ""}Снимите галочку, если гость не играет. Поставьте гостю не на связи — у него мог погаснуть экран.
            </p>
          )}
          <ul className="lob-list">
            {visibleWaiting.map((p) => (
              <li key={p.id} className={online(p) ? undefined : "is-off"}>
                {random || !lobbyPhase ? (
                  <label>
                    <input type="checkbox" checked={checked(p)} disabled={busy || lockedOn(p)} onChange={() => toggle(p)} />
                    <Presence on={online(p)} />
                    <span className="lob-grow">
                      <NameText name={p.name} />
                      {isExcluded(p) && <span className="lob-note"> · снят(а) вами</span>}
                      {!online(p) && !isExcluded(p) && <span className="lob-note"> · не на связи</span>}
                    </span>
                  </label>
                ) : (
                  <>
                    <Presence on={online(p)} />
                    <span className="lob-grow">
                      <NameText name={p.name} />
                    </span>
                  </>
                )}
                {canAddTeam && (
                  <button type="button" className="btn btn--quiet" disabled={busy} aria-label={`Новая команда, капитан — ${p.name}`} title="Новая команда с этим капитаном" onClick={() => void addTeam(p)}>
                    + команда
                  </button>
                )}
              </li>
            ))}
          </ul>
          {waiting.length > WAITING_PREVIEW && (
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Свернуть" : `Показать всех (${waiting.length})`}
            </button>
          )}
        </>
      )}

      {beforeSplit ? (
        <>
          <button type="button" className="btn btn--block" disabled={busy || chosen.length < formation.teamCount} onClick={() => void distribute()}>
            Разделить {chosen.length} {plural(chosen.length, "гостя", "гостей", "гостей")} на {formation.teamCount} {plural(formation.teamCount, "команду", "команды", "команд")}
          </button>
          {chosen.length < formation.teamCount && <p className="muted small">Нужно хотя бы {formation.teamCount} {plural(formation.teamCount, "гость", "гостя", "гостей")} с галочкой — по одному на команду.</p>}
        </>
      ) : (
        teams.length > 0 &&
        chosen.length > 0 && (
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void autoAssign()}>
            Распределить оставшихся ({chosen.length})
          </button>
        )
      )}

      {lobbyPhase && teams.length > 0 && (
        <button type="button" className="btn btn--quiet btn--block" disabled={busy} onClick={() => setConfirmReset(true)}>
          {random ? "Сбросить команды и разделить заново" : "Сбросить все команды"}
        </button>
      )}

      {settingsOpen ? (
        <div className="lob-sheet">
          {lobbyPhase && teams.length === 0 && (
            <fieldset>
              <legend>Как собираем команды</legend>
              {(["self", "randomTeams"] as const).map((mode) => (
                <label key={mode} className="choice">
                  <input type="radio" name="lobbyMode" checked={draft.mode === mode} onChange={() => setDraft((d) => ({ ...d, mode }))} />
                  <span className="choice__text">
                    <span className="choice__title">{mode === "self" ? "Гости сами" : "Случайно"}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <SeatSteppers
            teamCount={draft.teamCount}
            maxMembers={draft.maxMembers}
            minTeams={Math.max(1, teams.length)}
            minMembers={Math.max(2, largest)}
            onChange={(n) => setDraft((d) => ({ ...d, ...n }))}
          />
          <button type="button" className="btn btn--block" disabled={busy} onClick={() => void saveSettings()}>
            Сохранить
          </button>
          <button type="button" className="btn btn--quiet btn--block" onClick={() => setSettingsOpen(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn--quiet btn--block" onClick={() => setSettingsOpen(true)}>
          Изменить число команд и мест
        </button>
      )}

      {error && !confirmReset && !disband && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Сбросить команды?"
        confirmLabel="Сбросить"
        busy={busy}
        error={confirmReset ? error : null}
        onConfirm={() => void reset()}
        onCancel={() => setConfirmReset(false)}
      >
        <p>Все команды удалятся, гости станут без команды. Команды без телефона в таблице останутся.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={disband !== null}
        title={`Расформировать «${disband?.name ?? ""}»?`}
        confirmLabel="Расформировать"
        busy={busy}
        error={disband ? error : null}
        onConfirm={() => disband && void removeTeam(disband)}
        onCancel={() => setDisband(null)}
      >
        <p>{lobbyPhase ? "Её гости станут без команды." : "Очки команды пропадут, её гости станут без команды — распределите их снова."}</p>
      </ConfirmDialog>
    </section>
  );
}
