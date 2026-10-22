import { describe, expect, it } from "vitest";
import { draftRestoreMode } from "./draftRestore";

describe("черновик автосохранения: вернуть молча или спросить", () => {
  it("версия на сервере та же, поверх которой лежат правки, — вернуть молча", () => {
    expect(draftRestoreMode({ base: 1000 }, 1000)).toBe("restore");
    expect(draftRestoreMode({ base: null }, null)).toBe("restore");
  });

  it("игру с тех пор меняли (в том числе сам человек с другого устройства) — спросить", () => {
    // Р5: раньше черновик со «saved» молча ложился поверх, если последним правил тот же человек.
    expect(draftRestoreMode({ base: 1000 }, 2000)).toBe("ask");
    expect(draftRestoreMode({ base: null }, 2000)).toBe("ask");
    expect(draftRestoreMode({ base: 1000 }, null)).toBe("ask");
  });

  it("версия неизвестна (черновик старого формата, сервер версию не вернул) — спросить", () => {
    expect(draftRestoreMode({ base: undefined }, 1000)).toBe("ask");
    expect(draftRestoreMode({ base: 1000 }, undefined)).toBe("ask");
  });
});
