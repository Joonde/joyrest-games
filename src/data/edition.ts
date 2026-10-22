/**
 * Редакция платформы: `agency` — платформа агентства JoyRest, `lite` — подписочная платформа для
 * ведущих без CRM агентства (CLAUDE.md, «JoyRest Лайт»). Сервер ставит метку
 * `<meta name="joyrest-edition" content="agency|lite">` в index.html (server/src/edition.ts).
 * Лайт — только точное «lite»; нет метки (Netlify, разработка) или что-то другое — агентство.
 */
export type Edition = "agency" | "lite";

export function edition(): Edition {
  if (typeof document === "undefined") return "agency";
  const meta = document.querySelector('meta[name="joyrest-edition"]');
  return meta?.getAttribute("content") === "lite" ? "lite" : "agency";
}
