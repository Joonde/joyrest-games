// Русские шашки — чистые правила (пульт, телефон капитана, сервер-сценарий считают одинаково).
//
// Доска 8×8, клетки 0..63 по строкам сверху вниз (строка 0 — сторона чёрных, строка 7 — белых),
// играют тёмные клетки ((row + col) % 2 === 1). Позиция — строка из 64 символов: «.» пусто,
// «w»/«b» — шашка, «W»/«B» — дамка.
//
// Правила: простая ходит на одну клетку вперёд по диагонали, бьёт вперёд и назад; бить обязательно,
// бой продолжается, пока есть кого бить (одну шашку дважды не бьют, снимаются после хода — «турецкий
// удар» запрещён). Дошла до последней строки — дамка, в том числе посреди боя (и бьёт дальше как дамка).
// Дамка ходит и бьёт на любое расстояние; после взятия, если бой можно продолжить, встаёт только на
// поле, откуда он продолжается. Из нескольких вариантов боя можно выбрать любой (не обязательно больший).

export type Color = "w" | "b";
export type Piece = "w" | "b" | "W" | "B";

export interface Move {
  /** Поля по порядку: откуда, затем каждое поле остановки. */
  path: number[];
  /** Снятые шашки соперника (поля). */
  captured: number[];
  /** Стала дамкой за этот ход. */
  crowned: boolean;
}

export const SIZE = 8;
const DIRS: Array<[number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export const rowOf = (i: number) => Math.floor(i / SIZE);
export const colOf = (i: number) => i % SIZE;
const at = (r: number, c: number) => r * SIZE + c;
const inside = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
export const isDark = (i: number) => (rowOf(i) + colOf(i)) % 2 === 1;

export const colorOf = (p: string | undefined): Color | null => (p === "w" || p === "W" ? "w" : p === "b" || p === "B" ? "b" : null);
export const isKing = (p: string | undefined) => p === "W" || p === "B";
export const opponent = (c: Color): Color => (c === "w" ? "b" : "w");

/** Начальная позиция: чёрные — строки 0–2, белые — 5–7. */
export function initialBoard(): string {
  let s = "";
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = rowOf(i);
    s += !isDark(i) ? "." : r <= 2 ? "b" : r >= 5 ? "w" : ".";
  }
  return s;
}

/** Позиция из базы → строка 64 символов (битая — начальная). */
export function parseBoardString(raw: unknown): string {
  return typeof raw === "string" && /^[.wbWB]{64}$/.test(raw) ? raw : initialBoard();
}

const forward = (c: Color) => (c === "w" ? -1 : 1);
const lastRow = (c: Color) => (c === "w" ? 0 : SIZE - 1);

function captures(board: string, from: number, piece: Piece, taken: number[], path: number[], crowned: boolean, out: Move[]): void {
  const color = colorOf(piece) as Color;
  const king = isKing(piece);
  const r0 = rowOf(from);
  const c0 = colOf(from);
  // Поле, откуда начался ход, уже свободно (шашка ушла с него).
  const empty = (i: number) => board[i] === "." || i === path[0];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    // Дамка проходит пустые поля до первой шашки.
    if (king) {
      while (inside(r, c) && empty(at(r, c))) {
        r += dr;
        c += dc;
      }
    }
    if (!inside(r, c)) continue;
    const victim = at(r, c);
    if (colorOf(board[victim]) !== opponent(color) || taken.includes(victim)) continue;
    // Поля за ней.
    const landings: number[] = [];
    let lr = r + dr;
    let lc = c + dc;
    while (inside(lr, lc) && empty(at(lr, lc))) {
      landings.push(at(lr, lc));
      if (!king) break;
      lr += dr;
      lc += dc;
    }
    if (landings.length === 0) continue;
    // Дамка после взятия обязана встать туда, откуда бой продолжается (если такое поле есть).
    const options = landings.map((land) => {
      const promote = !king && rowOf(land) === lastRow(color);
      const nextPiece = (promote ? piece.toUpperCase() : piece) as Piece;
      const more: Move[] = [];
      captures(board, land, nextPiece, [...taken, victim], [...path, land], crowned || promote, more);
      return { land, more, promote };
    });
    const continuing = options.filter((o) => o.more.length > 0);
    for (const o of continuing.length > 0 ? continuing : options) {
      if (o.more.length > 0) out.push(...o.more);
      else out.push({ path: [...path, o.land], captured: [...taken, victim], crowned: crowned || o.promote });
    }
  }
}

/** Все разрешённые ходы стороны: если есть бой — только бой. */
export function legalMoves(board: string, color: Color): Move[] {
  const fights: Move[] = [];
  const quiet: Move[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const piece = board[i] as Piece | ".";
    if (piece === "." || colorOf(piece) !== color) continue;
    captures(board, i, piece, [], [i], false, fights);
    if (fights.length > 0) continue;
    const r0 = rowOf(i);
    const c0 = colOf(i);
    for (const [dr, dc] of DIRS) {
      if (!isKing(piece) && dr !== forward(color)) continue;
      let r = r0 + dr;
      let c = c0 + dc;
      while (inside(r, c) && board[at(r, c)] === ".") {
        quiet.push({ path: [i, at(r, c)], captured: [], crowned: !isKing(piece) && r === lastRow(color) });
        if (!isKing(piece)) break;
        r += dr;
        c += dc;
      }
    }
  }
  return fights.length > 0 ? fights : quiet;
}

/** Сделать ход (проверенный по `legalMoves`). */
export function applyMove(board: string, move: Move): string {
  const cells = board.split("");
  const from = move.path[0] ?? 0;
  const to = move.path[move.path.length - 1] ?? from;
  const piece = cells[from] as Piece;
  cells[from] = ".";
  for (const c of move.captured) cells[c] = ".";
  cells[to] = move.crowned ? piece.toUpperCase() : piece;
  return cells.join("");
}

/** Ход, который прислал телефон: путь должен совпасть с одним из разрешённых. */
export function findMove(board: string, color: Color, path: number[]): Move | null {
  return legalMoves(board, color).find((m) => m.path.length === path.length && m.path.every((p, i) => p === path[i])) ?? null;
}

/** Куда можно пойти дальше, если уже выбраны поля `prefix` (касания капитана по одному). */
export function nextTargets(board: string, color: Color, prefix: number[]): number[] {
  const set = new Set<number>();
  for (const m of legalMoves(board, color)) {
    if (m.path.length <= prefix.length) continue;
    if (prefix.every((p, i) => m.path[i] === p)) set.add(m.path[prefix.length] as number);
  }
  return [...set];
}

/** Ход закончен на этом пути (больше выбирать нечего)? */
export function completeMove(board: string, color: Color, prefix: number[]): Move | null {
  const exact = findMove(board, color, prefix);
  return exact && nextTargets(board, color, prefix).length === 0 ? exact : null;
}

export function count(board: string, color: Color): { men: number; kings: number } {
  let men = 0;
  let kings = 0;
  for (const ch of board) {
    if (colorOf(ch) !== color) continue;
    if (isKing(ch)) kings += 1;
    else men += 1;
  }
  return { men, kings };
}

/** Очки: 10 за шашку, 30 за дамку, 50 за победу, 20 за верный ответ на задание (решения владельца). */
export const POINTS = { man: 10, king: 30, win: 50, task: 20 } as const;

export function capturePoints(board: string, move: Move): number {
  return move.captured.reduce((sum, c) => sum + (isKing(board[c]) ? POINTS.king : POINTS.man), 0);
}

/** Сторона проиграла: шашек нет или ходить некуда. */
export function isLost(board: string, color: Color): boolean {
  return legalMoves(board, color).length === 0;
}
