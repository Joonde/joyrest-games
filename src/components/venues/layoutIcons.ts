/** Схемы рассадки для анкеты площадки (контур цветом текста, viewBox 100×46). Статичная разметка. */
const T = (x: number, y: number) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
const C = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="2" fill="currentColor"/>`;
const line = (d: string, width = 4) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const bar = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="currentColor"/>`;

export const LAYOUT_ICONS: Record<string, string> = {
  "Круглые столы": [[20, 15], [50, 15], [80, 15], [35, 34], [65, 34]].map(([x, y]) => T(x ?? 0, y ?? 0)).join(""),
  "П-образно": line("M20 8 V38 M20 8 H80 M80 8 V38"),
  "Общий стол": `<rect x="18" y="19" width="64" height="8" rx="2" fill="currentColor"/>` + [25, 40, 55, 70].map((x) => C(x, 13) + C(x, 33)).join(""),
  Фуршет: bar(14, 6, 72, 5) + [[24, 22], [40, 30], [58, 20], [74, 32], [50, 40], [30, 38]].map(([x, y]) => C(x ?? 0, y ?? 0)).join(""),
  "Театр, рядами": [12, 20, 28, 36].map((y) => [24, 36, 48, 60, 72].map((x) => C(x, y)).join("")).join("") + bar(30, 2, 36, 4),
  "Т-образно": line("M18 8 H82 M50 8 V40"),
  "Ш-образно, гребёнка": line("M16 8 H84 M22 8 V40 M50 8 V40 M78 8 V40"),
  Ёлочка: [14, 24, 34].map((y) => line(`M20 ${y + 6} L42 ${y} M80 ${y + 6} L58 ${y}`)).join("") + bar(40, 2, 20, 4),
  "Стол молодожёнов + гости": bar(38, 4, 24, 5) + C(45, 13) + C(55, 13) + [[22, 30], [50, 34], [78, 30]].map(([x, y]) => T(x ?? 0, y ?? 0)).join(""),
  "Каре (квадрат)": `<rect x="24" y="8" width="52" height="30" rx="2" fill="none" stroke="currentColor" stroke-width="4"/>`,
  "Отдельные столы на 4–6": [[22, 14], [50, 14], [78, 14], [22, 34], [50, 34], [78, 34]]
    .map(([x, y]) => `<rect x="${(x ?? 0) - 8}" y="${(y ?? 0) - 4}" width="16" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>`)
    .join(""),
  Класс: bar(30, 2, 36, 4) + [14, 26, 38].map((y) => bar(18, y, 26, 4) + bar(56, y, 26, 4) + [24, 36, 62, 74].map((x) => C(x, y + 7)).join("")).join(""),
  "Коктейль, высокие столы": [[24, 16], [50, 26], [76, 16], [36, 36], [66, 38]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="currentColor"/>` + C((x ?? 0) - 7, y ?? 0) + C((x ?? 0) + 7, y ?? 0))
    .join(""),
  "Лаунж-зоны с диванами": [[28, 23], [72, 23]]
    .map(([x = 0, y = 0]) => line(`M${x - 14} ${y - 10} V${y + 10} H${x + 14} V${y - 10}`) + `<rect x="${x - 5}" y="${y - 2}" width="10" height="6" rx="1" fill="currentColor"/>`)
    .join(""),
  Кабаре:
    [[25, 20], [50, 20], [75, 20], [38, 36], [62, 36]].map(([x = 0, y = 0]) => line(`M${x - 6} ${y} A6 6 0 0 0 ${x + 6} ${y}`, 1.5) + C(x, y + 3)).join("") + bar(30, 2, 36, 4),
};

export function layoutSvg(name: string): string {
  return `<svg viewBox="0 0 100 46" aria-hidden="true" focusable="false">${LAYOUT_ICONS[name] ?? ""}</svg>`;
}
