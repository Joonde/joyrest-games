import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

const INLINE_SVG = "?inline-svg";

/**
 * `import svg from "…/logo.svg?inline-svg"` — разметка SVG строкой для встраивания
 * в страницу (чтобы работал currentColor). Блок <metadata> вырезается: он не нужен
 * для отрисовки и только утяжеляет код на телефоне гостя.
 */
function inlineSvg(): Plugin {
  return {
    name: "joyrest-inline-svg",
    enforce: "pre",
    load(id) {
      if (!id.endsWith(INLINE_SVG)) return null;
      const file = id.slice(0, -INLINE_SVG.length);
      this.addWatchFile(file);
      const markup = readFileSync(file, "utf8")
        .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
        .replace(/\s+xmlns:c2pa="[^"]*"/g, "")
        .trim();
      return `export default ${JSON.stringify(markup)};`;
    },
  };
}

export default defineConfig({
  plugins: [inlineSvg(), react()],
  test: {
    include: ["src/**/*.test.ts"],
  },
});
