/// <reference types="vite/client" />

declare module "*.svg?inline-svg" {
  const markup: string;
  export default markup;
}
