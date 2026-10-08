/**
 * Предложения ведущих в общую библиотеку (CLAUDE.md, раздел 3, «Предложения в библиотеку»).
 * Ведущий предлагает свою личную игру, владелец агентства принимает (копия в библиотеку,
 * картинки — те же файлы) или отклоняет с причиной. Права — src/data/permissions.ts.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import * as permissions from "../../src/data/permissions";
import { actorOf, apiGuard, newUserId, sessionUser, type SessionRow } from "./auth";

export interface ProposalsOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const REASON_MAX = 300;
const LIST_LIMIT = 200;

interface ProposalRow {
  id: string;
  game_id: string;
  host_id: string;
  host_name: string | null;
  title: string;
  status: string;
  reason: string | null;
  library_game_id: string | null;
  created_at: Date;
  decided_at: Date | null;
}

interface GameRow {
  id: string;
  scope: string;
  owner_id: string;
  title: string;
  mechanic: string;
  theme_id: string;
  age_rating: string;
  play_mode: string;
  content: unknown;
}

function proposalOf(row: ProposalRow) {
  return {
    id: row.id,
    gameId: row.game_id,
    hostId: row.host_id,
    hostName: row.host_name ?? "",
    title: row.title,
    status: row.status === "accepted" || row.status === "rejected" ? row.status : "pending",
    reason: row.reason,
    libraryGameId: row.library_game_id,
    createdAt: row.created_at.getTime(),
    decidedAt: row.decided_at ? row.decided_at.getTime() : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Причина отказа: без управляющих символов (кроме переводов строк), не длиннее 300. */
export function cleanReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  return text ? text.slice(0, REASON_MAX) : null;
}

export function registerProposals(app: FastifyInstance, options: ProposalsOptions): void {
  const { sql } = options;
  const select = () => sql`
    select p.id, p.game_id, p.host_id, u.name as host_name, p.title, p.status, p.reason,
           p.library_game_id, p.created_at, p.decided_at
    from library_proposals p left join users u on u.id = p.host_id`;

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!permissions.canUseGames(actorOf(user)) && !permissions.canReviewProposals(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    async function findProposal(id: string): Promise<ProposalRow | null> {
      if (!ID.test(id)) return null;
      const rows = await sql<ProposalRow[]>`${select()} where p.id = ${id}`;
      return rows[0] ?? null;
    }

    // Ведущий предлагает свою игру. Пока предложение ждёт — повтор возвращает его же.
    api.post<{ Body: unknown }>("/api/proposals", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      const gameId = typeof body.gameId === "string" && ID.test(body.gameId) ? body.gameId : null;
      if (!id || !gameId) return fail(reply, 400, "invalid-argument");
      const [game] = await sql<GameRow[]>`select id, scope, owner_id, title from games where id = ${gameId}`;
      if (!game) return fail(reply, 404, "not-found");
      if (!permissions.canProposeGame(actorOf(user), { scope: game.scope === "agency" ? "agency" : "personal", ownerId: game.owner_id })) {
        return fail(reply, 403, "permission-denied");
      }
      const pending = await sql<ProposalRow[]>`${select()} where p.game_id = ${gameId} and p.status = 'pending' limit 1`;
      if (pending[0]) return proposalOf(pending[0]);
      const existing = await findProposal(id);
      if (existing) return existing.host_id === user.id ? proposalOf(existing) : fail(reply, 409, "already-exists");
      await sql`
        insert into library_proposals (id, game_id, host_id, title)
        values (${id}, ${gameId}, ${user.id}, ${game.title.slice(0, 200)})
        on conflict (id) do nothing`;
      const created = await findProposal(id);
      request.log.info({ proposal: "create" }, "proposal");
      return created ? proposalOf(created) : fail(reply, 503, "unavailable");
    });

    // Свои предложения (ведущий) или ожидающие (владелец).
    api.get<{ Querystring: { mine?: string; status?: string } }>("/api/proposals", async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (request.query.status === "pending") {
        if (!permissions.canReviewProposals(actorOf(user))) return fail(reply, 403, "permission-denied");
        const rows = await sql<ProposalRow[]>`${select()} where p.status = 'pending' order by p.created_at limit ${LIST_LIMIT}`;
        return rows.map(proposalOf);
      }
      const rows = await sql<ProposalRow[]>`
        ${select()} where p.host_id = ${user.id} order by p.created_at desc limit ${LIST_LIMIT}`;
      return rows.map(proposalOf);
    });

    api.post<{ Params: { id: string } }>("/api/proposals/:id/accept", async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!permissions.canReviewProposals(actorOf(user))) return fail(reply, 403, "permission-denied");
      const proposal = await findProposal(request.params.id);
      if (!proposal) return fail(reply, 404, "not-found");
      // Повтор после обрыва связи — уже принято.
      if (proposal.status === "accepted") return proposalOf(proposal);
      if (proposal.status !== "pending") return fail(reply, 409, "failed-precondition");

      const libraryGameId = await sql.begin(async (tx) => {
        const [source] = await tx<GameRow[]>`
          select id, scope, owner_id, title, mechanic, theme_id, age_rating, play_mode, content
          from games where id = ${proposal.game_id}`;
        if (!source) return null;
        // Эту игру уже принимали, и её копия в библиотеке есть — обновляем её, а не плодим дубль.
        const [previous] = await tx<{ id: string }[]>`
          select g.id from library_proposals p join games g on g.id = p.library_game_id and g.scope = 'agency'
          where p.game_id = ${proposal.game_id} and p.status = 'accepted'
          order by p.decided_at desc limit 1`;
        const content = tx.json((source.content ?? null) as Parameters<typeof tx.json>[0]);
        let target: string;
        if (previous) {
          target = previous.id;
          await tx`
            update games set title = ${source.title}, mechanic = ${source.mechanic}, theme_id = ${source.theme_id},
              age_rating = ${source.age_rating}, play_mode = ${source.play_mode}, content = ${content}, updated_at = now()
            where id = ${target}`;
        } else {
          target = newUserId();
          await tx`
            insert into games (id, scope, owner_id, title, mechanic, theme_id, age_rating, play_mode, content)
            values (${target}, 'agency', ${user.id}, ${source.title}, ${source.mechanic}, ${source.theme_id},
                    ${source.age_rating}, ${source.play_mode}, ${content})`;
        }
        // Картинки — те же файлы: копируются только ссылки, которых у игры библиотеки ещё нет.
        await tx`
          insert into media (game_id, media_id, variant, sha256, mime, width, height, size)
          select ${target}, media_id, variant, sha256, mime, width, height, size from media
          where game_id = ${source.id}
          on conflict (game_id, media_id, variant) do nothing`;
        await tx`
          update library_proposals set status = 'accepted', library_game_id = ${target}, decided_at = now(),
            title = ${source.title.slice(0, 200)}
          where id = ${proposal.id}`;
        return target;
      });
      if (!libraryGameId) return fail(reply, 404, "not-found");
      request.log.info({ proposal: "accept" }, "proposal");
      const updated = await findProposal(proposal.id);
      return updated ? proposalOf(updated) : { ok: true };
    });

    api.post<{ Params: { id: string }; Body: unknown }>("/api/proposals/:id/reject", { bodyLimit: 4096 }, async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!permissions.canReviewProposals(actorOf(user))) return fail(reply, 403, "permission-denied");
      const proposal = await findProposal(request.params.id);
      if (!proposal) return fail(reply, 404, "not-found");
      if (proposal.status === "rejected") return proposalOf(proposal);
      if (proposal.status !== "pending") return fail(reply, 409, "failed-precondition");
      const reason = cleanReason(isRecord(request.body) ? request.body.reason : null);
      await sql`
        update library_proposals set status = 'rejected', reason = ${reason}, decided_at = now()
        where id = ${proposal.id} and status = 'pending'`;
      request.log.info({ proposal: "reject" }, "proposal");
      const updated = await findProposal(proposal.id);
      return updated ? proposalOf(updated) : { ok: true };
    });
  });
}
