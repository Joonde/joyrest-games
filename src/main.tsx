import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Только загрузчик SDK, без остального слоя данных: общий чанк гостя остаётся лёгким.
import { preloadData } from "./data/firebase";
import { applyTheme, getTheme } from "./themes/registry";
import "./fonts.css";
import "./styles.css";

applyTheme(getTheme("joyrest"));

// Экранам с игрой нужен Firebase: начинаем качать его сразу, параллельно с кодом экрана.
// Главной, вводу кода и витрине стиля он не нужен.
if (!/^\/(j|brand)?\/?$/.test(window.location.pathname)) preloadData();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
