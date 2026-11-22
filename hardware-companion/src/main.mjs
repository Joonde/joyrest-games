import http from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { startUsbSerialAdapter } from "./usb-serial.mjs";

const JSON_LIMIT = 4096;
const SESSION_MS = 12 * 60 * 60 * 1000;
const PAIR_ATTEMPT_MS = 60_000;
const PAIR_ATTEMPTS_MAX = 5;
const ALLOWED_ORIGINS = new Set(["https://games.joy-rest.ru", "https://test.games.joy-rest.ru"]);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/;

function json(res, status, value, origin) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...cors(origin),
  });
  res.end(body);
}

function cors(origin) {
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "false",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-JoyRest-Hardware",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : {};
}

function allowedOrigin(value) {
  const origin = Array.isArray(value) ? value[0] : value;
  if (!origin) return "";
  return ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin) ? origin : null;
}

async function bodyOf(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > JSON_LIMIT) throw new Error("body-too-large");
  }
  if (!text) return {};
  const data = JSON.parse(text);
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

function tokenOf(req) {
  const value = req.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export async function startHardwareCompanion({ port = 43127, host = "127.0.0.1", now = Date.now, adapterKey = randomBytes(16).toString("hex") } = {}) {
  let pairingCode = String(Number(randomBytes(4).readUInt32BE(0) % 1_000_000)).padStart(6, "0");
  const sessions = new Map();
  const pairAttempts = new Map();
  const listeners = new Set();
  const pings = new Map();
  const adapterEvents = new Set();
  const devices = [
    { source: "bluetooth", hardwareId: "bt-demo-1", alias: "BT кнопка 1", connected: true, battery: 100, features: ["press"] },
    { source: "usb", hardwareId: "usb-demo-1", alias: "USB №1", connected: true, battery: null, features: ["press"] },
  ];
  const emitPress = (device, eventId) => {
    const event = { type: "press", source: device.source, hardwareId: device.hardwareId, eventId, localPressedAt: now() };
    for (const listener of listeners) {
      if (!listener.destroyed && !listener.writableEnded) listener.write(`event: press\ndata: ${JSON.stringify(event)}\n\n`);
    }
    return event;
  };
  const server = http.createServer(async (req, res) => {
    const origin = allowedOrigin(req.headers.origin);
    if (origin === null) {
      json(res, 403, { error: "origin-denied" });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors(origin),
        ...(origin ? { "Access-Control-Allow-Private-Network": "true" } : {}),
      });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, version: 1, adapter: "virtual" }, origin);
      return;
    }

    if (req.method === "POST" && url.pathname === "/pair") {
      const ip = req.socket.remoteAddress ?? "local";
      const attempt = pairAttempts.get(ip) ?? { since: now(), count: 0 };
      if (now() - attempt.since > PAIR_ATTEMPT_MS) {
        attempt.since = now();
        attempt.count = 0;
      }
      attempt.count += 1;
      pairAttempts.set(ip, attempt);
      if (attempt.count > PAIR_ATTEMPTS_MAX) {
        json(res, 429, { error: "pair-rate-limit" }, origin);
        return;
      }
      try {
        const body = await bodyOf(req);
        if (!pairingCode || body.code !== pairingCode) {
          json(res, 403, { error: "pair-code-invalid" }, origin);
          return;
        }
        const token = randomBytes(32).toString("base64url");
        sessions.set(token, now() + SESSION_MS);
        pairingCode = null;
        json(res, 200, { token, expiresAt: now() + SESSION_MS }, origin);
      } catch {
        json(res, 400, { error: "invalid-json" }, origin);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/adapters/usb/events") {
      if (req.headers["x-joyrest-adapter-key"] !== adapterKey) {
        json(res, 401, { error: "adapter-key-invalid" }, origin);
        return;
      }
      try {
        const body = await bodyOf(req);
        const hardwareId = typeof body.hardwareId === "string" ? body.hardwareId : "";
        if (!/^usb-[A-Za-z0-9_-]{1,32}$/.test(hardwareId)) {
          json(res, 400, { error: "invalid-button-id" }, origin);
          return;
        }
        let device = devices.find((item) => item.hardwareId === hardwareId);
        if (!device && body.type !== "disconnected") {
          device = { source: "usb", hardwareId, alias: typeof body.alias === "string" && body.alias.trim() ? body.alias.trim().slice(0, 40) : hardwareId, connected: true, battery: null, features: ["press"] };
          devices.push(device);
        }
        if (body.type === "disconnected") {
          if (device) device.connected = false;
          json(res, 200, { ok: true }, origin);
          return;
        }
        if (device) device.connected = true;
        if (body.type !== "down" || !device) {
          json(res, 200, { ok: true, device }, origin);
          return;
        }
        const sequence = typeof body.sequence === "string" || typeof body.sequence === "number" ? String(body.sequence) : randomBytes(8).toString("hex");
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(sequence)) {
          json(res, 400, { error: "invalid-event-sequence" }, origin);
          return;
        }
        const eventId = `${hardwareId}-${sequence}`;
        if (adapterEvents.has(eventId)) {
          json(res, 200, { result: "duplicate" }, origin);
          return;
        }
        adapterEvents.add(eventId);
        const event = emitPress(device, eventId);
        json(res, 200, event, origin);
      } catch {
        json(res, 400, { error: "invalid-json" }, origin);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/adapters/flic/events") {
      if (req.headers["x-joyrest-adapter-key"] !== adapterKey) {
        json(res, 401, { error: "adapter-key-invalid" }, origin);
        return;
      }
      try {
        const body = await bodyOf(req);
        const address = typeof body.bdaddr === "string" ? body.bdaddr.replace(/[^A-Fa-f0-9]/g, "").toUpperCase() : "";
        if (!/^[A-F0-9]{12}$/.test(address)) {
          json(res, 400, { error: "invalid-button-address" }, origin);
          return;
        }
        const hardwareId = `flic-${address}`;
        let device = devices.find((item) => item.hardwareId === hardwareId);
        if (!device && body.type !== "disconnected") {
          device = { source: "bluetooth", hardwareId, alias: `Flic ${address.slice(-4)}`, connected: true, battery: null, features: ["press"] };
          devices.push(device);
        }
        if (body.type === "disconnected") {
          if (device) device.connected = false;
          json(res, 200, { ok: true }, origin);
          return;
        }
        if (device) device.connected = true;
        if (body.type !== "down" || !device) {
          json(res, 200, { ok: true, device }, origin);
          return;
        }
        const sequence = typeof body.sequence === "string" || typeof body.sequence === "number" ? String(body.sequence) : randomBytes(8).toString("hex");
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(sequence)) {
          json(res, 400, { error: "invalid-event-sequence" }, origin);
          return;
        }
        const eventId = `flic-${address}-${sequence}`;
        if (adapterEvents.has(eventId)) {
          json(res, 200, { result: "duplicate" }, origin);
          return;
        }
        adapterEvents.add(eventId);
        const event = emitPress(device, eventId);
        json(res, 200, event, origin);
      } catch {
        json(res, 400, { error: "invalid-json" }, origin);
      }
      return;
    }

    const token = tokenOf(req);
    const expires = sessions.get(token) ?? 0;
    if (expires <= now()) {
      sessions.delete(token);
      json(res, 401, { error: "unauthenticated" }, origin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/devices") {
      json(res, 200, { adapter: "virtual", devices }, origin);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
        ...cors(origin),
      });
      res.write(`retry: 2000\n\nevent: ready\ndata: {"adapter":"virtual"}\n\n`);
      listeners.add(res);
      const ping = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(`event: ping\ndata: {"at":${now()}}\n\n`);
      }, 15_000);
      pings.set(res, ping);
      req.on("close", () => {
        clearInterval(ping);
        pings.delete(res);
        listeners.delete(res);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/virtual/press") {
      if (req.headers["x-joyrest-hardware"] !== "1") {
        json(res, 400, { error: "hardware-header-required" }, origin);
        return;
      }
      try {
        const body = await bodyOf(req);
        const device = devices.find((item) => item.source === body.source && item.hardwareId === body.hardwareId);
        if (!device) {
          json(res, 404, { error: "device-not-found" }, origin);
          return;
        }
        const event = emitPress(device, `event-${randomBytes(10).toString("hex")}`);
        json(res, 200, event, origin);
      } catch {
        json(res, 400, { error: "invalid-json" }, origin);
      }
      return;
    }

    json(res, 404, { error: "not-found" }, origin);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    server,
    port: actualPort,
    adapterKey,
    get pairingCode() {
      return pairingCode;
    },
    async close() {
      for (const ping of pings.values()) clearInterval(ping);
      pings.clear();
      for (const listener of listeners) listener.destroy();
      sessions.clear();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    const host = process.env.JOYREST_HARDWARE_HOST ?? "127.0.0.1";
    const companion = await startHardwareCompanion({ host });
    const serialPath = process.env.JOYREST_SERIAL_PORT;
    const serialAdapter = serialPath
      ? await startUsbSerialAdapter({ portPath: serialPath, adapterUrl: `http://127.0.0.1:${companion.port}`, adapterKey: companion.adapterKey, onError: (error) => console.error("USB Serial:", error.message) })
      : null;
    console.log(`JoyRest Кнопки: http://${host}:${companion.port}`);
    console.log(`Код сопряжения: ${companion.pairingCode}`);
    console.log(`Адаптеры: virtual, Flic Hub${serialAdapter ? `, USB Serial ${serialPath}` : ""}`);
    if (host !== "127.0.0.1") console.log(`Ключ адаптера: ${companion.adapterKey}`);
    const stop = async () => {
      await serialAdapter?.close();
      await companion.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  })();
}
