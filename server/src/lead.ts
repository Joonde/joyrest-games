/**
 * Заявки с сайта агентства: POST /api/lead → сообщение в Telegram.
 *
 * Токен бота и чат — только в /srv/joyrest/secrets.env на сервере (CLAUDE.md, «Сайт агентства»).
 * Защита: размер тела, проверка полей, скрытое поле-ловушка, лимит по IP и общий лимит.
 * В журнал пишем только тип заявки, итог и код ответа — без имён, телефонов и текста.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify";

export interface TelegramTarget {
  token: string;
  chatId: string;
}

export interface LeadOptions {
  /** null — бот не настроен: /api/lead отвечает 503, сайт работает. */
  telegram: TelegramTarget | null;
  /** Пометка в начале сообщения (тестовое окружение: «🧪 ТЕСТ»). */
  label?: string;
  /** Адреса сайта: запросы с другим Origin отклоняются. */
  hosts: string[];
  /** Отправка в Telegram (подменяется в тестах). */
  send?: (target: TelegramTarget, text: string) => Promise<void>;
  /** Часы (подменяются в тестах). */
  now?: () => number;
  limits?: Partial<LeadLimits>;
}

export interface LeadLimits {
  perIp: number;
  perIpWindowMs: number;
  global: number;
  globalWindowMs: number;
}

export const DEFAULT_LIMITS: LeadLimits = {
  perIp: 5,
  perIpWindowMs: 10 * 60_000,
  global: 30,
  globalWindowMs: 60 * 60_000,
};

export const LEAD_BODY_LIMIT = 8 * 1024;
const TELEGRAM_TIMEOUT_MS = 10_000;
const FALLBACK = "Напишите нам в Telegram: t.me/JoyRest";

// ------------------------------------------------------------------ поля

type FieldKind = "line" | "text";

interface FieldRule {
  label: string;
  max: number;
  required: boolean;
  kind: FieldKind;
}

const QUESTION = {
  contact: { label: "Контакт", max: 100, required: false, kind: "line" },
  text: { label: "Вопрос", max: 2000, required: true, kind: "text" },
} satisfies Record<string, FieldRule>;

const REVIEW = {
  name: { label: "Имя", max: 60, required: true, kind: "line" },
  text: { label: "Отзыв", max: 2000, required: true, kind: "text" },
} satisfies Record<string, FieldRule>;

const LEAD = {
  name: { label: "Имя", max: 60, required: true, kind: "line" },
  phone: { label: "Телефон", max: 40, required: true, kind: "line" },
  eventType: { label: "Тип мероприятия", max: 80, required: false, kind: "line" },
  guests: { label: "Гостей", max: 10, required: false, kind: "line" },
  contactMethod: { label: "Связь", max: 40, required: false, kind: "line" },
  contactLink: { label: "Контакт для связи", max: 120, required: false, kind: "line" },
  message: { label: "Комментарий", max: 2000, required: false, kind: "text" },
} satisfies Record<string, FieldRule>;

const RULES = { question: QUESTION, review: REVIEW, lead: LEAD } as const;
export type LeadType = keyof typeof RULES;

/** Служебные поля формы: тип, согласие, оценка отзыва и ловушка. */
const SERVICE_FIELDS = new Set(["type", "consent", "rating", "website"]);

/** Формат ведущего в заявке: опытный или стартовые форматы с молодыми ведущими (скидка на работу ведущего). */
export const HOST_LEVELS = {
  standard: "опытный",
  new: "Новые лица (−25%)",
  first: "Первый старт (−35%)",
} as const;
export type HostLevel = keyof typeof HOST_LEVELS;

function isHostLevel(value: unknown): value is HostLevel {
  return value === "standard" || value === "new" || value === "first";
}

export type LeadData =
  | { type: "question"; fields: Record<keyof typeof QUESTION, string> }
  | { type: "review"; fields: Record<keyof typeof REVIEW, string>; rating: number }
  | { type: "lead"; fields: Record<keyof typeof LEAD, string>; hostLevel?: HostLevel };

export type Checked =
  | { ok: true; lead: LeadData; trap: boolean }
  | { ok: false; message: string };

// Управляющие символы (кроме перевода строки) и невидимые символы направления текста:
// ими можно испортить или подменить вид сообщения в Telegram.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

/** Убирает управляющие символы; в однострочных полях переводы строк становятся пробелами. */
export function clean(value: string, kind: FieldKind): string {
  let text = value.replace(/\r\n?/g, "\n").replace(CONTROL, "");
  if (kind === "line") text = text.replace(/\n+/g, " ");
  else text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeadType(value: unknown): value is LeadType {
  return value === "question" || value === "review" || value === "lead";
}

/** Проверка тела заявки. Сообщение об ошибке показывается посетителю как есть. */
export function checkLead(body: unknown): Checked {
  if (!isRecord(body)) return { ok: false, message: "Не удалось прочитать форму. Обновите страницу и попробуйте ещё раз." };
  const type = body.type;
  if (!isLeadType(type)) return { ok: false, message: "Неизвестная форма. Обновите страницу и попробуйте ещё раз." };
  const rules: Record<string, FieldRule> = RULES[type];

  for (const key of Object.keys(body)) {
    if (!SERVICE_FIELDS.has(key) && !(key in rules) && !(type === "lead" && key === "hostLevel")) {
      return { ok: false, message: "Форма устарела. Обновите страницу и попробуйте ещё раз." };
    }
  }
  if (body.consent !== true) return { ok: false, message: "Отметьте согласие на обработку персональных данных." };

  // Ловушка: поле скрыто от людей, его заполняют только боты.
  const website = body.website;
  if (website !== undefined && typeof website !== "string") return { ok: false, message: "Не удалось прочитать форму." };
  const trap = typeof website === "string" && website.trim() !== "";

  const fields: Record<string, string> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const raw = body[key];
    if (raw !== undefined && raw !== null && typeof raw !== "string" && typeof raw !== "number") {
      return { ok: false, message: `Поле «${rule.label}» заполнено неверно.` };
    }
    const value = clean(raw === undefined || raw === null ? "" : String(raw), rule.kind);
    if (rule.required && value === "") return { ok: false, message: `Заполните поле «${rule.label}».` };
    if (value.length > rule.max) {
      return { ok: false, message: `Поле «${rule.label}» слишком длинное: не больше ${rule.max} символов.` };
    }
    fields[key] = value;
  }

  if (type === "lead") {
    if ((fields.phone.match(/\d/g) ?? []).length < 5) return { ok: false, message: "Проверьте номер телефона." };
    if (fields.guests !== "" && !/^\d{1,5}$/.test(fields.guests)) {
      return { ok: false, message: "Число гостей — только цифры." };
    }
    // Необязательное: старая форма поле не присылает — строки о ведущем тогда нет.
    const hostLevel = body.hostLevel;
    if (hostLevel !== undefined && hostLevel !== "" && !isHostLevel(hostLevel)) {
      return { ok: false, message: "Формат ведущего выбран неверно. Обновите страницу и попробуйте ещё раз." };
    }
    return {
      ok: true,
      trap,
      lead: { type, fields: fields as Record<keyof typeof LEAD, string>, ...(isHostLevel(hostLevel) ? { hostLevel } : {}) },
    };
  }
  if (type === "review") {
    const rating = body.rating;
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false, message: "Поставьте оценку от 1 до 5." };
    }
    return { ok: true, trap, lead: { type, fields: fields as Record<keyof typeof REVIEW, string>, rating } };
  }
  return { ok: true, trap, lead: { type, fields: fields as Record<keyof typeof QUESTION, string> } };
}

/** Текст сообщения в Telegram — простой текст, без разметки (parse_mode не задаётся). */
export function formatLead(lead: LeadData, label?: string): string {
  const head = label ? `${label}\n` : "";
  const or = (value: string) => value || "—";
  switch (lead.type) {
    case "question":
      return `${head}💬 Вопрос с сайта JoyRest\n\nКонтакт: ${or(lead.fields.contact)}\nВопрос: ${lead.fields.text}`;
    case "review":
      return (
        `${head}⭐ Отзыв с сайта JoyRest\n\nИмя: ${lead.fields.name}\n` +
        `Оценка: ${"★".repeat(lead.rating)}${"☆".repeat(5 - lead.rating)}\nОтзыв: ${lead.fields.text}`
      );
    case "lead": {
      const f = lead.fields;
      const contact = f.contactMethod ? f.contactMethod + (f.contactLink ? ` — ${f.contactLink}` : "") : or(f.contactLink);
      return (
        `${head}📩 Заявка с сайта JoyRest\n\n` +
        `Имя: ${f.name}\nТелефон: ${f.phone}\nТип мероприятия: ${or(f.eventType)}\n` +
        (lead.hostLevel ? `Ведущий: ${HOST_LEVELS[lead.hostLevel]}\n` : "") +
        `Гостей: ${or(f.guests)}\nСвязь: ${contact}\nКомментарий: ${or(f.message)}`
      );
    }
  }
}

// ------------------------------------------------------------------ лимиты

/** Скользящее окно: не больше `limit` событий за `windowMs` на ключ. Только в памяти. */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Можно ли ещё (без учёта события). */
  allowed(key: string, now: number): boolean {
    const from = now - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > from).length < this.limit;
  }

  /** true — событие учтено; false — лимит исчерпан (событие не учитывается). */
  take(key: string, now: number): boolean {
    const from = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Память не растёт от потока разных адресов: старые записи выбрасываем.
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    const from = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > from)) this.hits.delete(key);
    }
    // Всё ещё много живых ключей — выбрасываем самые старые, а не всё сразу (иначе обнулились бы
    // и счётчики того, кто сейчас перебирает).
    let extra = this.hits.size - 4000;
    for (const key of this.hits.keys()) {
      if (extra-- <= 0) break;
      this.hits.delete(key);
    }
  }
}

// ------------------------------------------------------------------ Telegram

export async function sendTelegram(target: TelegramTarget, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${target.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: target.chatId, text, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}`);
}

// ------------------------------------------------------------------ маршрут

interface LeadReplyBody {
  ok: boolean;
  error?: string;
  message?: string;
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function registerLead(app: FastifyInstance, options: LeadOptions, routeOptions: RouteShorthandOptions = {}): void {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const perIp = new WindowLimiter(limits.perIp, limits.perIpWindowMs);
  const global = new WindowLimiter(limits.global, limits.globalWindowMs);
  const send = options.send ?? sendTelegram;
  const now = options.now ?? Date.now;
  const hosts = new Set(options.hosts.map((h) => h.toLowerCase()));
  let warnedUntil = 0;

  function answer(
    request: FastifyRequest,
    reply: FastifyReply,
    code: number,
    body: LeadReplyBody,
    type = "-",
    result = body.error ?? "ok",
  ): LeadReplyBody {
    request.log.info({ lead: type, result, status: code }, "lead");
    reply.code(code).header("Cache-Control", "no-store");
    return body;
  }

  app.post(
    "/api/lead",
    {
      ...routeOptions,
      bodyLimit: LEAD_BODY_LIMIT,
      // Ошибки разбора тела (не JSON, слишком большое) — без текста запроса в журнале:
      // сообщение JSON.parse содержит кусок присланного текста.
      errorHandler(error, request, reply) {
        const code = typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
        const message =
          code === 413
            ? "Слишком длинное сообщение. Сократите текст и попробуйте ещё раз."
            : code === 415 || code === 400
              ? "Не удалось прочитать форму. Обновите страницу и попробуйте ещё раз."
              : `Не получилось отправить. ${FALLBACK}`;
        reply.send(answer(request, reply, code, { ok: false, error: code === 500 ? "server" : "bad_request", message }));
      },
    },
    async (request, reply) => {
      const origin = request.headers.origin;
      if (origin !== undefined && !hosts.has(hostOf(origin) ?? "")) {
        return answer(request, reply, 403, { ok: false, error: "origin", message: "Форма работает только на сайте joy-rest.ru." });
      }
      if (!options.telegram) {
        return answer(request, reply, 503, {
          ok: false,
          error: "not_configured",
          message: `Форма временно не работает. ${FALLBACK}`,
        });
      }

      const checked = checkLead(request.body);
      if (!checked.ok) return answer(request, reply, 400, { ok: false, error: "invalid", message: checked.message });
      const type = checked.lead.type;
      const time = now();

      if (!perIp.take(request.ip, time)) {
        return answer(request, reply, 429, {
          ok: false,
          error: "rate_limit",
          message: `Слишком много сообщений подряд. Попробуйте через 10 минут. ${FALLBACK}`,
        }, type);
      }
      // Ловушка: боту отвечаем «успешно», чтобы он не подбирал обход, но ничего не отправляем.
      if (checked.trap) return answer(request, reply, 200, { ok: true }, type, "trap");

      if (!global.take("all", time)) {
        if (time >= warnedUntil) {
          warnedUntil = time + limits.globalWindowMs;
          const minutes = Math.round(limits.globalWindowMs / 60_000);
          const warning =
            `${options.label ? options.label + "\n" : ""}⚠️ Много заявок с сайта: больше ${limits.global} за ${minutes} мин. ` +
            `Возможен спам. Новые заявки отклоняются, пока поток не спадёт.`;
          send(options.telegram, warning).catch(() => request.log.warn("lead: предупреждение о спаме не отправилось"));
        }
        return answer(request, reply, 429, {
          ok: false,
          error: "busy",
          message: `Сейчас форма перегружена. ${FALLBACK}`,
        }, type);
      }

      try {
        await send(options.telegram, formatLead(checked.lead, options.label));
      } catch (error) {
        // Только код ответа Telegram или вид ошибки сети — без адреса запроса (в нём токен).
        const reason = error instanceof Error && error.message.startsWith("telegram ") ? error.message : error instanceof Error ? error.name : "unknown";
        request.log.warn({ lead: type, reason }, "lead: telegram");
        return answer(request, reply, 502, {
          ok: false,
          error: "telegram",
          message: `Не получилось отправить. ${FALLBACK}`,
        }, type);
      }
      return answer(request, reply, 200, { ok: true }, type);
    },
  );
}
