/**
 * Личная карточка гостя для сторис (решение владельца 31 октября 2026): картинка 1080×1920 с логотипом JoyRest рисуется
 * прямо на телефоне (canvas), сервер не нагружается. Рисуется заранее, при открытии блока «Спасибо, что были с нами!»:
 * меню «Поделиться» браузер открывает только сразу по касанию. Касание — меню телефона с картинкой (Telegram,
 * ВКонтакте, WhatsApp, сторис); меню нет или не умеет файлы — картинка сохраняется. Тексты — `src/core/storyCard.ts`.
 */
import { useEffect, useMemo, useState } from "react";
import logoSvg from "../../../public/brand/joyrest-logo.svg?inline-svg";
import { storyCardText, type StoryCardInput, type StoryCardText } from "../../core/storyCard";
import { formatResultsText } from "../../core/results";
import type { GameResult } from "../../data";
import { resultsUrl } from "../links";

const W = 1080;
const H = 1920;
const CREAM = "#FBF6F1";
const SOFT = "#C9BEB4";
const GOLD = "#E3C68C";
const SANS = '"Jost", system-ui, sans-serif';
const SERIF = '"Cormorant Garamond", Georgia, serif';

type Ctx = CanvasRenderingContext2D;

function loadLogo(): Promise<HTMLImageElement | null> {
  const markup = logoSvg.replace(/currentColor/g, "#F3DFAE");
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadFonts(): Promise<void> {
  if (!document.fonts?.load) return;
  await Promise.race([
    Promise.all([
      document.fonts.load(`700 120px ${SERIF}`, "1 место"),
      document.fonts.load(`600 60px ${SERIF}`, "Радость"),
      document.fonts.load(`600 60px ${SANS}`, "Команда"),
      document.fonts.load(`400 40px ${SANS}`, "Квиз"),
    ]).catch(() => undefined),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
}

/** Строки по ширине; не больше `max` строк, последняя — с многоточием. */
function wrap(ctx: Ctx, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = `${kept[max - 1]} ${lines.slice(max).join(" ")}`;
  while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[max - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** Самый крупный размер, при котором текст влезает в `max` строк. */
function fit(ctx: Ctx, font: (px: number) => string, text: string, width: number, max: number, from: number, to: number): { px: number; lines: string[] } {
  for (let px = from; px > to; px -= 4) {
    ctx.font = font(px);
    const lines = wrap(ctx, text, width, 99);
    if (lines.length <= max) return { px, lines };
  }
  ctx.font = font(to);
  return { px: to, lines: wrap(ctx, text, width, max) };
}

function background(ctx: Ctx, gold: boolean) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#2E2622");
  bg.addColorStop(0.55, "#221E1B");
  bg.addColorStop(1, "#15110F");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Тёплое свечение за главной надписью и розовое снизу.
  const glow = ctx.createRadialGradient(W / 2, 1000, 40, W / 2, 1000, 760);
  glow.addColorStop(0, gold ? "rgba(243,223,174,0.34)" : "rgba(227,198,140,0.22)");
  glow.addColorStop(1, "rgba(227,198,140,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const rose = ctx.createRadialGradient(W / 2, H + 120, 40, W / 2, H + 120, 820);
  rose.addColorStop(0, "rgba(196,158,150,0.30)");
  rose.addColorStop(1, "rgba(196,158,150,0)");
  ctx.fillStyle = rose;
  ctx.fillRect(0, 0, W, H);

  // Лучи ар-деко из центра.
  ctx.save();
  ctx.strokeStyle = "rgba(227,198,140,0.07)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.cos(a) * 180, 1000 + Math.sin(a) * 180);
    ctx.lineTo(W / 2 + Math.cos(a) * 1500, 1000 + Math.sin(a) * 1500);
    ctx.stroke();
  }
  ctx.restore();

  // Рамка в два контура и ромбы по углам.
  ctx.strokeStyle = "rgba(227,198,140,0.6)";
  ctx.lineWidth = 3;
  ctx.strokeRect(56, 56, W - 112, H - 112);
  ctx.strokeStyle = "rgba(227,198,140,0.28)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(76, 76, W - 152, H - 152);
  ctx.fillStyle = GOLD;
  for (const [x, y] of [[56, 56], [W - 56, 56], [56, H - 56], [W - 56, H - 56]] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x + 16, y);
    ctx.lineTo(x, y + 16);
    ctx.lineTo(x - 16, y);
    ctx.closePath();
    ctx.fill();
  }
}

function goldFill(ctx: Ctx, top: number, height: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, top + height);
  g.addColorStop(0, "#FFF1CF");
  g.addColorStop(0.5, "#E3C68C");
  g.addColorStop(1, "#C9A15F");
  return g;
}

function divider(ctx: Ctx, y: number) {
  ctx.strokeStyle = "rgba(227,198,140,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 220, y);
  ctx.lineTo(W / 2 - 40, y);
  ctx.moveTo(W / 2 + 40, y);
  ctx.lineTo(W / 2 + 220, y);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.font = `600 40px ${SANS}`;
  ctx.fillText("✦", W / 2, y + 2);
}

/** Рисует карточку; null — браузер не умеет canvas. */
export async function drawStoryCard(text: StoryCardText): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const [logo] = await Promise.all([loadLogo(), loadFonts()]);

  background(ctx, text.medal === "gold");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Логотип — ниже верхней полосы сторис (имя аккаунта и полоски закрывают ~250 px).
  if (logo) {
    const lw = 420;
    const lh = (lw * 775) / 1000;
    ctx.drawImage(logo, (W - lw) / 2, 230, lw, lh);
  } else {
    ctx.fillStyle = GOLD;
    ctx.font = `700 120px ${SERIF}`;
    ctx.fillText("JoyRest", W / 2, 380);
  }

  // Главный блок по центру между логотипом и слоганом; не влезает — всё мельче.
  const width = W - 240;
  const top = 610;
  const bottom = 1490;
  type Part = { h: number; draw: (y: number) => void };
  const layout = (k: number): Part[] => {
    const parts: Part[] = [];
    const gap = (h: number): Part => ({ h, draw: () => undefined });
    const lines = (font: (px: number) => string, str: string, max: number, from: number, to: number, lh: number, fill: () => string | CanvasGradient, glow = 0): Part => {
      const r = fit(ctx, font, str, width, max, Math.round(from * k), Math.round(to * k));
      const step = r.px * lh;
      return {
        h: r.lines.length * step,
        draw: (y) => {
          ctx.font = font(r.px);
          ctx.fillStyle = fill();
          ctx.shadowColor = "rgba(243,223,174,0.45)";
          ctx.shadowBlur = glow;
          r.lines.forEach((line, i) => ctx.fillText(line, W / 2, y + step * i + step / 2));
          ctx.shadowBlur = 0;
        },
      };
    };
    if (text.emoji) {
      const px = Math.round(160 * k);
      parts.push({
        h: px,
        draw: (y) => {
          ctx.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
          ctx.fillStyle = CREAM;
          ctx.fillText(text.emoji ?? "", W / 2, y + px / 2);
        },
      });
      parts.push(gap(36 * k));
    }
    const who = lines((px) => `600 ${px}px ${SANS}`, text.who, 2, 84, 52, 1.18, () => CREAM);
    if (text.placeNumber !== null) {
      // Цифра — Jost: у Cormorant старинные цифры, «1» похожа на «I».
      parts.push(who, gap(28 * k));
      const numPx = Math.round(320 * k);
      parts.push({
        h: numPx * 0.95,
        draw: (y) => {
          ctx.font = `500 ${numPx}px ${SANS}`;
          ctx.fillStyle = goldFill(ctx, y, numPx);
          ctx.shadowColor = "rgba(243,223,174,0.5)";
          ctx.shadowBlur = text.medal === "gold" ? 50 : 24;
          ctx.fillText(String(text.placeNumber), W / 2, y + numPx * 0.5);
          ctx.shadowBlur = 0;
        },
      });
      parts.push(lines((px) => `700 ${px}px ${SERIF}`, text.placeWord, 1, 120, 80, 1.05, () => goldFill(ctx, 0, H)));
    } else {
      parts.push(lines((px) => `700 ${px}px ${SERIF}`, text.headline, 3, 124, 80, 1.05, () => goldFill(ctx, 0, H), 18), gap(48 * k), who);
    }
    parts.push(gap(56 * k), { h: 4, draw: (y) => divider(ctx, y) }, gap(48 * k));
    parts.push(lines((px) => `500 ${px}px ${SANS}`, text.gameTitle, 3, 50, 36, 1.28, () => SOFT));
    parts.push(gap(10 * k), lines((px) => `400 ${px}px ${SANS}`, text.date, 1, 44, 34, 1.3, () => SOFT));
    return parts;
  };
  let parts = layout(1);
  for (let k = 0.95; k >= 0.6 && parts.reduce((a, p) => a + p.h, 0) > bottom - top; k -= 0.05) parts = layout(k);
  const total = parts.reduce((a, p) => a + p.h, 0);
  let y = top + Math.max(0, (bottom - top - total) / 2);
  for (const part of parts) {
    part.draw(y);
    y += part.h;
  }

  // Слоган и адреса — выше нижней полосы сторис (поле ответа).
  ctx.fillStyle = GOLD;
  ctx.font = `600 64px ${SERIF}`;
  ctx.fillText("Радость без хлопот", W / 2, 1580);
  ctx.fillStyle = CREAM;
  ctx.font = `500 42px ${SANS}`;
  ctx.fillText(text.footer, W / 2, 1660);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Кнопка «Поделиться победой» с превью карточки и «Поделиться итогами» (вся таблица текстом и ссылкой).
 * `result` — итоги игры из сессии (для текста таблицы).
 */
export function StoryShare({ input, result }: { input: StoryCardInput; result: GameResult }) {
  // Сессия обновляется и после игры (музыка, слайды) — карточку перерисовываем, только если поменялся её текст.
  const key = JSON.stringify(input);
  const text = useMemo(() => storyCardText(input), [key]);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setBlob(null);
    setFailed(false);
    drawStoryCard(text)
      .then((b) => {
        if (!alive) return;
        if (!b) return setFailed(true);
        url = URL.createObjectURL(b);
        setBlob(b);
        setPreview(url);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [text]);

  async function shareCard() {
    if (!blob) return;
    setNote(null);
    const file = new File([blob], text.fileName, { type: "image/png" });
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: text.shareText });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    save(blob, text.fileName);
    setNote("Картинка сохранена — найдите её в загрузках или галерее и выложите в сторис.");
  }

  async function shareResults() {
    setNote(null);
    const link = resultsUrl(result.id);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `Итоги игры «${result.gameTitle || "Игра"}»`, text: formatResultsText(result), url: link });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(formatResultsText(result, link));
      setNote("Итоги скопированы — вставьте их в чат.");
    } catch {
      setNote(`Ссылка на итоги: ${link}`);
    }
  }

  if (failed) return null;
  return (
    <div className="stack stack--tight story-share">
      <p className="finale-review__title">Карточка для сторис</p>
      {preview ? (
        <img className="story-share__preview" src={preview} alt={`${text.who}: ${text.headline}. ${text.game}`} width={W / 4} height={H / 4} />
      ) : (
        <div className="story-share__preview story-share__preview--wait" aria-hidden />
      )}
      <button type="button" className="btn btn--block" disabled={!blob} onClick={() => void shareCard()}>
        {blob ? text.button : "Рисуем карточку…"}
      </button>
      <button type="button" className="btn btn--secondary btn--block" onClick={() => void shareResults()}>
        Поделиться итогами игры
      </button>
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
