import assert from "node:assert/strict";
import { test } from "node:test";
import { startHardwareCompanion } from "./main.mjs";

async function fixture() {
  const companion = await startHardwareCompanion({ port: 0 });
  const base = `http://127.0.0.1:${companion.port}`;
  return { companion, base };
}

async function pair(base, code) {
  const res = await fetch(`${base}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

test("health открыт, устройства и события только после одноразового сопряжения", async () => {
  const { companion, base } = await fixture();
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).adapter, "virtual");
    assert.equal((await fetch(`${base}/api/devices`)).status, 401);
    assert.equal((await fetch(`${base}/pair`, { method: "POST", body: JSON.stringify({ code: "000000" }) })).status, 403);
    const token = await pair(base, companion.pairingCode);
    assert.equal(companion.pairingCode, null);
    assert.equal((await fetch(`${base}/pair`, { method: "POST", body: JSON.stringify({ code: "000000" }) })).status, 403);
    const devices = await fetch(`${base}/api/devices`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(devices.status, 200);
    assert.equal((await devices.json()).devices.length, 2);
  } finally {
    await companion.close();
  }
});

test("HTTPS-origin получает CORS и Private Network Access preflight, чужой origin отклонён", async () => {
  const { companion, base } = await fixture();
  try {
    const preflight = await fetch(`${base}/api/events`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://test.games.joy-rest.ru",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://test.games.joy-rest.ru");
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    const denied = await fetch(`${base}/health`, { headers: { Origin: "https://example.com" } });
    assert.equal(denied.status, 403);
  } finally {
    await companion.close();
  }
});

test("виртуальное нажатие приходит в SSE с уникальным eventId", async () => {
  const { companion, base } = await fixture();
  const controller = new AbortController();
  try {
    const token = await pair(base, companion.pairingCode);
    const stream = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type"), /text\/event-stream/);
    const reader = stream.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /event: ready/);
    const press = await fetch(`${base}/api/virtual/press`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-JoyRest-Hardware": "1" },
      body: JSON.stringify({ source: "usb", hardwareId: "usb-demo-1" }),
    });
    assert.equal(press.status, 200);
    const event = await press.json();
    assert.equal(event.type, "press");
    assert.match(event.eventId, /^event-/);
    const next = await reader.read();
    const text = new TextDecoder().decode(next.value);
    assert.match(text, /event: press/);
    assert.match(text, /usb-demo-1/);
  } finally {
    controller.abort();
    await companion.close();
  }
});


test("одновременные нажатия двух устройств доставляются без потерь и с разными eventId", async () => {
  const { companion, base } = await fixture();
  const controller = new AbortController();
  let reader;
  try {
    const token = await pair(base, companion.pairingCode);
    const stream = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    reader = stream.body.getReader();
    await reader.read();
    const [bt, usb] = await Promise.all([
      fetch(`${base}/api/virtual/press`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-JoyRest-Hardware": "1" },
        body: JSON.stringify({ source: "bluetooth", hardwareId: "bt-demo-1" }),
      }),
      fetch(`${base}/api/virtual/press`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-JoyRest-Hardware": "1" },
        body: JSON.stringify({ source: "usb", hardwareId: "usb-demo-1" }),
      }),
    ]);
    assert.equal(bt.status, 200);
    assert.equal(usb.status, 200);
    const first = await bt.json();
    const second = await usb.json();
    assert.notEqual(first.eventId, second.eventId);
    const delivered = [new TextDecoder().decode((await reader.read()).value), new TextDecoder().decode((await reader.read()).value)].join("\n");
    assert.match(delivered, /bt-demo-1/);
    assert.match(delivered, /usb-demo-1/);
  } finally {
    controller.abort();
    if (reader) await reader.cancel().catch(() => undefined);
    await companion.close();
  }
});


test("Flic Hub: устройство появляется по адресу, buttonDown идёт в SSE, повтор отклоняется", async () => {
  const { companion, base } = await fixture();
  const controller = new AbortController();
  try {
    const address = "AA:BB:CC:DD:EE:FF";
    const send = (type, sequence = "0") => fetch(`${base}/api/adapters/flic/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-JoyRest-Adapter-Key": companion.adapterKey },
      body: JSON.stringify({ type, bdaddr: address, sequence }),
    });
    assert.equal((await fetch(`${base}/api/adapters/flic/events`, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await send("added")).status, 200);
    const token = await pair(base, companion.pairingCode);
    const devices = await (await fetch(`${base}/api/devices`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const flic = devices.devices.find((item) => item.hardwareId === "flic-AABBCCDDEEFF");
    assert.equal(flic.alias, "Flic EEFF");
    assert.equal(flic.connected, true);

    const stream = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    const reader = stream.body.getReader();
    await reader.read();
    const down = await send("down", "press-1");
    assert.equal(down.status, 200);
    const event = await down.json();
    assert.equal(event.hardwareId, "flic-AABBCCDDEEFF");
    assert.equal(event.eventId, "flic-AABBCCDDEEFF-press-1");
    const delivered = new TextDecoder().decode((await reader.read()).value);
    assert.match(delivered, /flic-AABBCCDDEEFF-press-1/);
    assert.deepEqual((await (await send("down", "press-1")).json()).result, "duplicate");
    await reader.cancel();
    assert.equal((await send("disconnected")).status, 200);
    const after = await (await fetch(`${base}/api/devices`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(after.devices.find((item) => item.hardwareId === "flic-AABBCCDDEEFF").connected, false);
  } finally {
    controller.abort();
    await companion.close();
  }
});
