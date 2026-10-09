import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import { checkLead, clean, formatLead, type LeadOptions, type TelegramTarget } from "./lead";

const HOST = "joy-rest.ru";
const TELEGRAM: TelegramTarget = { token: "test-token", chatId: "-100123" };

const VALID = {
  question: { type: "question", consent: true, website: "", contact: "@anna", text: "Сколько стоит квиз?" },
  review: { type: "review", consent: true, website: "", name: "Анна", rating: 5, text: "Всё было чудесно" },
  lead: {
    type: "lead",
    consent: true,
    terms: true,
    deposit: true,
    website: "",
    name: "Анна",
    phone: "+7 (900) 123-45-67",
    eventType: "Корпоратив",
    guests: "25",
    contactMethod: "Telegram",
    contactLink: "@anna",
    message: "Пятница, вечер",
  },
};

interface Setup {
  telegram?: TelegramTarget | null;
  send?: LeadOptions["send"];
  limits?: LeadOptions["limits"];
  now?: () => number;
  label?: string;
}

function setup(options: Setup = {}) {
  const sent: string[] = [];
  const send = options.send ?? vi.fn(async (_target: TelegramTarget, text: string) => void sent.push(text));
  const app = buildApp({
    version: "abc",
    publicDir: null,
    checkDatabase: async () => true,
    site: { dir: "/nonexistent", enabled: true, stubDir: null, hosts: [HOST, "test.joy-rest.ru"], indexing: false },
    lead: {
      telegram: options.telegram === undefined ? TELEGRAM : options.telegram,
      send,
      limits: options.limits,
      now: options.now,
      label: options.label,
    },
  });
  const post = (body: unknown, extra: { ip?: string; headers?: Record<string, string>; host?: string } = {}) =>
    app.inject({
      method: "POST",
      url: "/api/lead",
      remoteAddress: extra.ip ?? "172.18.0.5",
      headers: {
        host: extra.host ?? HOST,
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
        ...extra.headers,
      },
      payload: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { app, post, sent, send };
}

describe("/api/lead: поля", () => {
  it("три типа заявок уходят в Telegram простым текстом", async () => {
    const { app, post, sent } = setup();
    for (const body of Object.values(VALID)) {
      const res = await post(body);
      expect(res.statusCode, body.type).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
    expect(sent).toHaveLength(3);
    expect(sent[0]).toContain("Вопрос: Сколько стоит квиз?");
    expect(sent[1]).toContain("Оценка: ★★★★★");
    expect(sent[2]).toContain("Телефон: +7 (900) 123-45-67");
    expect(sent[2]).toContain("Связь: Telegram — @anna");
    expect(sent[2]).toContain("Условия работы и залога: приняты");
    await app.close();
  });

  it("без обязательных полей, согласия и с лишними полями — 400 с понятным текстом", async () => {
    const { app, post, sent } = setup();
    const cases: [unknown, string][] = [
      [{ ...VALID.question, text: "   " }, "Вопрос"],
      [{ ...VALID.lead, name: "" }, "Имя"],
      [{ ...VALID.lead, phone: "нет" }, "телефон"],
      [{ ...VALID.lead, guests: "много" }, "гостей"],
      [{ ...VALID.review, rating: 7 }, "оценку"],
      [{ ...VALID.review, rating: "5" }, "оценку"],
      [{ ...VALID.lead, consent: false }, "согласие"],
      [{ ...VALID.lead, terms: false }, "условия работы"],
      [{ ...VALID.lead, terms: undefined }, "условия работы"],
      [{ ...VALID.lead, deposit: false }, "условия залога"],
      [{ ...VALID.lead, extra: "x" }, "устарела"],
      [{ ...VALID.lead, type: "spam" }, "Неизвестная"],
      [{ ...VALID.lead, name: { a: 1 } }, "Имя"],
      [[1, 2], "прочитать"],
    ];
    for (const [body, text] of cases) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().message).toContain(text);
    }
    expect(sent).toHaveLength(0);
    await app.close();
  });

  it("ограничение длины каждого поля", async () => {
    const { app, post } = setup();
    expect((await post({ ...VALID.lead, name: "А".repeat(61) })).json().message).toContain("не больше 60");
    expect((await post({ ...VALID.question, text: "а".repeat(2001) })).json().message).toContain("не больше 2000");
    expect((await post({ ...VALID.lead, contactLink: "x".repeat(121) })).statusCode).toBe(400);
    expect((await post({ ...VALID.question, text: "а".repeat(2000) })).statusCode).toBe(200);
    await app.close();
  });

  it("тело больше 8 КБ и не JSON — отказ без текста запроса в ответе", async () => {
    const { app, post, sent } = setup();
    const big = await post({ ...VALID.question, text: "а".repeat(9000) });
    expect(big.statusCode).toBe(413);
    expect(big.json().message).toContain("Слишком длинное");
    const broken = await post("секрет{не json");
    expect(broken.statusCode).toBe(400);
    expect(broken.body).not.toContain("секрет");
    const form = await post("a=1", { headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.statusCode).toBe(415);
    expect(sent).toHaveLength(0);
    await app.close();
  });

  it("управляющие символы убираются, переводы строк в тексте остаются", async () => {
    expect(clean("Ан\u0000на\u0007‮", "line")).toBe("Анна");
    expect(clean("строка 1\r\nстрока 2\u001B[31m", "text")).toBe("строка 1\nстрока 2[31m");
    expect(clean("имя\nфамилия", "line")).toBe("имя фамилия");
    const checked = checkLead({ ...VALID.question, text: "раз\n\n\n\n\nдва\u0008" });
    expect(checked.ok && checked.lead.type === "question" && checked.lead.fields.text).toBe("раз\n\nдва");
  });

  it("формат ведущего (hostLevel): необязательный, только три значения, строка в Telegram", async () => {
    const { app, post, sent } = setup();
    expect((await post({ ...VALID.lead, hostLevel: "new" })).statusCode).toBe(200);
    expect(sent.at(-1)).toContain("Ведущий: Новые лица (−25%)");
    expect((await post({ ...VALID.lead, hostLevel: "first" })).statusCode).toBe(200);
    expect(sent.at(-1)).toContain("Ведущий: Первый старт (−35%)");
    expect((await post({ ...VALID.lead, hostLevel: "standard" })).statusCode).toBe(200);
    expect(sent.at(-1)).toContain("Ведущий: опытный");
    // Без поля (старая форма) — заявка принимается, строки о ведущем нет.
    expect((await post(VALID.lead)).statusCode).toBe(200);
    expect(sent.at(-1)).not.toContain("Ведущий:");
    for (const bad of ["vip", "NEW", 1, true, { a: 1 }]) {
      const res = await post({ ...VALID.lead, hostLevel: bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json().message).toContain("Формат ведущего");
    }
    // Только у заявки: в вопросе и отзыве поле лишнее.
    expect((await post({ ...VALID.question, hostLevel: "new" })).statusCode).toBe(400);
    await app.close();
  });

  it("сообщение с меткой тестового окружения", () => {
    const checked = checkLead(VALID.question);
    if (!checked.ok) throw new Error("ожидалась верная заявка");
    expect(formatLead(checked.lead, "🧪 ТЕСТ").startsWith("🧪 ТЕСТ\n")).toBe(true);
  });

  it("заявка с чужого сайта (Origin) и с адреса платформы не принимается", async () => {
    const { app, post, sent } = setup();
    expect((await post(VALID.lead, { headers: { origin: "https://evil.example" } })).statusCode).toBe(403);
    expect((await post(VALID.lead, { headers: { origin: "https://joy-rest.ru" } })).statusCode).toBe(200);
    expect((await post(VALID.lead, { host: "games.joy-rest.ru" })).statusCode).toBe(404);
    expect(sent).toHaveLength(1);
    await app.close();
  });
});

describe("/api/lead: защита", () => {
  it("ловушка: бот получает 200, но в Telegram ничего не уходит", async () => {
    const { app, post, sent } = setup();
    const res = await post({ ...VALID.lead, website: "https://spam.example" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    await app.close();
  });

  it("не больше 5 заявок за 10 минут с одного адреса; другой адрес проходит; через 10 минут снова можно", async () => {
    let time = 1_000_000;
    const { app, post, sent } = setup({ now: () => time });
    for (let i = 0; i < 5; i++) expect((await post(VALID.lead)).statusCode).toBe(200);
    const sixth = await post(VALID.lead);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().message).toContain("10 минут");
    expect((await post(VALID.lead, { headers: { "x-forwarded-for": "198.51.100.7" } })).statusCode).toBe(200);
    time += 10 * 60_000 + 1;
    expect((await post(VALID.lead)).statusCode).toBe(200);
    expect(sent).toHaveLength(7);
    await app.close();
  });

  it("подделанный X-Forwarded-For не обходит лимит: заголовку верим только от прокси из внутренней сети", async () => {
    const { app, post } = setup();
    // Запрос пришёл не от Caddy (внешний адрес): каждый раз новый X-Forwarded-For.
    for (let i = 0; i < 5; i++) {
      const res = await post(VALID.lead, { ip: "203.0.113.99", headers: { "x-forwarded-for": `198.51.100.${i}` } });
      expect(res.statusCode).toBe(200);
    }
    const res = await post(VALID.lead, { ip: "203.0.113.99", headers: { "x-forwarded-for": "198.51.100.200" } });
    expect(res.statusCode).toBe(429);
    await app.close();
  });

  it("адрес гостя от Caddy берётся из X-Forwarded-For", async () => {
    const { app } = setup();
    app.get("/api/ip", { constraints: { host: HOST } }, async (request) => ({ ip: request.ip }));
    const fromCaddy = await app.inject({
      url: "/api/ip",
      remoteAddress: "172.18.0.2",
      headers: { host: HOST, "x-forwarded-for": "203.0.113.10" },
    });
    expect(fromCaddy.json().ip).toBe("203.0.113.10");
    const direct = await app.inject({
      url: "/api/ip",
      remoteAddress: "203.0.113.99",
      headers: { host: HOST, "x-forwarded-for": "1.2.3.4" },
    });
    expect(direct.json().ip).toBe("203.0.113.99");
    await app.close();
  });

  it("общий лимит: после 30 заявок в час — 429 и одно предупреждение в Telegram", async () => {
    let time = 5_000_000;
    const { app, post, sent } = setup({ now: () => time, limits: { global: 3 } });
    for (let i = 0; i < 3; i++) {
      expect((await post(VALID.question, { headers: { "x-forwarded-for": `198.51.100.${i}` } })).statusCode).toBe(200);
    }
    for (let i = 3; i < 6; i++) {
      const res = await post(VALID.question, { headers: { "x-forwarded-for": `198.51.100.${i}` } });
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe("busy");
    }
    await new Promise((r) => setTimeout(r, 0));
    const warnings = sent.filter((t) => t.includes("возможен спам") || t.includes("Возможен спам"));
    expect(warnings).toHaveLength(1);
    expect(sent).toHaveLength(4);
    time += 60 * 60_000 + 1;
    expect((await post(VALID.question, { headers: { "x-forwarded-for": "198.51.100.50" } })).statusCode).toBe(200);
    await app.close();
  });

  it("лимит общего потока по умолчанию — 30 в час", async () => {
    const { DEFAULT_LIMITS } = await import("./lead");
    expect(DEFAULT_LIMITS).toEqual({ perIp: 5, perIpWindowMs: 600_000, global: 30, globalWindowMs: 3_600_000 });
  });
});

describe("/api/lead: Telegram", () => {
  it("нет токена или чата — 503 с понятным текстом, сайт работает", async () => {
    const { app, post } = setup({ telegram: null });
    const res = await post(VALID.lead);
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toContain("t.me/JoyRest");
    const page = await app.inject({ url: "/robots.txt", headers: { host: HOST } });
    expect(page.statusCode).toBe(200);
    await app.close();
  });

  it("Telegram не ответил — 502, посетитель видит ошибку", async () => {
    const { app, post } = setup({
      send: async () => {
        throw new Error("telegram 400");
      },
    });
    const res = await post(VALID.lead);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: "telegram" });
    await app.close();
  });

  it("запрос в Telegram — sendMessage без parse_mode", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { sendTelegram } = await import("./lead");
      await sendTelegram(TELEGRAM, "Имя: <b>Анна</b> *жирный*");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({ chat_id: "-100123", text: "Имя: <b>Анна</b> *жирный*", link_preview_options: { is_disabled: true } });
      expect(body).not.toHaveProperty("parse_mode");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("содержимое заявки не попадает в журнал", async () => {
    const lines: string[] = [];
    const app = buildApp({
      version: "abc",
      publicDir: null,
      checkDatabase: async () => true,
      site: { dir: "/nonexistent", enabled: true, stubDir: null, hosts: [HOST], indexing: false },
      lead: { telegram: TELEGRAM, send: async () => {} },
      logStream: { write: (line) => void lines.push(line) },
    });
    const post = (payload: string) =>
      app.inject({ method: "POST", url: "/api/lead", headers: { host: HOST, "content-type": "application/json" }, payload });
    await post(JSON.stringify(VALID.lead));
    await post(JSON.stringify({ ...VALID.lead, name: "" }));
    await post("Анна{сломано");
    await app.close();
    const log = lines.join("");
    expect(lines).toHaveLength(3);
    expect(log).toContain('"lead":"lead"');
    expect(log).toContain('"status":400');
    expect(log).not.toContain("Анна");
    expect(log).not.toContain("123-45-67");
    expect(log).not.toContain("Пятница");
  });
});
