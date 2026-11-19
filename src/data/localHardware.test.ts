import { afterEach, describe, expect, it, vi } from "vitest";
import { listLocalHardwareDevices, LOCAL_HARDWARE_URL, parseHardwareSseBlock, pairLocalHardware, pressLocalVirtual, streamLocalHardwareEvents } from "./localHardware";

afterEach(() => vi.unstubAllGlobals());

describe("клиент локальной программы JoyRest Кнопки", () => {
  it("сопряжение, устройства и виртуальное нажатие идут только на loopback", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "secret", expiresAt: 123 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ devices: [{ source: "usb", hardwareId: "usb-1", alias: "USB", connected: true, battery: null, features: ["press"] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: "press", source: "usb", hardwareId: "usb-1", eventId: "e1", localPressedAt: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await pairLocalHardware("123456")).toEqual({ token: "secret", expiresAt: 123 });
    expect((await listLocalHardwareDevices("secret"))[0]?.hardwareId).toBe("usb-1");
    expect((await pressLocalVirtual("secret", "usb", "usb-1")).eventId).toBe("e1");
    expect(fetchMock.mock.calls.every((call) => String(call[0]).startsWith(LOCAL_HARDWARE_URL))).toBe(true);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({ Authorization: "Bearer secret" });
  });

  it("SSE разбирается по границам сетевых пакетов; ping и битое событие пропускаются", async () => {
    const event = JSON.stringify({ type: "press", source: "bluetooth", hardwareId: "bt-1", eventId: "e2", localPressedAt: 2 });
    const blocks = [
      "retry: 2000\n\nevent: ready\ndata: {\"adapter\":\"virtual\"}\n\n",
      `event: press\nda`,
      `ta: ${event}\n\nevent: ping\ndata: {"at":3}\n\n`,
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const block of blocks) controller.enqueue(new TextEncoder().encode(block));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    const received: string[] = [];
    await streamLocalHardwareEvents("secret", new AbortController().signal, (press) => received.push(press.eventId));
    expect(received).toEqual(["e2"]);
    expect(parseHardwareSseBlock("event: press\ndata: {broken}\n\n")).toBeNull();
  });
});
