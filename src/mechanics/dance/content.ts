// «Танцевальный батл»: карточки Батл / Танец / Караоке. Команды по очереди выбирают карточку,
// выступают, другие команды оценивают (танец, караоке — от 10 до 100) или голосуют (батл).
// Видео на сервер не загружается: файл на устройстве экрана зала или ссылка (YouTube, VK, Rutube).
import { clipFields, parseClip, type Clip } from "../../core/clip";

export type DanceKind = "battle" | "dance" | "karaoke";
export type VideoSource = "none" | "file" | "link";

export interface DanceCard {
  id: string;
  kind: DanceKind;
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
}

export interface DanceContent {
  cards: DanceCard[];
  /** Очки победителю батла. */
  battlePoints: number;
  /** Оценка выступления: от и до. */
  minRate: number;
  maxRate: number;
  /** Секунд на оценку. */
  voteTime: number;
}

export const DANCE_LIMITS = { cards: 60, title: 80, note: 200, url: 500, minPoints: 10, maxPoints: 1000, minVote: 10, maxVote: 120 } as const;

export const KIND_TITLES: Record<DanceKind, string> = { battle: "Батл", dance: "Танец", karaoke: "Караоке" };
export const KIND_EMOJI: Record<DanceKind, string> = { battle: "⚡", dance: "💃", karaoke: "🎤" };

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "d" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

const CLIP = () => clipFields(parseClip({})) as Pick<DanceCard, "trackId" | "trackStart" | "trackLength" | "fadeIn" | "fadeOut" | "chorusStart" | "chorusLength" | "join" | "confetti">;

export function newCard(kind: DanceKind): DanceCard {
  return { id: id(), kind, title: "", note: "", video: { source: kind === "battle" ? "none" : "link", url: "", name: "" }, ...CLIP() };
}

export function createDance(): DanceContent {
  return { cards: [newCard("dance"), newCard("karaoke"), newCard("battle")], battlePoints: 100, minRate: 10, maxRate: 100, voteTime: 30 };
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

export function parseDance(raw: unknown): DanceContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const cards = (Array.isArray(d.cards) ? d.cards : []).slice(0, DANCE_LIMITS.cards).map((item, i) => {
    const c = rec(item);
    let cid = typeof c.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) ? c.id : `d${i + 1}`;
    while (seen.has(cid)) cid += "_";
    seen.add(cid);
    const kind: DanceKind = c.kind === "battle" || c.kind === "karaoke" ? c.kind : "dance";
    const v = rec(c.video);
    const source: VideoSource = v.source === "file" || v.source === "link" ? v.source : "none";
    return {
      id: cid,
      kind,
      title: str(c.title, DANCE_LIMITS.title),
      note: str(c.note, DANCE_LIMITS.note),
      video: { source, url: source === "link" ? str(v.url, DANCE_LIMITS.url) : "", name: str(v.name, 120) },
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

export function danceTrackIds(content: DanceContent): string[] {
  return [...new Set(content.cards.flatMap((c) => (c.trackId ? [c.trackId] : [])))];
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
