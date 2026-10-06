import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp, parseDataBackend, withDataBackend } from "./app";

function site(): string {
  const dir = mkdtempSync(join(tmpdir(), "joyrest-site-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><html><head><title>JoyRest</title></head><body></body></html>");
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(dir, "favicon.svg"), "<svg/>");
  return dir;
}

describe("сервер", () => {
  const app = buildApp({ version: "abc", publicDir: site(), checkDatabase: async () => true });
  afterAll(() => app.close());

  it("/health отвечает версией и состоянием базы", async () => {
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: "abc", database: "ok" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("/health без базы — 503", async () => {
    const broken = buildApp({ version: "abc", publicDir: null, checkDatabase: async () => { throw new Error("down"); } });
    const res = await broken.inject("/health");
    expect(res.statusCode).toBe(503);
    expect(res.json().database).toBe("error");
    await broken.close();
  });

  it("страницы приложения отдают index.html без долгого кэша", async () => {
    for (const url of ["/", "/studio", "/play/123456", "/screen/123456?x=1"]) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain("JoyRest");
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("собранные файлы кэшируются на год, отсутствующие — 404", async () => {
    const js = await app.inject("/assets/app-abc123.js");
    expect(js.statusCode).toBe(200);
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await app.inject("/assets/missing.js")).statusCode).toBe(404);
    expect((await app.inject("/missing.png")).statusCode).toBe(404);
    expect((await app.inject("/api/nothing")).statusCode).toBe(404);
  });

  it("обычные файлы из корня — без долгого кэша", async () => {
    const res = await app.inject("/favicon.svg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("страница приложения сообщает реализацию слоя данных: по умолчанию Firebase", async () => {
    for (const url of ["/", "/studio", "/index.html"]) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('<meta name="joyrest-data" content="firebase"></head>');
      expect(res.headers["content-type"], url).toContain("text/html");
    }
  });

  it("DATA_BACKEND=server — метка server", async () => {
    const server = buildApp({ version: "abc", publicDir: site(), checkDatabase: async () => true, dataBackend: "server" });
    const res = await server.inject("/host/123456");
    expect(res.body).toContain('<meta name="joyrest-data" content="server">');
    expect(res.body).not.toContain("firebase");
    await server.close();
  });
});

describe("переключатель слоя данных", () => {
  it("свой сервер — только точное «server», остальное — Firebase", () => {
    for (const value of [undefined, "", "firebase", "servers", "1", "on", "true"]) {
      expect(parseDataBackend(value), String(value)).toBe("firebase");
    }
    for (const value of ["server", "SERVER", " server\r\n"]) expect(parseDataBackend(value), value).toBe("server");
  });

  it("метка вставляется в head", () => {
    expect(withDataBackend("<html><head><title>x</title></head></html>", "server")).toBe(
      '<html><head><title>x</title><meta name="joyrest-data" content="server"></head></html>',
    );
  });
});
