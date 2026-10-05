import { describe, expect, it } from "vitest";
import { hideFromScreenReaders, uniquifyIds, withGradient } from "./svgMarkup";

const sample =
  '<svg viewBox="0 0 100 50"><defs><clipPath id="jrc"><rect/></clipPath></defs>' +
  '<g fill="currentColor"><path clip-path="url(#jrc)"/><path stroke="currentColor"/></g></svg>';

describe("встроенный логотип", () => {
  it("делает id clipPath уникальными вместе со ссылками", () => {
    const a = uniquifyIds(sample, "a1");
    const b = uniquifyIds(sample, "b2");
    expect(a).toContain('id="jrc-a1"');
    expect(a).toContain("url(#jrc-a1)");
    expect(a).not.toContain('"jrc"');
    expect(b).toContain("url(#jrc-b2)");
  });

  it("заливает градиентом вместо currentColor", () => {
    const g = withGradient(sample, ["#111111", "#222222", "#333333"], "grad");
    expect(g).not.toContain("currentColor");
    expect(g).toContain('fill="url(#grad)"');
    expect(g).toContain('stroke="url(#grad)"');
    expect(g).toContain('<linearGradient id="grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="50">');
    expect(g).toContain('offset="0.5" stop-color="#222222"');
  });

  it("скрывает svg от экранного диктора", () => {
    expect(hideFromScreenReaders(sample)).toMatch(/^<svg aria-hidden="true"/);
  });
});
