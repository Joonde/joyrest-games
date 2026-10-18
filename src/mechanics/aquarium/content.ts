// «Аквариум и Ёлка»: настройки игры (решение владельца 18 октября 2026 — по согласованному прототипу).
import type { ValidationError } from "../types";

export type SceneId = "aqua" | "tree";

export interface AquariumContent {
  /** С какой сцены начинать (на пульте её можно сменить на ходу). */
  scene: SceneId;
  /** Готовые рыбки и игрушки для начала, чтобы экран не был пустым. */
  starters: boolean;
  /** `auto` — рисунок сразу на экране, `host` — ведущий сначала смотрит его на пульте. */
  moderation: "auto" | "host";
  /** Гость может написать своё имя на боку рыбки или игрушки. */
  names: boolean;
  /** Сколько рисунков с одного телефона за игру. */
  perGuest: number;
}

export const PER_GUEST = { min: 1, max: 10, default: 5 } as const;

export function createAquarium(): AquariumContent {
  return { scene: "aqua", starters: true, moderation: "auto", names: true, perGuest: PER_GUEST.default };
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseAquarium(raw: unknown): AquariumContent {
  const d = rec(raw);
  const base = createAquarium();
  const per = typeof d.perGuest === "number" && Number.isFinite(d.perGuest) ? Math.round(d.perGuest) : base.perGuest;
  return {
    scene: d.scene === "tree" ? "tree" : "aqua",
    starters: d.starters !== false,
    moderation: d.moderation === "host" ? "host" : "auto",
    names: d.names !== false,
    perGuest: Math.min(PER_GUEST.max, Math.max(PER_GUEST.min, per)),
  };
}

export function validateAquarium(): ValidationError[] {
  return [];
}

/** Сколько рыбок в аквариуме одновременно. */
export const AQUA_MAX = 40;
export const GARLAND_MODES = ["мерцание", "волна", "тёплый свет"] as const;

export const SCENE_TITLES: Record<SceneId, string> = { aqua: "Аквариум", tree: "Ёлка" };
/** Автор движка раскрасок — указываем везде (решение владельца 18 октября 2026). */
export const CREDIT_URL = "https://github.com/MrMoT9I/paper-aquarium";
export const CREDIT_TEXT: Record<SceneId, string> = {
  aqua: "По мотивам Paper Aquarium · автор MrMoT9I",
  tree: "Движок раскрасок по мотивам Paper Aquarium · MrMoT9I",
};
