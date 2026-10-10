import { describe, expect, it } from "vitest";
import { apply, beats, botAction, canTransfer, deal, newDeck, playable, rankOf, timeoutActions, viewOf, waitingFor, type DurakAction, type DurakOptions, type Game } from "./engine";

const OPTS: DurakOptions = { transfer: false, noTransferFirst: true, throwers: "all", spades: false, partners: null };

/** Детерминированный «случай» для тестов. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Партия «вручную»: руки, колода, кто ходит. */
function game(hands: Record<string, string[]>, over: Partial<Game> = {}): Game {
  const seats = Object.keys(hands);
  return {
    seats,
    out: [],
    table: [],
    trump: "H",
    trumpCard: "7H",
    attacker: seats[0] as string,
    defender: seats[1] as string,
    taking: false,
    passed: [],
    limit: 6,
    firstBout: false,
    opts: OPTS,
    discard: 0,
    over: false,
    loser: null,
    draw: false,
    pogony: 0,
    hands,
    deck: ["7H", "8C", "9C", "TC", "JC", "QC", "KC", "AC"],
    contributors: [],
    lastPlayed: {},
    lastExit: null,
    ...over,
  };
}

function ok(g: Game | string): Game {
  if (typeof g === "string") throw new Error(g);
  return g;
}

function total(g: Game): number {
  const inHands = Object.values(g.hands).reduce((n, h) => n + h.length, 0);
  const onTable = g.table.reduce((n, p) => n + (p.d ? 2 : 1), 0);
  return inHands + onTable + g.deck.length + g.discard;
}

describe("колода и раздача", () => {
  it("36 и 52 карты", () => {
    expect(newDeck(36)).toHaveLength(36);
    expect(newDeck(52)).toHaveLength(52);
    expect(new Set(newDeck(52)).size).toBe(52);
  });

  it("по 6 карт, козырь — нижняя карта колоды, первым ходит младший козырь", () => {
    const g = deal(["a", "b", "c", "d"], { deck: 36, opts: OPTS, first: null }, seeded(7));
    for (const p of g.seats) expect(g.hands[p]).toHaveLength(6);
    expect(g.deck).toHaveLength(12);
    expect(g.deck[0]).toBe(g.trumpCard);
    const trumps = g.seats.flatMap((p) => (g.hands[p] ?? []).filter((c) => c.endsWith(g.trump)).map((c) => ({ p, r: rankOf(c) })));
    const low = trumps.sort((x, y) => x.r - y.r)[0];
    expect(g.attacker).toBe(low?.p);
    expect(g.limit).toBe(5);
  });

  it("6 игроков на 36 картах: колода раздана целиком", () => {
    const g = deal(["a", "b", "c", "d", "e", "f"], { deck: 36, opts: OPTS, first: "a" }, seeded(3));
    expect(g.deck).toHaveLength(0);
    expect(g.attacker).toBe("a");
    expect(g.defender).toBe("b");
  });
});

describe("бой", () => {
  it("старшая той же масти и козырь бьют, козырь — только старшим козырем", () => {
    expect(beats("9S", "TS", "H", false)).toBe(true);
    expect(beats("9S", "8S", "H", false)).toBe(false);
    expect(beats("AS", "6H", "H", false)).toBe(true);
    expect(beats("8H", "7H", "H", false)).toBe(false);
    expect(beats("8H", "AS", "H", false)).toBe(false);
  });

  it("«пики пиками»: пику бьют только пикой", () => {
    expect(beats("9S", "6H", "H", true)).toBe(false);
    expect(beats("9S", "TS", "H", true)).toBe(true);
    expect(beats("9S", "6H", "H", false)).toBe(true);
  });
});

describe("ходы", () => {
  it("первым ходом — одного достоинства, только атакующий, лимит отбоя", () => {
    const g = game({ a: ["6S", "6C", "9D", "TD"], b: ["7S", "8S", "9S"], c: ["6D"] });
    expect(apply(g, "b", { a: "attack", c: ["7S"] })).toBe("Сейчас ходит другой игрок");
    expect(apply(g, "a", { a: "attack", c: ["6S", "9D"] })).toMatch(/одного достоинства/);
    const ok2 = ok(apply(g, "a", { a: "attack", c: ["6S", "6C"] }));
    expect(ok2.table).toHaveLength(2);
    expect(ok2.hands.a).toEqual(["9D", "TD"]);
  });

  it("подкидывают только достоинства со стола и не больше, чем карт у защитника", () => {
    let g = game({ a: ["6S", "9D"], b: ["7S", "8D"], c: ["6D", "6H", "KC"] }, { limit: 2 });
    g = ok(apply(g, "a", { a: "attack", c: ["6S"] }));
    expect(apply(g, "c", { a: "attack", c: ["KC"] })).toMatch(/достоинства со стола/);
    g = ok(apply(g, "c", { a: "attack", c: ["6D"] }));
    expect(apply(g, "c", { a: "attack", c: ["6H"] })).toMatch(/Больше подкидывать нельзя/);
  });

  it("взял — карты защитнику, ходит следующий за ним; добор: атакующий первым", () => {
    let g = game({ a: ["6S", "9D", "TD", "JD", "QD", "KD"], b: ["7C", "8C", "9C", "TC", "JC", "QC"], c: ["AS", "AD", "AC", "7D", "8D", "9H"] });
    g = ok(apply(g, "a", { a: "attack", c: ["6S"] }));
    g = ok(apply(g, "b", { a: "take" }));
    // a и c ещё могут подкинуть? У них нет шестёрок — отбой закрывается сам.
    expect(g.table).toHaveLength(0);
    expect(g.hands.b).toContain("6S");
    expect(g.attacker).toBe("c");
    expect(g.defender).toBe("a");
    expect(g.hands.a).toHaveLength(6);
  });

  it("бито — карты уходят, защитник ходит следующим", () => {
    let g = game({ a: ["6S", "6D"], b: ["7S", "8C", "9C"], c: ["AS"] });
    g = ok(apply(g, "a", { a: "attack", c: ["6S"] }));
    g = ok(apply(g, "b", { a: "defend", c: "7S", t: 0 }));
    // У a есть 6D (шестёрка на столе) — ждём его «Пас».
    expect(g.table).toHaveLength(1);
    expect(waitingFor(viewOf(g), g.hands)).toEqual(["a"]);
    g = ok(apply(g, "a", { a: "pass" }));
    expect(g.table).toHaveLength(0);
    expect(g.discard).toBe(2);
    expect(g.attacker).toBe("b");
  });

  it("партнёру не подкидывают", () => {
    const opts: DurakOptions = { ...OPTS, partners: [["a", "c"], ["b", "d"]] };
    let g = game({ a: ["6S"], b: ["7S", "8S"], c: ["6C"], d: ["6D", "KS"] }, { opts, attacker: "a", defender: "b" });
    g = ok(apply(g, "a", { a: "attack", c: ["6S"] }));
    expect(apply(g, "d", { a: "attack", c: ["6D"] })).toMatch(/не подкидываете/);
    expect(ok(apply(g, "c", { a: "attack", c: ["6C"] })).table).toHaveLength(2);
  });

  it("«только соседи»: подкидывает атакующий и сосед защитника", () => {
    const opts: DurakOptions = { ...OPTS, throwers: "neighbors" };
    let g = game({ a: ["6S", "9D"], b: ["7S", "8S"], c: ["6C"], d: ["6D"] }, { opts });
    g = ok(apply(g, "a", { a: "attack", c: ["6S"] }));
    expect(apply(g, "d", { a: "attack", c: ["6D"] })).toMatch(/не подкидываете/);
    expect(ok(apply(g, "c", { a: "attack", c: ["6C"] })).table).toHaveLength(2);
  });
});

describe("переводной", () => {
  const opts: DurakOptions = { ...OPTS, transfer: true };

  it("перевод — атака уходит следующему, если у него хватит карт", () => {
    let g = game({ a: ["6S", "9D"], b: ["6C", "8S"], c: ["7D", "8D", "9H"] }, { opts });
    g = ok(apply(g, "a", { a: "attack", c: ["6S"] }));
    expect(canTransfer(viewOf(g), "b", ["6C"])).toBe(true);
    g = ok(apply(g, "b", { a: "transfer", c: ["6C"] }));
    expect(g.defender).toBe("c");
    expect(g.attacker).toBe("b");
    expect(g.table).toHaveLength(2);
  });

  it("нельзя, если у следующего меньше карт, чем окажется на столе, и в первом кону", () => {
    let g = game({ a: ["6S", "6D"], b: ["6C", "8S"], c: ["7D"] }, { opts });
    g = ok(apply(g, "a", { a: "attack", c: ["6S"] }));
    expect(apply(g, "b", { a: "transfer", c: ["6C"] })).toBe("Перевести нельзя");
    let first = game({ a: ["6S"], b: ["6C", "8S"], c: ["7D", "8D", "9D"] }, { opts, firstBout: true, limit: 2 });
    first = ok(apply(first, "a", { a: "attack", c: ["6S"] }));
    expect(apply(first, "b", { a: "transfer", c: ["6C"] })).toBe("Перевести нельзя");
  });

  it("после покрытой карты переводить нельзя", () => {
    let g = game({ a: ["6S", "6D"], b: ["6C", "8S", "7D"], c: ["7C", "8D", "9H", "TH"] }, { opts });
    g = ok(apply(g, "a", { a: "attack", c: ["6S", "6D"] }));
    g = ok(apply(g, "b", { a: "defend", c: "8S", t: 0 }));
    expect(apply(g, "b", { a: "transfer", c: ["6C"] })).toBe("Перевести нельзя");
  });
});

describe("конец партии", () => {
  it("последний с картами — дурак; шестёрки последним ходом — погоны", () => {
    let g = game({ a: ["6S", "6C"], b: ["7S", "7C", "AD"] }, { deck: [], trump: "D", trumpCard: "7D" });
    g = ok(apply(g, "a", { a: "attack", c: ["6S", "6C"] }));
    g = ok(apply(g, "b", { a: "defend", c: "7S", t: 0 }));
    g = ok(apply(g, "b", { a: "defend", c: "7C", t: 1 }));
    expect(g.over).toBe(true);
    expect(g.loser).toBe("b");
    expect(g.pogony).toBe(2);
  });

  it("последние карты ушли одновременно — ничья", () => {
    let g = game({ a: ["6S"], b: ["7S"] }, { deck: [], trump: "D", trumpCard: "7D" });
    g = ok(apply(g, "a", { a: "attack", c: ["6S"] }));
    g = ok(apply(g, "b", { a: "defend", c: "7S", t: 0 }));
    expect(g.over).toBe(true);
    expect(g.draw).toBe(true);
    expect(g.loser).toBeNull();
  });
});

describe("подсказки и таймер", () => {
  it("защитнику подсвечиваются карты, которые бьют", () => {
    let g = game({ a: ["9S"], b: ["TS", "8S", "6H", "7C"] });
    g = ok(apply(g, "a", { a: "attack", c: ["9S"] }));
    expect(playable(viewOf(g), "b", g.hands.b ?? []).sort()).toEqual(["6H", "TS"]);
  });

  it("время вышло у защитника — он берёт", () => {
    let g = game({ a: ["9S"], b: ["6C"] });
    g = ok(apply(g, "a", { a: "attack", c: ["9S"] }));
    expect(timeoutActions(g)).toEqual([{ pid: "b", action: { a: "take" } }]);
  });
});

describe("1000 случайных партий без зависаний", () => {
  const variants: Array<{ size: 36 | 52; n: number; opts: DurakOptions }> = [
    { size: 36, n: 2, opts: OPTS },
    { size: 36, n: 4, opts: { ...OPTS, transfer: true, noTransferFirst: false } },
    { size: 36, n: 6, opts: { ...OPTS, throwers: "neighbors", spades: true } },
    { size: 36, n: 4, opts: { ...OPTS, partners: [["p0", "p2"], ["p1", "p3"]] } },
    { size: 52, n: 8, opts: { ...OPTS, transfer: true } },
  ];

  it("карты не теряются, партия всегда заканчивается", () => {
    for (let i = 0; i < 1000; i++) {
      const v = variants[i % variants.length] as (typeof variants)[number];
      const random = seeded(1000 + i);
      const seats = Array.from({ length: v.n }, (_, k) => `p${k}`);
      let g = deal(seats, { deck: v.size, opts: v.opts, first: null }, random);
      let moves = 0;
      while (!g.over) {
        expect(moves++).toBeLessThan(5000);
        const v2 = viewOf(g);
        const who = waitingFor(v2, g.hands);
        // Иногда — случайный подкид или перевод, чаще — ход компьютера.
        let acted = false;
        for (const p of who.length ? who : seats) {
          const hand = g.hands[p] ?? [];
          const options = playable(v2, p, hand);
          let action: DurakAction | null = botAction(g, p);
          if (options.length > 0 && random() < 0.3) {
            const c = options[Math.floor(random() * options.length)] as string;
            if (p === g.defender && canTransfer(v2, p, [c])) action = { a: "transfer", c: [c] };
            else if (p !== g.defender) action = { a: "attack", c: [c] };
          }
          if (!action) continue;
          const next = apply(g, p, action);
          if (typeof next === "string") continue;
          g = next;
          acted = true;
          break;
        }
        if (!acted) {
          for (const t of timeoutActions(g)) {
            const next = apply(g, t.pid, t.action);
            if (typeof next !== "string") g = next;
          }
        }
        expect(total(g)).toBe(v.size);
      }
      expect(g.out.length + (g.loser ? 1 : 0)).toBe(v.n);
    }
  });
});
