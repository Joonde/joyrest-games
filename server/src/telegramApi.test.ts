import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TELEGRAM_API, parseTelegramApiBase, telegramBotUrl } from "./telegramApi";

describe("адрес Telegram через посредника", () => {
  it("без настройки — прямой адрес Telegram", () => {
    for (const v of [undefined, null, "", "   "]) expect(parseTelegramApiBase(v)).toBe(TELEGRAM_API);
    expect(telegramBotUrl("1:AA", "")).toBe("https://api.telegram.org/bot1:AA");
  });

  it("посредник с секретным путём; лишние пробелы, \\r\\n и слэш в конце убираются", () => {
    expect(parseTelegramApiBase(" https://tg.joy-rest.ru/Ab_c-9\r\n")).toBe("https://tg.joy-rest.ru/Ab_c-9");
    expect(parseTelegramApiBase("https://tg.joy-rest.ru/sec/")).toBe("https://tg.joy-rest.ru/sec");
    expect(parseTelegramApiBase("https://relay.example.com:8443")).toBe("https://relay.example.com:8443");
    expect(telegramBotUrl("1:AA", "https://tg.joy-rest.ru/sec")).toBe("https://tg.joy-rest.ru/sec/bot1:AA");
  });

  it("неправильный адрес — не посредник, а прямой Telegram (токен не уйдёт по http или на чужой путь)", () => {
    for (const v of [
      "http://tg.joy-rest.ru/sec",
      "tg.joy-rest.ru/sec",
      "https://tg.joy-rest.ru/sec?x=1",
      "https://tg.joy-rest.ru/sec#a",
      "https://user:pass@tg.joy-rest.ru",
      "https://tg.joy-rest.ru/se c",
      "https://tg.joy-rest.ru/../x",
      "javascript:alert(1)",
    ]) {
      expect(parseTelegramApiBase(v), v).toBe(TELEGRAM_API);
    }
  });

  it("сервер нигде не пишет адрес Telegram напрямую — только через telegramBotUrl", () => {
    for (const file of ["telegram.ts", "channel.ts", "lead.ts"]) {
      const src = readFileSync(resolve(import.meta.dirname, file), "utf8");
      expect(src, file).not.toContain("api.telegram.org");
      expect(src, file).toContain("telegramBotUrl(");
    }
  });

  it("compose передаёт адрес посредника основной и тестовой версии, joyrest умеет его задать", () => {
    const root = resolve(import.meta.dirname, "../..");
    const compose = readFileSync(resolve(root, "deploy/compose.yml"), "utf8");
    expect(compose.match(/^ {6}TELEGRAM_API_BASE: \$\{TELEGRAM_API_BASE:-\}$/gm)?.length).toBe(2);
    const joyrest = readFileSync(resolve(root, "deploy/bin/joyrest"), "utf8");
    expect(joyrest).toContain("tg-relay)");
    expect(joyrest).toContain("TELEGRAM_API_BASE");
    // telegram_call берёт адрес посредника, а не только прямой адрес.
    const call = joyrest.slice(joyrest.indexOf("\ntelegram_call() {"), joyrest.indexOf("\n}", joyrest.indexOf("\ntelegram_call() {")));
    expect(call).toContain("telegram_base");
    // Скрипт посредника: доступ к 443 — только с адреса основного сервера, без журналов запросов (в адресе — токен).
    const relay = readFileSync(resolve(root, "deploy/relay/install.sh"), "utf8");
    expect(relay).toContain("ufw allow from \"$MAIN_IP\" to any port 443 proto tcp");
    expect(relay).not.toMatch(/^\s*log\b/m);
    expect(relay).toContain("PasswordAuthentication no");
  });
});
