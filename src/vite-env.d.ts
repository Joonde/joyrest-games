/// <reference types="vite/client" />

declare module "*.svg?inline-svg" {
  const markup: string;
  export default markup;
}

// pdf.js: сборка «legacy» для старых iPhone и телевизоров — те же типы, что у основной.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
