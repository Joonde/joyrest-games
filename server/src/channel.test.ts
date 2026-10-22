/**
 * Публикации в Telegram-канал: очередь из релиза → база, предупреждение владельцу за 3 часа, пост с роликом в канал в
 * назначенное время (один раз, даже при двух проверках подряд), закрепление, /skip_N, /pause и /resume только владельцу,
 * пропущенный из-за простоя пост не публикуется. Плюс разбор очереди и настоящая очередь репозитория (channel/queue.json).
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firstLine, parseQueue, previewText, startChannel, type Channel } from "./channel";
import { migrate } from "./migrate";

const ROOT = resolve(import.meta.dirname, "../..");

describe("очередь канала: разбор", () => {
  const good = { id: "w43-quiz", n: 1, at: "2026-10-21T19:00:00+03:00", text: "Квиз на праздник\nТекст", video: "joyrest-1.mp4", pin: true };

  it("целая очередь принимается", () => {
    const r = parseQueue({ posts: [good] });
    expect(r.errors).toEqual([]);
    expect(r.posts[0]).toMatchObject({ id: "w43-quiz", n: 1, pin: true });
  });

  it("ошибки — вся очередь не принимается", () => {
    expect(parseQueue({ posts: [good, { ...good, id: "w43-2" }] }).errors.join()).toMatch(/номер 1 повторяется/);
    expect(parseQueue({ posts: [{ ...good, at: "21.10.2026 19:00" }] }).errors.join()).toMatch(/ISO с поясом/);
    expect(parseQueue({ posts: [{ ...good, text: "а".repeat(1025) }] }).errors.join()).toMatch(/1024/);
    expect(parseQueue({ posts: [{ ...good, video: "../secrets.env" }] }).errors.join()).toMatch(/\.mp4/);
    expect(parseQueue({ posts: [{ ...good, id: "Пост" }] }).errors.join()).toMatch(/латиница/);
    expect(parseQueue(null).posts).toEqual([]);
  });

  it("предупреждение владельцу — только первая строка и команды", () => {
    const t = previewText(3, Date.parse("2026-10-23T16:00:00Z"), "Первая строка\nвторая со всем текстом");
    expect(t).toContain("23 окт, 19:00");
    expect(t).toContain("«Первая строка»");
    expect(t).not.toContain("вторая");
    expect(t).toContain("/skip_3");
    expect(firstLine("\n\n  Привет\nмир")).toBe("  Привет");
  });

  it("очередь репозитория: без ошибок, ролики на месте, подписи в лимите", () => {
    const file = join(ROOT, "channel/queue.json");
    if (!existsSync(file)) return;
    const { posts, errors } = parseQueue(JSON.parse(readFileSync(file, "utf8")));
    expect(errors).toEqual([]);
    for (const p of posts) {
      if (p.video) expect(existsSync(join(ROOT, "channel/video", p.video)), p.video).toBe(true);
      expect(p.text).not.toMatch(/комисси|маржа|наценк/i);
    }
  });
});

interface Call {
  method: string;
  chat: string;
  text: string;
  video: boolean;
}

function fakeTelegram() {
  const calls: Call[] = [];
  let fail = false;
  let id = 100;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = String(input).split("/").pop() ?? "";
    let chat = "";
    let text = "";
    let video = false;
    if (init?.body instanceof FormData) {
      chat = String(init.body.get("chat_id"));
      text = String(init.body.get("caption") ?? "");
      video = init.body.get("video") instanceof Blob;
    } else {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      chat = String(body.chat_id ?? "");
      text = String(body.text ?? "");
    }
    // Отказ — только для канала: владельцу сообщения доходят.
    if (fail && chat === "@JoyRest") return new Response(JSON.stringify({ ok: false, description: "Forbidden" }), { status: 403 });
    calls.push({ method, chat, text, video });
    id += 1;
    return new Response(JSON.stringify({ ok: true, result: method === "pinChatMessage" ? true : { message_id: id } }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls, setFail: (v: boolean) => (fail = v) };
}

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("канал: бот публикует сам", () => {
  const SCHEMA = "channel_test";
  const admin = postgres(url ?? "", { max: 1, onnotice: () => {} });
  const sql = postgres(url ?? "", { max: 3, onnotice: () => {}, connection: { search_path: SCHEMA } });
  const tg = fakeTelegram();
  const OWNER = "555";
  const AT = Date.parse("2026-10-21T16:00:00Z"); // 19:00 по Москве
  let clock = AT - 4 * 3_600_000;
  let channel: Channel;
  let dir = "";
  let media = "";

  const posts = (method: string) => tg.calls.filter((c) => c.method === method);

  beforeAll(async () => {
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`create schema ${SCHEMA}`);
    await migrate(sql, resolve(import.meta.dirname, "../migrations"));
    dir = await mkdtemp(join(tmpdir(), "channel-"));
    media = await mkdtemp(join(tmpdir(), "channel-media-"));
    await mkdir(join(dir, "video"));
    await writeFile(join(dir, "video", "clip-1.mp4"), Buffer.from("....ftypisom-ролик"));
    const queue = {
      posts: [
        { id: "w43-one", n: 1, at: "2026-10-21T19:00:00+03:00", text: "Квиз на праздник\nВторая строка", video: "clip-1.mp4", pin: true },
        { id: "w43-two", n: 2, at: "2026-10-22T19:00:00+03:00", text: "Ставка на знания\nТекст", video: "clip-1.mp4" },
        { id: "w43-old", n: 3, at: "2026-10-20T19:00:00+03:00", text: "Старый пост", video: "" },
      ],
    };
    await writeFile(join(dir, "queue.json"), JSON.stringify(queue));
    channel = startChannel({ sql, token: "t", chat: "@JoyRest", ownerChat: OWNER, dir, mediaDir: media, log: { info: () => undefined, warn: () => undefined }, fetchImpl: tg.fetchImpl, now: () => clock, manual: true });
    expect(await channel.importQueue()).toBe(3);
  });

  afterAll(async () => {
    channel.stop();
    await sql.end();
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it("ролики скопированы в медиа, за 4 часа — тишина, только пропущенный старый пост", async () => {
    expect(existsSync(join(media, "channel", "clip-1.mp4"))).toBe(true);
    await channel.tick();
    expect(posts("sendVideo")).toHaveLength(0);
    const owner = posts("sendMessage").filter((c) => c.chat === OWNER);
    expect(owner).toHaveLength(1);
    expect(owner[0]?.text).toMatch(/№3.*не вышел вовремя/s);
    const [old] = await sql`select status from channel_posts where id = 'w43-old'`;
    expect(old?.status).toBe("missed");
  });

  it("за 3 часа — предупреждение владельцу один раз", async () => {
    clock = AT - 2 * 3_600_000;
    await channel.tick();
    await channel.tick();
    const preview = posts("sendMessage").filter((c) => c.chat === OWNER && c.text.includes("выйдет пост №1"));
    expect(preview).toHaveLength(1);
    expect(preview[0]?.text).toContain("«Квиз на праздник»");
    expect(preview[0]?.text).not.toContain("Вторая строка");
  });

  it("чужой чат командами не управляет", async () => {
    expect(await channel.command(777, "/pause")).toMatch(/только для владельца/);
    expect(await channel.command(777, "/start")).toBeNull();
    expect(await channel.command(OWNER, "/channel")).toMatch(/№1 · 21 окт, 19:00 · Квиз на праздник/);
  });

  it("на паузе пост ждёт, после /resume — выходит в канал один раз и закрепляется", async () => {
    expect(await channel.command(OWNER, "/pause")).toMatch(/остановлены/);
    clock = AT + 60_000;
    await channel.tick();
    expect(posts("sendVideo")).toHaveLength(0);
    expect(await channel.command(OWNER, "/resume")).toMatch(/продолжаются/);
    await Promise.all([channel.tick(), channel.tick()]);
    await channel.tick();
    const sent = posts("sendVideo");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat: "@JoyRest", video: true });
    expect(sent[0]?.text).toBe("Квиз на праздник\nВторая строка");
    expect(posts("pinChatMessage")).toHaveLength(1);
    const [row] = await sql`select status, message_id from channel_posts where id = 'w43-one'`;
    expect(row?.status).toBe("sent");
  });

  it("новый релиз с той же очередью не трогает вышедший пост", async () => {
    await channel.importQueue();
    const [row] = await sql`select status from channel_posts where id = 'w43-one'`;
    expect(row?.status).toBe("sent");
  });

  it("/skip_N — пост не выходит", async () => {
    expect(await channel.command(OWNER, "/skip_2")).toMatch(/№2 не будет опубликован/);
    expect(await channel.command(OWNER, "/skip_2")).toMatch(/в очереди нет/);
    clock = Date.parse("2026-10-22T16:01:00Z");
    await channel.tick();
    expect(posts("sendVideo")).toHaveLength(1);
  });

  it("Telegram отказывает три раза — пост «не вышел», владельцу сообщение", async () => {
    await sql`insert into channel_posts (id, n, at, text, video) values ('w43-fail', 9, ${new Date(clock - 60_000)}, 'Пост без ролика', '')`;
    tg.setFail(true);
    await channel.tick();
    await channel.tick();
    await channel.tick();
    tg.setFail(false);
    const [row] = await sql`select status, attempts from channel_posts where id = 'w43-fail'`;
    expect(row).toMatchObject({ status: "failed", attempts: 3 });
    expect(posts("sendMessage").some((c) => c.chat === OWNER && /№9 не вышел/.test(c.text))).toBe(true);
  });
});
