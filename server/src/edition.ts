/**
 * Редакция платформы (CLAUDE.md, «JoyRest Лайт»): `agency` — платформа агентства JoyRest со всем,
 * `lite` — подписочная платформа для ведущих без CRM агентства. Образ один, редакцию выбирает
 * переменная EDITION при запуске (compose). Лайт — только точное «lite»; всё остальное (нет
 * переменной, опечатка) — платформа агентства, поэтому основная версия от этой переменной не меняется.
 */
export type Edition = "agency" | "lite";

export function parseEdition(value: string | undefined): Edition {
  return value?.trim().toLowerCase() === "lite" ? "lite" : "agency";
}

/** index.html с меткой редакции (src/data/edition.ts читает её при запуске). */
export function withEdition(html: string, edition: Edition): string {
  const meta = `<meta name="joyrest-edition" content="${edition}">`;
  return html.includes("</head>") ? html.replace("</head>", `${meta}</head>`) : meta + html;
}

/**
 * Разделы агентства, которых в Лайте нет: сайт и заявки, база клиентов, колокольчик, планировщик
 * и календарь команды, база площадок, Telegram-бот и канал, команда, квалификация и баллы,
 * предложения в библиотеку; отзывы и ссылки JoyRest в конце игры, фотоотчёты, оформление под заказчика (платный
 * «Фирменный шаблон»). Сервер Лайта их адресов не регистрирует (404).
 */
export const AGENCY_ONLY = [
  "site",
  "lead",
  "clients",
  "notices",
  "events",
  "calendar",
  "venues",
  "telegram",
  "channel",
  "team",
  "staff",
  "proposals",
  "finale",
  "photos",
  "branding",
] as const;
