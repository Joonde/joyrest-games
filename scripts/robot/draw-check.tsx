// Проверка жребия на экране зала (scripts/robot/draw-check.mjs): настоящий SlideView на кадре 16:9, эффект, число имён,
// тема и момент вращения — из адреса. Часы страницы замораживает Playwright, поэтому кадр детерминирован.
import { createRoot } from "react-dom/client";
import { SlideView } from "../../src/components/live/SlideView";
import { drawSlide, parseDrawEffect } from "../../src/core/draw";
import { applyTheme, getTheme } from "../../src/themes/registry";
import "../../src/fonts.css";
import "../../src/styles.css";

const q = new URLSearchParams(location.search);
const n = Math.max(1, Number(q.get("n") ?? "3"));
const names = Array.from({ length: n }, (_, i) => (q.get("long") === "1" && i % 2 === 0 ? `🦊 Команда очень длинное название ${i + 1}` : `🎉 Игрок ${i + 1}`));
const winner = names[Number(q.get("win") ?? "0") % n] as string;
const ends = Date.now() + Number(q.get("left") ?? "0");
applyTheme(getTheme(q.get("theme") ?? "joyrest"));
const slide = drawSlide("auccheck", names, winner, ends - 5200, {
  spinEyebrow: "Аукцион · ставки равны",
  spinText: `Одинаковая ставка у ${n}: по 300 — жребий решит, кто отвечает`,
  doneEyebrow: "Аукцион разыгрывает",
  doneText: "Ставка 300 · отвечает на вопрос",
}, parseDrawEffect(q.get("effect")));
(window as unknown as { drawWinner: string }).drawWinner = winner;
createRoot(document.getElementById("root") as HTMLElement).render(
  <div className="quiz-stage" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
    <SlideView slide={slide} />
  </div>,
);
