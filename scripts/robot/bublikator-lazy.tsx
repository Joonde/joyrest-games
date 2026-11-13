// Стенд lazy-чанка телефона «Бубликатора» (аудит 2b, круг 2, №2): страница с шапкой платформы и телефоном гостя из
// отдельного чанка. Сборка — `ROBOT_SPLIT=1`, проверка — `bublikator-phone.mjs` с `LAZY=<папка>` (обрыв чанка).
import "../../src/fonts.css";
import "../../src/styles.css";
import { createRoot } from "react-dom/client";
import { BublikatorPlayerView } from "../../src/mechanics/bublikator/views";
import { applyTheme, getTheme } from "../../src/themes/registry";

applyTheme(getTheme("joyrest"));
const session = { id: "s1", code: "515042" } as never;
const participant = { name: "🦊 Аня" } as never;
const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("нет #root");
createRoot(rootEl).render(
  <div>
    <h1 id="app-alive">Шапка платформы</h1>
    <BublikatorPlayerView {...({ session, participant, content: {}, pid: "p0", role: "player", myAnswer: null, sending: false, onAnswer: () => undefined } as never)} />
  </div>,
);
