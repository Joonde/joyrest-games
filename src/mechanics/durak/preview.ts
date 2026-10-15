// Предпросмотр «Дурака»: те же функции пульта, что в игре (`startDeal`, `deal`, `apply`, `playChange`).
// Колоду пульт тасует так же, но с постоянным жребием; партия целиком в игре хранится зашифрованной ключом
// ведущего (WebCrypto, асинхронно), а предпросмотр синхронный — поэтому пульт предпросмотра каждый раз
// восстанавливает партию заново: та же раздача и те же ходы по порядку (номер хода — `seq`). Руки на
// телефонах шифруются тоже — в предпросмотре своих карт на телефоне не видно; стол, отбой, кто берёт и кто
// дурак — на экране зала, как в игре.
import type { PreviewDriver } from "../preview";
import type { DurakContent } from "./content";
import { apply, botAction, canThrow, deal, rankOf, room, suitOf, tableRanks, throwers, viewOf, waitingFor, type DurakAction, type Game } from "./engine";
import { engineOptions, firstAttacker, lineFor, nameOf, parseDurakResult, playChange, startDeal, type DurakResult } from "./logic";

/** Постоянный жребий (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ключ тестового телефона: base64 от 32 байт, как у настоящего. */
const keyOf = (pid: string) => btoa(`preview:${pid}`.padEnd(32, "#").slice(0, 32));

const SUIT_WORD: Record<string, string> = { S: "пики", H: "червы", D: "бубны", C: "трефы" };

function dealOf(r: DurakResult, content: DurakContent): Game {
  return deal(r.seats, { deck: content.deck, opts: engineOptions(content, r.seats), first: firstAttacker(content, r.seats, r.prevLoser) }, seeded(7907 * r.party + r.seats.length));
}

/** Ход тестового игрока: как у компьютера, но некозырную мелочь со стола ещё и подкидывает. */
function moveOf(g: Game, pid: string): DurakAction | null {
  const v = viewOf(g);
  const hand = g.hands[pid] ?? [];
  if (v.table.length > 0 && pid !== v.defender && throwers(v).includes(pid) && !v.passed.includes(pid) && room(v) > 0 && canThrow(v, pid, hand)) {
    const ranks = tableRanks(v);
    const card = hand.find((c) => ranks.has(rankOf(c)) && suitOf(c) !== v.trump && rankOf(c) <= 10);
    if (card) return { a: "attack", c: [card] };
  }
  return botAction(g, pid);
}

interface Turn {
  game: Game;
  moves: Array<{ pid: string; action: DurakAction }>;
  line: string;
}

/**
 * Один момент игры: заход (или подкидывание) и ответ защитника — «отбивается» или «берёт»; пасы — вместе с
 * ними. Отбой закончился — момент тоже закончился.
 */
function turnOf(g0: Game, session: Parameters<typeof lineFor>[0]): Turn {
  let g = g0;
  const moves: Turn["moves"] = [];
  const lines: string[] = [];
  for (let guard = 0; guard < 40 && !g.over; guard++) {
    const before = viewOf(g);
    const who = waitingFor(before, g.hands).find((p) => moveOf(g, p) !== null);
    if (!who) break;
    const action = moveOf(g, who) as DurakAction;
    const next = apply(g, who, action);
    if (typeof next === "string") break;
    g = next;
    moves.push({ pid: who, action });
    const after = viewOf(g);
    const line = lineFor(session, who, action, before, after);
    // Отбой закончился сразу после ответа защитника — сначала его ход, потом «Бито!».
    if (after.table.length === 0 && action.a === "defend") lines.push(`${nameOf(session, who)} отбивается`);
    // Взял, а подкинуть больше нечего — отбой кончился сразу: «забирает», а не «Бито!».
    if (after.table.length === 0 && action.a === "take" && !after.over) lines.push(`${nameOf(session, who)} забирает карты. Ходит ${nameOf(session, after.attacker)}`);
    else if (line && (action.a !== "pass" || after.table.length === 0)) lines.push(line);
    if (after.table.length === 0) break;
    if (action.a === "defend" || action.a === "take") break;
  }
  return { game: g, moves, line: lines.join(" · ") };
}

export const durakPreview: PreviewDriver<DurakContent> = ({ session, content, participants, answers }) => {
  const started = session.state.result !== null && session.state.result !== undefined;
  if (!started) return { label: "Пульт: «Собрать игроков» — садятся за стол по порядку входа", change: startDeal(session, participants, content) };
  const r = parseDurakResult(session.state.result);
  if (r.mode === "deal") {
    if (r.seats.length < 2) return null;
    if (answers.length === 0) return { label: "Телефоны прислали свои ключи — карты увидит только хозяин", answers: r.seats.map((pid) => ({ pid, value: { key: keyOf(pid) } })) };
    const g = dealOf(r, content);
    const line = `Козырь — ${SUIT_WORD[g.trump] ?? ""}. Ходит ${nameOf(session, g.attacker)}`;
    // Руки шифруются асинхронно — в предпросмотре их нет; партию пульт восстанавливает заново.
    return { label: `Пульт: «Раздать карты» — ${line}`, change: playChange(session, content, viewOf(g), {}, "", { bots: [], line, last: null }) };
  }
  if (r.mode !== "play" || !r.view || r.view.over) return null;
  // Партия на этот момент: раздача и все ходы по порядку (после раздачи `seq` = 1, каждый момент — +1).
  let g = dealOf(r, content);
  for (let i = 1; i < r.seq && !g.over; i++) g = turnOf(g, session).game;
  const turn = turnOf(g, session);
  const last = turn.moves.at(-1);
  if (!last) return null;
  const view = viewOf(turn.game);
  const cards = last.action.a === "attack" || last.action.a === "transfer" ? last.action.c : last.action.a === "defend" ? [last.action.c] : [];
  const own = new Map<string, DurakAction>();
  for (const m of turn.moves) own.set(m.pid, m.action);
  const n = `p${r.seq}`;
  const loser = view.over ? (view.loser ? `Дурак — ${nameOf(session, view.loser)}!` : "Ничья — дураков нет!") : "";
  return {
    label: view.over ? `Партия окончена. ${loser}` : turn.line || "Ход на столе",
    answers: [...own].map(([pid, action]) => ({ pid, value: { ...action, n } })),
    change: playChange(session, content, view, {}, "", { last: { pid: last.pid, a: last.action.a, cards }, ...(turn.line ? { line: turn.line } : {}) }),
  };
};
