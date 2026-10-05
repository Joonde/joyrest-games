import QRCode from "qrcode";
import { brand } from "../themes/brand";

/** Чистая сборка SVG QR-кода в фирменном стиле. Без React, проверяется тестом распознавания. */

/** Тихая зона вокруг кода в модулях: стандарт требует не меньше 4. */
export const QR_QUIET_ZONE = 4;

/** Логотип в центре занимает не больше этой доли ширины кода (без тихой зоны). */
export const QR_LOGO_MAX_SHARE = 0.2;

export const QR_COLORS = { plate: brand.cream, modules: brand.espresso } as const;

export interface QrLayout {
  /** Модулей в стороне кода. */
  size: number;
  /** Сторона всей плашки в модулях: код + тихая зона с двух сторон. */
  total: number;
  /** Подложка логотипа: левый верхний угол и сторона в модулях; null — без логотипа. */
  logo: { x: number; y: number; side: number } | null;
}

/** Сторона подложки логотипа: ≤ 20 % кода и той же чётности, что код, — чтобы стоять ровно по центру. */
export function logoSide(size: number): number {
  let side = Math.floor(size * QR_LOGO_MAX_SHARE);
  if ((size - side) % 2 !== 0) side -= 1;
  return Math.max(side, 0);
}

function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** Встраивает SVG логотипа в квадрат (x, y, side) с цветом модулей. */
function placeLogo(markup: string, x: number, y: number, side: number): string {
  return markup.replace(
    /<svg\b([^>]*)>/,
    (_tag, attrs: string) =>
      `<svg${attrs} x="${round(x)}" y="${round(y)}" width="${round(side)}" height="${round(side)}" ` +
      `color="${QR_COLORS.modules}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">`,
  );
}

/**
 * QR-код с уровнем коррекции H: кремовая скруглённая плашка, тёмные модули,
 * равная тихая зона со всех сторон и монограмма в центре на кремовой подложке.
 * `logoMarkup` — разметка SVG логотипа (currentColor), id внутри уже уникальны.
 */
export function qrSvg(value: string, logoMarkup?: string): { svg: string; layout: QrLayout } {
  const qr = QRCode.create(value, { errorCorrectionLevel: "H" });
  const size = qr.modules.size;
  const total = size + QR_QUIET_ZONE * 2;
  const side = logoMarkup ? logoSide(size) : 0;
  const logoStart = (size - side) / 2;
  const underLogo = (x: number, y: number) =>
    side > 0 && x >= logoStart && x < logoStart + side && y >= logoStart && y < logoStart + side;

  // Тёмные модули строки склеиваем в отрезки: так SVG в разы короче.
  let path = "";
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!qr.modules.get(y, x) || underLogo(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && qr.modules.get(y, x) && !underLogo(x, y)) x++;
      path += `M${start + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h${x - start}v1h-${x - start}z`;
    }
  }

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" aria-hidden="true" focusable="false">`,
    `<rect width="${total}" height="${total}" rx="${round(QR_QUIET_ZONE * 0.6)}" fill="${QR_COLORS.plate}"/>`,
    `<path d="${path}" fill="${QR_COLORS.modules}" shape-rendering="crispEdges"/>`,
  ];

  let logo: QrLayout["logo"] = null;
  if (logoMarkup && side > 0) {
    const x = logoStart + QR_QUIET_ZONE;
    logo = { x, y: x, side };
    parts.push(`<rect x="${x}" y="${x}" width="${side}" height="${side}" rx="${round(side * 0.22)}" fill="${QR_COLORS.plate}"/>`);
    const inset = side * 0.14;
    parts.push(placeLogo(logoMarkup, x + inset, x + inset, side - inset * 2));
  }
  parts.push("</svg>");
  return { svg: parts.join(""), layout: { size, total, logo } };
}
