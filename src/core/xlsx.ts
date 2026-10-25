/**
 * Таблицы Excel (.xlsx) без сторонних пакетов (решение владельца 25 октября 2026: загрузка клиентов таблицей по шаблону).
 * .xlsx — zip-архив с XML. Читаем первый видимый лист: строки и значения ячеек текстом (числа как есть, даты — «17.10.2026»).
 * Пишем — простую книгу (шаблон): строки текстом, жирная шапка, колонки-«текст» (телефон не превращается в число),
 * выпадающий список в колонке. Распаковка — встроенный `DecompressionStream("deflate-raw")` (браузеры 2023+, Node 18+).
 */

export type XlsxProblem = "not-xlsx" | "old-xls" | "no-sheet" | "too-big";

export class XlsxError extends Error {
  constructor(readonly problem: XlsxProblem) {
    super(problem);
    this.name = "XlsxError";
  }
}

const utf8 = new TextDecoder();
const encoder = new TextEncoder();

function u16(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16)) + (b[o + 3] ?? 0) * 0x1000000;
}

interface ZipEntry {
  method: number;
  compSize: number;
  offset: number;
}

/** Оглавление zip (центральный каталог). Не zip — null. */
function zipEntries(b: Uint8Array): Map<string, ZipEntry> | null {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return null;
    const nameLen = u16(b, p + 28);
    const name = utf8.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.set(name.replace(/\\/g, "/").replace(/^\//, ""), { method: u16(b, p + 10), compSize: u32(b, p + 20), offset: u32(b, p + 42) });
    p += 46 + nameLen + u16(b, p + 30) + u16(b, p + 32);
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function entryText(b: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const e = entries.get(name) ?? [...entries].find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  if (!e) return null;
  if (u32(b, e.offset) !== 0x04034b50) throw new XlsxError("not-xlsx");
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const raw = b.subarray(start, start + e.compSize);
  if (e.method === 0) return utf8.decode(raw);
  if (e.method === 8) return utf8.decode(await inflateRaw(raw));
  throw new XlsxError("not-xlsx");
}

/** XML-сущности и экранирование Excel «_x000D_». */
function unescapeXml(s: string): string {
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1] ?? "") : null;
}

/** Текст из <t>…</t> внутри строки (обычной или с форматированием по кускам), без фонетических подсказок. */
function runsText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1] ?? "");
  return out;
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => runsText(m[1] ?? ""));
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Какие стили ячеек (индекс `s`) — даты. */
function dateStyles(xml: string | null): Set<number> {
  const out = new Set<number>();
  if (!xml) return out;
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1] ?? "", "numFmtId"));
    custom.set(id, attr(m[1] ?? "", "formatCode") ?? "");
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(attr(m[1] ?? "", "numFmtId") ?? 0);
    const code = custom.get(id);
    // Своё оформление — дата, если в нём есть день, месяц или год вне кавычек и цветов ([Red], «"г."»).
    const isDate = code !== undefined ? /[dmyдмг]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^general$/i.test(code) : BUILTIN_DATE_FORMATS.has(id);
    if (isDate) out.add(i);
    i++;
  }
  return out;
}

/** Номер дня Excel → «17.10.2026». */
export function excelDate(serial: number, date1904 = false): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.floor(serial) * 86_400_000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/** Число из ячейки текстом: «8.9261450593E10» → «89261450593» (телефон, сохранённый числом). */
function numberText(raw: string): string {
  if (/e/i.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  }
  return raw;
}

/** «AB» → 27 (с единицы). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const MAX_ROWS = 20_000;
const MAX_COLS = 100;

/**
 * Первый видимый лист книги: строки по номерам Excel (строка 1 → `rows[0]`), значения текстом. Пустые строки — [].
 * Не .xlsx — `XlsxError`: «old-xls» — старый формат .xls, «not-xlsx» — не таблица или защищена паролем.
 */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  // Старый .xls и книги с паролем — составной документ Microsoft (D0 CF 11 E0).
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new XlsxError("old-xls");
  const entries = zipEntries(bytes);
  if (!entries) throw new XlsxError("not-xlsx");
  const workbook = await entryText(bytes, entries, "xl/workbook.xml");
  if (!workbook) throw new XlsxError("not-xlsx");
  const date1904 = /<workbookPr\b[^>]*date1904\s*=\s*"(?:1|true)"/i.test(workbook);
  const rels = (await entryText(bytes, entries, "xl/_rels/workbook.xml.rels")) ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) targets.set(attr(m[1] ?? "", "Id") ?? "", attr(m[1] ?? "", "Target") ?? "");
  let sheetPath: string | null = null;
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const tag = m[1] ?? "";
    if (/state\s*=\s*"(?:hidden|veryHidden)"/.test(tag)) continue;
    const rid = /\s[\w]+:id\s*=\s*"([^"]+)"/.exec(tag)?.[1] ?? "";
    const target = targets.get(rid);
    if (target) {
      sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      break;
    }
  }
  const sheet = (sheetPath && (await entryText(bytes, entries, sheetPath))) ?? (await entryText(bytes, entries, "xl/worksheets/sheet1.xml"));
  if (!sheet) throw new XlsxError("no-sheet");
  const shared = sharedStrings(await entryText(bytes, entries, "xl/sharedStrings.xml"));
  const dates = dateStyles(await entryText(bytes, entries, "xl/styles.xml"));

  const rows: string[][] = [];
  let next = 1;
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[1] ?? "", "r")) || next;
    next = r + 1;
    if (r > MAX_ROWS) throw new XlsxError("too-big");
    const row: string[] = [];
    let col = 1;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = attr(tag, "r");
      const c = ref ? columnIndex(ref) || col : col;
      col = c + 1;
      if (c > MAX_COLS) continue;
      const type = attr(tag, "t") ?? "n";
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "s") text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = runsText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str") text = unescapeXml(v ?? "");
      else if (type === "b") text = v === "1" ? "TRUE" : v === undefined ? "" : "FALSE";
      else if (type === "e") text = "";
      else if (v !== undefined) {
        const raw = unescapeXml(v).trim();
        const s = Number(attr(tag, "s") ?? 0);
        const num = Number(raw);
        text = dates.has(s) && Number.isFinite(num) && num > 0 && num < 2_958_466 ? excelDate(num, date1904) : numberText(raw);
      }
      while (row.length < c - 1) row.push("");
      row[c - 1] = text;
    }
    while (rows.length < r - 1) rows.push([]);
    rows[r - 1] = row;
  }
  return rows;
}

/** CSV (Google Таблицы, Numbers, Excel «CSV»): разделитель «;», «,» или табуляция — по первой строке; кавычки — по RFC 4180. */
export function readCsv(bytes: Uint8Array): string[][] {
  let text = utf8.decode(bytes);
  // Excel на Windows сохраняет CSV в кодировке Windows-1251.
  if (text.includes("�")) {
    try {
      text = new TextDecoder("windows-1251").decode(bytes);
    } catch {
      // Нет такой кодировки — оставляем как есть.
    }
  }
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Array<[string, number]> = [";", ",", "\t"].map((d) => [d, first.split(d).length - 1]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ";";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      if (rows.length > MAX_ROWS) throw new XlsxError("too-big");
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // «'+7 915…» — так Excel и выгрузка платформы защищают ячейку от формулы.
  return rows.map((r) => r.map((c) => c.replace(/^'(?=[=+\-@])/, "")));
}

// ——— Запись (шаблон) ———

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip без сжатия (метод 0): шаблон маленький, а распаковать его может любая программа. */
function zipStored(files: Array<[string, string]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // имена в UTF-8
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true); // 1 января 1980
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const part of all) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export interface SheetSpec {
  name: string;
  rows: string[][];
  /** Ширина колонок в символах. */
  widths?: number[];
  /** Колонки (с нуля), где всё — текст: телефон «89151234567» не станет числом 8,9E+10. */
  textColumns?: number[];
  /** Первая строка — жирная шапка, закреплена при прокрутке. */
  header?: boolean;
  /** Выпадающий список в колонке (с нуля) со 2-й строки до `toRow`. */
  lists?: Array<{ column: number; values: string[]; toRow: number }>;
}

function sheetXml(s: SheetSpec): string {
  const text = new Set(s.textColumns ?? []);
  const cols = (s.widths ?? [])
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${text.has(i) ? ' style="1"' : ""}/>`)
    .join("");
  const rows = s.rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const style = s.header && r === 0 ? 2 : text.has(c) ? 1 : 0;
          if (v === "") return style ? `<c r="${columnName(c + 1)}${r + 1}" s="${style}"/>` : "";
          return `<c r="${columnName(c + 1)}${r + 1}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const pane = s.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : "";
  const lists = (s.lists ?? [])
    .map((l) => {
      const col = columnName(l.column + 1);
      const formula = `"${l.values.map((v) => v.replace(/[",]/g, "")).join(",")}"`;
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${col}2:${col}${l.toRow}"><formula1>${escapeXml(formula)}</formula1></dataValidation>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rows}</sheetData>` +
    (lists ? `<dataValidations count="${s.lists?.length ?? 0}">${lists}</dataValidations>` : "") +
    "</worksheet>"
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF3DFAE"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** Книга .xlsx из листов (первый открывается сразу). */
export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const ns = "http://schemas.openxmlformats.org";
  const files: Array<[string, string]> = [
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Types xmlns="${ns}/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join("") +
        "</Types>",
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Relationships xmlns="${ns}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        "</Relationships>",
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships">` +
        "<sheets>" +
        sheets.map((s, i) => `<sheet name="${escapeXml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        "</sheets></workbook>",
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Relationships xmlns="${ns}/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        "</Relationships>",
    ],
    ["xl/styles.xml", STYLES],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zipStored(files);
}
