// «Just Dance и Караоке на поле» (решение владельца 12 октября 2026): поле как в «Своей игре» — строки-категории,
// плитки с очками. Плитку выбрали — она переворачивается: кто выходит (фигурки), трек, задание, и на экране зала
// играет видео Just Dance или караоке. Видео на сервер не загружается: ссылка (YouTube, VK Видео, Rutube) или файл
// на устройстве экрана зала (как в «Танцевальном батле»).
import { parseVideo, type VideoSource } from "../dance/content";
import { VERSUS, WHO } from "./who";

export type StageVariant = "dance" | "karaoke";
export type TileKind = "perform" | "battle";

export interface StageCategory {
  id: string;
  title: string;
}

export interface StageTile {
  id: string;
  cat: string;
  points: number;
  kind: TileKind;
  /** Кто выходит (выступление) — id из `WHO`. */
  who: string;
  /** Кто против кого (батл) — id из `VERSUS`. */
  vs: string;
  /** Трек или песня (необязательно). */
  title: string;
  /** Задание или подсказка на экране. */
  note: string;
  video: { source: VideoSource; url: string; name: string };
}

export interface StageContent {
  variant: StageVariant;
  categories: StageCategory[];
  tiles: StageTile[];
  /** Зрительская симпатия: сколько своих очков игрок или команда дарит выступающим (0 — выключено). */
  gift: number;
  /** Секунд на голосование в батле. */
  voteTime: number;
  /** Батлы открываются, только когда каждая команда хотя бы раз выступила (решение владельца 14 октября 2026). */
  battleLock: boolean;
}

export const STAGE_LIMITS = { categories: 6, perCategory: 8, title: 80, catTitle: 40, note: 200, url: 500, minPoints: 10, maxPoints: 5000, maxGift: 500, minVote: 10, maxVote: 120 } as const;

export const VARIANT_TITLES: Record<StageVariant, string> = { dance: "Just Dance", karaoke: "Караоке" };

function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newCategory(title = ""): StageCategory {
  return { id: newId("c"), title };
}

export function newTile(cat: string, points: number, kind: TileKind = "perform"): StageTile {
  return { id: newId("t"), cat, points, kind, who: "a2", vs: "m-w", title: "", note: "", video: { source: "none", url: "", name: "" } };
}

export function createStage(variant: StageVariant = "dance"): StageContent {
  const cats = [newCategory(variant === "karaoke" ? "Хиты" : "Активные"), newCategory(variant === "karaoke" ? "Дуэты" : "Медленные"), newCategory("Батлы")];
  const tiles = cats.flatMap((c, ci) => [100, 200, 300].map((p) => newTile(c.id, p, ci === 2 ? "battle" : "perform")));
  return { variant, categories: cats, tiles, gift: 50, voteTime: 20, battleLock: true };
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const WHO_IDS = new Set(WHO.map((w) => w.id));
const VS_IDS = new Set(VERSUS.map((v) => v.id));

export function parseStage(raw: unknown): StageContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const uniq = (v: unknown, fallback: string) => {
    let id = typeof v === "string" && ID.test(v) ? v : fallback;
    while (seen.has(id)) id += "_";
    seen.add(id);
    return id;
  };
  const categories = (Array.isArray(d.categories) ? d.categories : []).slice(0, STAGE_LIMITS.categories).map((item, i) => {
    const c = rec(item);
    return { id: uniq(c.id, `c${i + 1}`), title: str(c.title, STAGE_LIMITS.catTitle) };
  });
  const cats = new Set(categories.map((c) => c.id));
  const perCat = new Map<string, number>();
  const tiles: StageTile[] = [];
  for (const [i, item] of (Array.isArray(d.tiles) ? d.tiles : []).entries()) {
    const t = rec(item);
    const cat = typeof t.cat === "string" && cats.has(t.cat) ? t.cat : null;
    if (!cat) continue;
    const n = perCat.get(cat) ?? 0;
    if (n >= STAGE_LIMITS.perCategory) continue;
    perCat.set(cat, n + 1);
    tiles.push({
      id: uniq(t.id, `t${i + 1}`),
      cat,
      points: int(t.points, 100, STAGE_LIMITS.minPoints, STAGE_LIMITS.maxPoints),
      kind: t.kind === "battle" ? "battle" : "perform",
      who: typeof t.who === "string" && WHO_IDS.has(t.who) ? t.who : "a2",
      vs: typeof t.vs === "string" && VS_IDS.has(t.vs) ? t.vs : "m-w",
      title: str(t.title, STAGE_LIMITS.title),
      note: str(t.note, STAGE_LIMITS.note),
      video: parseVideo(t.video, STAGE_LIMITS.url),
    });
  }
  return {
    variant: d.variant === "karaoke" ? "karaoke" : "dance",
    categories,
    tiles,
    gift: int(d.gift, 50, 0, STAGE_LIMITS.maxGift),
    voteTime: int(d.voteTime, 20, STAGE_LIMITS.minVote, STAGE_LIMITS.maxVote),
    battleLock: d.battleLock !== false,
  };
}

/** Плитки категории по возрастанию очков. */
export function tilesOf(content: StageContent, cat: string): StageTile[] {
  return content.tiles.filter((t) => t.cat === cat).sort((a, b) => a.points - b.points);
}

export function tileOf(content: StageContent, id: string | null): StageTile | null {
  return id ? (content.tiles.find((t) => t.id === id) ?? null) : null;
}
