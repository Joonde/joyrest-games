/**
 * База площадок (CLAUDE.md, «База площадок»): анкеты заведений и запросы клиентов по QR-коду
 * ведущего, кабинет владельца (площадки, заявки, подбор) и предложение клиенту по ссылке.
 *
 * Без входа (только при VENUE_FORMS=on — `sudo joyrest venues on`; test — всегда):
 *   POST /api/venue-forms/venue, PUT /api/venue-forms/venue/:id/files/:kind (одноразовый токен),
 *   POST /api/venue-forms/request. GET /api/venue-forms/status — открыты ли анкеты.
 * Без входа всегда: GET /api/offers/:id и фото предложения — снимок без адресов и контактов.
 * Владелец и ведущие с доступом (`permissions.canManageVenues`): /api/venues…, /api/venue-requests…,
 * /api/venue-offers. Доступ ведущему — POST /api/users/:id/venue-access (admin).
 *
 * В Telegram (бот заявок сайта) — номер заявки, событие и число гостей, название площадки и кто
 * привёл; без имён и телефонов клиентов и контактов заведений. В журнал — действие и итог.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import * as permissions from "../../src/data/permissions";
import {
  isRequestStatus,
  isVenueStatus,
  matchVenue,
  MENU_PDF_MAX_BYTES,
  offerItem,
  parseRequest,
  parseVenue,
  requestMissing,
  requestTitle,
  cleanText,
  TEXT_LIMITS,
  VENUE_FILES,
  VENUE_IMAGE_MAX_BYTES,
  venueMissing,
  formatEventDate,
  type OfferData,
  type RequestData,
  type VenueData,
  type VenueFileKind,
} from "../../src/core/venues";
import { actorOf, apiGuard, sessionUser, type SessionRow, takeUploadSlot } from "./auth";
import { imageMime } from "./games";
import { sendTelegram, type TelegramTarget, WindowLimiter } from "./lead";

export interface VenuesOptions {
  sql: Sql;
  mediaDir: string | null;
  isSite?: (request: FastifyRequest) => boolean;
  /** Анкеты без входа открыты (VENUE_FORMS=on). Кабинет и предложения работают всегда. */
  formsOpen: boolean;
  /** Бот заявок сайта; null — уведомлений нет, анкеты работают. */
  telegram?: TelegramTarget | null;
  /** Пометка тестового окружения («🧪 ТЕСТ»). */
  label?: string;
  send?: (target: TelegramTarget, text: string) => Promise<void>;
  now?: () => number;
  limits?: Partial<VenueLimits>;
  freeBytes?: (dir: string) => Promise<number>;
}

export interface VenueLimits {
  venuesPerIp: number;
  requestsPerIp: number;
  perIpWindowMs: number;
  global: number;
  globalWindowMs: number;
  minFreeBytes: number;
}

export const DEFAULT_VENUE_LIMITS: VenueLimits = {
  venuesPerIp: 5,
  requestsPerIp: 5,
  perIpWindowMs: 60 * 60_000,
  global: 60,
  globalWindowMs: 60 * 60_000,
  minFreeBytes: 3 * 1024 ** 3,
};

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const SHA = /^[0-9a-f]{64}$/;
const UPLOAD_TTL_MS = 2 * 60 * 60_000;
const FORM_BODY_LIMIT = 48 * 1024;
const FILE_BODY_LIMIT = 2 * 1024 * 1024;
const MAX_OFFER_VENUES = 10;

export interface VenueFile {
  sha: string;
  kind: VenueFileKind;
  mime: string;
  size: number;
  name: string;
}

interface VenueRow {
  id: string;
  data: unknown;
  status: string;
  rating: number | null;
  notes: string;
  source: string;
  host_id: string | null;
  host_name: string | null;
  files: unknown;
  created_at: Date;
  updated_at: Date;
}

interface RequestRow {
  id: string;
  number: number;
  data: unknown;
  status: string;
  notes: string;
  host_id: string | null;
  host_name: string | null;
  offers: string | number;
  created_at: Date;
  updated_at: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKind(value: string): value is VenueFileKind {
  return value === "photo" || value === "menu";
}

export function filesOf(value: unknown): VenueFile[] {
  if (!Array.isArray(value)) return [];
  const out: VenueFile[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.sha !== "string" || !SHA.test(item.sha) || typeof item.kind !== "string" || !isKind(item.kind)) continue;
    out.push({
      sha: item.sha,
      kind: item.kind,
      mime: typeof item.mime === "string" ? item.mime : "application/octet-stream",
      size: typeof item.size === "number" ? item.size : 0,
      name: typeof item.name === "string" ? item.name : "",
    });
  }
  return out;
}

function venueOut(row: VenueRow) {
  return {
    id: row.id,
    data: parseVenue(row.data),
    status: isVenueStatus(row.status) ? row.status : "new",
    rating: row.rating,
    notes: row.notes,
    source: row.source === "manual" ? "manual" : "form",
    hostId: row.host_id,
    hostName: row.host_name,
    files: filesOf(row.files),
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

function requestOut(row: RequestRow) {
  return {
    id: row.id,
    number: row.number,
    data: parseRequest(row.data),
    status: isRequestStatus(row.status) ? row.status : "new",
    notes: row.notes,
    hostId: row.host_id,
    hostName: row.host_name,
    offers: Number(row.offers),
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

/** Ссылка предложения: 22 случайных символа — не угадать и не перебрать. */
export function newOfferId(): string {
  return randomBytes(17).toString("base64url").slice(0, 22);
}

/** Тип файла по первым байтам: картинка (WebP, JPEG) или PDF. */
export function venueFileMime(bytes: Buffer): "image/webp" | "image/jpeg" | "application/pdf" | null {
  const image = imageMime(bytes);
  if (image) return image;
  return bytes.length >= 5 && bytes.toString("latin1", 0, 5) === "%PDF-" ? "application/pdf" : null;
}

function fileName(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return cleanText(decodeURIComponent(value), 120);
  } catch {
    return "";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function diskFree(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

function maxGuests(v: VenueData): number | null {
  if (v.seated === null && v.standing === null) return null;
  return Math.max(v.seated ?? 0, v.standing ?? 0);
}

/** Сообщение о новой анкете: название заведения и вместимость — без людей и телефонов. */
export function venueNotice(v: VenueData, hostName: string | null, link: string, label?: string): string {
  const guests = maxGuests(v);
  const parts = [`🏢 Новая анкета площадки: «${v.name}»`, v.type ? v.type.toLowerCase() : "", guests ? `до ${guests} гостей` : ""].filter(Boolean);
  return [label, parts.join(", "), hostName ? `Привёл: ${hostName}` : "", `Открыть: ${link}`].filter(Boolean).join("\n");
}

/** Сообщение о заявке клиента: номер, событие, гости, дата — без имени и телефона. */
export function requestNotice(number: number, r: RequestData, hostName: string | null, link: string, label?: string): string {
  const what = [r.eventType ? r.eventType.toLowerCase() : "мероприятие", r.guests ? `${r.guests} гостей` : "", formatEventDate(r.date)].filter(Boolean).join(", ");
  return [label, `📝 Заявка №${number}: ${what}`, hostName ? `Привёл: ${hostName}` : "", `Открыть: ${link}`].filter(Boolean).join("\n");
}

/**
 * Открыты ли анкеты без входа. Только явное `on` (`sudo joyrest venues on`) — или тестовое
 * окружение без настройки: его адреса сайта только test.* (compose берётся из основного релиза,
 * поэтому до слияния у app-test переменной может не быть). Основная версия без `on` — закрыта.
 */
export function venueFormsOpen(value: string | undefined, siteHosts: string[]): boolean {
  const setting = value?.trim().toLowerCase();
  if (setting === "on") return true;
  if (setting) return false;
  return siteHosts.length > 0 && siteHosts.every((host) => host.startsWith("test."));
}

export function registerVenues(app: FastifyInstance, options: VenuesOptions): void {
  const { sql } = options;
  const limits = { ...DEFAULT_VENUE_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const send = options.send ?? sendTelegram;
  const freeBytes = options.freeBytes ?? diskFree;
  const venuesDir = options.mediaDir ? join(options.mediaDir, "venues") : null;
  const venuesPerIp = new WindowLimiter(limits.venuesPerIp, limits.perIpWindowMs);
  const requestsPerIp = new WindowLimiter(limits.requestsPerIp, limits.perIpWindowMs);
  const global = new WindowLimiter(limits.global, limits.globalWindowMs);
  let warnedUntil = 0;

  function notify(request: FastifyRequest, text: string) {
    if (!options.telegram) return;
    send(options.telegram, text).catch((error: unknown) => {
      const reason = error instanceof Error && error.message.startsWith("telegram ") ? error.message : error instanceof Error ? error.name : "unknown";
      request.log.warn({ venues: "telegram", reason }, "venues");
    });
  }

  function origin(request: FastifyRequest): string {
    return `https://${request.hostname}`;
  }

  /** Общий поток анкет без входа: при превышении — одно предупреждение в час. */
  function takeGlobal(request: FastifyRequest): boolean {
    const time = now();
    if (global.take("all", time)) return true;
    if (time >= warnedUntil && options.telegram) {
      warnedUntil = time + limits.globalWindowMs;
      notify(request, [options.label, `⚠️ Много анкет площадок и заявок: больше ${limits.global} за час. Возможен спам, новые отклоняются.`].filter(Boolean).join("\n"));
    }
    return false;
  }

  async function hostName(id: string | null): Promise<{ id: string; name: string } | null> {
    if (!id || !ID.test(id)) return null;
    const [row] = await sql<{ id: string; name: string }[]>`select id, name from users where id = ${id} and active = true`;
    return row ?? null;
  }

  app.register(async (api) => {
    api.addHook("onRequest", apiGuard(options.isSite));
    api.addContentTypeParser(["image/webp", "image/jpeg", "application/pdf"], { parseAs: "buffer", bodyLimit: FILE_BODY_LIMIT }, (_request, body, done) => done(null, body));

    function fail(reply: FastifyReply, status: number, code: string, extra: Record<string, unknown> = {}) {
      return reply.code(status).send({ error: code, ...extra });
    }

    function log(request: FastifyRequest, action: string, result: string) {
      request.log.info({ venues: action, result }, "venues");
    }

    async function requireManager(request: FastifyRequest, reply: FastifyReply): Promise<SessionRow | null> {
      const user = await sessionUser(sql, request, reply);
      if (!user) {
        fail(reply, 401, "unauthenticated");
        return null;
      }
      if (!permissions.canManageVenues(actorOf(user))) {
        fail(reply, 403, "permission-denied");
        return null;
      }
      return user;
    }

    /** Файл в MEDIA_DIR/venues под именем sha256 (тот же файл второй раз не пишется). */
    async function storeFile(bytes: Buffer): Promise<string> {
      if (!venuesDir) throw new Error("no media dir");
      const sha = createHash("sha256").update(bytes).digest("hex");
      await mkdir(venuesDir, { recursive: true });
      const path = join(venuesDir, sha);
      if (!existsSync(path)) {
        const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, path);
      }
      return sha;
    }

    /** Проверка файла: тип по первым байтам и вес. Ошибка — код для ответа. */
    function checkFile(kind: VenueFileKind, bytes: unknown): { mime: string } | { error: string; status: number } {
      if (!Buffer.isBuffer(bytes)) return { error: "invalid-argument", status: 400 };
      const mime = venueFileMime(bytes);
      if (!mime || (kind === "photo" && mime === "application/pdf")) return { error: "invalid-argument", status: 400 };
      const max = mime === "application/pdf" ? MENU_PDF_MAX_BYTES : VENUE_IMAGE_MAX_BYTES;
      if (bytes.length > max) return { error: "resource-exhausted", status: 413 };
      return { mime };
    }

    /** Добавляет файл к анкете, если для этого вида ещё есть место (атомарно). */
    async function attach(id: string, kind: VenueFileKind, file: VenueFile): Promise<"ok" | "full" | "missing"> {
      const rows = await sql<{ files: unknown }[]>`select files from venues where id = ${id}`;
      const row = rows[0];
      if (!row) return "missing";
      if (filesOf(row.files).some((f) => f.sha === file.sha && f.kind === kind)) return "ok";
      const updated = await sql`
        update venues set files = files || ${sql.json(JSON.parse(JSON.stringify([file])))}::jsonb, updated_at = now()
        where id = ${id}
          and (select count(*) from jsonb_array_elements(files) e where e->>'kind' = ${kind}) < ${VENUE_FILES[kind]}
        returning id`;
      return updated.length > 0 ? "ok" : "full";
    }

    // ---------------------------------------------------------------- без входа

    api.get("/api/venue-forms/status", async () => ({ open: options.formsOpen }));

    api.post("/api/venue-forms/venue", { bodyLimit: FORM_BODY_LIMIT }, async (request, reply) => {
      if (!options.formsOpen) return fail(reply, 404, "not-found");
      const body = isRecord(request.body) ? request.body : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      if (!id) return fail(reply, 400, "invalid-argument");
      if (body.consent !== true) return fail(reply, 400, "invalid-argument", { missing: ["согласие"] });
      const data = parseVenue(body.data);
      const photoFiles = Math.min(VENUE_FILES.photo, Math.max(0, Number(body.photoFiles) || 0));
      const menuFiles = Math.min(VENUE_FILES.menu, Math.max(0, Number(body.menuFiles) || 0));
      const missing = venueMissing(data, menuFiles);
      if (missing.length > 0) return fail(reply, 400, "invalid-argument", { missing });

      const token = randomBytes(24).toString("base64url");
      const quota = { photo: photoFiles, menu: menuFiles };
      const until = new Date(now() + UPLOAD_TTL_MS);
      // Повтор после обрыва связи: та же анкета, новый токен для файлов (пока не вышел срок).
      const [existing] = await sql<{ created_at: Date }[]>`select created_at from venues where id = ${id}`;
      if (existing) {
        if (now() - existing.created_at.getTime() > UPLOAD_TTL_MS) return fail(reply, 409, "already-exists");
        await sql`update venues set upload_hash = ${hashToken(token)}, upload_until = ${until}, upload_quota = ${sql.json(quota)} where id = ${id}`;
        log(request, "venue-form", "repeat");
        return { ok: true, uploadToken: token };
      }

      // Ловушка для ботов: «успешно», но ничего не сохраняем.
      if (typeof body.website === "string" && body.website.trim() !== "") {
        log(request, "venue-form", "trap");
        return { ok: true, uploadToken: token };
      }
      if (!venuesPerIp.take(request.ip, now()) || !takeGlobal(request)) {
        log(request, "venue-form", "rate-limit");
        return fail(reply, 429, "resource-exhausted");
      }
      const host = await hostName(typeof body.from === "string" ? body.from : null);
      await sql`
        insert into venues (id, data, status, source, host_id, upload_hash, upload_until, upload_quota, consent_at)
        values (${id}, ${sql.json(JSON.parse(JSON.stringify(data)))}, 'new', 'form', ${host?.id ?? null}, ${hashToken(token)}, ${until}, ${sql.json(quota)}, now())
        on conflict (id) do nothing`;
      notify(request, venueNotice(data, host?.name ?? null, `${origin(request)}/venues/v/${id}`, options.label));
      log(request, "venue-form", "ok");
      return { ok: true, uploadToken: token };
    });

    // Файлы анкеты без входа: токен проверяется до чтения тела, место для загрузки — общее.
    api.put<{ Params: { id: string; kind: string } }>(
      "/api/venue-forms/venue/:id/files/:kind",
      {
        bodyLimit: FILE_BODY_LIMIT,
        onRequest: async (request, reply) => {
          if (!options.formsOpen) return fail(reply, 404, "not-found");
          const { id, kind } = request.params;
          const token = request.headers["x-upload-token"];
          if (!ID.test(id) || !isKind(kind) || typeof token !== "string" || token.length < 16) return fail(reply, 403, "permission-denied");
          const [row] = await sql<{ upload_hash: string | null; upload_until: Date | null; upload_quota: unknown; files: unknown }[]>`
            select upload_hash, upload_until, upload_quota, files from venues where id = ${id}`;
          if (!row || row.upload_hash !== hashToken(token) || !row.upload_until || row.upload_until.getTime() < now()) return fail(reply, 403, "permission-denied");
          const quota = isRecord(row.upload_quota) ? Number(row.upload_quota[kind]) || 0 : 0;
          if (filesOf(row.files).filter((f) => f.kind === kind).length >= quota) return fail(reply, 409, "already-exists");
          if (!takeUploadSlot(request, reply)) return reply.code(503).header("Retry-After", "2").send({ error: "unavailable" });
        },
      },
      async (request, reply) => {
        const { id, kind } = request.params;
        if (!venuesDir || !isKind(kind)) return fail(reply, 501, "unimplemented");
        const checked = checkFile(kind, request.body);
        if ("error" in checked) return fail(reply, checked.status, checked.error);
        if ((await freeBytes(options.mediaDir ?? venuesDir)) < limits.minFreeBytes) {
          request.log.warn({ venues: "upload" }, "мало места на диске");
          return fail(reply, 507, "resource-exhausted");
        }
        const bytes = request.body as Buffer;
        const sha = await storeFile(bytes);
        const result = await attach(id, kind, { sha, kind, mime: checked.mime, size: bytes.length, name: fileName(request.headers["x-file-name"]) });
        log(request, "venue-file", result);
        if (result === "missing") return fail(reply, 404, "not-found");
        if (result === "full") return fail(reply, 409, "already-exists");
        return { ok: true, sha };
      },
    );

    api.post("/api/venue-forms/request", { bodyLimit: FORM_BODY_LIMIT }, async (request, reply) => {
      if (!options.formsOpen) return fail(reply, 404, "not-found");
      const body = isRecord(request.body) ? request.body : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      if (!id) return fail(reply, 400, "invalid-argument");
      if (body.consent !== true || body.ack !== true) return fail(reply, 400, "invalid-argument", { missing: ["согласие"] });
      const data = parseRequest(body.data);
      const missing = requestMissing(data);
      if (missing.length > 0) return fail(reply, 400, "invalid-argument", { missing });
      // Повтор после обрыва: тот же номер.
      const [existing] = await sql<{ number: number }[]>`select number from venue_requests where id = ${id}`;
      if (existing) return { ok: true, number: existing.number };
      if (typeof body.website === "string" && body.website.trim() !== "") {
        log(request, "request-form", "trap");
        return { ok: true, number: 0 };
      }
      if (!requestsPerIp.take(request.ip, now()) || !takeGlobal(request)) {
        log(request, "request-form", "rate-limit");
        return fail(reply, 429, "resource-exhausted");
      }
      const host = await hostName(typeof body.from === "string" ? body.from : null);
      const rows = await sql<{ number: number }[]>`
        insert into venue_requests (id, data, status, host_id, consent_at)
        values (${id}, ${sql.json(JSON.parse(JSON.stringify(data)))}, 'new', ${host?.id ?? null}, now())
        on conflict (id) do update set id = excluded.id
        returning number`;
      const number = rows[0]?.number ?? 0;
      notify(request, requestNotice(number, data, host?.name ?? null, `${origin(request)}/venues/r/${id}`, options.label));
      log(request, "request-form", "ok");
      return { ok: true, number };
    });

    // Предложение клиенту: снимок без адресов и контактов, открывается по ссылке без входа.
    api.get<{ Params: { id: string } }>("/api/offers/:id", async (request, reply) => {
      const id = request.params.id;
      if (!/^[A-Za-z0-9_-]{16,32}$/.test(id)) return fail(reply, 404, "not-found");
      const [row] = await sql<{ data: unknown; created_at: Date }[]>`select data, created_at from venue_offers where id = ${id}`;
      if (!row) return fail(reply, 404, "not-found");
      reply.header("X-Robots-Tag", "noindex, nofollow");
      return { id, ...(isRecord(row.data) ? row.data : {}), createdAt: row.created_at.getTime() };
    });

    api.get<{ Params: { id: string; sha: string } }>("/api/offers/:id/photos/:sha", async (request, reply) => {
      const { id, sha } = request.params;
      if (!/^[A-Za-z0-9_-]{16,32}$/.test(id) || !SHA.test(sha) || !venuesDir) return fail(reply, 404, "not-found");
      const rows = await sql`
        select 1 from venue_offers o, jsonb_array_elements(o.data->'items') i, jsonb_array_elements(i->'photos') p
        where o.id = ${id} and p #>> '{}' = ${sha} limit 1`;
      if (rows.length === 0) return fail(reply, 404, "not-found");
      return sendFile(request, reply, sha);
    });

    async function sendFile(request: FastifyRequest, reply: FastifyReply, sha: string, mime?: string) {
      if (!venuesDir) return fail(reply, 404, "not-found");
      let bytes: Buffer;
      try {
        bytes = await readFile(join(venuesDir, sha));
      } catch {
        return fail(reply, 404, "not-found");
      }
      const etag = `"${sha}"`;
      reply.header("Cache-Control", "private, max-age=31536000, immutable").header("ETag", etag);
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      return reply.type(mime ?? venueFileMime(bytes) ?? "application/octet-stream").send(bytes);
    }

    // ---------------------------------------------------------------- кабинет

    const venueSelect = () => sql`
      select v.id, v.data, v.status, v.rating, v.notes, v.source, v.host_id, u.name as host_name, v.files, v.created_at, v.updated_at
      from venues v left join users u on u.id = v.host_id`;

    api.get("/api/venues", async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const rows = await sql<VenueRow[]>`${venueSelect()} order by v.created_at desc`;
      return rows.map(venueOut);
    });

    api.get<{ Params: { id: string } }>("/api/venues/:id", async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const [row] = await sql<VenueRow[]>`${venueSelect()} where v.id = ${request.params.id}`;
      if (!row) return fail(reply, 404, "not-found");
      return venueOut(row);
    });

    // Площадку заводит владелец сам (позвонил, нашёл на сайте): нужно только название.
    api.post("/api/venues", { bodyLimit: FORM_BODY_LIMIT }, async (request, reply) => {
      const user = await requireManager(request, reply);
      if (!user) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const id = typeof body.id === "string" && ID.test(body.id) ? body.id : null;
      if (!id) return fail(reply, 400, "invalid-argument");
      const data = parseVenue(body.data);
      const missing = venueMissing(data, 0, true);
      if (missing.length > 0) return fail(reply, 400, "invalid-argument", { missing });
      await sql`
        insert into venues (id, data, status, source, host_id)
        values (${id}, ${sql.json(JSON.parse(JSON.stringify(data)))}, 'checked', 'manual', ${user.id})
        on conflict (id) do nothing`;
      const [row] = await sql<VenueRow[]>`${venueSelect()} where v.id = ${id}`;
      log(request, "venue-add", "ok");
      return row ? venueOut(row) : fail(reply, 404, "not-found");
    });

    api.patch<{ Params: { id: string } }>("/api/venues/:id", { bodyLimit: FORM_BODY_LIMIT }, async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const id = request.params.id;
      const [current] = await sql<{ id: string }[]>`select id from venues where id = ${id}`;
      if (!current) return fail(reply, 404, "not-found");
      if (body.status !== undefined && !isVenueStatus(body.status)) return fail(reply, 400, "invalid-argument");
      const rating = body.rating === undefined ? undefined : body.rating === null ? null : Number(body.rating);
      if (rating !== undefined && rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return fail(reply, 400, "invalid-argument");
      if (body.data !== undefined) {
        const data = parseVenue(body.data);
        if (!data.name) return fail(reply, 400, "invalid-argument", { missing: ["название"] });
        await sql`update venues set data = ${sql.json(JSON.parse(JSON.stringify(data)))}, updated_at = now() where id = ${id}`;
      }
      if (body.status !== undefined) await sql`update venues set status = ${String(body.status)}, updated_at = now() where id = ${id}`;
      if (rating !== undefined) await sql`update venues set rating = ${rating}, updated_at = now() where id = ${id}`;
      if (body.notes !== undefined) await sql`update venues set notes = ${cleanText(body.notes, TEXT_LIMITS.notes, true)}, updated_at = now() where id = ${id}`;
      const [row] = await sql<VenueRow[]>`${venueSelect()} where v.id = ${id}`;
      log(request, "venue-edit", "ok");
      return row ? venueOut(row) : fail(reply, 404, "not-found");
    });

    api.delete<{ Params: { id: string } }>("/api/venues/:id", { bodyLimit: 1024 }, async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      // Файлы уберёт ночная уборка (если на них не ссылается отправленное предложение).
      await sql`delete from venues where id = ${request.params.id}`;
      log(request, "venue-delete", "ok");
      return { ok: true };
    });

    api.put<{ Params: { id: string; kind: string } }>(
      "/api/venues/:id/files/:kind",
      {
        bodyLimit: FILE_BODY_LIMIT,
        onRequest: async (request, reply) => {
          if (!(await requireManager(request, reply))) return reply;
          if (!takeUploadSlot(request, reply)) return reply.code(503).header("Retry-After", "2").send({ error: "unavailable" });
        },
      },
      async (request, reply) => {
        const { id, kind } = request.params;
        if (!venuesDir) return fail(reply, 501, "unimplemented");
        if (!isKind(kind)) return fail(reply, 404, "not-found");
        const checked = checkFile(kind, request.body);
        if ("error" in checked) return fail(reply, checked.status, checked.error);
        if ((await freeBytes(options.mediaDir ?? venuesDir)) < limits.minFreeBytes) return fail(reply, 507, "resource-exhausted");
        const bytes = request.body as Buffer;
        const sha = await storeFile(bytes);
        const result = await attach(id, kind, { sha, kind, mime: checked.mime, size: bytes.length, name: fileName(request.headers["x-file-name"]) });
        if (result === "missing") return fail(reply, 404, "not-found");
        if (result === "full") return fail(reply, 409, "already-exists");
        return { ok: true, sha };
      },
    );

    api.delete<{ Params: { id: string; sha: string } }>("/api/venues/:id/files/:sha", { bodyLimit: 1024 }, async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const { id, sha } = request.params;
      if (!SHA.test(sha)) return fail(reply, 404, "not-found");
      await sql`
        update venues set files = coalesce((select jsonb_agg(f) from jsonb_array_elements(files) f where f->>'sha' <> ${sha}), '[]'::jsonb), updated_at = now()
        where id = ${id}`;
      return { ok: true };
    });

    api.get<{ Params: { id: string; sha: string } }>("/api/venues/:id/files/:sha", async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const { id, sha } = request.params;
      if (!SHA.test(sha)) return fail(reply, 404, "not-found");
      const [row] = await sql<{ files: unknown }[]>`select files from venues where id = ${id}`;
      const file = filesOf(row?.files).find((f) => f.sha === sha);
      if (!file) return fail(reply, 404, "not-found");
      return sendFile(request, reply, sha, file.mime);
    });

    const requestSelect = () => sql`
      select r.id, r.number, r.data, r.status, r.notes, r.host_id, u.name as host_name, r.created_at, r.updated_at,
             (select count(*) from venue_offers o where o.request_id = r.id) as offers
      from venue_requests r left join users u on u.id = r.host_id`;

    api.get("/api/venue-requests", async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const rows = await sql<RequestRow[]>`${requestSelect()} order by r.created_at desc`;
      return rows.map(requestOut);
    });

    api.get<{ Params: { id: string } }>("/api/venue-requests/:id", async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const [row] = await sql<RequestRow[]>`${requestSelect()} where r.id = ${request.params.id}`;
      if (!row) return fail(reply, 404, "not-found");
      return requestOut(row);
    });

    api.patch<{ Params: { id: string } }>("/api/venue-requests/:id", { bodyLimit: FORM_BODY_LIMIT }, async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const id = request.params.id;
      const [current] = await sql<{ id: string }[]>`select id from venue_requests where id = ${id}`;
      if (!current) return fail(reply, 404, "not-found");
      if (body.status !== undefined && !isRequestStatus(body.status)) return fail(reply, 400, "invalid-argument");
      if (body.status !== undefined) await sql`update venue_requests set status = ${String(body.status)}, updated_at = now() where id = ${id}`;
      if (body.notes !== undefined) await sql`update venue_requests set notes = ${cleanText(body.notes, TEXT_LIMITS.notes, true)}, updated_at = now() where id = ${id}`;
      // Владелец уточнил запрос по телефону (гости, бюджет, пожелания).
      if (body.data !== undefined) {
        const data = parseRequest(body.data);
        if (requestMissing(data).length > 0) return fail(reply, 400, "invalid-argument", { missing: requestMissing(data) });
        await sql`update venue_requests set data = ${sql.json(JSON.parse(JSON.stringify(data)))}, updated_at = now() where id = ${id}`;
      }
      const [row] = await sql<RequestRow[]>`${requestSelect()} where r.id = ${id}`;
      log(request, "request-edit", "ok");
      return row ? requestOut(row) : fail(reply, 404, "not-found");
    });

    api.delete<{ Params: { id: string } }>("/api/venue-requests/:id", { bodyLimit: 1024 }, async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      // Отправленные ссылки продолжают открываться: предложение — отдельный снимок.
      await sql`delete from venue_requests where id = ${request.params.id}`;
      log(request, "request-delete", "ok");
      return { ok: true };
    });

    // Предложение клиенту: сервер сам берёт площадки из базы и собирает снимок без контактов.
    api.post("/api/venue-offers", { bodyLimit: 8 * 1024 }, async (request, reply) => {
      const user = await requireManager(request, reply);
      if (!user) return reply;
      const body = isRecord(request.body) ? request.body : {};
      const requestId = typeof body.requestId === "string" && ID.test(body.requestId) ? body.requestId : null;
      const venueIds = Array.isArray(body.venueIds) ? [...new Set(body.venueIds.filter((v): v is string => typeof v === "string" && ID.test(v)))] : [];
      if (venueIds.length === 0 || venueIds.length > MAX_OFFER_VENUES) return fail(reply, 400, "invalid-argument");
      const [req] = requestId ? await sql<{ id: string; data: unknown; status: string }[]>`select id, data, status from venue_requests where id = ${requestId}` : [];
      if (requestId && !req) return fail(reply, 404, "not-found");
      const r = parseRequest(req?.data);
      const rows = await sql<{ id: string; data: unknown; files: unknown }[]>`select id, data, files from venues where id in ${sql(venueIds)}`;
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items = venueIds.flatMap((venueId) => {
        const row = byId.get(venueId);
        if (!row) return [];
        const data = parseVenue(row.data);
        const photos = filesOf(row.files).filter((f) => f.kind === "photo").map((f) => f.sha);
        return [offerItem(venueId, data, req ? matchVenue(data, r) : null, photos)];
      });
      if (items.length === 0) return fail(reply, 404, "not-found");
      const offer: OfferData = {
        title: req ? requestTitle(r) : "Подборка площадок",
        comment: cleanText(body.comment, TEXT_LIMITS.comment, true),
        items,
      };
      const id = newOfferId();
      await sql`insert into venue_offers (id, request_id, data, created_by) values (${id}, ${req?.id ?? null}, ${sql.json(JSON.parse(JSON.stringify(offer)))}, ${user.id})`;
      if (req && req.status === "new") await sql`update venue_requests set status = 'sent', updated_at = now() where id = ${req.id}`;
      log(request, "offer", "ok");
      return { id, ...offer, createdAt: now() };
    });

    api.get<{ Querystring: { request?: string } }>("/api/venue-offers", async (request, reply) => {
      if (!(await requireManager(request, reply))) return reply;
      const requestId = request.query.request ?? "";
      if (!ID.test(requestId)) return fail(reply, 400, "invalid-argument");
      const rows = await sql<{ id: string; data: unknown; created_at: Date }[]>`
        select id, data, created_at from venue_offers where request_id = ${requestId} order by created_at desc`;
      return rows.map((row) => {
        const data = isRecord(row.data) ? row.data : {};
        const items = Array.isArray(data.items) ? data.items : [];
        return {
          id: row.id,
          title: typeof data.title === "string" ? data.title : "",
          venues: items.map((i) => (isRecord(i) && typeof i.name === "string" ? i.name : "")).filter(Boolean),
          createdAt: row.created_at.getTime(),
        };
      });
    });

    // Доступ ведущего к базе площадок — только владелец.
    api.post<{ Params: { id: string } }>("/api/users/:id/venue-access", { bodyLimit: 1024 }, async (request, reply) => {
      const user = await sessionUser(sql, request, reply);
      if (!user) return fail(reply, 401, "unauthenticated");
      const body = isRecord(request.body) ? request.body : {};
      if (typeof body.access !== "boolean") return fail(reply, 400, "invalid-argument");
      const target = request.params.id;
      if (!permissions.canGrantVenueAccess(actorOf(user), { uid: target })) return fail(reply, 403, "permission-denied");
      const rows = await sql`update users set venue_access = ${body.access}, updated_at = now() where id = ${target} returning id`;
      if (rows.length === 0) return fail(reply, 404, "not-found");
      log(request, "access", body.access ? "on" : "off");
      return { ok: true };
    });
  });
}
