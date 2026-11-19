// «Танцевальный батл»: карточки Батл / Танец / Караоке / Танцуй иначе. Команды по очереди выбирают карточку,
// выступают, другие команды оценивают (танец, караоке — от 10 до 100) или голосуют (батл и специальный раунд).
// Видео: ссылка (YouTube, VK, Rutube), файл на устройстве экрана зала или видео JoyRest на сервере (`server`: в `url` — id
// видео, загружают владелец и заместитель — решение владельца 15 октября 2026).
import { clipFields, parseClip, type Clip } from "../../core/clip";
import { isStyleId } from "./styles";

export type DanceKind = "battle" | "dance" | "karaoke" | "special";
export type VideoSource = "none" | "file" | "link" | "server";
export type DanceModifier = "hands" | "robot" | "slow";

export const DANCE_MODIFIERS: Array<{ id: DanceModifier; title: string; hint: string }> = [
  { id: "hands", title: "Только руки", hint: "Ноги не двигаются — работают руки, жесты и мимика." },
  { id: "robot", title: "Как роботы", hint: "Резкие движения и паузы, никакой плавности." },
  { id: "slow", title: "Замедление", hint: "Танцуем вполовину медленнее музыки." },
];

export const REMIX_COUNT = 3;
export const REMIX_LIMITS = { minLength: 3, maxLength: 15, defaultLength: 8 } as const;

export function isDanceModifier(value: unknown): value is DanceModifier {
  return value === "hands" || value === "robot" || value === "slow";
}

/** Обычный и специальный батл: финальное голосование за другую команду и очки победителю. */
export function isTeamBattle(card: DanceCard | null): boolean {
  return card?.kind === "battle" || card?.kind === "special";
}

/** Видео из базы → формат механики: ссылка — как есть (до `urlMax`), видео JoyRest — id, файл — только название. */
export function parseVideo(raw: unknown, urlMax: number): { source: VideoSource; url: string; name: string } {
  const v = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = typeof v.name === "string" ? v.name.slice(0, 120) : "";
  const url = typeof v.url === "string" ? v.url : "";
  if (v.source === "link") return { source: "link", url: url.slice(0, urlMax).trim(), name };
  if (v.source === "file") return { source: "file", url: "", name };
  // Видео JoyRest ещё не выбрано — пустой id (конструктор подскажет выбрать).
  if (v.source === "server") return { source: "server", url: /^[A-Za-z0-9_-]{1,64}$/.test(url) ? url : "", name };
  return { source: "none", url: "", name };
}

export interface DanceCard {
  id: string;
  kind: DanceKind;
  /** Стиль танца (styles.ts): «jazz», «disco»…; пусто — без стиля. */
  style: string;
  title: string;
  /** Подсказка ведущему и на экран: «повторяйте движения», «поёт один участник». */
  note: string;
  video: { source: VideoSource; url: string; name: string };
  /** Трек батла (и запасной звук для танца без видео). */
  trackId: string | null;
  trackStart: number;
  trackLength: number;
  fadeIn: number;
  fadeOut: number;
  chorusStart: number | null;
  chorusLength: number;
  join: Clip["join"];
  confetti: boolean;
  /** «Танцуй иначе»: три коротких музыкальных фрагмента; у остальных карточек пусто. */
  remix: Clip[];
}

export interface DanceContent {
  cards: DanceCard[];
  /** Очки победителю батла. */
  battlePoints: number;
  /** Оценка выступления: от и до. */
  minRate: number;
  maxRate: number;
  /** Секунд на оценку и на выбор усложнения. */
  voteTime: number;
}

export const DANCE_LIMITS = { cards: 60, title: 80, note: 200, url: 500, minPoints: 10, maxPoints: 1000, minVote: 10, maxVote: 120 } as const;

export const KIND_TITLES: Record<DanceKind, string> = { battle: "Батл", dance: "Танец", karaoke: "Караоке", special: "Танцуй иначе" };
export const KIND_EMOJI: Record<DanceKind, string> = { battle: "⚡", dance: "💃", karaoke: "🎤", special: "✨" };

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "d" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

const CLIP = () => clipFields(parseClip({})) as Pick<DanceCard, "trackId" | "trackStart" | "trackLength" | "fadeIn" | "fadeOut" | "chorusStart" | "chorusLength" | "join" | "confetti">;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

/** Короткий участок ремикса: неизвестные и битые поля нормализуются общим музыкальным парсером. */
export function parseRemixClip(raw: unknown): Clip {
  const source = rec(raw);
  const clip = parseClip({ ...source, trackLength: source.trackLength ?? source.length ?? REMIX_LIMITS.defaultLength });
  return { ...clip, length: int(clip.length, REMIX_LIMITS.defaultLength, REMIX_LIMITS.minLength, REMIX_LIMITS.maxLength), confetti: false };
}

export function newCard(kind: DanceKind, style = ""): DanceCard {
  return {
    id: id(),
    kind,
    style,
    title: "",
    note: "",
    video: { source: kind === "battle" || kind === "special" ? "none" : "link", url: "", name: "" },
    remix: kind === "special" ? Array.from({ length: REMIX_COUNT }, () => parseRemixClip({})) : [],
    ...CLIP(),
  };
}

export function createDance(): DanceContent {
  return { cards: [newCard("dance"), newCard("karaoke"), newCard("battle")], battlePoints: 100, minRate: 10, maxRate: 100, voteTime: 30 };
}

export function parseDance(raw: unknown): DanceContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const cards = (Array.isArray(d.cards) ? d.cards : []).slice(0, DANCE_LIMITS.cards).map((item, i) => {
    const c = rec(item);
    let cid = typeof c.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) ? c.id : `d${i + 1}`;
    while (seen.has(cid)) cid += "_";
    seen.add(cid);
    const kind: DanceKind = c.kind === "battle" || c.kind === "karaoke" || c.kind === "special" ? c.kind : "dance";
    const rawRemix = Array.isArray(c.remix) ? c.remix : [];
    return {
      id: cid,
      kind,
      style: isStyleId(c.style) ? c.style : "",
      title: str(c.title, DANCE_LIMITS.title),
      note: str(c.note, DANCE_LIMITS.note),
      video: kind === "special" ? { source: "none" as const, url: "", name: "" } : parseVideo(c.video, DANCE_LIMITS.url),
      remix: kind === "special" ? Array.from({ length: REMIX_COUNT }, (_, index) => parseRemixClip(rawRemix[index])) : [],
      ...(clipFields(parseClip(c)) as ReturnType<typeof CLIP>),
    };
  });
  const minRate = int(d.minRate, 10, 1, 100);
  return {
    cards,
    battlePoints: int(d.battlePoints, 100, DANCE_LIMITS.minPoints, DANCE_LIMITS.maxPoints),
    minRate,
    maxRate: Math.max(minRate + 1, int(d.maxRate, 100, 2, 1000)),
    voteTime: int(d.voteTime, 30, DANCE_LIMITS.minVote, DANCE_LIMITS.maxVote),
  };
}

/** Все музыкальные зависимости: обычный трек карточки и три участка специального ремикса. */
export function danceTrackIds(content: DanceContent): string[] {
  return [...new Set(content.cards.flatMap((c) => [c.trackId, ...c.remix.map((clip) => clip.trackId)].filter((id): id is string => Boolean(id))))];
}

/**
 * Ссылка на ролик → адрес для встраивания на экране зала. Только YouTube, VK Видео и Rutube
 * (https); остальное — null (экран покажет «ссылку не открыть, выберите файл»).
 */
export function embedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const yt = (vid: string | null) => (vid && /^[A-Za-z0-9_-]{6,20}$/.test(vid) ? `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&playsinline=1` : null);
  if (host === "youtu.be") return yt(url.pathname.slice(1));
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") return yt(url.searchParams.get("v"));
    const m = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]+)/);
    return yt(m?.[1] ?? null);
  }
  if (host === "vk.com" || host === "vkvideo.ru") {
    const m = (url.pathname + url.search).match(/video(-?\d+)_(\d+)/);
    return m ? `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}&autoplay=1` : null;
  }
  if (host === "rutube.ru") {
    const m = url.pathname.match(/^\/(?:video|play\/embed)\/([0-9a-f]{32})/);
    return m ? `https://rutube.ru/play/embed/${m[1]}?autoplay=1` : null;
  }
  return null;
}
