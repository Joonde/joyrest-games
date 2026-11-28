/**
 * Управляемое командное лобби на своём сервере (docs/TEAM_LOBBY_AND_COLLABORATION_TZ_2026-11-22.md, часть 1а этапа 1):
 * режимы «Сами» и «Случайно», вместимость, распределение, исключения ведущего, «Не хочу быть капитаном», опоздавшие.
 *
 * Включается только у сессии с `sessions.team_formation` (создаёт пульт с настройками). У прежних сессий (null) все
 * запросы `live.ts` работают как раньше — этот модуль их не трогает.
 *
 * Все изменения составов — в транзакции под замком `teams:<сессия>` (тот же, что у создания команды в прежнем лобби) и
 * под блокировкой строки сессии: составы, фаза и настройки читаются заново там, а не по запросу (ТЗ 14.1). Действия
 * ведущего повторяемы по `actionId` (таблица `team_formation_actions`): тот же запрос — прежний результат, тот же
 * `actionId` с другим телом — 409. Что меняет составы, растит `revision`; запрос со старым `expectedRevision` — 409.
 * «На связи» сервер считает по своим часам (75 с, `isOnline`); смена капитана — 90 с (`autoCaptainAllowed`).
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql, TransactionSql } from "postgres";
import { autoCaptainAllowed } from "../../src/core/leaderboard";
import { NAME_MAX_LENGTH } from "../../src/core/names";
import { isOnline } from "../../src/core/presence";
import {
  autoTeamNames,
  formationRevision,
  isFormationMode,
  parseTeamFormation,
  pickCaptain,
  planAutoAssign,
  planDistribution,
  settingsError,
  teamNameKey,
  type CaptainCandidate,
} from "../../src/core/teamFormation";
import * as permissions from "../../src/data/permissions";
import type { SessionPhase, StepStage, TeamFormation, TeamLobbyPublic, TeamLobbySnapshot } from "../../src/data/types";
import type { Identity } from "./auth";
import { PARTICIPANT_COLUMNS, participantOf, type ParticipantRow } from "./participantRows";

/** Поля сессии, нужные лобби (подмножество `SessionRow` из `live.ts`). */
export interface LobbySessionRow {
  id: string;
  host_id: string;
  play_mode: string;
  state: unknown;
  team_formation?: unknown;
}

type StreamFn = (
  request: FastifyRequest,
  reply: FastifyReply,
  channel: string,
  filter: (event: object) => boolean,
  snapshot: () => Promise<object>,
  transform?: (event: object) => object,
) => Promise<void>;

export interface TeamLobbyDeps {
  sql: Sql;
  hub: { publish(channel: string, event: object): void; count(channel: string): number };
  now: () => number;
  phaseOf: (state: unknown) => SessionPhase;
  stageOf: (state: unknown) => StepStage;
  fail: (reply: FastifyReply, status: number, code: string) => FastifyReply;
  requireIdentity: (request: FastifyRequest, reply: FastifyReply) => Promise<Identity | null>;
  loadSession: (id: string) => Promise<LobbySessionRow | null>;
  stream: StreamFn;
  publishParticipant: (sessionId: string, row: ParticipantRow | null, removed?: string) => void;
  /** Свежий снимок сессии всем (настройки лобби видны в `Session.teamFormation`). */
  publishSession: (sessionId: string) => Promise<void>;
  /** Пауза перед рассылкой общего лобби (несколько изменений подряд — одна рассылка). */
  debounceMs?: number;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SMALL_BODY = 16 * 1024;

/** Отказ внутри транзакции: откат и ответ с кодом (ТЗ, раздел 17). */
class LobbyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= NAME_MAX_LENGTH;
}

const newId = () => randomBytes(12).toString("base64url");
const secureInt = (max: number) => randomInt(max);

/**
 * Включено ли управляемое лобби на этом сервере: `TEAM_LOBBY=on|off`; без настройки — только на test (все адреса сайта
 * `test.*`), как проверочная комната. Пока телефон гостя (часть 1в) не готов и владелец не сказал «да», основная версия
 * создаёт только прежнее лобби, что бы ни прислал браузер.
 */
export function teamLobbyEnabled(value: string | undefined, siteHosts: readonly string[]): boolean {
  const setting = value?.trim().toLowerCase();
  if (setting) return setting === "on";
  return siteHosts.length > 0 && siteHosts.every((host) => host.startsWith("test."));
}

/** Механики, где управляемое лобби не включается без отдельного решения (ТЗ 11): «Олимп» — запрет владельца. */
export const NO_TEAM_LOBBY = new Set(["olymp"]);

/** Канал Hub общего лобби: снимок карточек команд всем телефонам сессии. */
export const lobbyChannel = (sessionId: string) => `teamlobby:${sessionId}`;

interface Changes {
  changed: ParticipantRow[];
  removed: string[];
  /** Видимые всем настройки изменились: `version + 1` и снимок сессии после записи. */
  session?: boolean;
}

/** Хранимое значение: настройки или «прежнее лобби» с последней `revision` (чтобы она не начиналась заново). */
type StoredFormation = TeamFormation | { mode: "legacy"; revision: number };

export function createTeamLobby(deps: TeamLobbyDeps) {
  const { sql, hub, now, fail } = deps;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let closed = false;

  function formationOf(row: Pick<LobbySessionRow, "play_mode" | "team_formation">): TeamFormation | null {
    return row.play_mode === "teams" ? parseTeamFormation(row.team_formation ?? null) : null;
  }

  async function lock(tx: TransactionSql, sessionId: string) {
    await tx`select pg_advisory_xact_lock(hashtext(${`teams:${sessionId}`}::text))`;
  }

  async function freshSession(tx: TransactionSql, sessionId: string, write: boolean): Promise<LobbySessionRow> {
    const rows = write
      ? await tx<LobbySessionRow[]>`select id, host_id, play_mode, state, team_formation from sessions where id = ${sessionId} for update`
      : await tx<LobbySessionRow[]>`select id, host_id, play_mode, state, team_formation from sessions where id = ${sessionId} for share`;
    const row = rows[0];
    if (!row) throw new LobbyError(404, "not-found");
    return row;
  }

  async function allRows(tx: TransactionSql | Sql, sessionId: string): Promise<ParticipantRow[]> {
    return tx<ParticipantRow[]>`select ${tx(PARTICIPANT_COLUMNS)} from participants where session_id = ${sessionId}`;
  }

  /** Состав по строкам: реальные команды, игроки, кто где. Ссылка на несуществующую команду — «без команды». */
  function roster(rows: readonly ParticipantRow[]) {
    const teams = rows.filter((r) => r.kind === "team");
    const teamIds = new Set(teams.map((t) => t.id));
    const players = rows.filter((r) => r.kind === "player");
    const teamOf = (p: ParticipantRow) => (p.team_id && teamIds.has(p.team_id) ? p.team_id : null);
    const members = (teamId: string) => players.filter((p) => teamOf(p) === teamId);
    return { teams, players, teamOf, members, waiting: players.filter((p) => teamOf(p) === null) };
  }

  const candidate = (p: ParticipantRow, at: number): CaptainCandidate => ({
    id: p.id,
    joinedAt: p.joined_at ? p.joined_at.getTime() : null,
    online: isOnline(participantOf(p), at),
    noCaptain: p.no_captain,
  });

  /**
   * Записать настройки. `out` — изменение видно всем (режим, числа, «распределено», переход в прежнее лобби): растёт
   * `version`, после записи телефоны и второй пульт получают свежий снимок сессии. Без `out` (исключения ведущего —
   * их видит только пульт) снимок сессии не рассылается.
   */
  async function saveFormation(tx: TransactionSql, sessionId: string, formation: StoredFormation, out?: Changes) {
    const visible = out !== undefined;
    await tx`
      update sessions set team_formation = ${tx.json(formation as never)}, updated_at = now(),
        version = case when ${visible} then version + 1 else version end
      where id = ${sessionId}`;
    if (out) out.session = true;
  }

  async function setTeam(tx: TransactionSql, sessionId: string, pids: readonly string[], teamId: string | null): Promise<ParticipantRow[]> {
    if (pids.length === 0) return [];
    return tx<ParticipantRow[]>`
      update participants set team_id = ${teamId} where session_id = ${sessionId} and kind = 'player' and id = any(${pids as string[]}::text[])
      returning ${tx(PARTICIPANT_COLUMNS)}`;
  }

  async function insertTeam(tx: TransactionSql, sessionId: string, id: string, name: string, captain: string): Promise<ParticipantRow> {
    const [row] = await tx<ParticipantRow[]>`
      insert into participants (session_id, id, name, kind, team_id, captain_uid)
      values (${sessionId}, ${id}, ${name}, 'team', null, ${captain})
      returning ${tx(PARTICIPANT_COLUMNS)}`;
    if (!row) throw new LobbyError(409, "already-exists");
    return row;
  }

  /**
   * Игрок уходит из команды (выход, перемещение, удаление): если он был капитаном — капитанство следующему по ТЗ 6.5
   * (согласные на связи → все на связи → …, по времени входа); остался последним — в лобби пустая команда удаляется.
   */
  async function leaveTeam(tx: TransactionSql, sessionId: string, rows: readonly ParticipantRow[], player: ParticipantRow, phase: SessionPhase, at: number, out: Changes) {
    const { teams, members, teamOf } = roster(rows);
    const teamId = teamOf(player);
    const team = teams.find((t) => t.id === teamId);
    if (!team || team.captain_uid !== player.id) return;
    const rest = members(team.id).filter((m) => m.id !== player.id);
    const next = pickCaptain(rest.map((m) => candidate(m, at)));
    if (next) {
      const [row] = await tx<ParticipantRow[]>`
        update participants set captain_uid = ${next.id} where session_id = ${sessionId} and id = ${team.id} returning ${tx(PARTICIPANT_COLUMNS)}`;
      if (row) out.changed.push(row);
    } else if (phase === "lobby") {
      await tx`delete from participants where session_id = ${sessionId} and id = ${team.id}`;
      out.removed.push(team.id);
    }
  }

  function nameTaken(rows: readonly ParticipantRow[], name: string, exceptId: string | null): boolean {
    const key = teamNameKey(name);
    return rows.some((r) => r.kind === "team" && r.id !== exceptId && teamNameKey(r.name) === key);
  }

  function publish(sessionId: string, out: Changes) {
    for (const row of out.changed) deps.publishParticipant(sessionId, row);
    for (const id of out.removed) deps.publishParticipant(sessionId, null, id);
    if (out.session) deps.publishSession(sessionId).catch(() => undefined);
    lobbyChanged(sessionId);
  }

  // ------------------------------------------------------------ снимки лобби

  function buildPublic(formation: TeamFormation, rows: readonly ParticipantRow[], at: number): TeamLobbyPublic {
    const { teams, players, members, waiting } = roster(rows);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      formation,
      teams: teams
        .map((t) => {
          const crew = members(t.id);
          const captain = byId.get(t.captain_uid);
          return {
            id: t.id,
            name: t.name,
            memberCount: crew.length,
            captainName: captain && crew.includes(captain) ? captain.name : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id)),
      joinedCount: players.length,
      onlineCount: players.filter((p) => isOnline(participantOf(p), at)).length,
      waitingCount: waiting.length,
    };
  }

  function buildPersonal(formation: TeamFormation, rows: readonly ParticipantRow[], uid: string, at: number): TeamLobbySnapshot {
    const lobby = buildPublic(guestFormation(formation), rows, at);
    const { teams, members, teamOf } = roster(rows);
    const mine = rows.find((r) => r.id === uid && r.kind === "player");
    if (!mine) return { ...lobby, me: null };
    const teamId = teamOf(mine);
    const team = teams.find((t) => t.id === teamId);
    const snapshot: TeamLobbySnapshot = {
      ...lobby,
      me: { teamId, isCaptain: team?.captain_uid === mine.id, noCaptain: mine.no_captain },
    };
    if (team) {
      snapshot.ownTeamMembers = members(team.id)
        .sort((a, b) => (a.joined_at?.getTime() ?? 0) - (b.joined_at?.getTime() ?? 0) || a.id.localeCompare(b.id))
        .map((m) => ({ name: m.name, isCaptain: team.captain_uid === m.id, online: isOnline(participantOf(m), at) }));
    }
    return snapshot;
  }

  function guestFormation(formation: TeamFormation): TeamFormation {
    const { excluded: _excluded, ...rest } = formation;
    return rest;
  }

  /** Гостям — тот же снимок без исключённых; вычисляется один раз на событие (рассылка сериализует его один раз). */
  const guestEvents = new WeakMap<object, object>();
  function forGuests(event: object): object {
    let out = guestEvents.get(event);
    if (!out) {
      const e = event as { lobby?: TeamLobbyPublic };
      out = e.lobby ? { ...e, lobby: { ...e.lobby, formation: guestFormation(e.lobby.formation) } } : event;
      guestEvents.set(event, out);
    }
    return out;
  }

  async function publicLobby(sessionId: string): Promise<TeamLobbyPublic | null> {
    const session = await deps.loadSession(sessionId);
    const formation = session ? formationOf(session) : null;
    if (!session || !formation) return null;
    return buildPublic(formation, await allRows(sql, sessionId), now());
  }

  /** Составы изменились: одна рассылка общего лобби через паузу (50 входов подряд — не 50 снимков). */
  function lobbyChanged(sessionId: string) {
    if (closed || timers.has(sessionId) || hub.count(lobbyChannel(sessionId)) === 0) return;
    const timer = setTimeout(() => {
      timers.delete(sessionId);
      if (closed) return;
      publicLobby(sessionId)
        .then((lobby) => {
          if (closed) return;
          // Ведущий вернул прежнее лобби (или сессии нет) — подписчики узнают и закрывают поток лобби.
          hub.publish(lobbyChannel(sessionId), lobby ? { type: "snapshot", lobby } : { type: "closed" });
        })
        .catch(() => undefined);
    }, deps.debounceMs ?? 250);
    timer.unref?.();
    timers.set(sessionId, timer);
  }

  function close() {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  /** Отказ транзакции — ответ с кодом; остальное — дальше (500). */
  function failWith(reply: FastifyReply, error: unknown) {
    if (error instanceof LobbyError) return fail(reply, error.status, error.code);
    throw error;
  }

  // ------------------------------------------------------------ действия ведущего

  function hashOf(kind: string, fields: object): string {
    return createHash("sha256").update(JSON.stringify([kind, fields])).digest("base64url");
  }

  interface HostContext {
    tx: TransactionSql;
    session: LobbySessionRow;
    phase: SessionPhase;
    formation: TeamFormation | null;
    rows: ParticipantRow[];
    at: number;
    out: Changes;
  }

  /**
   * Действие ведущего: вход, `actionId` и `expectedRevision`, замок, повтор по `actionId`, проверка `revision`,
   * работа, запись результата. `needsFormation` — только в управляемом лобби (настройки можно и в прежнем).
   */
  async function hostAction(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    kind: string,
    fields: (body: Record<string, unknown>) => object | null,
    work: (ctx: HostContext, body: Record<string, unknown>) => Promise<object>,
    needsFormation = true,
  ) {
    const who = await deps.requireIdentity(request, reply);
    if (!who) return reply;
    const body = isRecord(request.body) ? request.body : {};
    const actionId = body.actionId;
    const expected = body.expectedRevision;
    const own = fields(body);
    if (typeof actionId !== "string" || !ID.test(actionId) || typeof expected !== "number" || !Number.isInteger(expected) || expected < 0 || !own) {
      return fail(reply, 400, "invalid-argument");
    }
    const sessionId = request.params.id;
    if (!ID.test(sessionId)) return fail(reply, 404, "not-found");
    const out: Changes = { changed: [], removed: [] };
    const hash = hashOf(kind, own);
    try {
      const result = await sql.begin(async (tx) => {
        await lock(tx, sessionId);
        const session = await freshSession(tx, sessionId, true);
        const phase = deps.phaseOf(session.state);
        if (!permissions.canControlSession(who.uid, { hostId: session.host_id })) throw new LobbyError(403, "permission-denied");
        const [done] = await tx<{ kind: string; request_hash: string; result: unknown }[]>`
          select kind, request_hash, result from team_formation_actions where session_id = ${sessionId} and action_id = ${actionId}`;
        if (done) {
          if (done.kind !== kind || done.request_hash !== hash) throw new LobbyError(409, "formation-changed");
          return { replay: true, result: done.result };
        }
        if (!permissions.canManageTeamFormation(who.uid, { hostId: session.host_id, phase })) throw new LobbyError(409, "failed-precondition");
        if (session.play_mode !== "teams") throw new LobbyError(400, "invalid-argument");
        const formation = formationOf(session);
        if (needsFormation && !formation) throw new LobbyError(409, "failed-precondition");
        if ((formation?.revision ?? formationRevision(session.team_formation)) !== expected) throw new LobbyError(409, "formation-changed");
        const rows = await allRows(tx, sessionId);
        const outcome = await work({ tx, session, phase, formation, rows, at: now(), out }, body);
        await tx`
          insert into team_formation_actions (session_id, action_id, kind, request_hash, result)
          values (${sessionId}, ${actionId}, ${kind}, ${hash}, ${tx.json(outcome as never)})`;
        return { replay: false, result: outcome };
      });
      if (!result.replay) publish(sessionId, out);
      request.log.info({ teamLobby: kind, replay: result.replay }, "team lobby");
      return result.result;
    } catch (error) {
      return failWith(reply, error);
    }
  }

  /** Новая `revision` в настройках; возвращает её для ответа. */
  async function bump(ctx: HostContext, patch: Partial<TeamFormation> = {}): Promise<number> {
    const base = ctx.formation as TeamFormation;
    const next: TeamFormation = { ...base, ...patch, revision: base.revision + 1 };
    // revision видна в снимке сессии (`Session.teamFormation`): растёт она — растёт и version, иначе поток и опрос
    // `?since=` отдали бы пульту устаревшую revision и лишний 409.
    await saveFormation(ctx.tx, ctx.session.id, next, ctx.out);
    return next.revision;
  }

  function pickIds(value: unknown): string[] | null {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 200 || !value.every((x) => typeof x === "string" && ID.test(x))) return null;
    return [...new Set(value as string[])].sort();
  }

  /**
   * Кого распределять (ТЗ 6.4): игроки без команды, не исключённые ведущим, на связи по часам сервера — плюс отмеченные
   * ведущим «не на связи» (`includeOffline`). Чужие и уже распределённые `pid` из `includeOffline` — в `ignored`.
   */
  function selectPlayers(ctx: HostContext, includeOffline: readonly string[]) {
    const { waiting } = roster(ctx.rows);
    const waitingIds = new Set(waiting.map((p) => p.id));
    const forced = new Set(includeOffline);
    // Во время игры исключения не используются (ТЗ 6.4): ждущий гость — тот, кого ведущий решил добавить.
    const excluded = new Set(ctx.phase === "playing" ? [] : (ctx.formation?.excluded ?? []));
    const chosen: string[] = [];
    const skippedOffline: string[] = [];
    const skippedExcluded: string[] = [];
    for (const p of waiting) {
      if (excluded.has(p.id)) skippedExcluded.push(p.id);
      else if (forced.has(p.id) || isOnline(participantOf(p), ctx.at)) chosen.push(p.id);
      else skippedOffline.push(p.id);
    }
    return { chosen, skippedOffline, skippedExcluded, ignored: includeOffline.filter((pid) => !waitingIds.has(pid)) };
  }

  function register(api: FastifyInstance) {
    // Настройки: режим («legacy» — прежнее лобби), число команд, вместимость (ТЗ 7.2).
    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/team-formation", { bodyLimit: SMALL_BODY }, (request, reply) =>
      hostAction(
        request,
        reply,
        "settings",
        (body) => ({ mode: body.mode, teamCount: body.teamCount ?? null, maxMembers: body.maxMembers ?? null }),
        async (ctx, body) => {
          const { teams, members } = roster(ctx.rows);
          const mode = body.mode;
          const current = ctx.formation?.revision ?? formationRevision(ctx.session.team_formation);
          if (mode === "legacy") {
            if (!ctx.formation) return { mode: "legacy", revision: current };
            // Обойти новые лимиты задним числом нельзя: в прежнее лобби — только с пустым составом.
            if (ctx.phase !== "lobby" || teams.length > 0) throw new LobbyError(409, "failed-precondition");
            // revision не начинается заново: запоздалый запрос старого лобби не пройдёт в новом (ABA).
            await saveFormation(ctx.tx, ctx.session.id, { mode: "legacy", revision: current + 1 }, ctx.out);
            // В прежнем лобби галочки нет (ТЗ 6.5).
            ctx.out.changed.push(...(await ctx.tx<ParticipantRow[]>`
              update participants set no_captain = false where session_id = ${ctx.session.id} and no_captain
              returning ${ctx.tx(PARTICIPANT_COLUMNS)}`));
            return { mode: "legacy", revision: current + 1 };
          }
          if (!isFormationMode(mode)) throw new LobbyError(400, "invalid-argument");
          // Во время игры — только между шагами (ТЗ 7.4).
          if (ctx.phase === "playing" && deps.stageOf(ctx.session.state) === "question") throw new LobbyError(409, "failed-precondition");
          const teamCount = body.teamCount ?? ctx.formation?.teamCount;
          const maxMembers = body.maxMembers ?? ctx.formation?.maxMembers;
          const problem = settingsError(teamCount, maxMembers);
          if (problem) throw new LobbyError(400, problem);
          const count = teamCount as number;
          const max = maxMembers as number;
          // Сменить режим можно только до игры и без команд: старые команды с новым алгоритмом не смешиваются.
          if ((!ctx.formation || ctx.formation.mode !== mode) && (ctx.phase !== "lobby" || teams.length > 0)) {
            throw new LobbyError(409, "failed-precondition");
          }
          if (count < teams.length) throw new LobbyError(409, "team-limit");
          if (teams.some((t) => members(t.id).length > max)) throw new LobbyError(409, "team-full");
          const same = ctx.formation?.mode === mode;
          const next: TeamFormation = {
            mode,
            teamCount: count,
            maxMembers: max,
            revision: current + 1,
            distributed: same ? (ctx.formation?.distributed ?? false) : false,
            excluded: same ? (ctx.formation?.excluded ?? []) : [],
          };
          await saveFormation(ctx.tx, ctx.session.id, next, ctx.out);
          return { mode, teamCount: count, maxMembers: max, revision: next.revision };
        },
        false,
      ),
    );

    // Исключить игрока из распределения или вернуть (ТЗ 6.4): значение, а не переключение — повтор и два пульта не
    // спорят; revision не меняется. Только лобби.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/team-formation/exclude", { bodyLimit: SMALL_BODY }, async (request, reply) => {
      const who = await deps.requireIdentity(request, reply);
      if (!who) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const pid = body.pid;
      if (typeof pid !== "string" || !ID.test(pid) || typeof body.excluded !== "boolean") return fail(reply, 400, "invalid-argument");
      const excludedNow = body.excluded;
      const sessionId = request.params.id;
      if (!ID.test(sessionId)) return fail(reply, 404, "not-found");
      try {
        const excluded = await sql.begin(async (tx) => {
          await lock(tx, sessionId);
          const session = await freshSession(tx, sessionId, true);
          if (!permissions.canControlSession(who.uid, { hostId: session.host_id })) throw new LobbyError(403, "permission-denied");
          const formation = formationOf(session);
          if (!formation || deps.phaseOf(session.state) !== "lobby") throw new LobbyError(409, "failed-precondition");
          const [player] = await tx`select 1 from participants where session_id = ${sessionId} and id = ${pid} and kind = 'player'`;
          if (!player) throw new LobbyError(404, "not-found");
          const set = new Set(formation.excluded ?? []);
          if (excludedNow) set.add(pid);
          else set.delete(pid);
          const list = [...set].sort();
          await saveFormation(tx, sessionId, { ...formation, excluded: list });
          return list;
        });
        lobbyChanged(sessionId);
        return { ok: true, excluded };
      } catch (error) {
        return failWith(reply, error);
      }
    });

    // «Сформировать случайно» (ТЗ 6.2): все отобранные по 6.4 — криптостойкое перемешивание, команды по кругу, капитан
    // случайно по 6.5, готовые названия. Одной транзакцией; ответ — три списка и `ignored`.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/team-formation/distribute", { bodyLimit: SMALL_BODY }, (request, reply) =>
      hostAction(
        request,
        reply,
        "distribute",
        (body) => {
          const includeOffline = pickIds(body.includeOffline);
          return includeOffline ? { includeOffline } : null;
        },
        async (ctx, body) => {
          const formation = ctx.formation as TeamFormation;
          if (formation.mode !== "randomTeams" || ctx.phase !== "lobby") throw new LobbyError(409, "failed-precondition");
          const { teams } = roster(ctx.rows);
          if (formation.distributed || teams.length > 0) throw new LobbyError(409, "already-distributed");
          const picked = selectPlayers(ctx, pickIds(body.includeOffline) ?? []);
          if (picked.chosen.length < formation.teamCount) throw new LobbyError(409, "not-enough-players");
          if (picked.chosen.length > formation.teamCount * formation.maxMembers) throw new LobbyError(409, "capacity-exceeded");
          const groups = planDistribution(picked.chosen, formation.teamCount, secureInt);
          const names = autoTeamNames(groups.length, [], secureInt);
          const byId = new Map(ctx.rows.map((r) => [r.id, r]));
          const assigned: Record<string, string> = {};
          const created: Array<{ id: string; captain: string; unwilling: boolean }> = [];
          for (const [i, group] of groups.entries()) {
            const teamId = newId();
            const captain = pickCaptain(group.map((pid) => candidate(byId.get(pid) as ParticipantRow, ctx.at)), secureInt);
            if (!captain) continue;
            ctx.out.changed.push(await insertTeam(ctx.tx, ctx.session.id, teamId, names[i] ?? teamId, captain.id));
            ctx.out.changed.push(...(await setTeam(ctx.tx, ctx.session.id, group, teamId)));
            for (const pid of group) assigned[pid] = teamId;
            created.push({ id: teamId, captain: captain.id, unwilling: captain.unwilling });
          }
          const revision = await bump(ctx, { distributed: true });
          return { assigned, teams: created, skippedOffline: picked.skippedOffline, skippedExcluded: picked.skippedExcluded, ignored: picked.ignored, revision };
        },
      ),
    );

    // «Распределить оставшихся» (ТЗ 6.2.13, 7.3): в самые малочисленные команды со свободными местами, остаток — списком.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/team-formation/auto-assign", { bodyLimit: SMALL_BODY }, (request, reply) =>
      hostAction(
        request,
        reply,
        "auto-assign",
        (body) => {
          const includeOffline = pickIds(body.includeOffline);
          return includeOffline ? { includeOffline } : null;
        },
        async (ctx, body) => {
          const formation = ctx.formation as TeamFormation;
          const { teams, members } = roster(ctx.rows);
          // Составы во время игры меняются только между вопросами (ТЗ 7.4).
          if (ctx.phase === "playing" && deps.stageOf(ctx.session.state) === "question") throw new LobbyError(409, "failed-precondition");
          if (teams.length === 0 || (formation.mode === "randomTeams" && ctx.phase === "lobby" && !formation.distributed)) {
            throw new LobbyError(409, "failed-precondition");
          }
          const picked = selectPlayers(ctx, pickIds(body.includeOffline) ?? []);
          const plan = planAutoAssign(
            picked.chosen,
            teams.map((t) => ({ id: t.id, size: members(t.id).length })),
            formation.maxMembers,
            secureInt,
          );
          const byTeam = new Map<string, string[]>();
          for (const [pid, teamId] of plan.assigned) byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), pid]);
          for (const [teamId, pids] of byTeam) ctx.out.changed.push(...(await setTeam(ctx.tx, ctx.session.id, pids, teamId)));
          const revision = await bump(ctx);
          return {
            assigned: Object.fromEntries(plan.assigned),
            rest: plan.rest,
            skippedOffline: picked.skippedOffline,
            skippedExcluded: picked.skippedExcluded,
            ignored: picked.ignored,
            revision,
          };
        },
      ),
    );

    // «Сбросить команды» (ТЗ 7.2): только лобби; реальные команды удаляются, игроки — без команды, исключения очищаются.
    // Ручные записи таблицы (без телефона) не трогаются: их нет среди участников.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/team-formation/reset", { bodyLimit: SMALL_BODY }, (request, reply) =>
      hostAction(
        request,
        reply,
        "reset",
        () => ({}),
        async (ctx) => {
          if (ctx.phase !== "lobby") throw new LobbyError(409, "failed-precondition");
          const { teams, players } = roster(ctx.rows);
          const teamIds = teams.map((t) => t.id);
          if (teamIds.length > 0) {
            await ctx.tx`delete from participants where session_id = ${ctx.session.id} and kind = 'team'`;
          }
          ctx.out.removed.push(...teamIds);
          ctx.out.changed.push(...(await setTeam(ctx.tx, ctx.session.id, players.filter((p) => p.team_id !== null).map((p) => p.id), null)));
          const revision = await bump(ctx, { distributed: false, excluded: [] });
          return { removedTeams: teamIds, revision };
        },
      ),
    );

    // Переместить игрока (ТЗ 7.2, 7.4): в другую команду или «без команды». Во время игры — не при открытом вопросе
    // (строка сессии под блокировкой, пульт открывает вопрос под той же блокировкой). Очки не переносятся.
    api.post<{ Params: { id: string; pid: string }; Body: unknown }>("/api/sessions/:id/participants/:pid/move", { bodyLimit: SMALL_BODY }, (request, reply) =>
      hostAction(
        request,
        reply,
        "move",
        (body) => (body.teamId === null || (typeof body.teamId === "string" && ID.test(body.teamId)) ? { pid: request.params.pid, teamId: body.teamId } : null),
        async (ctx, body) => {
          const formation = ctx.formation as TeamFormation;
          if (ctx.phase === "playing" && deps.stageOf(ctx.session.state) === "question") throw new LobbyError(409, "failed-precondition");
          const { teams, members, teamOf } = roster(ctx.rows);
          const player = ctx.rows.find((r) => r.id === request.params.pid && r.kind === "player");
          if (!player) throw new LobbyError(404, "not-found");
          const target = body.teamId as string | null;
          if (target !== null && !teams.some((t) => t.id === target)) throw new LobbyError(400, "invalid-argument");
          if (teamOf(player) !== target) {
            if (target !== null && members(target).length >= formation.maxMembers) throw new LobbyError(409, "team-full");
            await leaveTeam(ctx.tx, ctx.session.id, ctx.rows, player, ctx.phase, ctx.at, ctx.out);
            ctx.out.changed.push(...(await setTeam(ctx.tx, ctx.session.id, [player.id], target)));
          }
          const revision = await bump(ctx);
          return { pid: player.id, teamId: target, revision };
        },
      ),
    );

    // Ведущий добавляет команду с капитаном из ожидающих (ТЗ 7.4): в пределах числа команд.
    api.post<{ Params: { id: string }; Body: unknown }>("/api/sessions/:id/team-formation/team", { bodyLimit: SMALL_BODY }, (request, reply) =>
      hostAction(
        request,
        reply,
        "team",
        (body) =>
          typeof body.captainPid === "string" && ID.test(body.captainPid) && (body.name === undefined || validName(body.name))
            ? { captainPid: body.captainPid, name: body.name ?? null }
            : null,
        async (ctx, body) => {
          const formation = ctx.formation as TeamFormation;
          const { teams, waiting } = roster(ctx.rows);
          if (ctx.phase === "playing" && deps.stageOf(ctx.session.state) === "question") throw new LobbyError(409, "failed-precondition");
          if (formation.mode === "randomTeams" && ctx.phase === "lobby" && !formation.distributed) throw new LobbyError(409, "failed-precondition");
          if (teams.length >= formation.teamCount) throw new LobbyError(409, "team-limit");
          const captain = waiting.find((p) => p.id === body.captainPid);
          if (!captain) throw new LobbyError(409, "already-assigned");
          let name = typeof body.name === "string" ? body.name.trim() : "";
          if (name && nameTaken(ctx.rows, name, null)) throw new LobbyError(409, "team-name-taken");
          if (!name) name = autoTeamNames(1, teams.map((t) => t.name), secureInt)[0] ?? "Команда";
          const teamId = newId();
          ctx.out.changed.push(await insertTeam(ctx.tx, ctx.session.id, teamId, name, captain.id));
          ctx.out.changed.push(...(await setTeam(ctx.tx, ctx.session.id, [captain.id], teamId)));
          const revision = await bump(ctx);
          return { teamId, captain: captain.id, revision };
        },
      ),
    );

    // ---------------------------------------------------------- телефон гостя

    // Лобби глазами телефона: общие карточки, своё положение и состав только своей команды (ТЗ 13.1).
    api.get<{ Params: { id: string } }>("/api/sessions/:id/team-lobby", async (request, reply) => {
      const who = await deps.requireIdentity(request, reply);
      if (!who) return reply;
      const session = await deps.loadSession(request.params.id);
      const formation = session ? formationOf(session) : null;
      if (!session || !formation || deps.phaseOf(session.state) === "finished") return fail(reply, 404, "not-found");
      reply.header("cache-control", "no-store");
      const rows = await allRows(sql, session.id);
      const at = now();
      if (permissions.canControlSession(who.uid, { hostId: session.host_id })) return { ...buildPublic(formation, rows, at), me: null };
      return buildPersonal(formation, rows, who.uid, at);
    });

    // Общий поток лобби: снимок карточек команд при подписке и после каждого изменения составов. Отметка «я на связи» и
    // «Не хочу быть капитаном» его не трогают. Исключённых видит только пульт.
    api.get<{ Params: { id: string } }>("/api/stream/team-lobby/:id", async (request, reply) => {
      const who = await deps.requireIdentity(request, reply);
      if (!who) return reply;
      const session = await deps.loadSession(request.params.id);
      if (!session || !formationOf(session)) return fail(reply, 404, "not-found");
      const host = permissions.canControlSession(who.uid, { hostId: session.host_id });
      return deps.stream(
        request,
        reply,
        lobbyChannel(session.id),
        () => true,
        async () => ({ type: "snapshot", lobby: await publicLobby(session.id) }),
        host ? (event) => event : forGuests,
      );
    });

    // Выйти из команды (ТЗ 6.1.7–8): сам игрок, только «Сами» и только лобби.
    api.post<{ Params: { id: string; pid: string } }>("/api/sessions/:id/participants/:pid/leave", { bodyLimit: 1024 }, async (request, reply) => {
      const who = await deps.requireIdentity(request, reply);
      if (!who) return reply;
      const { id, pid } = request.params;
      if (!permissions.canChangeOwnLobbyState(who.uid, pid)) return fail(reply, 403, "permission-denied");
      if (!ID.test(id)) return fail(reply, 404, "not-found");
      const out: Changes = { changed: [], removed: [] };
      try {
        await sql.begin(async (tx) => {
          await lock(tx, id);
          const session = await freshSession(tx, id, false);
          const formation = formationOf(session);
          if (!formation) throw new LobbyError(404, "not-found");
          const phase = deps.phaseOf(session.state);
          if (phase !== "lobby") throw new LobbyError(409, "playing");
          if (formation.mode !== "self") throw new LobbyError(403, "permission-denied");
          const rows = await allRows(tx, id);
          const me = rows.find((r) => r.id === pid && r.kind === "player");
          if (!me) throw new LobbyError(404, "not-found");
          if (roster(rows).teamOf(me) === null) return;
          await leaveTeam(tx, id, rows, me, phase, now(), out);
          out.changed.push(...(await setTeam(tx, id, [pid], null)));
        });
        publish(id, out);
        return { ok: true };
      } catch (error) {
        return failWith(reply, error);
      }
    });

    // «Не хочу быть капитаном» (ТЗ 6.5): сам игрок, в лобби и во время игры. Пульт узнаёт из своего потока участников,
    // общий поток лобби не трогается.
    api.post<{ Params: { id: string; pid: string }; Body: unknown }>("/api/sessions/:id/participants/:pid/captain-pref", { bodyLimit: 1024 }, async (request, reply) => {
      const who = await deps.requireIdentity(request, reply);
      if (!who) return reply;
      const { id, pid } = request.params;
      if (!permissions.canChangeOwnLobbyState(who.uid, pid)) return fail(reply, 403, "permission-denied");
      const noCaptain = isRecord(request.body) ? request.body.noCaptain : null;
      if (typeof noCaptain !== "boolean") return fail(reply, 400, "invalid-argument");
      const session = await deps.loadSession(id);
      if (!session || !formationOf(session) || deps.phaseOf(session.state) === "finished") return fail(reply, 404, "not-found");
      const [row] = await sql<ParticipantRow[]>`
        update participants set no_captain = ${noCaptain} where session_id = ${session.id} and id = ${pid} and kind = 'player'
        returning ${sql(PARTICIPANT_COLUMNS)}`;
      if (!row) return fail(reply, 404, "not-found");
      deps.publishParticipant(session.id, row);
      return { ok: true, noCaptain };
    });

    // Название команды (ТЗ 5.3, 6.1.10): капитан в лобби или ведущий; дубли не допускаются.
    api.post<{ Params: { id: string; teamId: string }; Body: unknown }>("/api/sessions/:id/teams/:teamId/profile", { bodyLimit: 1024 }, async (request, reply) => {
      const who = await deps.requireIdentity(request, reply);
      if (!who) return reply;
      const { id, teamId } = request.params;
      const name = isRecord(request.body) ? request.body.name : null;
      if (!validName(name) || !ID.test(id)) return fail(reply, 400, "invalid-argument");
      return renameTeam(reply, who, id, teamId, name.trim());
    });
  }

  async function renameTeam(reply: FastifyReply, who: Identity, sessionId: string, teamId: string, name: string) {
    const out: Changes = { changed: [], removed: [] };
    try {
      await sql.begin(async (tx) => {
        await lock(tx, sessionId);
        const session = await freshSession(tx, sessionId, false);
        if (!formationOf(session)) throw new LobbyError(404, "not-found");
        const rows = await allRows(tx, sessionId);
        const team = rows.find((r) => r.id === teamId && r.kind === "team");
        if (!team) throw new LobbyError(404, "not-found");
        const mine = rows.find((r) => r.id === who.uid && r.kind === "player") ?? null;
        const phase = deps.phaseOf(session.state);
        const allowed = permissions.canEditTeamProfile(
          who.uid,
          { hostId: session.host_id, phase },
          { id: team.id, captainUid: team.captain_uid },
          mine ? { teamId: roster(rows).teamOf(mine) } : null,
        );
        if (!allowed) throw new LobbyError(403, mine && phase === "lobby" ? "not-captain" : "permission-denied");
        if (nameTaken(rows, name, team.id)) throw new LobbyError(409, "team-name-taken");
        const [row] = await tx<ParticipantRow[]>`
          update participants set name = ${name} where session_id = ${sessionId} and id = ${teamId} returning ${tx(PARTICIPANT_COLUMNS)}`;
        if (row) out.changed.push(row);
      });
      publish(sessionId, out);
      return { ok: true };
    } catch (error) {
      return failWith(reply, error);
    }
  }

  // ------------------------------------------------------------ прежние запросы в управляемом лобби (из live.ts)

  /**
   * Вход телефона (`/join`): имя; команду можно выбрать только в «Сами» и в лобби, если её ещё нет и есть место.
   * Без команды в запросе нынешняя команда сохраняется (в прежнем лобби вход без команды её стирал). Новый игрок во
   * время игры — в самую малочисленную команду со свободным местом (ТЗ 9.2); мест нет — ждёт ведущего.
   */
  async function join(reply: FastifyReply, who: Identity, sessionId: string, body: Record<string, unknown>): Promise<{ created: boolean; teamId: string | null } | FastifyReply> {
    const pid = who.uid;
    const requested = typeof body.teamId === "string" ? body.teamId : null;
    if (!validName(body.name)) return fail(reply, 400, "invalid-argument");
    const name = body.name;
    const out: Changes = { changed: [], removed: [] };
    try {
      const created = await sql.begin(async (tx) => {
        await lock(tx, sessionId);
        const session = await freshSession(tx, sessionId, false);
        const formation = formationOf(session);
        // Ведущий как раз вернул прежнее лобби — телефон получит свежий снимок и войдёт по-старому.
        if (!formation) throw new LobbyError(409, "failed-precondition");
        const phase = deps.phaseOf(session.state);
        if (phase === "finished") throw new LobbyError(403, "permission-denied");
        const rows = await allRows(tx, sessionId);
        const { teams, members, teamOf } = roster(rows);
        const existing = rows.find((r) => r.id === pid) ?? null;
        if (existing && existing.kind !== "player") throw new LobbyError(403, "permission-denied");
        let teamId = existing ? teamOf(existing) : null;
        if (requested !== null && requested !== teamId) {
          if (phase !== "lobby") throw new LobbyError(409, "playing");
          if (formation.mode !== "self") throw new LobbyError(403, "permission-denied");
          if (teamId !== null) throw new LobbyError(409, "already-assigned");
          if (!teams.some((t) => t.id === requested)) throw new LobbyError(400, "invalid-argument");
          if (members(requested).length >= formation.maxMembers) throw new LobbyError(409, "team-full");
          teamId = requested;
        }
        if (!existing && phase === "playing" && teamId === null) {
          const plan = planAutoAssign([pid], teams.map((t) => ({ id: t.id, size: members(t.id).length })), formation.maxMembers, secureInt);
          teamId = plan.assigned[0]?.[1] ?? null;
        }
        const [row] = await tx<ParticipantRow[]>`
          insert into participants (session_id, id, name, kind, team_id, captain_uid)
          values (${sessionId}, ${pid}, ${name}, 'player', ${teamId}, ${pid})
          on conflict (session_id, id) do update set name = excluded.name, team_id = excluded.team_id
          returning ${tx(PARTICIPANT_COLUMNS)}`;
        if (row) out.changed.push(row);
        // Команда без капитана в составе (прежнего убрали) — капитаном становится вошедший, а не через 15 с автосмены.
        const team = teams.find((t) => t.id === teamId);
        if (team && teamId !== (existing ? teamOf(existing) : null) && !members(team.id).some((m) => m.id === team.captain_uid)) {
          const [captain] = await tx<ParticipantRow[]>`
            update participants set captain_uid = ${pid} where session_id = ${sessionId} and id = ${team.id} returning ${tx(PARTICIPANT_COLUMNS)}`;
          if (captain) out.changed.push(captain);
        }
        return { created: !existing, teamId };
      });
      publish(sessionId, out);
      return created;
    } catch (error) {
      return failWith(reply, error);
    }
  }

  /** «Создать команду» (ТЗ 6.1.4): вошедший игрок без команды, только «Сами» и лобби; он капитан и первый член. */
  async function createTeam(reply: FastifyReply, who: Identity, sessionId: string, teamId: string, name: string) {
    const out: Changes = { changed: [], removed: [] };
    try {
      await sql.begin(async (tx) => {
        await lock(tx, sessionId);
        const session = await freshSession(tx, sessionId, false);
        const formation = formationOf(session);
        if (!formation) throw new LobbyError(409, "failed-precondition");
        if (deps.phaseOf(session.state) !== "lobby") throw new LobbyError(409, "playing");
        if (formation.mode !== "self") throw new LobbyError(403, "permission-denied");
        const rows = await allRows(tx, sessionId);
        const { teams, teamOf } = roster(rows);
        const same = rows.find((r) => r.id === teamId);
        // Повтор после обрыва: та же команда этого капитана — ответ как в первый раз.
        if (same) {
          if (same.kind === "team" && same.captain_uid === who.uid) return;
          throw new LobbyError(409, "already-exists");
        }
        const me = rows.find((r) => r.id === who.uid && r.kind === "player");
        if (!me) throw new LobbyError(409, "failed-precondition");
        if (teamOf(me) !== null) throw new LobbyError(409, "already-assigned");
        if (teams.length >= formation.teamCount) throw new LobbyError(409, "team-limit");
        if (nameTaken(rows, name, null)) throw new LobbyError(409, "team-name-taken");
        out.changed.push(await insertTeam(tx, sessionId, teamId, name.trim(), me.id));
        // Создать команду — вызваться капитаном: прежняя галочка снимается (ТЗ 6.1.4).
        const [row] = await tx<ParticipantRow[]>`
          update participants set team_id = ${teamId}, no_captain = false where session_id = ${sessionId} and id = ${me.id}
          returning ${tx(PARTICIPANT_COLUMNS)}`;
        if (row) out.changed.push(row);
      });
      publish(sessionId, out);
      return { id: teamId };
    } catch (error) {
      return failWith(reply, error);
    }
  }

  /** Новый капитан (`/captain`): член этой команды; автосмена с пульта (`auto`) перепроверяется по ТЗ 6.5. */
  async function setCaptain(reply: FastifyReply, sessionId: string, teamId: string, uid: string, auto: boolean) {
    const out: Changes = { changed: [], removed: [] };
    try {
      await sql.begin(async (tx) => {
        await lock(tx, sessionId);
        const session = await freshSession(tx, sessionId, false);
        if (deps.phaseOf(session.state) === "finished") throw new LobbyError(409, "failed-precondition");
        const rows = await allRows(tx, sessionId);
        const team = rows.find((r) => r.id === teamId && r.kind === "team");
        if (!team) throw new LobbyError(404, "not-found");
        if (!roster(rows).members(team.id).some((m) => m.id === uid)) throw new LobbyError(400, "invalid-argument");
        if (team.captain_uid === uid) return;
        if (auto && !autoCaptainAllowed(participantOf(team), rows.map(participantOf), uid, now())) throw new LobbyError(409, "formation-changed");
        const [row] = await tx<ParticipantRow[]>`
          update participants set captain_uid = ${uid} where session_id = ${sessionId} and id = ${teamId} returning ${tx(PARTICIPANT_COLUMNS)}`;
        if (row) out.changed.push(row);
      });
      publish(sessionId, out);
      return { ok: true };
    } catch (error) {
      return failWith(reply, error);
    }
  }

  /**
   * Ведущий убирает участника: команда — её члены становятся без команды в той же транзакции (внешнего ключа на
   * `team_id` нет, ТЗ 7.2); игрок-капитан — капитанство следующему по ТЗ 6.5.
   */
  async function remove(reply: FastifyReply, sessionId: string, pid: string) {
    const out: Changes = { changed: [], removed: [] };
    try {
      await sql.begin(async (tx) => {
        await lock(tx, sessionId);
        const session = await freshSession(tx, sessionId, false);
        const rows = await allRows(tx, sessionId);
        const target = rows.find((r) => r.id === pid);
        if (!target) return;
        const crew = roster(rows);
        // Во время игры последнюю команду с людьми не расформировать: им некуда попасть (ТЗ 7.4).
        if (target.kind === "team" && deps.phaseOf(session.state) === "playing" && crew.teams.length === 1 && crew.members(pid).length > 0) {
          throw new LobbyError(409, "failed-precondition");
        }
        if (target.kind === "team") {
          out.changed.push(...(await setTeam(tx, sessionId, roster(rows).members(pid).map((m) => m.id), null)));
        } else {
          await leaveTeam(tx, sessionId, rows, target, deps.phaseOf(session.state), now(), out);
        }
        await tx`delete from participants where session_id = ${sessionId} and id = ${pid}`;
        out.removed.push(pid);
      });
      publish(sessionId, out);
      return { ok: true };
    } catch (error) {
      return failWith(reply, error);
    }
  }

  /** Список команд гостям (`GET /teams`): без капитана и связи — только название и число людей (ТЗ 13.1). */
  async function listTeams(sessionId: string) {
    const rows = await allRows(sql, sessionId);
    const { teams, members } = roster(rows);
    return teams
      .map((t) => ({ id: t.id, name: t.name, kind: "team", teamId: null, captainUid: "", joinedAt: null, seenAt: null, memberCount: members(t.id).length }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  /** Переименование ведущим (`/rename`) команды в управляемом лобби — с проверкой дублей. */
  async function renameByHost(reply: FastifyReply, who: Identity, sessionId: string, pid: string, name: string) {
    return renameTeam(reply, who, sessionId, pid, name.trim());
  }

  return { register, formationOf, join, createTeam, setCaptain, remove, listTeams, renameByHost, lobbyChanged, close };
}
