/** Подготовка встроенного SVG логотипа к показу. Чистые функции без React. */

/**
 * Делает id внутри SVG уникальными: на одной странице может быть несколько логотипов,
 * а одинаковые id clipPath ломают отрисовку в части браузеров.
 */
export function uniquifyIds(markup: string, suffix: string): string {
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id): id is string => !!id);
  let result = markup;
  for (const id of ids) {
    const unique = `${id}-${suffix}`;
    result = result
      .split(`id="${id}"`).join(`id="${unique}"`)
      .split(`url(#${id})`).join(`url(#${unique})`)
      .split(`href="#${id}"`).join(`href="#${unique}"`);
  }
  return result;
}

function viewBoxOf(markup: string): [number, number, number, number] {
  const m = /viewBox="([^"]+)"/.exec(markup);
  const parts = (m?.[1] ?? "0 0 100 100").split(/[\s,]+/).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 100, parts[3] ?? 100];
}

/** Заменяет currentColor на диагональный градиент по всей площади логотипа. */
export function withGradient(markup: string, stops: readonly string[], id: string): string {
  const [x, y, w, h] = viewBoxOf(markup);
  const stopTags = stops
    .map((color, i) => `<stop offset="${stops.length > 1 ? i / (stops.length - 1) : 0}" stop-color="${color}"/>`)
    .join("");
  const gradient =
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}">${stopTags}</linearGradient>`;
  const painted = markup.split('"currentColor"').join(`"url(#${id})"`);
  return painted.includes("<defs>")
    ? painted.replace("<defs>", `<defs>${gradient}`)
    : painted.replace(/<svg([^>]*)>/, `<svg$1><defs>${gradient}</defs>`);
}

/** Декоративный SVG: скрыт от экранного диктора (подпись — у обёртки). */
export function hideFromScreenReaders(markup: string): string {
  return markup.replace(/<svg\b/, '<svg aria-hidden="true" focusable="false"');
}
