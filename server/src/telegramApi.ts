/**
 * Адрес Bot API Telegram.
 *
 * Из российских дата-центров api.telegram.org недоступен (6 ноября 2026), поэтому сервер ходит
 * в Telegram через посредника за границей: маленький сервер с Caddy (deploy/relay/install.sh),
 * который пересылает запросы на api.telegram.org. Адрес посредника с секретным путём —
 * `TELEGRAM_API_BASE` в /srv/joyrest/secrets.env (пишет `sudo joyrest tg-relay`), например
 * https://tg.joy-rest.ru/<секрет>. Нет переменной или она неправильная — прямой адрес Telegram.
 * Через посредника идут только сообщения ботов: имён и телефонов клиентов в них нет.
 */
export const TELEGRAM_API = "https://api.telegram.org";

// https://хост[:порт] и необязательный путь из латинских букв, цифр, «-» и «_» (секрет посредника).
const BASE_RE = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(\/[A-Za-z0-9_-]+)*$/;

export function parseTelegramApiBase(value: string | undefined | null): string {
  const clean = (value ?? "").trim().replace(/\/+$/, "");
  return BASE_RE.test(clean) ? clean : TELEGRAM_API;
}

/** Адрес методов бота: `${telegramBotUrl(token)}/sendMessage`. */
export function telegramBotUrl(token: string, base: string | undefined = process.env.TELEGRAM_API_BASE): string {
  return `${parseTelegramApiBase(base)}/bot${token}`;
}
