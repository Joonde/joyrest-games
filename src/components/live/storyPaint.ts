/**
 * Рисунок карточки для сторис в трёх стилях (решение владельца 31 октября 2026, макет «Карточки — 3 стиля»): «Венок» — тёмная
 * сцена с лучом света и лавровым венком вокруг цифры места, «Ар-деко» — огромная цифра на лучах в рамке ар-деко, «Светлый» —
 * кремовый фон, арка и золотой венок. Всё рисуется кодом на телефоне гостя (без картинок с сервера), 1080×1920.
 * Верх (~220 px) и низ (~260 px) кадра в сторис закрыты полосками и полем ответа — там только фон и рамка.
 * Без React: этот файл можно нарисовать и вне приложения (снимки для проверки).
 */
import { storyEyebrow, type StoryCardText, type StoryStyle } from "../../core/storyCard";

export const STORY_W = 1080;
export const STORY_H = 1920;
const W = STORY_W;
const H = STORY_H;

const SANS = '"Jost", system-ui, sans-serif';
const SERIF = '"Cormorant Garamond", Georgia, serif';
/** Для имени со смайликом: смайлик берётся из цветного шрифта телефона. */
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const NAME_SANS = `"Jost", ${EMOJI}, system-ui, sans-serif`;
const NAME_SERIF = `"Cormorant Garamond", ${EMOJI}, Georgia, serif`;

type Ctx = CanvasRenderingContext2D;
type Medal = StoryCardText["medal"];

/** Монограмма JR нужного цвета; null — не загрузилась (тогда пишем «JoyRest» буквами). */
export type MonogramFor = (color: string) => CanvasImageSource | null;

/** Металл цифры: золото, серебро, бронза; без места — золото. */
const METAL: Record<"gold" | "silver" | "bronze", { stops: string[]; leaf: [string, string]; berry: string }> = {
  gold: { stops: ["#FFF3D6", "#F3DFAE", "#E3C68C", "#A9814A", "#E9CD95"], leaf: ["#F3DFAE", "#C9A15E"], berry: "#E3AA9C" },
  silver: { stops: ["#FFFFFF", "#E4E6EC", "#C9CCD4", "#A8ABB6", "#E9EBF0"], leaf: ["#F2F3F6", "#9EA2AE"], berry: "#C9D6E3" },
  bronze: { stops: ["#FFE2C4", "#E9B98A", "#C98F5E", "#A86B3C", "#EDC29A"], leaf: ["#F0C7A0", "#A86B3C"], berry: "#E3AA9C" },
};
const LIGHT_GOLD = ["#E7C987", "#C9A15E", "#B98B45", "#F2D9A2", "#9C7136"];

function metalOf(medal: Medal) {
  return METAL[medal ?? "gold"];
}

function vGradient(ctx: Ctx, top: number, height: number, stops: readonly string[]): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, top + height);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

/** Текст с разрядкой по центру (у canvas `letterSpacing` есть не везде — расставляем буквы сами). */
function spaced(ctx: Ctx, text: string, cx: number, y: number, spacing: number) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, w) => a + w, 0) + spacing * (chars.length - 1);
  let x = cx - total / 2;
  const align = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y);
    x += (widths[i] ?? 0) + spacing;
  });
  ctx.textAlign = align;
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
function fit(ctx: Ctx, font: (px: number) => string, text: string, width: number, max: number, from: number, to: number) {
  for (let px = from; px > to; px -= 4) {
    ctx.font = font(px);
    const lines = wrap(ctx, text, width, 99);
    if (lines.length <= max) return { px, lines };
  }
  ctx.font = font(to);
  return { px: to, lines: wrap(ctx, text, width, max) };
}

/** Детерминированное конфетти и звёздочки вокруг середины (середину с цифрой не закрывают). */
function confetti(ctx: Ctx, colors: readonly string[], spark: string, seed: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < 60; i++) {
    const x = rnd() * W;
    const y = 120 + rnd() * (H - 240);
    const inCenter = y > H * 0.24 && y < H * 0.8 && x > W * 0.16 && x < W * 0.84;
    const size = rnd();
    const rot = rnd() * Math.PI;
    const alpha = 0.45 + rnd() * 0.5;
    if (inCenter) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    if (i % 3 === 0) {
      ctx.fillStyle = spark;
      ctx.font = `${Math.round(24 + size * 30)}px ${SANS}`;
      ctx.fillText("✦", 0, 0);
    } else {
      ctx.rotate(rot);
      ctx.fillStyle = colors[i % colors.length] ?? spark;
      ctx.fillRect(-7, -13, 14, 26);
    }
    ctx.restore();
  }
}

function diamond(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Лавровый венок: две ветви по дуге снизу вверх, сверху открыт, снизу бант. Центр (cx, cy), радиус ветвей r.
 * Листья — по паре на узел, к верху мельче.
 */
function wreath(ctx: Ctx, cx: number, cy: number, r: number, [c1, c2]: readonly [string, string], berry: string) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const at = (f: number) => [cx + r * Math.sin(rad(f)), cy - r * Math.cos(rad(f))] as const;
  const k = r / 126;
  const leaf = (x: number, y: number, rot: number, sz: number, fill: CanvasGradient | string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rad(rot));
    ctx.scale(sz * k, sz * k);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(7, -8, 7, -20, 0, -28);
    ctx.bezierCurveTo(-7, -20, -7, -8, 0, 0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "rgba(60,40,20,0.3)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(0, -24);
    ctx.stroke();
    ctx.restore();
  };
  const grad = (y: number) => {
    const g = ctx.createLinearGradient(0, y + 30 * k, 0, y - 30 * k);
    g.addColorStop(0, c2);
    g.addColorStop(1, c1);
    return g;
  };
  for (const side of [1, -1] as const) {
    // side 1 — левая ветвь (угол растёт от низа к верху слева), -1 — правая.
    const a0 = side > 0 ? 194 : 166;
    const a1 = side > 0 ? 322 : 38;
    const [x0, y0] = at(a0);
    ctx.strokeStyle = c2;
    ctx.lineWidth = 2.2 * k;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    // Дуга по той же окружности: углы canvas от оси x по часовой.
    const toCanvas = (f: number) => rad(f - 90);
    ctx.arc(cx, cy, r, toCanvas(a0), toCanvas(a1), side < 0);
    ctx.stroke();
    const n = 13;
    for (let i = 0; i < n; i++) {
      const f = a0 + ((a1 - a0) * i) / (n - 1);
      const [x, y] = at(f);
      const dx = Math.cos(rad(f)) * side;
      const dy = Math.sin(rad(f)) * side;
      const rot = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const sz = 1.1 - (0.45 * i) / (n - 1);
      const g = grad(y);
      leaf(x, y, rot - 32, sz, g);
      leaf(x, y, rot + 32, sz, g);
      if (i % 3 === 1) {
        ctx.fillStyle = berry;
        ctx.beginPath();
        ctx.arc(x + (cx - x) * 0.09, y + (cy - y) * 0.09, 3 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const [xe, ye] = at(a1);
    const dx = Math.cos(rad(a1)) * side;
    const dy = Math.sin(rad(a1)) * side;
    leaf(xe, ye, (Math.atan2(dx, -dy) * 180) / Math.PI, 0.8, grad(ye));
  }
  // Бант снизу.
  const by = cy + r * 1.0;
  ctx.fillStyle = c2;
  ctx.beginPath();
  ctx.moveTo(cx, by);
  ctx.lineTo(cx - 22 * k, by + 22 * k);
  ctx.lineTo(cx - 13 * k, by + 23 * k);
  ctx.lineTo(cx, by + 9 * k);
  ctx.lineTo(cx + 13 * k, by + 23 * k);
  ctx.lineTo(cx + 22 * k, by + 22 * k);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c1;
  ctx.beginPath();
  ctx.arc(cx, by, 5.5 * k, 0, Math.PI * 2);
  ctx.fill();
}

/** Логотип сверху: монограмма (или «JoyRest» буквами) и подпись разрядкой. */
function logo(ctx: Ctx, mono: MonogramFor, color: string, top: number, width: number, caption: string | null, captionColor: string) {
  const img = mono(color);
  const h = (width * 445) / 500;
  if (img) ctx.drawImage(img, (W - width) / 2, top, width, h);
  else {
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.round(width * 0.6)}px ${SERIF}`;
    ctx.fillText("JoyRest", W / 2, top + h / 2);
  }
  if (caption) {
    ctx.fillStyle = captionColor;
    ctx.font = `400 34px ${SANS}`;
    spaced(ctx, caption, W / 2, top + h + 44, 18);
  }
  return top + h;
}

/** Цифра места крупно с металлом и мягким свечением; `outline` — контур со сдвигом (ар-деко). */
function placeNumber(ctx: Ctx, n: number, cy: number, px: number, stops: readonly string[], glow: string, outline?: string) {
  ctx.font = `500 ${px}px ${SANS}`;
  const text = String(n);
  if (outline) {
    ctx.save();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3;
    ctx.strokeText(text, W / 2 + px * 0.022, cy + px * 0.022);
    ctx.restore();
  }
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = px * 0.14;
  ctx.shadowOffsetY = px * 0.02;
  ctx.fillStyle = vGradient(ctx, cy - px * 0.38, px * 0.76, stops);
  ctx.fillText(text, W / 2, cy);
  ctx.restore();
}

type Fit = { px: number; lines: string[] };

/** Нижний блок над слоганом: имя (до 2 строк, на ленте — у «Венка»), игра (до 2 строк) и дата. Высота по тексту, низ — не ниже 1548. */
function bottomBlock(
  ctx: Ctx,
  text: StoryCardText,
  opts: { nameFont: (px: number) => string; nameFrom: number; nameTo: number; nameColor: string; ribbon?: boolean; titleColor: string; dateColor: string; upper?: boolean },
) {
  const who = text.emoji ? `${text.emoji} ${text.who}` : text.who;
  const title = opts.upper ? text.gameTitle.toLocaleUpperCase("ru") : text.gameTitle;
  const nameWidth = opts.ribbon ? 720 : W - 240;
  const top = 1240;
  const bottom = 1548;
  // Не влезает между венком и слоганом — всё мельче (длинное имя команды и название игры в две строки).
  const measure = (k: number) => {
    const name: Fit = fit(ctx, opts.nameFont, who, nameWidth, 2, Math.round(opts.nameFrom * k), Math.round(opts.nameTo * k));
    const game: Fit = fit(ctx, (px) => `500 ${px}px ${SANS}`, title, W - 260, 2, Math.round(42 * k), Math.round(30 * k));
    const nameStep = name.px * 1.16;
    const gameStep = game.px * 1.28;
    const pad = opts.ribbon ? name.px * 0.42 : 0;
    const nameH = nameStep * name.lines.length + pad * 2;
    const gap = 26;
    const dateH = 44;
    const total = nameH + gap + gameStep * game.lines.length + 6 + dateH;
    return { name, game, nameStep, gameStep, pad, nameH, gap, dateH, total };
  };
  let m = measure(1);
  for (let k = 0.92; k >= 0.6 && m.total > bottom - top; k -= 0.08) m = measure(k);
  const { name, game, nameStep, gameStep, pad, nameH, gap, dateH, total } = m;
  let y = Math.max(top, bottom - total);
  if (opts.ribbon) {
    ctx.font = opts.nameFont(name.px);
    const textW = Math.max(...name.lines.map((l) => ctx.measureText(l).width));
    const rw = Math.min(W - 140, textW + 170);
    const rx = (W - rw) / 2;
    const notch = Math.min(40, nameH * 0.3);
    ctx.fillStyle = vGradient(ctx, y, nameH, ["#F6E4B8", "#D9B676"]);
    ctx.beginPath();
    ctx.moveTo(rx, y);
    ctx.lineTo(rx + rw, y);
    ctx.lineTo(rx + rw - notch, y + nameH / 2);
    ctx.lineTo(rx + rw, y + nameH);
    ctx.lineTo(rx, y + nameH);
    ctx.lineTo(rx + notch, y + nameH / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = opts.nameFont(name.px);
  ctx.fillStyle = opts.nameColor;
  name.lines.forEach((line, i) => ctx.fillText(line, W / 2, y + pad + nameStep * i + nameStep / 2));
  y += nameH + gap;
  ctx.font = `500 ${game.px}px ${SANS}`;
  ctx.fillStyle = opts.titleColor;
  game.lines.forEach((line, i) => ctx.fillText(line, W / 2, y + gameStep * i + gameStep / 2));
  y += gameStep * game.lines.length + 6;
  ctx.fillStyle = opts.dateColor;
  ctx.font = `400 34px ${SANS}`;
  ctx.fillText(text.date, W / 2, y + dateH / 2);
}

/** Слоган и адреса — над полем ответа сторис. */
function footer(ctx: Ctx, slogan: string, url: string, sloganY = 1592) {
  ctx.fillStyle = slogan;
  ctx.font = `600 62px ${SERIF}`;
  ctx.fillText("Радость без хлопот", W / 2, sloganY);
  ctx.fillStyle = url;
  ctx.font = `400 34px ${SANS}`;
  spaced(ctx, "joy-rest.ru · t.me/JoyRest", W / 2, sloganY + 64, 3);
}

/** Без места — фраза «Я играл(а) в квиз JoyRest!» внутри венка. */
function headlineInside(ctx: Ctx, text: StoryCardText, cy: number, width: number, fill: string | CanvasGradient) {
  const r = fit(ctx, (px) => `700 ${px}px ${SERIF}`, text.headline, width, 3, 104, 64);
  const step = r.px * 1.06;
  const top = cy - (step * r.lines.length) / 2;
  ctx.font = `700 ${r.px}px ${SERIF}`;
  ctx.fillStyle = fill;
  r.lines.forEach((line, i) => ctx.fillText(line, W / 2, top + step * i + step / 2));
}

// ---------- «Венок» ----------

function paintWreath(ctx: Ctx, text: StoryCardText, mono: MonogramFor) {
  const metal = metalOf(text.medal);
  const bg = ctx.createRadialGradient(W / 2, 880, 0, W / 2, 880, 1300);
  bg.addColorStop(0, "#4D3D2B");
  bg.addColorStop(0.45, "#2B241E");
  bg.addColorStop(1, "#171412");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Луч прожектора сверху.
  const beam = ctx.createLinearGradient(0, 0, 0, 1250);
  beam.addColorStop(0, "rgba(255,236,190,0.30)");
  beam.addColorStop(1, "rgba(255,236,190,0)");
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 70, 0);
  ctx.lineTo(W / 2 + 70, 0);
  ctx.lineTo(W / 2 + 420, 1250);
  ctx.lineTo(W / 2 - 420, 1250);
  ctx.closePath();
  ctx.fill();

  confetti(ctx, ["#E3C68C", "#E3AA9C", "#A3C2AA", "#F3DFAE"], "#F3DFAE", 7);

  ctx.strokeStyle = "rgba(227,198,140,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(42, 42, W - 84, H - 84);
  ctx.strokeStyle = "rgba(227,198,140,0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(60, 60, W - 120, H - 120);
  for (const [x, y] of [[42, 42], [W - 42, 42], [42, H - 42], [W - 42, H - 42]] as const) diamond(ctx, x, y, 14, "#E3C68C");

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  logo(ctx, mono, "#F3DFAE", 228, 150, "JOYREST", "#E3C68C");

  ctx.fillStyle = "#C9BEB4";
  ctx.font = `400 38px ${SANS}`;
  spaced(ctx, storyEyebrow("wreath", text.medal), W / 2, 486, 20);

  const cy = 870;
  wreath(ctx, W / 2, cy, 320, metal.leaf, metal.berry);
  if (text.placeNumber !== null) {
    placeNumber(ctx, text.placeNumber, cy - 24, 500, metal.stops, "rgba(227,198,140,0.45)");
    ctx.fillStyle = "#F3DFAE";
    ctx.font = `400 36px ${SANS}`;
    spaced(ctx, "МЕСТО", W / 2, cy + 230, 20);
  } else {
    headlineInside(ctx, text, cy - 10, 400, vGradient(ctx, cy - 200, 400, METAL.gold.stops));
  }

  // Имя — на золотой ленте.
  bottomBlock(ctx, text, { nameFont: (px) => `600 ${px}px ${NAME_SANS}`, nameFrom: 64, nameTo: 44, nameColor: "#2A2018", ribbon: true, titleColor: "#FBF6F1", dateColor: "#C9BEB4" });
  footer(ctx, "#F3DFAE", "#C9BEB4");
}

// ---------- «Ар-деко» ----------

function paintDeco(ctx: Ctx, text: StoryCardText, mono: MonogramFor) {
  const metal = metalOf(text.medal);
  ctx.fillStyle = vGradient(ctx, 0, H, ["#1B1714", "#2A221B", "#1B1714"]);
  ctx.fillRect(0, 0, W, H);

  // Лучи из-за цифры, гаснут к краям.
  const cx = W / 2;
  const cy = 860;
  const rays = ctx.createRadialGradient(cx, cy, 60, cx, cy, 1150);
  rays.addColorStop(0, "rgba(227,198,140,0.16)");
  rays.addColorStop(0.5, "rgba(227,198,140,0.07)");
  rays.addColorStop(1, "rgba(227,198,140,0)");
  ctx.fillStyle = rays;
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 1400, a, a + (Math.PI * 2) / 120);
    ctx.closePath();
    ctx.fill();
  }

  confetti(ctx, ["#E3C68C", "#E3AA9C", "#F3DFAE"], "#F3DFAE", 11);

  // Рамка ар-деко: контур, уголки, шевроны сверху и снизу, внутренний контур, черты у цифры.
  const x0 = 48;
  const y0 = 48;
  const x1 = W - 48;
  const y1 = H - 48;
  ctx.strokeStyle = "rgba(227,198,140,0.7)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
    ctx.moveTo(x + sx * 24, y + sy * 120);
    ctx.lineTo(x + sx * 24, y + sy * 24);
    ctx.lineTo(x + sx * 120, y + sy * 24);
  }
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 180, y0 + 24);
  ctx.lineTo(W / 2, y0 + 72);
  ctx.lineTo(W / 2 + 180, y0 + 24);
  ctx.moveTo(W / 2 - 180, y1 - 24);
  ctx.lineTo(W / 2, y1 - 72);
  ctx.lineTo(W / 2 + 180, y1 - 24);
  ctx.moveTo(x0 + 42, cy);
  ctx.lineTo(x0 + 160, cy);
  ctx.moveTo(x1 - 160, cy);
  ctx.lineTo(x1 - 42, cy);
  ctx.stroke();
  ctx.strokeStyle = "rgba(227,198,140,0.3)";
  ctx.strokeRect(x0 + 42, y0 + 42, x1 - x0 - 84, y1 - y0 - 84);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  logo(ctx, mono, "#F3DFAE", 232, 136, null, "#E3C68C");
  ctx.fillStyle = "#E3C68C";
  ctx.font = `400 36px ${SANS}`;
  spaced(ctx, storyEyebrow("deco", text.medal), W / 2, 450, 22);

  if (text.placeNumber !== null) {
    placeNumber(ctx, text.placeNumber, cy - 20, 720, metal.stops, "rgba(227,198,140,0.40)", "rgba(243,223,174,0.55)");
    // Черта с «МЕСТО» в просвете.
    const ly = 1200;
    const line = ctx.createLinearGradient(120, 0, W - 120, 0);
    line.addColorStop(0, "rgba(227,198,140,0)");
    line.addColorStop(0.5, "rgba(227,198,140,1)");
    line.addColorStop(1, "rgba(227,198,140,0)");
    ctx.fillStyle = line;
    ctx.fillRect(120, ly - 1.5, W - 240, 3);
    ctx.fillStyle = "#231D18";
    ctx.fillRect(W / 2 - 170, ly - 40, 340, 80);
    ctx.fillStyle = "#F3DFAE";
    ctx.font = `600 66px ${SERIF}`;
    spaced(ctx, "МЕСТО", W / 2, ly, 22);
  } else {
    headlineInside(ctx, text, cy, 760, vGradient(ctx, cy - 220, 440, METAL.gold.stops));
  }

  bottomBlock(ctx, text, { nameFont: (px) => `700 ${px}px ${NAME_SERIF}`, nameFrom: 100, nameTo: 64, nameColor: "#FBF6F1", titleColor: "#C9BEB4", dateColor: "#C9BEB4", upper: true });
  footer(ctx, "#E3C68C", "#C9BEB4");
}

// ---------- «Светлый» ----------

function arch(ctx: Ctx, inset: number, bottomR: number) {
  const x0 = inset;
  const x1 = W - inset;
  const r = (x1 - x0) / 2;
  const top = inset + r;
  const y1 = H - inset;
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.arc(W / 2, top, r, Math.PI, 0);
  ctx.lineTo(x1, y1 - bottomR);
  ctx.quadraticCurveTo(x1, y1, x1 - bottomR, y1);
  ctx.lineTo(x0 + bottomR, y1);
  ctx.quadraticCurveTo(x0, y1, x0, y1 - bottomR);
  ctx.closePath();
}

function paintLight(ctx: Ctx, text: StoryCardText, mono: MonogramFor) {
  const bg = ctx.createRadialGradient(W / 2, 860, 0, W / 2, 860, 1250);
  bg.addColorStop(0, "#FFFCF8");
  bg.addColorStop(0.5, "#FBF6F1");
  bg.addColorStop(1, "#F1E6D9");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  confetti(ctx, ["#D2B477", "#E3AA9C", "#A3C2AA"], "#D2B477", 5);

  ctx.strokeStyle = "#D2B477";
  ctx.lineWidth = 4;
  arch(ctx, 48, 42);
  ctx.stroke();
  ctx.strokeStyle = "rgba(210,180,119,0.45)";
  ctx.lineWidth = 2;
  arch(ctx, 69, 27);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  logo(ctx, mono, "#B8924F", 250, 150, null, "#8A7458");
  ctx.fillStyle = "#8A7458";
  ctx.font = `400 36px ${SANS}`;
  spaced(ctx, storyEyebrow("light", text.medal), W / 2, 470, 20);

  const cy = 870;
  const leaf: [string, string] = text.medal === "silver" ? ["#D7DAE2", "#8E929E"] : text.medal === "bronze" ? ["#E6B48A", "#9A6236"] : ["#D9BC80", "#B48A47"];
  wreath(ctx, W / 2, cy, 310, leaf, "#E3AA9C");
  const stops = text.medal === "silver" ? ["#C9CCD4", "#8E929E", "#E4E6EC", "#7C808C"] : text.medal === "bronze" ? ["#E9B98A", "#A86B3C", "#EDC29A", "#8E5730"] : LIGHT_GOLD;
  if (text.placeNumber !== null) {
    placeNumber(ctx, text.placeNumber, cy - 24, 490, stops, "rgba(156,113,54,0.28)");
    ctx.fillStyle = "#9C7136";
    ctx.font = `400 36px ${SANS}`;
    spaced(ctx, "МЕСТО", W / 2, cy + 225, 20);
  } else {
    headlineInside(ctx, text, cy - 10, 400, vGradient(ctx, cy - 200, 400, LIGHT_GOLD));
  }

  bottomBlock(ctx, text, { nameFont: (px) => `700 ${px}px ${NAME_SERIF}`, nameFrom: 96, nameTo: 60, nameColor: "#2B2118", titleColor: "#5B4632", dateColor: "#7A6650" });
  footer(ctx, "#9C7136", "#8A7458");
}

/** Рисует карточку нужного стиля на холсте 1080×1920. */
export function paintStoryCard(ctx: Ctx, text: StoryCardText, style: StoryStyle, mono: MonogramFor) {
  ctx.save();
  if (style === "deco") paintDeco(ctx, text, mono);
  else if (style === "light") paintLight(ctx, text, mono);
  else paintWreath(ctx, text, mono);
  ctx.restore();
}
