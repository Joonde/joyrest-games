/**
 * Чья реализация слоя данных работает: свой сервер или Firebase (на время переезда).
 * Свой сервер ставит метку `<meta name="joyrest-data" content="server|firebase">` в index.html
 * (server/src/app.ts, withDataBackend). Свой сервер — только точное «server»; нет метки
 * (сборка Netlify, разработка) или что-то другое — Firebase.
 */
export type DataBackend = "server" | "firebase";

export function dataBackend(): DataBackend {
  if (typeof document === "undefined") return "firebase";
  const meta = document.querySelector('meta[name="joyrest-data"]');
  return meta?.getAttribute("content") === "server" ? "server" : "firebase";
}
