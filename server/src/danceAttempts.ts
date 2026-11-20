import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JSONValue, Sql } from "postgres";
import { apiGuard, identityOf } from "./auth";
import { WindowLimiter } from "./lead";
import { motionDance, type DanceAttemptSummary } from "../../src/mechanics/stage/dances";
import { parseStage } from "../../src/mechanics/stage/content";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const BODY_LIMIT = 1900 * 1024;
const LIST_LIMIT = 100;

interface SessionRow {
  id: string;
  host_id: string;
  game_id: string | null;
  mechanic: string | null;
  game_snapshot: unknown;
}
interface AttemptRow {
  id: string;
  session_id: string;
  tile_id: string;
  song_key: string;
  dancer: number;
  pid: string;
  team_id: string | null;
  player_name: string;
  percent: number;
  points: number;
  max_points: number;
  created_at: Date;
}
interface ParticipantRow {
  name: string;
  team_id: string | null;
}

function rec(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}
function int(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}
function summary(row: AttemptRow): DanceAttemptSummary {
  return { id: row.id, sessionId: row.session_id, tileId: row.tile_id, songKey: row.song_key, dancer: row.dancer, pid: row.pid, teamId: row.team_id, playerName: row.player_name, percent: row.percent, points: row.points, maxPoints: row.max_points, createdAt: row.created_at.getTime() };
}

export function registerDanceAttempts(app: FastifyInstance, options: { sql: Sql; isSite?: (request: FastifyRequest) => boolean; now?: () => number }) {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const limiter = new WindowLimiter(40, 10 * 60_000);

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    const fail = (reply: FastifyReply, status: number, error: string) => reply.code(status).send({ error });

    async function session(id: unknown): Promise<SessionRow | null> {
      if (!validId(id)) return null;
      const rows = await sql<SessionRow[]>`select id, host_id, game_id, mechanic, game_snapshot from sessions where id = ${id}`;
      return rows[0] ?? null;
    }
    async function participant(sessionId: string, pid: string): Promise<ParticipantRow | null> {
      const rows = await sql<ParticipantRow[]>`select name, team_id from participants where session_id = ${sessionId} and id = ${pid} and kind = 'player'`;
      return rows[0] ?? null;
    }
    async function canRead(request: FastifyRequest, reply: FastifyReply, game: SessionRow): Promise<boolean> {
      const who = await identityOf(sql, request, reply);
      if (!who) {
        await fail(reply, 401, "unauthenticated");
        return false;
      }
      if (who.user) {
        if (who.user.id !== game.host_id) {
          await fail(reply, 403, "permission-denied");
          return false;
        }
        return true;
      }
      const member = await participant(game.id, who.uid);
      if (!member) {
        await fail(reply, 403, "permission-denied");
        return false;
      }
      return true;
    }

    api.get<{ Querystring: { sessionId?: string; tileId?: string } }>("/api/dance-attempts", async (request, reply) => {
      const game = await session(request.query.sessionId);
      if (!game) return fail(reply, 404, "not-found");
      if (!(await canRead(request, reply, game))) return reply;
      const tileId = validId(request.query.tileId) ? request.query.tileId : null;
      const rows = tileId
        ? await sql<AttemptRow[]>`select id, session_id, tile_id, song_key, dancer, pid, team_id, player_name, percent, points, max_points, created_at from dance_attempts where session_id = ${game.id} and tile_id = ${tileId} order by created_at desc limit ${LIST_LIMIT}`
        : await sql<AttemptRow[]>`select id, session_id, tile_id, song_key, dancer, pid, team_id, player_name, percent, points, max_points, created_at from dance_attempts where session_id = ${game.id} order by created_at desc limit ${LIST_LIMIT}`;
      return { attempts: rows.map(summary) };
    });

    api.get<{ Params: { id: string }; Querystring: { sessionId?: string } }>("/api/dance-attempts/:id", async (request, reply) => {
      if (!validId(request.params.id)) return fail(reply, 404, "not-found");
      const game = await session(request.query.sessionId);
      if (!game) return fail(reply, 404, "not-found");
      if (!(await canRead(request, reply, game))) return reply;
      const rows = await sql`select recording, analysis from dance_attempts where id = ${request.params.id} and session_id = ${game.id}`;
      const row = rows[0] as { recording: unknown; analysis: unknown } | undefined;
      return row ?? fail(reply, 404, "not-found");
    });

    api.post<{ Body: unknown }>("/api/dance-attempts", { bodyLimit: BODY_LIMIT }, async (request, reply) => {
      if (!limiter.take(request.ip, now())) return fail(reply, 429, "resource-exhausted");
      const who = await identityOf(sql, request, reply);
      if (!who) return fail(reply, 401, "unauthenticated");
      const body = rec(request.body);
      const game = await session(body.sessionId);
      if (!game || game.mechanic !== "stage") return fail(reply, 404, "not-found");
      if (!validId(body.id) || !validId(body.tileId)) return fail(reply, 400, "invalid-argument");
      const dance = motionDance(body.songKey);
      const dancer = int(body.dancer, 1, dance?.dancers ?? 4);
      const percent = int(rec(body.result).percent, 0, 100);
      const points = int(rec(body.result).points, 0, 1_000_000);
      const maxPoints = int(rec(body.result).max, 0, 1_000_000);
      if (!dance || dancer === null || percent === null || points === null || maxPoints === null) return fail(reply, 400, "invalid-argument");
      const content = parseStage(rec(game.game_snapshot).content);
      const tile = content.tiles.find((item) => item.id === body.tileId);
      if (!tile || tile.motionSong !== dance.key) return fail(reply, 409, "failed-precondition");
      const member = await participant(game.id, who.uid);
      if (!member) return fail(reply, 403, "permission-denied");
      const recording = body.recording as JSONValue;
      const analysis = body.result as JSONValue;
      const recordedEvents = rec(recording).events;
      if (!Array.isArray(recordedEvents) || recordedEvents.length === 0) return fail(reply, 400, "invalid-argument");
      await sql`
        insert into dance_attempts (id, session_id, game_id, tile_id, song_key, dancer, pid, team_id, player_name, percent, points, max_points, recording, analysis)
        values (${body.id}, ${game.id}, ${game.game_id}, ${body.tileId}, ${dance.key}, ${dancer}, ${who.uid}, ${member.team_id}, ${member.name}, ${percent}, ${points}, ${maxPoints}, ${sql.json(recording)}, ${sql.json(analysis)})
        on conflict (id) do nothing`;
      const rows = await sql<AttemptRow[]>`select id, session_id, tile_id, song_key, dancer, pid, team_id, player_name, percent, points, max_points, created_at from dance_attempts where id = ${body.id}`;
      const saved = rows[0];
      if (!saved || saved.pid !== who.uid) return fail(reply, 409, "already-exists");
      return { attempt: summary(saved) };
    });
  });
}
