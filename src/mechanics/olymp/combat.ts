// «Олимп» — бой. Чистые функции над состоянием боя (JSON, лежит в state.result сессии):
// очередь по скорости, ходы богов и противника, исходы броска, стихии, щиты, эффекты,
// перезарядка и ульта, журнал событий, итог боя и делёж опыта.
//
// Порядок хода: `beginTurn` (эффекты в начале хода: яд, пропуск) → действие (`godAct` или `foeAct`)
// → `endTurn` (перезарядка, срок эффектов, следующее место на шкале времени) → `nextActor`.
import { abilitiesOf, godOf, type Ability, type EffectSpec } from "./gods";
import { foeOf, scaledHp, type FoeAbility } from "./foes";
import {
  ELEMENT_NAMES,
  OUTCOME_MULT,
  OUTCOME_NAMES,
  foeXp,
  hpMaxOf,
  outcomeOf,
  splitXp,
  turnTime,
  type ElementId,
  type Outcome,
  type StatId,
  type Stats,
} from "./rules";

export interface ActiveEffect {
  id: string;
  name: string;
  kind: "bless" | "curse";
  /** Сколько ходов цели осталось. */
  left: number;
  roll?: number;
  stats?: Partial<Stats>;
  dot?: number;
  speed?: number;
  taken?: number;
  skip?: boolean;
  /** Кто наложил. */
  from: string;
}

export interface Fighter {
  /** pid участника (бог) или `foe`. */
  id: string;
  side: "god" | "foe";
  /** id бога или противника. */
  ref: string;
  name: string;
  level: number;
  hp: number;
  hpMax: number;
  shield: number;
  speed: number;
  stats: Stats;
  effects: ActiveEffect[];
  /** Перезарядка способностей: сколько своих ходов ждать. */
  cd: Record<string, number>;
  /** Заряд ульты 0–100. */
  charge: number;
  ultUsed: boolean;
  /** Место на шкале времени: ходит тот, у кого меньше. */
  next: number;
  /** Нанесённый урон за бой (для опыта). */
  dealt: number;
  /** Помогал отряду (лечение, щиты, благословения) — опыт не меньше 10%. */
  helped: boolean;
  down: boolean;
}

export type LogKind = "fight" | "curse" | "heal" | "coin" | "level" | "start" | "idea" | "vote" | "story";

export interface LogEntry {
  n: number;
  k: LogKind;
  /** Текст без разметки; имена из `who` экран выделяет сам. */
  x: string;
  who: string[];
  /** Урон: кто, кому, сколько. */
  d?: [string, string, number];
  /** Лечение или щит: кто, кому, сколько. */
  h?: [string, string, number];
}

export interface Battle {
  foe: string;
  fighters: Fighter[];
  /** Чей ход сейчас (id бойца), null — бой окончен. */
  actor: string | null;
  /** Индекс способности, которую противник применит своим ходом. */
  intent: number;
  /** Сколько ходов сделано. */
  turns: number;
  over: null | "win" | "lose";
  log: LogEntry[];
  /** Номер следующей записи журнала. */
  seq: number;
  /** Сила противника (сложность): множитель урона и лечения. */
  power?: number;
}

/** Бог, который вступает в бой. */
export interface GodEntry {
  /** Имя в бою, если бог повторяется (больше 10 команд): «Зевс II». */
  name?: string;
  pid: string;
  god: string;
  level: number;
  /** Здоровье после прошлого боя; нет — полное. */
  hp?: number;
  /** Прибавки от вещей. */
  bonus?: Partial<Stats> & { speed?: number; hpPercent?: number };
}

const LOG_KEEP = 80;
export const ULT_PER_ACTION = 25;
export const ULT_PER_HIT = 10;

function fighterOf(b: Battle, id: string): Fighter | undefined {
  return b.fighters.find((f) => f.id === id);
}

function push(b: Battle, entry: Omit<LogEntry, "n">): void {
  b.log.unshift({ ...entry, n: b.seq });
  b.seq += 1;
  if (b.log.length > LOG_KEEP) b.log.length = LOG_KEEP;
}

function clone(b: Battle): Battle {
  return JSON.parse(JSON.stringify(b)) as Battle;
}

/** Начать бой: боги в порядке входа, противник — по карточке, здоровье под размер отряда. */
/** Сила противника растёт с отрядом: на 3 бога — как в карточке, каждый следующий +15%, меньше — −15%. */
export function partyPower(gods: number): number {
  return Math.max(0.6, 1 + 0.15 * (Math.max(1, gods) - 3));
}

/** Сложность: множители здоровья и силы противника (1 — как в карточке). */
export interface BattleOptions {
  hp?: number;
  power?: number;
}

export function startBattle(foeId: string, gods: GodEntry[], seq = 1, opts: BattleOptions = {}): Battle {
  const foe = foeOf(foeId);
  if (!foe) throw new Error(`Нет противника ${foeId}`);
  const fighters: Fighter[] = [];
  for (const g of gods) {
    const god = godOf(g.god);
    if (!god) continue;
    const bonus = g.bonus ?? {};
    const stats = { ...god.stats };
    for (const k of Object.keys(stats) as StatId[]) stats[k] += Math.round(bonus[k] ?? 0);
    const hpMax = hpMaxOf(g.level, bonus.hpPercent ?? 0);
    const speed = god.speed + (bonus.speed ?? 0);
    fighters.push({
      id: g.pid, side: "god", ref: god.id, name: g.name ?? god.name, level: g.level,
      hp: Math.max(1, Math.min(hpMax, g.hp ?? hpMax)), hpMax, shield: 0, speed, stats,
      effects: [], cd: {}, charge: 0, ultUsed: false, next: turnTime(speed), dealt: 0, helped: false, down: false,
    });
  }
  const hp = Math.max(1, Math.round(scaledHp(foe, fighters.length) * (opts.hp ?? 1)));
  fighters.push({
    id: "foe", side: "foe", ref: foe.id, name: foe.name, level: 1, hp, hpMax: hp, shield: 0, speed: foe.speed,
    stats: { might: 50, influence: 50, wisdom: 50, endurance: 50, luck: 50, cunning: 50 },
    effects: [], cd: {}, charge: 0, ultUsed: false, next: turnTime(foe.speed), dealt: 0, helped: false, down: false,
  });
  const b: Battle = { foe: foe.id, fighters, actor: null, intent: 0, turns: 0, over: null, log: [], seq, power: (opts.power ?? 1) * partyPower(fighters.length - 1) };
  push(b, { k: "start", x: `Бой: ${foe.name}, ранг ${foe.rank}${foe.boss ? ", босс" : ""}. Здоровье ${hp}, драхм ${foe.coins}, опыта ${foeXp(foe.rank, foe.boss)}`, who: [foe.name] });
  b.actor = nextActor(b);
  return b;
}

/** Скорость с эффектами (не ниже 10). */
export function speedOf(f: Fighter): number {
  return Math.max(10, f.speed + f.effects.reduce((a, e) => a + (e.speed ?? 0), 0));
}

/** Характеристика с эффектами. */
export function statOf(f: Fighter, stat: StatId): number {
  return f.stats[stat] + f.effects.reduce((a, e) => a + (e.stats?.[stat] ?? 0), 0);
}

/** Прибавка к броскам от эффектов (Рок, Оцепенение, Мудрость Афины…). */
export function rollModOf(f: Fighter): number {
  return f.effects.reduce((a, e) => a + (e.roll ?? 0), 0);
}

/** Множитель входящего урона от эффектов (броня, метка, ярость). */
export function takenOf(f: Fighter): number {
  return f.effects.reduce((a, e) => a * (e.taken ?? 1), 1);
}

/** Кто ходит следующим: меньшее место на шкале; при равенстве — боги раньше, потом по порядку. */
export function nextActor(b: Battle): string | null {
  if (b.over) return null;
  let best: Fighter | null = null;
  for (const f of b.fighters) {
    if (f.down) continue;
    if (!best || f.next < best.next - 1e-9 || (Math.abs(f.next - best.next) < 1e-9 && f.side === "god" && best.side === "foe")) best = f;
  }
  return best ? best.id : null;
}

/** Очередь на несколько ходов вперёд (для ленты на экране зала). */
export function turnQueue(b: Battle, count: number): string[] {
  const sim = b.fighters.filter((f) => !f.down).map((f) => ({ id: f.id, next: f.next, step: turnTime(speedOf(f)), god: f.side === "god" }));
  const out: string[] = [];
  for (let i = 0; i < count && sim.length > 0; i++) {
    sim.sort((a, c) => a.next - c.next || (a.god === c.god ? 0 : a.god ? -1 : 1));
    const first = sim[0];
    if (!first) break;
    out.push(first.id);
    first.next += first.step;
  }
  return out;
}

/** Готова ли способность: перезарядка, ульта — заряд 100 и раз за бой. */
export function canUse(f: Fighter, ability: Ability): boolean {
  if (ability.ult) return !f.ultUsed && f.charge >= 100;
  return (f.cd[ability.id] ?? 0) <= 0;
}

function applyEffect(target: Fighter, spec: EffectSpec, from: string, bonusTurns = 0): void {
  const rest = target.effects.filter((e) => e.id !== spec.id);
  rest.push({ id: spec.id, name: spec.name, kind: spec.kind, left: Math.max(1, spec.turns + bonusTurns), roll: spec.roll, stats: spec.stats, dot: spec.dot, speed: spec.speed, taken: spec.taken, skip: spec.skip, from });
  target.effects = rest;
}

const ROCK: EffectSpec = { id: "rock", name: "Рок", kind: "curse", turns: 1, roll: -10 };

/** Урон по бойцу: сначала щит, потом здоровье; возвращает, сколько ушло в здоровье, и сколько съел щит. */
function hurt(target: Fighter, amount: number): { hp: number; shield: number } {
  const dmg = Math.max(0, Math.round(amount));
  const byShield = Math.min(target.shield, dmg);
  target.shield -= byShield;
  const toHp = Math.min(target.hp, dmg - byShield);
  target.hp -= toHp;
  if (target.side === "god") target.charge = Math.min(100, target.charge + ULT_PER_HIT);
  if (target.hp <= 0) {
    target.hp = 0;
    target.down = true;
  }
  return { hp: toHp, shield: byShield };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function hpWord(n: number): string {
  return `${n} ${plural(n, "урон", "урона", "урона")}`;
}

/** Множитель урона по противнику: стихия по его сопротивлениям, без стихии — 100%. */
function resistMult(foeRef: string, element: ElementId | null): number {
  const foe = foeOf(foeRef);
  if (!foe || !element) return 1;
  return (foe.resist[element] ?? 100) / 100;
}

/** Урон бога: база × исход × стихия × уровень × эффекты цели. Округление до целого. */
export function godDamage(power: number, outcome: Outcome, level: number, elementResist: number, taken: number): number {
  return Math.round(power * OUTCOME_MULT[outcome] * elementResist * (1 + 0.05 * (level - 1)) * taken);
}

export interface GodActResult {
  battle: Battle;
  outcome: Outcome;
  /** Что вышло: для показа на экране. */
  amount: number;
}

/**
 * Ход бога: способность, цели, бросок d100 (с сервера). Цели: `foe` — противник, союзники — pid.
 * Не та очередь, не готова способность или нет целей — бросает ошибку (пульт не покажет такую кнопку).
 */
export function godAct(battle: Battle, actorId: string, abilityId: string, targetIds: string[], roll: number): GodActResult {
  const b = clone(battle);
  const actor = fighterOf(b, actorId);
  if (!actor || actor.side !== "god" || b.actor !== actorId || b.over) throw new Error("Не ход этого бога");
  const god = godOf(actor.ref);
  const ability = god ? abilitiesOf(god).find((a) => a.id === abilityId) : undefined;
  if (!ability || !canUse(actor, ability)) throw new Error("Способность не готова");
  const outcome = outcomeOf(roll, statOf(actor, ability.stat), rollModOf(actor));
  const mod = rollModOf(actor);
  const rollText = `бросок ${roll}${mod ? ` ${mod > 0 ? "+" : "−"}${Math.abs(mod)}` : ""} — ${OUTCOME_NAMES[outcome].toLowerCase()}`;
  const foe = b.fighters.find((f) => f.side === "foe" && !f.down);
  const allies = b.fighters.filter((f) => f.side === "god" && !f.down);
  const targets: Fighter[] =
    ability.target === "foe" || ability.target === "foes" ? (foe ? [foe] : [])
    : ability.target === "self" ? [actor]
    : ability.target === "allies" ? allies
    : targetIds.map((id) => fighterOf(b, id)).filter((f): f is Fighter => !!f && f.side === "god" && !f.down).slice(0, 1);
  if (targets.length === 0) throw new Error("Нет цели");

  // способность потрачена при любом исходе
  if (ability.ult) {
    actor.ultUsed = true;
    actor.charge = 0;
  } else {
    actor.cd[ability.id] = ability.cooldown + 1;
    actor.charge = Math.min(100, actor.charge + ULT_PER_ACTION);
  }

  let amount = 0;
  if (outcome === "fail") {
    applyEffect(actor, ROCK, actor.name);
    push(b, { k: "curse", x: `${actor.name}: «${ability.name}», ${rollText}. Промах, на ${actor.name} «Рок»: −10 к следующему броску`, who: [actor.name] });
  } else if (ability.kind === "strike" || ability.kind === "blast" || (ability.kind === "curse" && ability.power > 0 && targets[0]?.side === "foe")) {
    const target = targets[0] as Fighter;
    const res = resistMult(target.ref, ability.element);
    const raw = godDamage(ability.power, outcome, actor.level, res, takenOf(target));
    const got = hurt(target, raw);
    amount = got.hp + got.shield;
    actor.dealt += got.hp;
    const parts = [`${ability.power} × ${String(OUTCOME_MULT[outcome]).replace(".", ",")}`];
    if (ability.element && res !== 1) parts.push(`${ELEMENT_NAMES[ability.element]} ${Math.round(res * 100)}%`);
    if (takenOf(target) !== 1) parts.push(`эффекты ×${String(Math.round(takenOf(target) * 100) / 100).replace(".", ",")}`);
    push(b, {
      k: "fight",
      x: `${actor.name} → ${target.name}: «${ability.name}», ${rollText}, ${hpWord(amount)} (${parts.join(", ")}). У ${target.side === "foe" ? "противника" : target.name} ${target.hp} / ${target.hpMax}`,
      who: [actor.name, target.name],
      d: [actor.name, target.name, amount],
    });
    if (ability.effect && outcome !== "bad") {
      applyEffect(target, ability.effect, actor.name, outcome === "crit" ? 1 : 0);
      push(b, { k: "curse", x: `${actor.name} наложил на ${target.name} «${ability.effect.name}»${effectText(ability.effect)}`, who: [actor.name, target.name] });
    }
    if (target.down && target.side === "foe") {
      b.over = "win";
      push(b, { k: "fight", x: `${target.name} повержен! Последний удар — ${actor.name}`, who: [target.name, actor.name] });
    }
  } else if (ability.kind === "curse") {
    for (const t of targets) {
      if (outcome === "bad") continue;
      applyEffect(t, ability.effect as EffectSpec, actor.name, outcome === "crit" ? 1 : 0);
    }
    push(b, {
      k: "curse",
      x: outcome === "bad" ? `${actor.name}: «${ability.name}», ${rollText} — не подействовало` : `${actor.name} наложил на ${targets.map((t) => t.name).join(", ")} «${ability.effect?.name ?? ability.name}»${ability.effect ? effectText(ability.effect) : ""}, ${rollText}`,
      who: [actor.name, ...targets.map((t) => t.name)],
    });
  } else if (ability.kind === "heal") {
    for (const t of targets) {
      const heal = Math.min(t.hpMax - t.hp, Math.round(ability.power * OUTCOME_MULT[outcome]));
      t.hp += heal;
      amount += heal;
      let cleansed: string[] = [];
      if (ability.cleanse && outcome !== "bad") {
        const curses = t.effects.filter((e) => e.kind === "curse").slice(0, ability.cleanse);
        cleansed = curses.map((e) => e.name);
        t.effects = t.effects.filter((e) => !curses.includes(e));
      }
      push(b, { k: "heal", x: `${actor.name} лечит ${t.name}: «${ability.name}», ${rollText}, +${heal} здоровья (${t.hp} / ${t.hpMax})${cleansed.length ? `, снято: «${cleansed.join("», «")}»` : ""}`, who: [actor.name, t.name], h: [actor.name, t.name, heal] });
    }
    actor.helped = true;
  } else if (ability.kind === "shield") {
    for (const t of targets) {
      const add = Math.round(ability.power * OUTCOME_MULT[outcome]);
      t.shield = Math.min(Math.round(t.hpMax / 2), t.shield + add);
      amount += add;
      push(b, { k: "heal", x: `${actor.name} ставит щит на ${t.name}: «${ability.name}», ${rollText}, щит ${t.shield}`, who: [actor.name, t.name], h: [actor.name, t.name, add] });
    }
    actor.helped = true;
  } else if (ability.kind === "bless" && ability.effect) {
    if (outcome !== "bad") for (const t of targets) applyEffect(t, ability.effect, actor.name, outcome === "crit" ? 1 : 0);
    push(b, {
      k: "heal",
      x: outcome === "bad" ? `${actor.name}: «${ability.name}», ${rollText} — не подействовало` : `${actor.name} благословляет ${targets.map((t) => t.name).join(", ")}: «${ability.effect.name}»${effectText(ability.effect)}, ${rollText}`,
      who: [actor.name, ...targets.map((t) => t.name)],
    });
    actor.helped = true;
  }
  return { battle: b, outcome, amount };
}

/** Коротко, что делает эффект: «: −10 к броскам, 2 хода». */
export function effectText(e: EffectSpec): string {
  const parts: string[] = [];
  if (e.roll) parts.push(`${e.roll > 0 ? "+" : "−"}${Math.abs(e.roll)} к броскам`);
  for (const [k, v] of Object.entries(e.stats ?? {})) if (v) parts.push(`${v > 0 ? "+" : "−"}${Math.abs(v)} к ${STAT_DAT[k as StatId]}`);
  if (e.dot) parts.push(e.dot > 0 ? `−${e.dot} здоровья в начале хода` : `+${-e.dot} здоровья в начале хода`);
  if (e.speed) parts.push(`${e.speed > 0 ? "+" : "−"}${Math.abs(e.speed)} к скорости`);
  if (e.taken) parts.push(e.taken < 1 ? `урон по нему ×${String(e.taken).replace(".", ",")}` : `урон по нему +${Math.round((e.taken - 1) * 100)}%`);
  if (e.skip) parts.push("пропускает ход");
  parts.push(`${e.turns} ${plural(e.turns, "ход", "хода", "ходов")}`);
  return `: ${parts.join(", ")}`;
}

const STAT_DAT: Record<StatId, string> = { might: "Мощи", influence: "Влиянию", wisdom: "Мудрости", endurance: "Стойкости", luck: "Удаче", cunning: "Хитрости" };

/** Что противник сделает своим ходом (для «Готовит: …»). */
export function intentOf(b: Battle): FoeAbility | undefined {
  const foe = foeOf(b.foe);
  return foe ? foe.abilities[b.intent % foe.abilities.length] : undefined;
}

/**
 * Ход противника: способность по кругу; цель удара выбирает бросок среди стоящих богов
 * (честно и повторяемо). Крит. неудача — промах, крит. удача — ×1,5.
 */
export function foeAct(battle: Battle, roll: number): Battle {
  const b = clone(battle);
  const foeF = b.fighters.find((f) => f.side === "foe");
  const foe = foeOf(b.foe);
  if (!foeF || !foe || b.actor !== foeF.id || b.over) throw new Error("Не ход противника");
  const ability = foe.abilities[b.intent % foe.abilities.length] as FoeAbility;
  b.intent = (b.intent + 1) % foe.abilities.length;
  const alive = b.fighters.filter((f) => f.side === "god" && !f.down);
  const pick = alive[(roll - 1) % Math.max(1, alive.length)];
  const mult = (roll >= 96 ? 1.5 : roll <= 5 ? 0 : 1) * (b.power ?? 1);
  const tag = roll >= 96 ? " (крит. удача ×1,5)" : "";
  if (mult === 0 && (ability.kind === "strike" || ability.kind === "blast")) {
    push(b, { k: "fight", x: `${foe.name}: «${ability.name}» — промах (бросок ${roll})`, who: [foe.name] });
  } else if (ability.kind === "strike" && pick) {
    const got = hurt(pick, ability.power * mult * takenOf(pick) * defenseOf(pick));
    push(b, { k: "fight", x: `${foe.name} → ${pick.name}: «${ability.name}», ${hpWord(got.hp + got.shield)}${got.shield ? ` (щит принял ${got.shield})` : ""}${tag}. У ${pick.name} ${pick.hp} / ${pick.hpMax}${pick.down ? " — без сил!" : ""}`, who: [foe.name, pick.name], d: [foe.name, pick.name, got.hp + got.shield] });
  } else if (ability.kind === "blast") {
    let total = 0;
    for (const t of alive) {
      const got = hurt(t, ability.power * mult * takenOf(t) * defenseOf(t));
      total += got.hp + got.shield;
    }
    const fallen = alive.filter((t) => t.down).map((t) => t.name);
    push(b, { k: "fight", x: `${foe.name} → все: «${ability.name}», по ${Math.round(ability.power * mult)} до защиты${tag}${fallen.length ? `. Без сил: ${fallen.join(", ")}` : ""}`, who: [foe.name, ...alive.map((t) => t.name)], d: [foe.name, "все", total] });
  } else if (ability.kind === "heal") {
    const heal = Math.min(foeF.hpMax - foeF.hp, Math.round(ability.power * (b.power ?? 1)));
    foeF.hp += heal;
    push(b, { k: "heal", x: `${foe.name}: «${ability.name}», +${heal} здоровья. У него ${foeF.hp} / ${foeF.hpMax}`, who: [foe.name], h: [foe.name, foe.name, heal] });
  } else if (ability.kind === "armor" && ability.effect) {
    applyEffect(foeF, ability.effect, foe.name);
    push(b, { k: "curse", x: `${foe.name}: «${ability.name}»${effectText(ability.effect)}`, who: [foe.name] });
  } else if (ability.kind === "curse" && ability.effect && pick) {
    if (ability.power > 0) hurt(pick, ability.power * (b.power ?? 1) * takenOf(pick));
    applyEffect(pick, ability.effect, foe.name);
    push(b, { k: "curse", x: `${foe.name} наложил на ${pick.name} «${ability.effect.name}»${effectText(ability.effect)}${ability.power ? `, ${hpWord(Math.round(ability.power * (b.power ?? 1)))}` : ""}`, who: [foe.name, pick.name] });
  } else if (ability.kind === "curseAll" && ability.effect) {
    for (const t of alive) applyEffect(t, ability.effect, foe.name);
    push(b, { k: "curse", x: `${foe.name} → все: «${ability.effect.name}»${effectText(ability.effect)}`, who: [foe.name, ...alive.map((t) => t.name)] });
  }
  if (alive.every((t) => t.down)) {
    b.over = "lose";
    push(b, { k: "fight", x: `Отряд пал. ${foe.name} победил`, who: [foe.name] });
  }
  return b;
}

/** Стойкость снижает урон по богу: до 40% (Стойкость 100). */
export function defenseOf(f: Fighter): number {
  if (f.side !== "god") return 1;
  return 1 - Math.min(0.4, Math.max(0, statOf(f, "endurance")) / 250);
}

/**
 * Начало хода бойца: урон и лечение от эффектов, пропуск хода. Возвращает, пропускает ли он ход
 * (тогда сразу `endTurn`). Боец мог упасть от яда — тогда тоже конец хода.
 */
export function beginTurn(battle: Battle): { battle: Battle; skip: boolean } {
  const b = clone(battle);
  const actor = b.actor ? fighterOf(b, b.actor) : undefined;
  if (!actor || b.over) return { battle: b, skip: true };
  for (const e of actor.effects) {
    if (!e.dot) continue;
    if (e.dot > 0) {
      const got = hurt(actor, e.dot);
      push(b, { k: "curse", x: `${actor.name}: «${e.name}», ${hpWord(got.hp + got.shield)}. Здоровье ${actor.hp} / ${actor.hpMax}`, who: [actor.name], d: [e.from, actor.name, got.hp + got.shield] });
    } else {
      const heal = Math.min(actor.hpMax - actor.hp, -e.dot);
      actor.hp += heal;
      push(b, { k: "heal", x: `${actor.name}: «${e.name}», +${heal} здоровья`, who: [actor.name], h: [e.from, actor.name, heal] });
    }
  }
  if (actor.down) {
    if (actor.side === "foe") b.over = "win";
    else if (b.fighters.filter((f) => f.side === "god").every((f) => f.down)) b.over = "lose";
    return { battle: b, skip: true };
  }
  const skip = actor.effects.some((e) => e.skip);
  if (skip) push(b, { k: "curse", x: `${actor.name} пропускает ход: «${actor.effects.find((e) => e.skip)?.name ?? ""}»`, who: [actor.name] });
  return { battle: b, skip };
}

/** Конец хода: перезарядка −1, эффекты −1 ход (истёкшие снимаются), следующее место на шкале. */
export function endTurn(battle: Battle): Battle {
  const b = clone(battle);
  const actor = b.actor ? fighterOf(b, b.actor) : undefined;
  if (actor) {
    for (const k of Object.keys(actor.cd)) {
      actor.cd[k] = Math.max(0, (actor.cd[k] ?? 0) - 1);
      if (actor.cd[k] === 0) delete actor.cd[k];
    }
    actor.effects = actor.effects.map((e) => ({ ...e, left: e.left - 1 })).filter((e) => e.left > 0);
    actor.next += turnTime(speedOf(actor));
  }
  b.turns += 1;
  b.actor = nextActor(b);
  return b;
}

/** Опыт за бой: награда противника делится по урону, помощники — не меньше 10%. Проигрыш — ничего. */
export function battleXp(b: Battle): Record<string, number> {
  const foe = foeOf(b.foe);
  if (!foe || b.over !== "win") return {};
  const gods = b.fighters.filter((f) => f.side === "god");
  const dmg: Record<string, number> = {};
  for (const g of gods) if (g.dealt > 0) dmg[g.id] = g.dealt;
  return splitXp(foeXp(foe.rank, foe.boss), dmg, gods.filter((g) => g.helped && !dmg[g.id]).map((g) => g.id));
}

/** Итоги боя для журнала: кто сколько нанёс и получил, лечение и щиты, проклятия. */
export function battleTotals(b: Battle): { dealt: Record<string, number>; taken: Record<string, number>; help: number; curses: number } {
  const dealt: Record<string, number> = {};
  const taken: Record<string, number> = {};
  let help = 0;
  let curses = 0;
  const gods = b.fighters.filter((f) => f.side === "god").map((f) => f.name);
  for (const e of b.log) {
    if (e.d) {
      dealt[e.d[0]] = (dealt[e.d[0]] ?? 0) + e.d[2];
      if (e.d[1] !== "все") taken[e.d[1]] = (taken[e.d[1]] ?? 0) + e.d[2];
    }
    if (e.h && gods.includes(e.h[1])) help += e.h[2];
    if (e.k === "curse") curses += 1;
  }
  return { dealt, taken, help, curses };
}
