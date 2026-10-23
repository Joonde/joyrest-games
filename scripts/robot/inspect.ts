// «Ревизор» — глаза робота-ведущего (CLAUDE.md, раздел 9). Робот проверяет, что игра идёт по правилам; Ревизор
// смотрит, что при этом видят люди: экран зала на настоящем размере телевизора или проектора, пульт и телефоны
// гостей в настоящей обёртке страницы. На каждом новом виде игры он ищет то, что мешает ведущему и гостям:
// «undefined», «NaN» и прочий мусор вместо текста, обрезанный и уехавший за край текст, надписи друг на друге и
// закрытые другими элементами, мелкий для зала текст, бледный текст на фоне, битые картинки, пустой экран, кнопки
// меньше пальца и прокрутку вбок на телефоне. Каждая находка — одна запись с ключом (повторы только считаются),
// первая — со снимком (`window.robotSnap`, его даёт scripts/robot/inspect.mjs).

export type Area = "экран зала" | "пульт" | "телефон";

export interface Finding {
  key: string;
  area: Area;
  kind: string;
  /** Что не так — по-русски, с числами. */
  message: string;
  /** Где на странице: короткий путь по классам. */
  path: string;
  /** Текст элемента (до 80 символов). */
  text: string;
  /** Этап игры, где увидели впервые. */
  at: string;
  count: number;
  shot?: string;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GARBAGE = /\b(undefined|NaN|Infinity|null)\b|\[object [A-Za-z]+\]|Invalid Date|\{\{|\}\}|\$\{|(^|[\s(])-\d+\s?(с|сек|мин)\b/;

function box(r: DOMRect): Box {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function cssPath(el: Element, stop: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== stop && parts.length < 4) {
    const cls = [...cur.classList].filter((c) => !/^is-|^has-|--\d/.test(c)).slice(0, 2);
    parts.unshift(cur.tagName.toLowerCase() + (cls.length ? `.${cls.join(".")}` : ""));
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

function ownText(el: Element): string {
  let s = "";
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? "";
  return s.replace(/\s+/g, " ").trim();
}

/** Видимая часть прямоугольника: обрезана родителями с overflow (имя с многоточием не «длиннее» своей рамки). */
function clipped(el: Element, r: Box): Box | null {
  let { x, y } = r;
  let x2 = r.x + r.w;
  let y2 = r.y + r.h;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const cs = getComputedStyle(cur);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const b = cur.getBoundingClientRect();
    if (cs.overflowX !== "visible") {
      x = Math.max(x, b.left);
      x2 = Math.min(x2, b.right);
    }
    if (cs.overflowY !== "visible") {
      y = Math.max(y, b.top);
      y2 = Math.min(y2, b.bottom);
    }
  }
  return x2 - x >= 1 && y2 - y >= 1 ? { x, y, w: x2 - x, h: y2 - y } : null;
}

function textLines(el: Element): Box[] {
  // Строки самого текста (а не блока): видимые прямоугольники строк всех текстовых узлов элемента.
  const lines: Box[] = [];
  for (const n of el.childNodes) {
    if (n.nodeType !== Node.TEXT_NODE || !(n.textContent ?? "").trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const c = clipped(el, box(r));
      if (c) lines.push(c);
    }
  }
  return lines;
}

function textRect(el: Element): Box | null {
  // Прямоугольник самого текста (а не блока): объединение строк всех текстовых узлов элемента.
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of el.childNodes) {
    if (n.nodeType !== Node.TEXT_NODE || !(n.textContent ?? "").trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      x1 = Math.min(x1, r.left);
      y1 = Math.min(y1, r.top);
      x2 = Math.max(x2, r.right);
      y2 = Math.max(y2, r.bottom);
    }
  }
  return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function opacityChain(el: Element, root: Element): number {
  let o = 1;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const cs = getComputedStyle(cur);
    o *= Number(cs.opacity);
    if (cs.visibility === "hidden" || cs.display === "none") return 0;
    if (cur === root) break;
  }
  return o;
}

function decorative(el: Element, root: Element): boolean {
  for (let cur: Element | null = el; cur && cur !== root.parentElement; cur = cur.parentElement) {
    if (cur.getAttribute("aria-hidden") === "true" || cur.hasAttribute("inert") || cur.hasAttribute("hidden")) return true;
    if (cur.tagName === "svg" || cur.tagName === "SVG") return true;
  }
  return false;
}

/**
 * Повёрнут ли элемент или его предок до области (`transform` с поворотом или наклоном — матрица с b ≠ 0 или c ≠ 0,
 * свойство `rotate`): карты «Дурака» веером, козырь на 90°. У повёрнутого элемента getBoundingClientRect — внешняя
 * рамка повёрнутого прямоугольника, она шире самого элемента, и «обрезан» / «за краем» по ней — ложная находка.
 */
function rotated(el: Element, root: Element): boolean {
  for (let cur: Element | null = el; cur && cur !== root.parentElement; cur = cur.parentElement) {
    const cs = getComputedStyle(cur);
    if (cs.rotate && cs.rotate !== "none" && !/^0(deg|rad|turn)?$/.test(cs.rotate.trim())) return true;
    const t = cs.transform;
    if (t && t !== "none") {
      const m = t.match(/^matrix(3d)?\(([^)]+)\)$/);
      if (m) {
        const v = (m[2] ?? "").split(",").map(Number);
        // matrix(a, b, c, d, e, f); matrix3d: b — 2-е, c — 5-е число.
        const b = v[1];
        const c = m[1] ? v[4] : v[2];
        if (Math.abs(b ?? 0) > 0.01 || Math.abs(c ?? 0) > 0.01) return true;
      }
    }
    if (cur === root) break;
  }
  return false;
}

/** Сложная форма: clip-path у элемента или предка до области (половинки рубашки «Правда или действие»). */
function shaped(el: Element, root: Element): boolean {
  for (let cur: Element | null = el; cur && cur !== root.parentElement; cur = cur.parentElement) {
    const cp = getComputedStyle(cur).clipPath;
    if (cp && cp !== "none" && !cp.includes("inset(50%")) return true;
    if (cur === root) break;
  }
  return false;
}

/** Видно ли элемент вообще: display, visibility, прозрачность, закрытый <details> (content-visibility). */
function shown(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  return check ? check.call(el, { checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }) : true;
}

/** Служебное экрана зала: кнопки «Во весь экран» (прячутся сами), выход после игры, значок звука. */
const SERVICE = ".screen-controls, .screen-exit, .screen-tap";

/** Нарочно сложенное друг на друга: карты веером и в стопке, рисованные лица карт. Наложения там — замысел. */
const LAYERED = ".dk-card, .dk-hand, .dk-mini, .td-face, .td-back, .bk-card, .mf-card, .sp-card";

/** Только смайлики и знаки — цветные картинки, контраст и размер у них не меряем. */
const NO_LETTERS = /^[^\p{L}\p{N}]*$/u;

function inFixed(el: Element, root: Element): boolean {
  for (let cur: Element | null = el; cur && cur !== root; cur = cur.parentElement) if (getComputedStyle(cur).position === "fixed") return true;
  return false;
}

function visuallyHidden(el: Element, r: Box): boolean {
  if (r.w <= 2 || r.h <= 2) return true;
  const cs = getComputedStyle(el);
  return cs.clipPath.includes("inset(50%") || cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clip === "rect(1px, 1px, 1px, 1px)";
}

/** Цвет `rgb(a)` → [r, g, b, a]; другой формат — null (не гадаем). */
function rgba(c: string): [number, number, number, number] | null {
  const m = c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  if (!Number.isFinite(a)) a = 1;
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

function lum([r, g, b]: [number, number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function over(top: [number, number, number, number], under: [number, number, number, number]): [number, number, number, number] {
  const a = top[3] + under[3] * (1 - top[3]);
  if (a <= 0) return [0, 0, 0, 0];
  const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
  return [mix(0), mix(1), mix(2), a];
}

/** Фон под точкой: слои снизу вверх до первого непрозрачного. Под текстом картинка или градиент — null (не судим). */
function backgroundAt(x: number, y: number, el: Element): [number, number, number, number] | null {
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  const stack = document.elementsFromPoint(x, y);
  let color: [number, number, number, number] = [0, 0, 0, 0];
  const layers: [number, number, number, number][] = [];
  for (const e of stack) {
    // Свой фон элемента (кружок под буквой) — тоже фон текста; вложенные в него элементы — нет.
    if (e !== el && el.contains(e)) continue;
    const tag = e.tagName;
    if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" || tag === "IFRAME" || tag === "svg" || tag === "SVG" || e instanceof SVGElement) return null;
    const cs = getComputedStyle(e);
    if (cs.backgroundImage !== "none" || cs.backdropFilter !== "none" || cs.filter !== "none" || cs.mixBlendMode !== "normal") return null;
    // Псевдоэлементы (::before с картинкой сцены) elementsFromPoint не видит — их фон спрашиваем у владельца.
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(e, pseudo);
      if (ps.content !== "none" && ps.content !== "normal" && (ps.backgroundImage !== "none" || ps.position === "absolute" || ps.position === "fixed")) {
        if (ps.backgroundImage !== "none") return null;
        const pc = rgba(ps.backgroundColor);
        if (pc && pc[3] > 0.05) return null;
      }
    }
    const c = rgba(cs.backgroundColor);
    if (!c) return null;
    if (c[3] > 0) layers.push(c);
    if (c[3] >= 0.999) break;
  }
  for (let i = layers.length - 1; i >= 0; i--) color = over(layers[i] as [number, number, number, number], color);
  if (color[3] < 0.999) color = over(color, [255, 255, 255, 1]);
  return color;
}

export interface InspectOptions {
  area: Area;
  root: Element;
  at: string;
  /** Высота экрана зала — для «мелко для зала». */
  hallHeight?: number;
  /** Идёт игра (пустой экран — находка). */
  playing: boolean;
}

export interface Raw {
  kind: string;
  message: string;
  el: Element;
  path: string;
  text: string;
  rect: Box;
}

const MIN_HALL_FONT = 0.017; // от высоты экрана: 18 px на 1080, 13 px на 768
const MIN_PHONE_FONT = 12;
const MIN_TAP = 40;

/** Все находки в одной области. Чистая проверка DOM — ничего не меняет. */
export function inspectArea(o: InspectOptions): Raw[] {
  const out: Raw[] = [];
  const { root, area } = o;
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width < 2 || rootRect.height < 2) return out;
  const leaves: { el: Element; text: string; rect: Box; lines: Box[]; cs: CSSStyleDeclaration; turned: boolean; shape: boolean }[] = [];
  const add = (kind: string, message: string, el: Element, rect: Box, text = "") =>
    out.push({ kind, message, el, path: cssPath(el, root), text: text.slice(0, 80), rect });

  for (const el of root.querySelectorAll("*")) {
    const text = ownText(el);
    if (!text) continue;
    if (decorative(el, root) || el.closest(SERVICE) || !shown(el)) continue;
    // Пульт и телефон: окна поверх страницы (position: fixed) в Ревизоре привязаны к окну экрана зала — не судим.
    if (area !== "экран зала" && inFixed(el, root)) continue;
    const r = textRect(el);
    if (!r || visuallyHidden(el, r)) continue;
    if (opacityChain(el, root) < 0.15) continue;
    const cs = getComputedStyle(el);
    leaves.push({ el, text, rect: r, lines: textLines(el), cs, turned: rotated(el, root), shape: shaped(el, root) });
  }

  // 1. Мусор вместо текста. Смотрим и подписи кнопок (aria-label, title) — их читают и видят.
  for (const l of leaves) if (GARBAGE.test(l.text)) add("мусор в тексте", `на экране «${l.text.match(GARBAGE)?.[0]?.trim()}»`, l.el, l.rect, l.text);
  for (const el of root.querySelectorAll("[aria-label], [title], img[alt]")) {
    const label = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.getAttribute("alt") ?? ""}`;
    const m = label.match(GARBAGE);
    if (m && !decorative(el, root)) add("мусор в подписи", `подпись «${m[0].trim()}»`, el, box(el.getBoundingClientRect()), label.trim());
  }

  // 2. Обрезано или уехало: текст выходит за родителя, который его обрезает (overflow), или за саму область.
  for (const l of leaves) {
    // Повёрнутый текст: рамка шире самого текста — по ней не судим (см. `rotated`).
    if (l.turned) continue;
    const r = l.rect;
    for (let cur = l.el.parentElement as Element | null, self: Element | null = l.el; self && self !== root.parentElement; self = cur, cur = cur?.parentElement ?? null) {
      const c = self === l.el ? l.cs : getComputedStyle(self);
      const clipX = c.overflowX !== "visible";
      const clipY = c.overflowY !== "visible";
      if (!clipX && !clipY && self !== root) continue;
      const b = self.getBoundingClientRect();
      // Внутренняя область (без рамки): clientLeft/Top — толщина рамки.
      const inner = { x: b.left + (self as HTMLElement).clientLeft, y: b.top + (self as HTMLElement).clientTop, w: (self as HTMLElement).clientWidth || b.width, h: (self as HTMLElement).clientHeight || b.height };
      const outX = Math.max(inner.x - r.x, r.x + r.w - (inner.x + inner.w));
      const outY = Math.max(inner.y - r.y, r.y + r.h - (inner.y + inner.h));
      const designedX = c.textOverflow === "ellipsis" || c.webkitLineClamp !== "none";
      const designedY = c.webkitLineClamp !== "none" && c.webkitLineClamp !== "";
      const scroll = (clipX && (c.overflowX === "auto" || c.overflowX === "scroll")) || (clipY && (c.overflowY === "auto" || c.overflowY === "scroll"));
      // Телефон и пульт листаются вниз — за нижний край области текст уйти может, вбок — нет.
      const rootY = self === root && area === "экран зала";
      const hidden = (clipX || self === root) && outX > 3 && !designedX ? `вбок на ${Math.round(outX)} px` : (clipY || rootY) && outY > 3 && !designedY ? `по высоте на ${Math.round(outY)} px` : "";
      if (!hidden) {
        // Обрезано задуманно (многоточие) — выше не смотрим: дальше этот текст уже не виден.
        if (self !== root && ((clipX && outX > 3 && designedX) || (clipY && outY > 3 && designedY))) break;
        continue;
      }
      if (self === root) add(area === "экран зала" ? "за краем экрана" : "за краем", `текст выходит за край ${area === "экран зала" ? "экрана" : "области"} ${hidden}`, l.el, r, l.text);
      else if (scroll) {
        // На телевизоре прокрутить некому; на телефоне и пульте прокрутка внутри блока — норма.
        if (area === "экран зала") add("прячется за прокруткой", `на экране зала текст виден только прокруткой (${hidden})`, l.el, r, l.text);
      } else add("обрезан текст", `текст обрезан ${hidden} (${cssPath(self, root).split(" > ").pop()})`, l.el, r, l.text);
      break;
    }
  }

  // 3. Надписи друг на друге и закрытые другими элементами.
  for (let i = 0; i < leaves.length; i++) {
    const a = leaves[i];
    if (!a || a.el.closest(LAYERED)) continue;
    for (let j = i + 1; j < leaves.length; j++) {
      const b = leaves[j];
      if (!b || a.el.contains(b.el) || b.el.contains(a.el) || b.el.closest(LAYERED)) continue;
      // Повёрнутые (веер карт) и вырезанные по форме (clip-path) — рамки строк не совпадают с видимым текстом.
      if (a.turned || b.turned || a.shape || b.shape) continue;
      // По строкам: имя в две строки рядом со смайликом — не наложение.
      let hit = false;
      for (const la of a.lines)
        for (const lb of b.lines) {
          const ix = Math.min(la.x + la.w, lb.x + lb.w) - Math.max(la.x, lb.x);
          const iy = Math.min(la.y + la.h, lb.y + lb.h) - Math.max(la.y, lb.y);
          if (ix > 2 && iy > 2 && (ix * iy) / Math.min(la.w * la.h, lb.w * lb.h) >= 0.4) hit = true;
        }
      if (!hit) continue;
      add("надписи наезжают", `«${a.text.slice(0, 30)}» и «${b.text.slice(0, 30)}» друг на друге`, a.el, { x: Math.min(a.rect.x, b.rect.x), y: Math.min(a.rect.y, b.rect.y), w: Math.max(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.min(a.rect.x, b.rect.x), h: Math.max(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.min(a.rect.y, b.rect.y) }, `${a.text} | ${b.text}`);
    }
    // Закрыт: в середине текста сверху другой элемент (не сам текст, не его родитель и не прозрачный для касаний).
    const first = a.lines[0] ?? a.rect;
    const cx = first.x + first.w / 2;
    const cy = first.y + first.h / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
    const top = document.elementFromPoint(cx, cy);
    // Кнопки экрана зала («Во весь экран») сами прячутся через 3 с без мыши — их не считаем.
    // Кнопка сложной формы (clip-path): центр её рамки может лежать на соседней половинке — сверху «другой» элемент,
    // хотя видимая часть открыта. Сам текст или потомок той же кнопки — тоже не «закрыт».
    const ownButton = a.el.closest("button, [role=button]");
    if (top && ownButton && ownButton.contains(top)) continue;
    if (top && (a.shape || shaped(top, root))) continue;
    if (top && top !== a.el && !a.el.contains(top) && !top.contains(a.el) && root.contains(top) && !top.closest(SERVICE)) {
      const tcs = getComputedStyle(top);
      const bg = rgba(tcs.backgroundColor);
      const opaque = tcs.backgroundImage !== "none" || (bg !== null && bg[3] > 0.6) || ["IMG", "VIDEO", "CANVAS"].includes(top.tagName) || !!ownText(top);
      if (opaque && opacityChain(top, root) > 0.5) add("закрыт другим элементом", `«${a.text.slice(0, 40)}» закрыт элементом ${cssPath(top, root).split(" > ").pop()}`, a.el, a.rect, a.text);
    }
  }

  // 4. Размер текста: в зале — от высоты экрана (читают с другого конца зала), на телефоне и пульте — в пикселях.
  for (const l of leaves) {
    if (NO_LETTERS.test(l.text)) continue;
    const size = parseFloat(l.cs.fontSize);
    if (area === "экран зала" && o.hallHeight) {
      if (size / o.hallHeight < MIN_HALL_FONT) add("мелко для зала", `шрифт ${size.toFixed(1)} px — ${((size / o.hallHeight) * 1080).toFixed(0)} px на Full HD (нужно от ${Math.round(MIN_HALL_FONT * 1080)})`, l.el, l.rect, l.text);
    } else if (size < MIN_PHONE_FONT) add("мелкий текст", `шрифт ${size.toFixed(1)} px (нужно от ${MIN_PHONE_FONT})`, l.el, l.rect, l.text);
  }

  // 5. Контраст текста с фоном (WCAG: обычный текст 4.5, крупный 3; находка — ниже 3 и ниже 4.5 у мелкого).
  for (const l of leaves) {
    // Неактивная кнопка нарочно бледная — это подсказка «пока нельзя», а не плохой контраст.
    if (NO_LETTERS.test(l.text) || l.el.closest("button:disabled, [aria-disabled=true]")) continue;
    const fill = l.cs.getPropertyValue("-webkit-text-fill-color");
    if (l.cs.textShadow !== "none" || l.cs.getPropertyValue("-webkit-text-stroke-width") !== "0px") continue;
    const fg0 = rgba(fill && fill !== l.cs.color && fill !== "currentcolor" ? fill : l.cs.color);
    if (!fg0 || fg0[3] < 0.05) continue; // текст-градиент (background-clip: text) — не судим
    const bg = backgroundAt(l.rect.x + Math.min(l.rect.w / 2, 8), l.rect.y + l.rect.h / 2, l.el);
    if (!bg) continue;
    const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * opacityChain(l.el, root)], bg);
    const L1 = lum(fg);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(l.cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(l.cs.fontWeight) >= 700);
    // Ниже порога WCAG, но с запасом на приглушённые намеренно подписи: крупный — 3, обычный — 3,6.
    if (ratio < (large ? 3 : 3.6)) add("бледный текст", `контраст ${ratio.toFixed(2)} (нужно от ${large ? 3 : 4.5})`, l.el, l.rect, l.text);
  }

  // 6. Битые картинки.
  for (const img of root.querySelectorAll("img")) {
    const el = img as HTMLImageElement;
    if (!el.getAttribute("src") || decorative(el, root) || el.loading === "lazy") continue;
    if (el.complete && el.naturalWidth === 0) add("битая картинка", `картинка не загрузилась: ${el.getAttribute("src")?.slice(0, 80)}`, el, box(el.getBoundingClientRect()), el.alt);
  }

  // 7. Телефон и пульт: кнопки меньше пальца и прокрутка вбок.
  if (area !== "экран зала") {
    for (const b of root.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select")) {
      const r = b.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || decorative(b, root) || opacityChain(b, root) < 0.15) continue;
      if ((b as HTMLButtonElement).disabled || !shown(b) || inFixed(b, root)) continue;
      if (b.closest(".chip, .meta")) continue;
      // Ссылка внутри строки текста — часть фразы, а не кнопка.
      if (b.tagName === "A" && getComputedStyle(b).display === "inline") continue;
      if (r.height < MIN_TAP || r.width < MIN_TAP) add("мелкая кнопка", `кнопка ${Math.round(r.width)}×${Math.round(r.height)} px (пальцу нужно от ${MIN_TAP}×${MIN_TAP})`, b, box(r), (b.textContent ?? b.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim());
    }
    const sw = (root as HTMLElement).scrollWidth - (root as HTMLElement).clientWidth;
    if (sw > 2) {
      // Кто вылез: самый широкий элемент за правым краем.
      let widest: Element = root;
      let right = rootRect.right;
      for (const el of root.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.right > right + 1 && r.width > 0) {
          right = r.right;
          widest = el;
        }
      }
      add("прокрутка вбок", `страница шире экрана на ${Math.round(sw)} px (${cssPath(widest, root).split(" > ").pop()})`, widest, box(widest.getBoundingClientRect()), ownText(widest));
    }
  }

  // 8. Пустой экран во время игры.
  if (o.playing) {
    const media = [...root.querySelectorAll("img, video, canvas, svg, iframe")].some((m) => {
      const r = m.getBoundingClientRect();
      return r.width > 40 && r.height > 40;
    });
    if (leaves.length === 0 && !media) add("пустой экран", "на экране ни текста, ни картинки", root, box(rootRect));
  }
  return out;
}

/** Ключ находки: одно и то же место с тем же видом проблемы — одна запись (числа в тексте не важны). */
export function findingKey(area: Area, raw: Raw): string {
  const text = raw.text.replace(/\d+/g, "#").replace(/(Гость|Команда|Капитан|Игрок|Опоздал\S*) #/g, "$1").slice(0, 40);
  return `${area}|${raw.kind}|${raw.path}|${raw.kind === "мусор в тексте" || raw.kind === "мусор в подписи" ? text : ""}`;
}
