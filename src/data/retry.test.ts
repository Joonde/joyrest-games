import { describe, expect, it, vi } from "vitest";
import { isPermanentError, retryBriefly, retryDelay, withRetry } from "./retry";

describe("повтор загрузки", () => {
  it("паузы 2, 4, 8 секунд, дальше каждые 10", () => {
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([2000, 4000, 8000, 10000, 10000]);
  });

  it("медленная сеть — не ошибка, отказ в доступе — ошибка", () => {
    expect(isPermanentError({ code: "unavailable" })).toBe(false);
    expect(isPermanentError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isPermanentError({ code: "auth/network-request-failed" })).toBe(false);
    expect(isPermanentError({ code: "permission-denied" })).toBe(true);
    expect(isPermanentError({ code: "not-found" })).toBe(true);
  });

  it("повторяет после сетевой ошибки, пока данные не придут", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const result = withRetry(async () => {
      calls++;
      if (calls < 3) throw { code: "unavailable" };
      return "данные";
    });
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(result).resolves.toBe("данные");
    expect(calls).toBe(3);
    vi.useRealTimers();
  });

  it("настоящую ошибку пробрасывает сразу", async () => {
    let calls = 0;
    const failing = withRetry(async () => {
      calls++;
      throw { code: "permission-denied" };
    });
    await expect(failing).rejects.toEqual({ code: "permission-denied" });
    expect(calls).toBe(1);
  });
});

describe("быстрый повтор отправки ответа", () => {
  const noWait = () => Promise.resolve();

  it("обрыв на секунду — ответ уходит со второй попытки, паузы 1 и 2 секунды", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await retryBriefly(
      async () => {
        calls++;
        if (calls < 3) throw { code: "unavailable" };
        return "sent";
      },
      undefined,
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(result).toBe("sent");
    expect(calls).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it("сеть так и не появилась — после двух повторов отдаёт ошибку", async () => {
    let calls = 0;
    const result = retryBriefly(async () => {
      calls++;
      throw { code: "unavailable" };
    }, undefined, noWait);
    await expect(result).rejects.toEqual({ code: "unavailable" });
    expect(calls).toBe(3);
  });

  it("настоящую ошибку не повторяет", async () => {
    let calls = 0;
    const result = retryBriefly(async () => {
      calls++;
      throw { code: "permission-denied" };
    }, undefined, noWait);
    await expect(result).rejects.toEqual({ code: "permission-denied" });
    expect(calls).toBe(1);
  });

  it("без пауз — одна попытка", async () => {
    let calls = 0;
    await expect(
      retryBriefly(async () => {
        calls++;
        throw { code: "unavailable" };
      }, [], noWait),
    ).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });
});
