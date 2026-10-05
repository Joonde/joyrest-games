import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import monogramSvg from "../../public/brand/joyrest-monogram.svg?inline-svg";
import { logoSide, QR_LOGO_MAX_SHARE, QR_QUIET_ZONE, qrSvg } from "./qrSvg";
import { uniquifyIds } from "./svgMarkup";

/** Растеризует SVG и распознаёт QR так же, как камера телефона. */
function decode(svg: string, width: number): string | null {
  const image = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render();
  const pixels = new Uint8ClampedArray(image.pixels.buffer, image.pixels.byteOffset, image.pixels.length);
  return jsQR(pixels, image.width, image.height)?.data ?? null;
}

const LINKS = [
  "https://joyrest-games.netlify.app/play/659142",
  "https://claude-zealous-lamport--joyrest-games.netlify.app/play/100000",
  "http://localhost:5173/play/987654",
];

describe("QR-код с монограммой", () => {
  it.each(LINKS)("распознаётся: %s", (link) => {
    const { svg } = qrSvg(link, uniquifyIds(monogramSvg, "t"));
    expect(decode(svg, 600)).toBe(link);
  });

  it("распознаётся и в маленьком размере (как на экране телефона)", () => {
    const { svg } = qrSvg(LINKS[0] ?? "", uniquifyIds(monogramSvg, "t"));
    expect(decode(svg, 240)).toBe(LINKS[0]);
  });

  it("логотип не больше 20 % ширины кода и стоит ровно по центру", () => {
    const { layout } = qrSvg(LINKS[0] ?? "", monogramSvg);
    expect(layout.logo).not.toBeNull();
    const logo = layout.logo ?? { x: 0, y: 0, side: 0 };
    expect(logo.side / layout.size).toBeLessThanOrEqual(QR_LOGO_MAX_SHARE);
    expect(logo.x - QR_QUIET_ZONE).toBe(layout.size - (logo.x - QR_QUIET_ZONE) - logo.side);
    expect(logo.x).toBe(logo.y);
  });

  it("тихая зона не меньше 4 модулей с каждой стороны", () => {
    const { layout, svg } = qrSvg(LINKS[0] ?? "");
    expect(layout.total - layout.size).toBe(QR_QUIET_ZONE * 2);
    expect(QR_QUIET_ZONE).toBeGreaterThanOrEqual(4);
    // Ни один модуль не начинается в тихой зоне.
    const starts = [...svg.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((m) => m.slice(1).map(Number));
    for (const [x = 0, y = 0, len = 0] of starts) {
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(x + len).toBeLessThanOrEqual(layout.total - QR_QUIET_ZONE);
      expect(y + 1).toBeLessThanOrEqual(layout.total - QR_QUIET_ZONE);
    }
  });

  it("сторона логотипа той же чётности, что и код", () => {
    for (const size of [21, 25, 29, 33, 37, 41, 45]) {
      const side = logoSide(size);
      expect((size - side) % 2).toBe(0);
      expect(side / size).toBeLessThanOrEqual(QR_LOGO_MAX_SHARE);
    }
  });
});
