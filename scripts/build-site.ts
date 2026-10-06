/**
 * Сборка сайта агентства: site/ → build/site (в образе /app/site, раздаёт server/src/site.ts).
 *
 * - css/, js/, img/ получают отпечаток содержимого в имени (style.3f2a9c01de.css), ссылки в
 *   index.html и CSS переписываются: браузер хранит их год и берёт новый файл после правки.
 * - Шрифты — файлы платформы из public/fonts/ (имена не меняются, CLAUDE.md, раздел 8).
 * - Логотипы — файлы public/brand/ (не перерисовываем): элемент с data-brand-svg="<имя>"
 *   получает встроенный SVG (метаданные вырезаны, id уникальны, цвет — currentColor из CSS).
 * - Иконки — public/brand/favicon.svg и PNG из него: 32×32 и 180×180 (apple-touch-icon).
 * - Ссылка на несуществующий локальный файл — ошибка сборки.
 *
 * Запуск: npm run build:site (вызывают Dockerfile и CI).
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, relative, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { hideFromScreenReaders, uniquifyIds } from "../src/brand/svgMarkup";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = join(ROOT, "site");
const OUT = join(ROOT, "build", "site");
const HASHED_DIRS = ["img", "css", "js"]; // порядок важен: CSS ссылается на картинки
const SKIP = new Set(["README.md"]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Путь от корня сайта в стиле URL: css/style.css. */
const urlPath = (file: string) => relative(OUT, file).split("\\").join("/");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SOURCE, OUT, { recursive: true, filter: (src) => !SKIP.has(basename(src)) });

const fontsOut = join(OUT, "fonts");
mkdirSync(fontsOut, { recursive: true });
for (const name of readdirSync(join(ROOT, "public", "fonts"))) {
  if (name.endsWith(".woff2") || name === "OFL.txt") cpSync(join(ROOT, "public", "fonts", name), join(fontsOut, name));
}
const BRAND = join(ROOT, "public", "brand");

/** SVG из public/brand без метаданных (как плагин ?inline-svg в vite.config.ts). */
function brandSvg(name: string): string {
  return readFileSync(join(BRAND, `${name}.svg`), "utf8")
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
    .replace(/\s+xmlns:c2pa="[^"]*"/g, "")
    .trim();
}

// Иконки вкладки и экрана «Домой». У apple-touch-icon фон во весь квадрат: iOS сам скругляет
// углы, а прозрачные углы закрасил бы чёрным.
const favicon = brandSvg("favicon");
writeFileSync(join(OUT, "favicon.svg"), favicon);
const png = (svg: string, size: number) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
writeFileSync(join(OUT, "favicon-32.png"), png(favicon, 32));
writeFileSync(join(OUT, "apple-touch-icon.png"), png(favicon.replace(/(<rect width="512" height="512") rx="\d+"/, "$1"), 180));

// Логотипы: встраиваем в разметку, у каждого экземпляра свои id в clipPath.
{
  const indexFile = join(OUT, "index.html");
  let count = 0;
  const html = readFileSync(indexFile, "utf8").replace(
    /(<(\w+)\b[^>]*\bdata-brand-svg="([a-z-]+)"[^>]*>)(<\/\2>)/g,
    (_whole, open: string, _tag: string, name: string, close: string) => {
      if (!existsSync(join(BRAND, `${name}.svg`))) throw new Error(`Нет логотипа public/brand/${name}.svg`);
      count += 1;
      return open + hideFromScreenReaders(uniquifyIds(brandSvg(name), `s${count}`)) + close;
    },
  );
  if (html.includes("data-brand-svg") && count !== (html.match(/data-brand-svg=/g) ?? []).length) {
    throw new Error("Элемент data-brand-svg должен быть пустым: <span data-brand-svg=\"…\"></span>");
  }
  writeFileSync(indexFile, html);
}

/** Старое имя → новое (оба от корня сайта). */
const renamed = new Map<string, string>();
const missing: string[] = [];

// Ссылки в HTML (src/href) и CSS (url()). Внешние адреса, якоря, tel:, mailto:, data: не трогаем.
const REF = /(\b(?:src|href)=["'])([^"']+)(["'])|(url\(\s*["']?)([^"')]+)(["']?\s*\))/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function rewrite(file: string): void {
  const text = readFileSync(file, "utf8");
  const from = posix.dirname(urlPath(file));
  const next = text.replace(REF, (whole, a1?: string, ref1?: string, a3?: string, b1?: string, ref2?: string, b3?: string) => {
    const ref = (ref1 ?? ref2 ?? "").trim();
    if (!ref || EXTERNAL.test(ref)) return whole;
    const [path, suffix = ""] = ref.split(/(?=[?#])/);
    const target = path.startsWith("/") ? path.slice(1) : posix.normalize(posix.join(from, path));
    if (!renamed.has(target) && !existsSync(join(OUT, target))) {
      missing.push(`${urlPath(file)} → ${ref}`);
      return whole;
    }
    const hashed = renamed.get(target);
    if (!hashed) return whole;
    const replaced = path.startsWith("/") ? "/" + hashed : posix.relative(from, hashed);
    return ref1 !== undefined ? `${a1}${replaced}${suffix}${a3}` : `${b1}${replaced}${suffix}${b3}`;
  });
  if (next !== text) writeFileSync(file, next);
}

for (const dir of HASHED_DIRS) {
  for (const file of walk(join(OUT, dir))) {
    if (extname(file) === ".css") rewrite(file);
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10);
    const ext = extname(file);
    const target = join(dirname(file), `${basename(file, ext)}.${hash}${ext}`);
    renameSync(file, target);
    renamed.set(urlPath(file), urlPath(target));
  }
}
rewrite(join(OUT, "index.html"));

if (missing.length > 0) {
  console.error("Сайт ссылается на несуществующие файлы:\n  " + missing.join("\n  "));
  process.exit(1);
}
console.log(`Сайт собран: ${relative(ROOT, OUT)} (${renamed.size} файлов с отпечатком)`);
