/**
 * Публикации в Telegram-канал JoyRest (CLAUDE.md, «Telegram-канал»; решение владельца 21 октября 2026).
 *
 * - Бот JoyRest (тот же `LEAD_TELEGRAM_TOKEN`) — администратор канала с правом публикации. Ключ бота — только на сервере.
 * - Очередь постов приходит с релизом: `channel/queue.json` и ролики `channel/video/*.mp4` в образе (`CHANNEL_DIR`).
 *   При запуске сервер переносит очередь в `channel_posts` (ещё не вышедшие посты обновляются, вышедшие не трогаются),
 *   ролики копирует в `MEDIA_DIR/channel` — откат на прошлый релиз очередь не теряет.
 * - Раз в минуту: за 3 часа до поста владельцу приходит первая строка и команды; время пришло — пост с роликом уходит в
 *   канал (`sendVideo`), у поста с `pin` — закрепляется. Пост, время которого прошло больше 6 часов назад (сервер был
 *   выключен), не публикуется — «пропущен», владельцу сообщение.
 * - Команды владельца боту: /channel — что впереди, /pause — остановить публикации, /resume — продолжить, /skip_N — не
 *   публиковать пост N. Принимаются только из чата заявок владельца (`LEAD_TELEGRAM_CHAT_ID`) или от владельца агентства,
 *   подключившего Telegram в студии.
 * - Публикует только основная версия: `CHANNEL_POSTS=on` и `CHANNEL_CHAT` в compose (тестовая — off).
 * В журнал — только действие и итог, без текста постов.
 */
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Sql } from "postgres";

export const PREVIEW_BEFORE_MS = 3 * 3_600_000;
export const STALE_AFTER_MS = 6 * 3_600_000;
export const MAX_ATTEMPTS = 3;
const TICK_MS = 60_000;
const CAPTION_MAX = 1024;

export interface QueuedPost {
  id: string;
  /** Номер для команды /skip_N. */
  n: number;
  /** Время публикации, ISO с поясом (+03:00). */
  at: string;
  text: string;
  /** Имя файла ролика в channel/video (пусто — пост без ролика). */
  video: string;
  pin: boolean;
}

/** Очередь из channel/queue.json: только целые записи; ошибки — списком (их проверяет тест). */
export function parseQueue(raw: unknown): { posts: QueuedPost[]; errors: string[] } {
  const posts: QueuedPost[] = [];
  const errors: string[] = [];
  const list = raw && typeof raw === "object" && Array.isArray((raw as { posts?: unknown }).posts) ? (raw as { posts: unknown[] }).posts : [];
  const ids = new Set<string>();
  const ns = new Set<number>();
  list.forEach((item, i) => {
    const p = (item ?? {}) as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id : "";
    const n = typeof p.n === "number" ? p.n : NaN;
    const at = typeof p.at === "string" ? p.at : "";
    const text = typeof p.text === "string" ? p.text.trim() : "";
    const video = typeof p.video === "string" ? p.video : "";
    const where = `пост ${i + 1}`;
    if (!/^[a-z0-9-]{3,64}$/.test(id)) errors.push(`${where}: id — латиница, цифры и дефис`);
    else if (ids.has(id)) errors.push(`${where}: id ${id} повторяется`);
    if (!Number.isInteger(n) || n < 1 || n > 9999) errors.push(`${where}: n — целое от 1`);
    else if (ns.has(n)) errors.push(`${where}: номер ${n} повторяется`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\+|-)\d{2}:\d{2}$/.test(at) || Number.isNaN(Date.parse(at))) errors.push(`${where}: время — ISO с поясом, например 2026-10-21T19:00:00+03:00`);
    if (!text) errors.push(`${where}: пустой текст`);
    if (video && text.length > CAPTION_MAX) errors.push(`${where}: подпись к ролику длиннее ${CAPTION_MAX} знаков`);
    if (!video && text.length > 4096) errors.push(`${where}: текст длиннее 4096 знаков`);
    if (video && !/^[a-z0-9-]+\.mp4$/.test(video)) errors.push(`${where}: ролик — имя файла .mp4 из channel/video`);
    ids.add(id);
    ns.add(n);
    posts.push({ id, n, at, text, video, pin: p.pin === true });
  });
  return errors.length ? { posts: [], errors } : { posts, errors };
}

/** Первая строка поста — для предупреждения владельцу (без остального текста). */
export function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/** Время по Москве «21 окт, 19:00». */
export function moscowTime(ms: number): string {
  const d = new Date(ms + 3 * 3_600_000);
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${hh}:${mm}`;
}

export function previewText(n: number, atMs: number, text: string): string {
  return `📣 Канал JoyRest, ${moscowTime(atMs)} выйдет пост №${n}:
«${firstLine(text)}»

Не публиковать этот пост — /skip_${n}
Остановить все публикации — /pause`;
}

export interface ChannelLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface ChannelOptions {
  sql: Sql;
  token: string;
  /** Куда публиковать: @JoyRest или id канала. */
  chat: string;
  /** Чат владельца (заявки сайта): предупреждения и команды. */
  ownerChat: string | null;
  /** Папка очереди в образе (channel/), null — без новой очереди. */
  dir: string | null;
  /** Куда копировать ролики (MEDIA_DIR/channel). */
  mediaDir: string | null;
  log: ChannelLog;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Без таймера (проверки вызывают tick сами). */
  manual?: boolean;
}

export interface Channel {
  /** Очередь из папки релиза — в базу. Ответ — сколько постов принято. */
  importQueue(): Promise<number>;
  /** Предупреждения и публикации, время которых пришло. */
  tick(): Promise<void>;
  /** Команда владельца: ответ боту или null — команда не о канале. */
  command(chatId: number | string, text: string): Promise<string | null>;
  stop(): void;
}

interface Row {
  id: string;
  n: number;
  at: Date;
  text: string;
  video: string;
  pin: boolean;
  status: string;
  attempts: number;
  previewed: boolean;
}

const PAUSE_KEY = "channel:paused";

export function startChannel(options: ChannelOptions): Channel {
  const { sql, token, chat, log } = options;
  const f = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const base = `https://api.telegram.org/bot${token}`;
  const videoDir = options.mediaDir ? join(options.mediaDir, "channel") : options.dir ? join(options.dir, "video") : null;
  let busy = false;

  async function call(method: string, body: object | FormData, timeoutMs = 20_000): Promise<{ ok: boolean; status: number; result?: unknown; description?: string }> {
    const form = body instanceof FormData;
    const res = await f(`${base}/${method}`, {
      method: "POST",
      headers: form ? undefined : { "content-type": "application/json" },
      body: form ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
    return { ok: res.ok && data.ok === true, status: res.status, result: data.result, description: data.description };
  }

  async function tellOwner(text: string): Promise<void> {
    if (!options.ownerChat) return;
    try {
      await call("sendMessage", { chat_id: options.ownerChat, text, link_preview_options: { is_disabled: true } });
    } catch {
      log.warn({ channel: "owner" }, "channel: сообщение владельцу не ушло");
    }
  }

  async function paused(): Promise<boolean> {
    const [row] = await sql<{ value: string }[]>`select value from tg_state where key = ${PAUSE_KEY}`;
    return row?.value === "1";
  }

  async function setPaused(on: boolean): Promise<void> {
    await sql`insert into tg_state (key, value) values (${PAUSE_KEY}, ${on ? "1" : "0"}) on conflict (key) do update set value = excluded.value`;
  }

  async function importQueue(): Promise<number> {
    if (!options.dir) return 0;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(options.dir, "queue.json"), "utf8"));
    } catch {
      return 0;
    }
    const { posts, errors } = parseQueue(raw);
    if (errors.length) {
      log.warn({ channel: "queue", errors: errors.length }, "channel: очередь с ошибками не принята");
      return 0;
    }
    if (options.mediaDir) {
      const target = join(options.mediaDir, "channel");
      await mkdir(target, { recursive: true });
      for (const p of posts) {
        if (!p.video) continue;
        const to = join(target, basename(p.video));
        const has = await stat(to).then(() => true, () => false);
        if (!has) await copyFile(join(options.dir, "video", basename(p.video)), to).catch(() => log.warn({ channel: "copy" }, "channel: ролик не скопирован"));
      }
    }
    for (const p of posts) {
      await sql`insert into channel_posts (id, n, at, text, video, pin) values (${p.id}, ${p.n}, ${new Date(p.at)}, ${p.text}, ${p.video}, ${p.pin})
        on conflict (id) do update set n = excluded.n, at = excluded.at, text = excluded.text, video = excluded.video, pin = excluded.pin,
          previewed = case when channel_posts.at = excluded.at then channel_posts.previewed else false end, updated_at = now()
        where channel_posts.status = 'queued'`;
    }
    log.info({ channel: "queue", posts: posts.length }, "channel: очередь принята");
    return posts.length;
  }

  async function publish(p: Row): Promise<void> {
    // Забираем пост одним изменением: два тика (или два процесса) не опубликуют его дважды.
    const [claimed] = await sql`update channel_posts set status = 'sending', attempts = attempts + 1, updated_at = now()
      where id = ${p.id} and status = 'queued' returning id`;
    if (!claimed) return;
    try {
      let r: Awaited<ReturnType<typeof call>>;
      if (p.video) {
        if (!videoDir) throw new Error("нет папки роликов");
        const file = await readFile(join(videoDir, basename(p.video)));
        const form = new FormData();
        form.set("chat_id", chat);
        form.set("caption", p.text);
        form.set("supports_streaming", "true");
        form.set("width", "1080");
        form.set("height", "1920");
        form.set("video", new Blob([new Uint8Array(file)], { type: "video/mp4" }), basename(p.video));
        r = await call("sendVideo", form, 120_000);
      } else {
        r = await call("sendMessage", { chat_id: chat, text: p.text, link_preview_options: { is_disabled: true } });
      }
      if (!r.ok) throw new Error(`telegram ${r.status}`);
      const messageId = (r.result as { message_id?: number } | undefined)?.message_id ?? null;
      await sql`update channel_posts set status = 'sent', sent_at = now(), message_id = ${messageId}, error = '', updated_at = now() where id = ${p.id}`;
      log.info({ channel: "post", n: p.n, result: "sent" }, "channel");
      if (p.pin && messageId) {
        const pin = await call("pinChatMessage", { chat_id: chat, message_id: messageId, disable_notification: true }).catch(() => null);
        if (!pin?.ok) await tellOwner(`Пост №${p.n} вышел, но закрепить его не получилось — закрепите в канале вручную.`);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : "ошибка";
      const last = p.attempts + 1 >= MAX_ATTEMPTS;
      await sql`update channel_posts set status = ${last ? "failed" : "queued"}, error = ${reason}, updated_at = now() where id = ${p.id}`;
      log.warn({ channel: "post", n: p.n, result: last ? "failed" : "retry" }, "channel: пост не опубликован");
      if (last) await tellOwner(`⚠️ Пост №${p.n} не вышел в канал (${reason}). Проверьте, что бот — администратор канала с правом публикации. Опубликуйте его вручную или напишите Claude.`);
    }
  }

  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const t = now();
      const rows = await sql<Row[]>`select id, n, at, text, video, pin, status, attempts, previewed from channel_posts
        where status = 'queued' and at <= ${new Date(t + PREVIEW_BEFORE_MS)} order by at, n`;
      const stopped = await paused();
      for (const p of rows) {
        const at = p.at.getTime();
        if (at < t - STALE_AFTER_MS) {
          await sql`update channel_posts set status = 'missed', updated_at = now() where id = ${p.id} and status = 'queued'`;
          await tellOwner(`Пост №${p.n} (${moscowTime(at)}) не вышел вовремя — сервер был недоступен. Он пропущен; опубликуйте вручную, если нужен.`);
          continue;
        }
        if (at <= t) {
          if (!stopped) await publish(p);
          continue;
        }
        if (!p.previewed) {
          await sql`update channel_posts set previewed = true where id = ${p.id}`;
          await tellOwner(previewText(p.n, at, p.text) + (stopped ? "\n\nСейчас публикации на паузе — продолжить: /resume" : ""));
        }
      }
    } finally {
      busy = false;
    }
  }

  async function upcoming(): Promise<string> {
    const rows = await sql<Row[]>`select id, n, at, text, video, pin, status, attempts, previewed from channel_posts
      where status = 'queued' order by at, n limit 10`;
    const head = (await paused()) ? "⏸ Публикации на паузе — продолжить: /resume\n\n" : "";
    if (!rows.length) return `${head}В очереди канала пусто.`;
    return head + "Впереди в канале JoyRest:\n" + rows.map((p) => `№${p.n} · ${moscowTime(p.at.getTime())} · ${firstLine(p.text)}`).join("\n") + "\n\nНе публиковать — /skip_N, пауза — /pause";
  }

  /** Владелец: чат заявок сайта или владелец агентства, подключивший Telegram в студии. */
  async function isOwner(chatId: number | string): Promise<boolean> {
    if (options.ownerChat && String(chatId) === String(options.ownerChat)) return true;
    const [row] = await sql<{ role: string }[]>`select u.role from tg_links l join users u on u.id = l.user_id
      where l.chat_id = ${String(chatId)} and u.active`;
    return row?.role === "admin";
  }

  async function command(chatId: number | string, text: string): Promise<string | null> {
    const t = text.trim().replace(/@\w+$/, "");
    const skip = /^\/skip_(\d{1,4})$/.exec(t);
    if (!skip && !["/channel", "/pause", "/resume"].includes(t)) return null;
    if (!(await isOwner(chatId))) return "Эта команда — только для владельца JoyRest.";
    log.info({ channel: "command", command: skip ? "skip" : t }, "channel");
    if (t === "/channel") return upcoming();
    if (t === "/pause") {
      await setPaused(true);
      return "⏸ Публикации в канал остановлены. Продолжить — /resume";
    }
    if (t === "/resume") {
      await setPaused(false);
      return "▶️ Публикации в канал продолжаются. Что впереди — /channel";
    }
    const n = Number(skip?.[1]);
    const rows = await sql`update channel_posts set status = 'skipped', updated_at = now() where n = ${n} and status = 'queued' returning id`;
    return rows.length ? `Пост №${n} не будет опубликован.` : `Поста №${n} в очереди нет (уже вышел или отменён). Что впереди — /channel`;
  }

  const timer = options.manual
    ? null
    : setInterval(() => {
        void tick().catch(() => log.warn({ channel: "tick" }, "channel: проверка очереди не прошла"));
      }, TICK_MS);
  timer?.unref?.();
  if (!options.manual) {
    void importQueue()
      .then(() => tick())
      .catch(() => log.warn({ channel: "start" }, "channel: очередь не загрузилась"));
  }

  return {
    importQueue,
    tick,
    command,
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
