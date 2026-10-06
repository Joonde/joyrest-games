import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";

function site(): string {
  const dir = mkdtempSync(join(tmpdir(), "joyrest-site-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>JoyRest</title>");
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
});
