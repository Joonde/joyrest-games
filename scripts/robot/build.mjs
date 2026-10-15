// Сборка страницы робота (esbuild). Запуск: node scripts/robot/build.mjs <папка для сборки>
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.resolve(process.argv[2] ?? path.join(root, "build/robot"));
fs.mkdirSync(out, { recursive: true });
const dataIndex = path.join(root, "src/data/index.ts");

const result = await build({
  entryPoints: [process.env.ROBOT_ENTRY ? path.resolve(process.env.ROBOT_ENTRY) : path.join(import.meta.dirname, "entry.tsx")],
  bundle: true,
  outfile: path.join(out, "robot.js"),
  format: "esm",
  jsx: "automatic",
  logLevel: "warning",
  metafile: true,
  loader: { ".woff2": "file", ".svg": "text", ".png": "file", ".jpg": "file", ".webp": "file", ".mp3": "file" },
  nodePaths: process.env.ROBOT_NODE_PATH ? [process.env.ROBOT_NODE_PATH] : [],
  // Firebase-версия роботу не нужна (динамическая загрузка SDK не выполняется).
  external: ["firebase/*", "/fonts/*", "/olymp/*", "/brand/*", "/sounds/*", "/cards/*", "/shows/*", "/stage/*", "/spy/*", "/dance/*"],
  define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" },
  plugins: [
    {
      name: "robot",
      setup(b) {
        b.onResolve({ filter: /\?inline-svg$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace("?inline-svg", "")), namespace: "isvg" }));
        b.onLoad({ filter: /.*/, namespace: "isvg" }, (a) => ({ contents: `export default ${JSON.stringify(fs.readFileSync(a.path, "utf8"))}`, loader: "js" }));
        b.onResolve({ filter: /^qrcode$/ }, () => ({ path: path.join(import.meta.dirname, "qrcode-stub.ts") }));
        b.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: path.join(import.meta.dirname, "router-stub.tsx") }));
        // Слой данных — в памяти робота (без Firebase и сервера).
        b.onResolve({ filter: /(^|\/)data(\/index)?$/ }, (a) => {
          const full = path.resolve(a.resolveDir, a.path);
          const dir = path.dirname(dataIndex);
          return full === dir || full === dataIndex.replace(/\.ts$/, "") || full === dataIndex ? { path: path.join(import.meta.dirname, "data-stub.ts") } : undefined;
        });
      },
    },
  ],
});
fs.writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="/robot.css"></head><body><div id="root"></div><script type="module" src="/robot.js"></script></body></html>`,
);
if (process.env.ROBOT_META) fs.writeFileSync(process.env.ROBOT_META, JSON.stringify(result.metafile));
console.log("робот собран:", out);
