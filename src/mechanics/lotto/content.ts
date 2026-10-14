// Музыкальное лото: у каждого игрока (команды) своя карточка из названий песен. Звучит песня —
// гости отмечают её на карточке; собрал линию — жмёт «Лото!». Сервер и пульт проверяют заявку по
// песням, которые уже звучали, и дают очки первым победителям.
// У песни может быть видео — клип или караоке (решение владельца 14 октября 2026): ссылка YouTube /
// VK Видео / Rutube или файл только на устройстве экрана зала (на сервер видео не загружается).
import { embedUrl, type VideoSource } from "../dance/content";

export type { VideoSource };

export interface LottoSong {
  id: string;
  title: string;
  artist: string;
  /** Трек из музыки ведущего или общей; нет — ведущий ставит песню со своего плеера. */
  trackId: string | null;
  /** С какой секунды играть. */
  trackStart: number;
  /** Клип или караоке на экране зала; звук — из видео (трек тогда не играет). */
  video: { source: VideoSource; url: string; name: string };
  /** С какой секунды видео. */
  videoStart: number;
}

/** Что считается победой: одна линия, две линии или вся карточка. */
export type WinRule = "line" | "twoLines" | "full";

/**
 * Оформление карточки на телефоне гостя: «Классика» — простая сетка в цветах темы, «Вечер» и
 * «День» — сетка на рисованном фоне (`public/cards/art/web/loto-*.webp`, стили — src/styles.css).
 */
export type CardStyle = "classic" | "evening" | "day";

export interface LottoContent {
  songs: LottoSong[];
  /** Карточка size × size. */
  size: 3 | 4 | 5;
  rule: WinRule;
  /** Сколько секунд играет песня на экране зала. */
  fragment: number;
  /** Очки первым победителям по порядку; дальше — последнее число. */
  prizes: number[];
  /** Оформление карточки гостя. Старые игры без поля — «Классика». */
  cardStyle: CardStyle;
  /** Прятать картинку видео, пока не показали название (звучит только звук — угадывают на слух). */
  videoHide: boolean;
}

export const LOTTO_LIMITS = {
  songs: 100,
  title: 80,
  artist: 60,
  minFragment: 5,
  maxFragment: 180,
  maxPrize: 1000,
  prizes: 5,
  url: 500,
  maxVideoStart: 3600,
} as const;

/** Есть ли у песни видео, которое экран может показать (ссылка — непустая). */
export function hasVideo(song: Pick<LottoSong, "video"> | undefined): boolean {
  if (!song) return false;
  if (song.video.source === "file") return true;
  return song.video.source === "link" && song.video.url.trim() !== "";
}

/** Ссылка, которую экран не откроет (не YouTube, VK Видео или Rutube). */
export function badVideoLink(song: Pick<LottoSong, "video">): boolean {
  return song.video.source === "link" && song.video.url.trim() !== "" && embedUrl(song.video.url) === null;
}

export const RULE_TITLES: Record<WinRule, string> = {
  line: "Одна линия",
  twoLines: "Две линии",
  full: "Вся карточка",
};

export const RULE_HINTS: Record<WinRule, string> = {
  line: "Ряд, столбец или диагональ — быстрая игра.",
  twoLines: "Любые две линии — игра подольше.",
  full: "Все песни карточки — для долгого вечера.",
};

export const CARD_STYLES: CardStyle[] = ["classic", "evening", "day"];

export const CARD_STYLE_TITLES: Record<CardStyle, string> = {
  classic: "Классика",
  evening: "Вечер",
  day: "День",
};

export const CARD_STYLE_HINTS: Record<CardStyle, string> = {
  classic: "Простая сетка в цветах оформления игры.",
  evening: "Тёмная карточка в стиле ар-деко: золотая пластинка и веер.",
  day: "Светлая карточка: пионы, микрофон и граммофон.",
};

export function newSongId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "s" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newSong(title = "", artist = ""): LottoSong {
  return { id: newSongId(), title, artist, trackId: null, trackStart: 0, video: { source: "none", url: "", name: "" }, videoStart: 0 };
}

export function createLotto(): LottoContent {
  return { songs: [], size: 4, rule: "line", fragment: 30, prizes: [300, 200, 100], cardStyle: "evening", videoHide: false };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Содержимое из базы → лото. Ничего не бросает. */
export function parseLotto(raw: unknown): LottoContent {
  const d = record(raw);
  const seen = new Set<string>();
  const songs = (Array.isArray(d.songs) ? d.songs : []).slice(0, LOTTO_LIMITS.songs).map((item, i) => {
    const s = record(item);
    let id = typeof s.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(s.id) ? s.id : `s${i + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const v = record(s.video);
    const source: VideoSource = v.source === "file" || v.source === "link" ? v.source : "none";
    return {
      id,
      title: text(s.title, LOTTO_LIMITS.title),
      artist: text(s.artist, LOTTO_LIMITS.artist),
      trackId: typeof s.trackId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s.trackId) ? s.trackId : null,
      trackStart: int(s.trackStart, 0, 0, 3600),
      video: { source, url: source === "link" ? text(v.url, LOTTO_LIMITS.url).trim() : "", name: text(v.name, 120) },
      videoStart: int(s.videoStart, 0, 0, LOTTO_LIMITS.maxVideoStart),
    };
  });
  const size = d.size === 3 || d.size === 5 ? d.size : 4;
  const rule = d.rule === "twoLines" || d.rule === "full" ? d.rule : "line";
  const prizes = (Array.isArray(d.prizes) ? d.prizes : [300, 200, 100])
    .slice(0, LOTTO_LIMITS.prizes)
    .map((p) => int(p, 0, 0, LOTTO_LIMITS.maxPrize));
  return {
    songs,
    size,
    rule,
    fragment: int(d.fragment, 30, LOTTO_LIMITS.minFragment, LOTTO_LIMITS.maxFragment),
    prizes: prizes.length > 0 ? prizes : [300, 200, 100],
    cardStyle: d.cardStyle === "evening" || d.cardStyle === "day" ? d.cardStyle : "classic",
    videoHide: d.videoHide === true,
  };
}

/** Сколько букв помещается в строку клетки рисованной карточки при обычном размере шрифта. */
const FIT_LETTERS: Record<LottoContent["size"], number> = { 3: 8.5, 4: 7, 5: 6 };
/** Сколько строк названия помещается в клетку вместе с исполнителем (5×5 — без исполнителя). */
const FIT_LINES: Record<LottoContent["size"], number> = { 3: 2, 4: 2, 5: 3 };
const MIN_FIT = 0.6;
const MIN_WRAP_FIT = 0.72;

/** Сколько строк займёт название, если в строку помещается perLine букв (переносы — по словам). */
function lineCount(words: string[], perLine: number): number {
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used === 0) used = word.length;
    else if (used + 1 + word.length <= perLine) used += 1 + word.length;
    else {
      lines += 1;
      used = word.length;
    }
    while (used > perLine) {
      lines += 1;
      used -= perLine;
    }
  }
  return lines;
}

/**
 * Как показать название песни в клетке рисованной карточки: `fit` — во сколько раз уменьшить шрифт
 * (от 0,6 до 1), чтобы самое длинное слово влезло целиком, а строк было не больше, чем помещается;
 * `artist` — помещается ли ещё строка исполнителя (у длинных названий её нет, на 5×5 — никогда).
 */
export function cellFit(title: string, size: LottoContent["size"]): { fit: number; artist: boolean } {
  const words = title.split(/\s+/).filter(Boolean);
  const longest = Math.max(0, ...words.flatMap((w) => w.split(/[-‐–]/).map((part) => part.length)));
  const room = FIT_LETTERS[size];
  const wordFit = longest <= room ? 1 : Math.max(MIN_FIT, Math.floor((room / longest) * 100) / 100);
  const fits = (lines: number) => {
    for (let fit = wordFit; fit >= Math.min(wordFit, MIN_WRAP_FIT) - 1e-9; fit = Math.round((fit - 0.04) * 100) / 100) {
      if (lineCount(words, room / fit) <= lines) return fit;
    }
    return null;
  };
  const withArtist = size < 5 ? fits(FIT_LINES[size]) : null;
  if (withArtist !== null) return { fit: withArtist, artist: true };
  const alone = fits(FIT_LINES[size] + (size < 5 ? 1 : 0));
  return { fit: alone ?? Math.min(wordFit, MIN_WRAP_FIT), artist: false };
}

/** Сколько песен нужно на карточку. */
export function cardCells(content: Pick<LottoContent, "size">): number {
  return content.size * content.size;
}

/**
 * Список «Исполнитель — Песня» по строке → песни. Разделитель — тире, двоеточие или «/»;
 * без разделителя — только название.
 */
export function parseSongList(input: string): LottoSong[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\s*\d{1,3}\s*[.)]\s*/, ""))
    .filter(Boolean)
    .slice(0, LOTTO_LIMITS.songs)
    .map((line) => {
      const match = /^(.+?)\s+[—–-]\s+(.+)$/.exec(line) ?? /^(.+?)\s*[:/]\s*(.+)$/.exec(line);
      return match ? newSong(text(match[2]?.trim(), LOTTO_LIMITS.title), text(match[1]?.trim(), LOTTO_LIMITS.artist)) : newSong(text(line, LOTTO_LIMITS.title));
    });
}

export function lottoTrackIds(content: LottoContent): string[] {
  return [...new Set(content.songs.flatMap((s) => (s.trackId ? [s.trackId] : [])))];
}
