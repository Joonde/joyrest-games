/**
 * «Опрос гостей заранее» для «100 к 1» (решение владельца 15 октября 2026; логика — `src/core/polls.ts`).
 *
 * Без входа (гость открыл ссылку или QR дома): GET /api/polls/:id/form — вопросы опроса,
 * POST /api/polls/:id/answers — свой ответ на каждый вопрос (`{ id, answers, website }`: id создаёт браузер,
 * повтор — та же запись; `website` — ловушка для ботов: им 200, ничего не пишем). Имя не спрашиваем.
 * Лимиты: новые ответы — 30 в час с адреса и 3000 в час на всё приложение, до 2000 ответивших на опрос.
 *
 * Владелец игры (кто её правит — `permissions.canCreatePoll`) заводит опрос: POST /api/polls (id от браузера;
 * вопросы, открыт ли приём, объединения и подписи групп). Смотреть ответы, менять и удалять — тот, кто завёл,
 * и владелец агентства (`permissions.canManagePoll`): GET /api/polls/:id, DELETE /api/polls/:id.
 * В журнал — только действие и итог, без текста ответов.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { parsePollAnswers, parsePollEdits, parsePollQuestions, cleanPollText, POLL_LIMITS } from "../../src/core/polls";
import * as permissions from "../../src/data/permissions";
import { actorOf, apiGuard, sessionUser } from "./auth";
import { WindowLimiter } from "./lead";

export interface PollsOptions {
  sql: Sql;
  isSite?: (request: FastifyRequest) => boolean;
  now?: () => number;
  limits?: Partial<PollLimits>;
}

export interface PollLimits {
  perIp: number;
  perIpWindowMs: number;
  global: number;
  globalWindowMs: number;
  /** Опросов у одного ведущего. */
  perOwner: number;
}

export const DEFAULT_POLL_LIMITS: PollLimits = {
  perIp: 30,
  perIpWindowMs: 60 * 60_000,
  global: 3000,
  globalWindowMs: 60 * 60_000,
  perOwner: 200,
};

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const GAME_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface PollRow {
  id: string;
  game_id: string;
  owner_id: string;
  title: string;
  questions: unknown;
  edits: unknown;
  open: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function registerPolls(app: FastifyInstance, options: PollsOptions): void {
  const { sql } = options;
  const limits = { ...DEFAULT_POLL_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const perIp = new WindowLimiter(limits.perIp, limits.perIpWindowMs);
  const global = new WindowLimiter(limits.global, limits.globalWindowMs);

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string) {
      return reply.code(status).send({ error: code });
    }

    function log(request: FastifyRequest, action: string, result: string) {
      request.log.info({ polls: action, result }, "polls");
    }

    async function findPoll(id: string): Promise<PollRow | null> {
      if (!ID.test(id)) return null;
      const [row] = await sql<PollRow[]>`select id, game_id, owner_id, title, questions, edits, open from polls where id = ${id}`;
      return row ?? null;
    }

    // ---------------------------------------------------------------- без входа

    api.get<{ Params: { id: string } }>("/api/polls/:id/form", async (request, reply) => {
      const poll = await findPoll(request.params.id);
      if (!poll) return fail(reply, 404, "not-found");
      reply.header("X-Robots-Tag", "noindex, nofollow");
      return { id: poll.id, title: poll.title, questions: parsePollQuestions(poll.questions), open: poll.open };
    });

    api.post<{ Params: { id: string } }>("/api/polls/:id/answers", { bodyLimit: 16 * 1024 }, async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {};
      const rid = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      if (!rid) return fail(reply, 400, "invalid-argument");
      const poll = await findPoll(request.params.id);
      if (!poll) return fail(reply, 404, "not-found");
      if (!poll.open) return fail(reply, 409, "failed-precondition");
      const answers = parsePollAnswers(body.answers, parsePollQuestions(poll.questions));
      if (Object.keys(answers).length === 0) return fail(reply, 400, "invalid-argument");
      const json = sql.json(JSON.parse(JSON.stringify(answers)));
      // Правка своих ответов (тот же телефон) — без лимита: запись та же.
      const updated = await sql`update poll_answers set answers = ${json}, updated_at = now() where poll_id = ${poll.id} and id = ${rid} returning id`;
      if (updated.length > 0) {
        log(request, "answer", "updated");
        return { ok: true };
      }
      if (typeof body.website === "string" && body.website.trim() !== "") {
        log(request, "answer", "trap");
        return { ok: true };
      }
      const time = now();
      if (!perIp.allowed(request.ip, time) || !global.allowed("all", time)) {
        log(request, "answer", "rate-limit");
        return fail(reply, 429, "resource-exhausted");
      }
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from poll_answers where poll_id = ${poll.id}`;
      if ((count?.n ?? 0) >= POLL_LIMITS.respondents) {
        log(request, "answer", "full");
        return fail(reply, 429, "resource-exhausted");
      }
      perIp.take(request.ip, time);
      global.take("all", time);
      await sql`
        insert into poll_answers (poll_id, id, answers) values (${poll.id}, ${rid}, ${json})
        on conflict (poll_id, id) do update set answers = excluded.answers, updated_at = now()`;
      log(request, "answer", "ok");
      return { ok: true };
    });

    // ---------------------------------------------------------------- ведущий

    api.get<{ Params: { id: string } }>("/api/polls/:id", async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return fail(reply, 401, "unauthenticated");
      const poll = await findPoll(request.params.id);
      if (!poll) return fail(reply, 404, "not-found");
      if (!permissions.canManagePoll(actorOf(user), { ownerId: poll.owner_id })) return fail(reply, 403, "permission-denied");
      const questions = parsePollQuestions(poll.questions);
      const rows = await sql<{ answers: unknown }[]>`select answers from poll_answers where poll_id = ${poll.id} order by created_at`;
      const responses: Record<string, string[]> = Object.fromEntries(questions.map((q) => [q.id, [] as string[]]));
      let respondents = 0;
      for (const row of rows) {
        const answers = parsePollAnswers(row.answers, questions);
        if (Object.keys(answers).length > 0) respondents++;
        for (const [qid, text] of Object.entries(answers)) responses[qid]?.push(text);
      }
      return { id: poll.id, gameId: poll.game_id, title: poll.title, questions, open: poll.open, respondents, responses, edits: parsePollEdits(poll.edits) };
    });

    api.post("/api/polls", { bodyLimit: 60 * 1024 }, async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return fail(reply, 401, "unauthenticated");
      const actor = actorOf(user);
      const body = isRecord(request.body) ? request.body : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      const gameId = typeof body.gameId === "string" && GAME_ID.test(body.gameId) ? body.gameId : null;
      if (!id || !gameId) return fail(reply, 400, "invalid-argument");
      const questions = parsePollQuestions(body.questions);
      if (questions.length === 0) return fail(reply, 400, "invalid-argument");
      const title = cleanPollText(body.title, POLL_LIMITS.title);
      const open = body.open !== false;
      const edits = parsePollEdits(body.edits);
      const existing = await findPoll(id);
      if (existing) {
        if (!permissions.canManagePoll(actor, { ownerId: existing.owner_id })) return fail(reply, 403, "permission-denied");
        if (existing.game_id !== gameId) return fail(reply, 409, "already-exists");
        await sql`
          update polls set title = ${title}, questions = ${sql.json(JSON.parse(JSON.stringify(questions)))}, edits = ${sql.json(JSON.parse(JSON.stringify(edits)))},
                 open = ${open}, updated_at = now()
          where id = ${id}`;
        log(request, "save", "updated");
        return { ok: true };
      }
      const [game] = await sql<{ scope: "agency" | "personal"; owner_id: string }[]>`select scope, owner_id from games where id = ${gameId}`;
      if (!game) return fail(reply, 404, "not-found");
      if (!permissions.canCreatePoll(actor, { scope: game.scope, ownerId: game.owner_id })) return fail(reply, 403, "permission-denied");
      const [count] = await sql<{ n: number }[]>`select count(*)::int as n from polls where owner_id = ${user.id}`;
      if ((count?.n ?? 0) >= limits.perOwner) return fail(reply, 429, "resource-exhausted");
      // Два одновременных повтора: второй увидит запись первого (do nothing) — тот же опрос.
      await sql`
        insert into polls (id, game_id, owner_id, title, questions, edits, open)
        values (${id}, ${gameId}, ${user.id}, ${title}, ${sql.json(JSON.parse(JSON.stringify(questions)))}, ${sql.json(JSON.parse(JSON.stringify(edits)))}, ${open})
        on conflict (id) do nothing`;
      log(request, "save", "created");
      return { ok: true };
    });

    api.delete<{ Params: { id: string } }>("/api/polls/:id", async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return fail(reply, 401, "unauthenticated");
      const poll = await findPoll(request.params.id);
      if (!poll) return { ok: true };
      if (!permissions.canManagePoll(actorOf(user), { ownerId: poll.owner_id })) return fail(reply, 403, "permission-denied");
      await sql.begin(async (tx) => {
        await tx`delete from poll_answers where poll_id = ${poll.id}`;
        await tx`delete from polls where id = ${poll.id}`;
      });
      log(request, "delete", "ok");
      return { ok: true };
    });
  });
}
