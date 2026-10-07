import { afterEach, describe, expect, it, vi } from "vitest";
import { describeAuthError } from "../authErrors";
import { isPermanentError } from "../retry";
import { api, ApiError } from "./api";
import { parseProfile } from "./auth";

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("запросы к своему серверу", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("изменения идут с заголовком X-JoyRest и cookie своего адреса", async () => {
    const fetchMock = vi.fn(async () => reply(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api("POST", "/api/auth/logout");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-JoyRest": "1" },
      body: "{}",
    }));
  });

  it("ошибка сервера — код как у Firebase: настоящая ошибка без повторов, понятный текст", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { error: "auth/invalid-credential" })));
    const error = await api("POST", "/api/auth/login", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(describeAuthError(error)).toBe("Неверная почта или пароль.");

    vi.stubGlobal("fetch", vi.fn(async () => reply(403, {})));
    expect(isPermanentError(await api("GET", "/api/users").catch((e: unknown) => e))).toBe(true);
  });

  it("обрыв сети и сбой сервера повторяются", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const offline = await api("GET", "/api/auth/me").catch((e: unknown) => e);
    expect(isPermanentError(offline)).toBe(false);
    expect(describeAuthError(offline)).toBe("Нет связи с интернетом. Проверьте сеть и попробуйте снова.");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bad Gateway", { status: 502 })));
    expect(isPermanentError(await api("GET", "/api/auth/me").catch((e: unknown) => e))).toBe(false);
  });

  it("профиль: временный пароль и роль по умолчанию", () => {
    expect(parseProfile({ uid: "u1", role: "admin", name: "Аня", active: true, email: "a@b.c", mustChangePassword: true })).toEqual({
      uid: "u1",
      role: "admin",
      name: "Аня",
      active: true,
      email: "a@b.c",
      mustChangePassword: true,
    });
    expect(parseProfile({ uid: "u2", role: "root" })).toMatchObject({ role: "host", active: false, mustChangePassword: false });
    expect(parseProfile(null)).toBeNull();
  });
});
