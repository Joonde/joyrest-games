/**
 * Вход ведущих и управление ведущими на своём сервере (PR 3.1, CLAUDE.md, «Платформа на своём
 * сервере»). Пароль — scrypt (password.ts), сеанс — случайный токен в cookie `__Host-jr_s`
 * (httpOnly, Secure, SameSite=Lax, 30 дней), в базе — только sha256 токена.
 *
 * Права — функции src/data/permissions.ts, те же, что решают, что показывать в интерфейсе.
 * Ошибки — `{ error: "<код>" }` с кодами как у Firebase (`auth/invalid-credential`,
 * `permission-denied`, …): тексты ошибок и повторы в браузере общие для обеих реализаций.
 * Изменения — только с заголовком `X-JoyRest: 1` и Origin своего адреса (чужая страница
 * не может прислать такой запрос без CORS, а CORS сервер не разрешает).
 * В журнал — только итог, без почты и паролей.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { cleanName, isValidName } from "../../src/core/names";
import { generateTempPassword, isStrongEnough } from "../../src/core/password";
import * as permissions from "../../src/data/permissions";
import type { HostAccount, Role, UserProfile } from "../../src/data/types";
import { WindowLimiter } from "./lead";
import { hashPassword, verifyPassword } from "./password";

export const SESSION_COOKIE = "__Host-jr_s";
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;
const SESSION_MS = SESSION_DAYS * DAY_MS;
/** Сеанс продлевается не чаще раза в сутки — не пишем в базу на каждый запрос. */
const REFRESH_AFTER_MS = DAY_MS;
const BODY_LIMIT = 4 * 1024;
const MAX_FIELD = 200;
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface AuthLimits {
  /** Попыток входа на адрес + почту за окно. */
  perAccount: number;
  /** Попыток входа с одного адреса за окно (перебор разных почт). */
  perIp: number;
  windowMs: number;
  /** Новых устройств гостей в час с одного адреса без задержки. */
  devicesFast: number;
  /** Потолок новых устройств в час с одного адреса. */
  devicesMax: number;
  /** Задержка сверх devicesFast, мс (в тестах — 0). */
  deviceDelayMs?: () => number;
}

export const DEFAULT_AUTH_LIMITS: AuthLimits = { perAccount: 10, perIp: 30, windowMs: 15 * 60_000, devicesFast: 600, devicesMax: 3000 };
const HOUR_MS = 60 * 60_000;

export interface AuthOptions {
  sql: Sql;
  /** Адреса сайта агентства: там API платформы нет (404). */
  isSite?: (request: FastifyRequest) => boolean;
  /** Часы (подменяются в тестах). */
  now?: () => number;
  limits?: Partial<AuthLimits>;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  password_hash: string | null;
  must_change_password: boolean;
  created_at: Date | null;
}

export interface SessionRow extends UserRow {
  token_hash: string;
  expires_at: Date;
}

/** Профиль ведущего для браузера. `mustChangePassword` — вошёл по временному паролю. */
export type ServerProfile = UserProfile & { mustChangePassword: boolean };

function role(value: string): Role {
  return value === "admin" ? "admin" : "host";
}

export function profileOf(row: UserRow): ServerProfile {
  return {
    uid: row.id,
    role: role(row.role),
    name: row.name,
    active: row.active,
    email: row.email,
    mustChangePassword: row.must_change_password,
  };
}

function accountOf(row: UserRow): HostAccount {
  return { uid: row.id, role: role(row.role), name: row.name, active: row.active, email: row.email, createdAt: row.created_at ? row.created_at.getTime() : null };
}

export function actorOf(row: UserRow): permissions.Actor {
  return { uid: row.id, role: role(row.role), active: row.active };
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Значение cookie из заголовка Cookie; нет — null. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
    }
  }
  return null;
}

function sessionCookie(token: string, maxAgeMs: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; Secure; SameSite=Lax`;
}

const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** id нового ведущего: 20 символов, как у Firebase. */
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export function newUserId(): string {
  let id = "";
  while (id.length < 20) {
    for (const byte of randomBytes(32)) {
      if (byte < 248 && id.length < 20) id += ID_ALPHABET[byte % ID_ALPHABET.length];
    }
  }
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Строковое поле тела запроса не длиннее MAX_FIELD; иначе null. */
function field(body: unknown, key: string): string | null {
  if (!isRecord(body)) return null;
  const value = body[key];
  return typeof value === "string" && value.length <= MAX_FIELD ? value : null;
}

function sameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host.toLowerCase() === (request.headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Общая защита API платформы: ответы без кэша, на адресах сайта агентства — 404, изменения —
 * только с `X-JoyRest: 1` и Origin своего адреса.
 */
export function apiGuard(isSite?: (request: FastifyRequest) => boolean) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    if (isSite?.(request)) return reply.code(404).send({ error: "not-found" });
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (request.headers["x-joyrest"] !== "1" || !sameOrigin(request)) {
        return reply.code(403).send({ error: "permission-denied" });
      }
    }
  };
}

/** Вошедший ведущий по cookie; сеанс продлевается раз в сутки. Нет входа — null. */
export async function sessionUser(sql: Sql, request: FastifyRequest, reply: FastifyReply, now: () => number = Date.now): Promise<SessionRow | null> {
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const rows = await sql<SessionRow[]>`
    select s.token_hash, s.expires_at, u.id, u.email, u.name, u.role, u.active, u.password_hash,
           u.must_change_password, u.created_at
    from auth_sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash(token)} and s.expires_at > ${new Date(now())}`;
  const row = rows[0];
  if (!row) {
    reply.header("Set-Cookie", CLEAR_COOKIE);
    return null;
  }
  if (row.expires_at.getTime() - now() < SESSION_MS - REFRESH_AFTER_MS) {
    await sql`update auth_sessions set expires_at = ${new Date(now() + SESSION_MS)} where token_hash = ${row.token_hash}`;
    reply.header("Set-Cookie", sessionCookie(token, SESSION_MS));
  }
  return row;
}

export const DEVICE_COOKIE = "__Host-jr_d";
const DEVICE_MS = 180 * DAY_MS;

function deviceCookie(token: string): string {
  return `${DEVICE_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(DEVICE_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`;
}

/** Телефон гостя или экран зала по cookie устройства; нет — null. */
export async function deviceOf(sql: Sql, request: FastifyRequest): Promise<string | null> {
  const token = readCookie(request.headers.cookie, DEVICE_COOKIE);
  if (!token) return null;
  const rows = await sql<{ id: string }[]>`select id from devices where token_hash = ${tokenHash(token)}`;
  return rows[0]?.id ?? null;
}

/** Кто обращается: вошедший ведущий (user) или устройство гостя (user = null). Никто — null. */
export interface Identity {
  uid: string;
  user: SessionRow | null;
}

export async function identityOf(sql: Sql, request: FastifyRequest, reply: FastifyReply): Promise<Identity | null> {
  const user = await sessionUser(sql, request, reply);
  if (user) return { uid: user.id, user };
  const device = await deviceOf(sql, request);
  return device ? { uid: device, user: null } : null;
}

const USER_COLUMNS = ["id", "email", "name", "role", "active", "password_hash", "must_change_password", "created_at"];

export function registerAuth(app: FastifyInstance, options: AuthOptions): void {
  const { sql } = options;
  const now = options.now ?? Date.now;
  const limits = { ...DEFAULT_AUTH_LIMITS, ...options.limits };
  const perAccount = new WindowLimiter(limits.perAccount, limits.windowMs);
  const perIp = new WindowLimiter(limits.perIp, limits.windowMs);
  const perUser = new WindowLimiter(limits.perAccount, limits.windowMs);
  // Устройства гостей: весь зал часто за одним Wi‑Fi (один адрес). До 600 в час — сразу,
  // дальше с задержкой 1–3 с, больше 3000 в час — отказ.
  const devicesFast = new WindowLimiter(limits.devicesFast, HOUR_MS);
  const devicesMax = new WindowLimiter(limits.devicesMax, HOUR_MS);

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));

    function fail(reply: FastifyReply, status: number, code: string, request: FastifyRequest, action: string) {
      request.log.info({ auth: action, result: code, status }, "auth");
      return reply.code(status).send({ error: code });
    }

    async function startSession(reply: FastifyReply, userId: string): Promise<void> {
      const token = randomBytes(32).toString("base64url");
      await sql`insert into auth_sessions (token_hash, user_id, expires_at)
        values (${tokenHash(token)}, ${userId}, ${new Date(now() + SESSION_MS)})`;
      reply.header("Set-Cookie", sessionCookie(token, SESSION_MS));
    }

    const currentUser = (request: FastifyRequest, reply: FastifyReply) => sessionUser(sql, request, reply, now);

    /** Вошедший администратор; иначе ответ 401/403 уже отправлен и вернётся null. */
    async function requireAdmin(request: FastifyRequest, reply: FastifyReply, action: string): Promise<SessionRow | null> {
      const user = await currentUser(request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated", request, action);
        return null;
      }
      if (!permissions.canManageHosts(actorOf(user))) {
        fail(reply, 403, "permission-denied", request, action);
        return null;
      }
      return user;
    }

    async function findUser(id: string): Promise<UserRow | null> {
      const rows = await sql<UserRow[]>`select ${sql(USER_COLUMNS)} from users where id = ${id}`;
      return rows[0] ?? null;
    }

    const routeOptions = { bodyLimit: BODY_LIMIT };

    api.get("/api/auth/me", async (request, reply) => {
      const user = await currentUser(request, reply);
      if (!user) return { user: null, profile: null };
      return { user: { uid: user.id, email: user.email, anonymous: false }, profile: profileOf(user) };
    });

    // Анонимный вход гостя или экрана зала: уже вошедший (ведущий или устройство) остаётся собой.
    api.post("/api/auth/device", routeOptions, async (request, reply) => {
      const known = await identityOf(sql, request, reply);
      if (known) return { uid: known.uid, anonymous: known.user === null, email: known.user?.email ?? null };
      const time = now();
      if (!devicesMax.take(request.ip, time)) return fail(reply, 429, "resource-exhausted", request, "device");
      if (!devicesFast.take(request.ip, time)) {
        const delay = limits.deviceDelayMs ? limits.deviceDelayMs() : 1000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const token = randomBytes(32).toString("base64url");
      const id = newUserId();
      await sql`insert into devices (id, token_hash) values (${id}, ${tokenHash(token)})`;
      reply.header("Set-Cookie", deviceCookie(token));
      return { uid: id, anonymous: true, email: null };
    });

    api.post("/api/auth/login", routeOptions, async (request, reply) => {
      const email = field(request.body, "email")?.trim().toLowerCase() ?? "";
      const password = field(request.body, "password") ?? "";
      if (!EMAIL_PATTERN.test(email)) return fail(reply, 400, "auth/invalid-email", request, "login");
      if (!password) return fail(reply, 400, "auth/invalid-credential", request, "login");
      const time = now();
      if (!perIp.take(request.ip, time) || !perAccount.take(`${request.ip}|${email}`, time)) {
        return fail(reply, 429, "auth/too-many-requests", request, "login");
      }
      const rows = await sql<UserRow[]>`select ${sql(USER_COLUMNS)} from users where lower(email) = ${email}`;
      const user = rows[0] ?? null;
      // Проверка идёт и для неизвестной почты: по времени ответа не понять, есть ли аккаунт.
      const ok = await verifyPassword(password, user?.password_hash ?? null);
      if (!user || !ok) return fail(reply, 401, "auth/invalid-credential", request, "login");
      if (!permissions.isActiveHost(actorOf(user))) return fail(reply, 403, "auth/user-disabled", request, "login");
      await startSession(reply, user.id);
      // Заодно убираем просроченные сеансы — без отдельного таймера.
      await sql`delete from auth_sessions where expires_at < ${new Date(time)}`;
      request.log.info({ auth: "login", result: "ok", status: 200 }, "auth");
      return { user: { uid: user.id, email: user.email, anonymous: false }, profile: profileOf(user) };
    });

    api.post("/api/auth/logout", routeOptions, async (request, reply) => {
      const token = readCookie(request.headers.cookie, SESSION_COOKIE);
      if (token) await sql`delete from auth_sessions where token_hash = ${tokenHash(token)}`;
      reply.header("Set-Cookie", CLEAR_COOKIE);
      return { ok: true };
    });

    api.post("/api/auth/password", routeOptions, async (request, reply) => {
      const user = await currentUser(request, reply);
      if (!user) return fail(reply, 401, "unauthenticated", request, "password");
      const current = field(request.body, "currentPassword") ?? "";
      const next = field(request.body, "newPassword");
      if (next === null || !isStrongEnough(next)) return fail(reply, 400, "auth/weak-password", request, "password");
      if (!perUser.take(user.id, now())) return fail(reply, 429, "auth/too-many-requests", request, "password");
      if (!(await verifyPassword(current, user.password_hash))) return fail(reply, 401, "auth/wrong-password", request, "password");
      const hash = await hashPassword(next);
      await sql.begin(async (tx) => {
        await tx`update users set password_hash = ${hash}, must_change_password = false, updated_at = now() where id = ${user.id}`;
        // Остальные устройства выходят: пароль мог узнать кто-то ещё.
        await tx`delete from auth_sessions where user_id = ${user.id} and token_hash <> ${user.token_hash}`;
      });
      request.log.info({ auth: "password", result: "ok", status: 200 }, "auth");
      return { ok: true };
    });

    api.get("/api/users", async (request, reply) => {
      if (!(await requireAdmin(request, reply, "users"))) return reply;
      const rows = await sql<UserRow[]>`select ${sql(USER_COLUMNS)} from users`;
      return rows
        .map(accountOf)
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ru"));
    });

    api.post("/api/users", routeOptions, async (request, reply) => {
      if (!(await requireAdmin(request, reply, "create"))) return reply;
      const email = field(request.body, "email")?.trim().toLowerCase() ?? "";
      const name = cleanName(field(request.body, "name") ?? "");
      if (!EMAIL_PATTERN.test(email)) return fail(reply, 400, "auth/invalid-email", request, "create");
      if (!isValidName(name)) return fail(reply, 400, "invalid-argument", request, "create");
      const temporaryPassword = generateTempPassword();
      const hash = await hashPassword(temporaryPassword);
      try {
        const rows = await sql<UserRow[]>`
          insert into users (id, email, name, role, active, password_hash, must_change_password)
          values (${newUserId()}, ${email}, ${name}, 'host', true, ${hash}, true)
          returning ${sql(USER_COLUMNS)}`;
        const row = rows[0];
        if (!row) throw new Error("insert");
        request.log.info({ auth: "create", result: "ok", status: 200 }, "auth");
        return { account: accountOf(row), temporaryPassword };
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
          return fail(reply, 409, "auth/email-already-in-use", request, "create");
        }
        throw error;
      }
    });

    api.post<{ Params: { id: string } }>("/api/users/:id/active", routeOptions, async (request, reply) => {
      const admin = await requireAdmin(request, reply, "active");
      if (!admin) return reply;
      const body = request.body;
      if (!isRecord(body) || typeof body.active !== "boolean") return fail(reply, 400, "invalid-argument", request, "active");
      const target = await findUser(request.params.id);
      if (!target) return fail(reply, 404, "not-found", request, "active");
      if (!permissions.canSetHostActive(actorOf(admin), { uid: target.id })) return fail(reply, 403, "permission-denied", request, "active");
      const active = body.active;
      await sql.begin(async (tx) => {
        await tx`update users set active = ${active}, updated_at = now() where id = ${target.id}`;
        if (!active) await tx`delete from auth_sessions where user_id = ${target.id}`;
      });
      request.log.info({ auth: "active", result: "ok", status: 200 }, "auth");
      return { ok: true };
    });

    api.post<{ Params: { id: string } }>("/api/users/:id/password", routeOptions, async (request, reply) => {
      const admin = await requireAdmin(request, reply, "reset");
      if (!admin) return reply;
      const target = await findUser(request.params.id);
      if (!target) return fail(reply, 404, "not-found", request, "reset");
      if (!permissions.canResetHostPassword(actorOf(admin), { uid: target.id })) return fail(reply, 403, "permission-denied", request, "reset");
      const temporaryPassword = generateTempPassword();
      const hash = await hashPassword(temporaryPassword);
      await sql.begin(async (tx) => {
        await tx`update users set password_hash = ${hash}, must_change_password = true, updated_at = now() where id = ${target.id}`;
        // Старый пароль больше не действует нигде.
        await tx`delete from auth_sessions where user_id = ${target.id}`;
      });
      request.log.info({ auth: "reset", result: "ok", status: 200 }, "auth");
      return { account: accountOf(target), temporaryPassword };
    });
  });
}
