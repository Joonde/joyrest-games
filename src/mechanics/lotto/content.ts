// Музыкальное лото: у каждого игрока (команды) своя карточка из названий песен. Звучит песня —
// гости отмечают её на карточке; собрал линию — жмёт «Лото!». Сервер и пульт проверяют заявку по
// песням, которые уже звучали, и дают очки первым победителям.
// У песни может быть видео — клип или караоке (решение владельца 14 октября 2026): ссылка YouTube /
// VK Видео / Rutube или файл только на устройстве экрана зала (на сервер видео не загружается).
import { embedUrl, parseVideo, type VideoSource } from "../dance/content";

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
  /** Сколько секунд играет эта песня: null — как у всей игры (`fragment`), 0 — до конца трека. */
  length: number | null;
  /** Текст песни для караоке — по строкам (ведущий вставляет сам). Пусто — текста нет. */
  lyrics: string[];
  /** Секунда трека, с которой звучит каждая строка (размечает ведущий). Строки дальше — без времени, на экран не идут. */
  times: number[];
  /** Когда показывать текст: после названия или с секунды трека `lyricsAt`. */
  lyricsShow: LyricsShow;
  /** Секунда трека, с которой текст на экране (при `lyricsShow = "at"`). */
  lyricsAt: number;
}

/** Текст песни: после показа названия (угадывание не портит) или с выбранной секунды трека. */
export type LyricsShow = "reveal" | "at";

/**
 * Барабан перед песней (решение владельца 27 октября 2026): «full» — полный (~13 с с показом номера),
 * «quick» — быстрый (~7 с), «off» — без барабана, песни по списку (как было). С барабаном порядок песен
 * случайный и закрепляется на игру.
 */
export type DrumMode = "full" | "quick" | "off";

export const DRUM_MODES: DrumMode[] = ["full", "quick", "off"];

export const DRUM_TITLES: Record<DrumMode, string> = {
  full: "Барабан",
  quick: "Быстрый барабан",
  off: "Без барабана",
};

export const DRUM_HINTS: Record<DrumMode, string> = {
  full: "Барабан крутится, выпадает бочонок, номер 3 секунды на экране — и звучит песня. Песни в случайном порядке. ~13 с на песню.",
  quick: "То же, но короче — ~7 с на песню. Для больших игр на 60–100 песен.",
  off: "Песни по порядку списка, сразу звучат — как раньше.",
};

/** Сколько длится показ барабана до музыки, мс (вместе с 3 секундами номера). */
export const DRUM_MS: Record<DrumMode, number> = { full: 12900, quick: 7200, off: 0 };

/** Что считается победой: линия по горизонтали, по вертикали, любая линия, две линии или вся карточка. */
export type WinRule = "row" | "column" | "line" | "twoLines" | "full";

/** Порядок в конструкторе. */
export const WIN_RULES: WinRule[] = ["row", "column", "line", "twoLines", "full"];

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
  /** Подсказка гостю: звучащая песня есть на его карточке — клетка светится, «Эта песня у вас есть!». */
  hint: boolean;
  /** Барабан перед каждой песней. Старые игры — без барабана. */
  drum: DrumMode;
  /** Песня играет и после показа названия — тише, на 60% (люди допевают). Выкл — на названии музыка затихает. */
  playAfter: boolean;
}

/** Громкость песни после показа названия, если включено «играет и после ответа». */
export const AFTER_VOLUME = 0.6;

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
  /** Своя длина песни: от minFragment до maxLength секунд (0 — до конца). */
  maxLength: 900,
  lyricsLines: 200,
  lyricsLine: 120,
  maxTrackSec: 3600,
} as const;

/** Сколько секунд играет песня (0 — до конца трека). */
export function songLength(content: Pick<LottoContent, "fragment">, song: Pick<LottoSong, "length"> | undefined): number {
  if (!song || song.length === null) return content.fragment;
  return song.length;
}

/** Есть ли у песни размеченный текст (хотя бы одна строка со временем). */
export function hasLyrics(song: Pick<LottoSong, "lyrics" | "times"> | undefined): boolean {
  return !!song && song.lyrics.length > 0 && song.times.length > 0;
}

/** Есть ли у песни видео, которое экран может показать (ссылка — непустая). */
export function hasVideo(song: Pick<LottoSong, "video"> | undefined): boolean {
  if (!song) return false;
  if (song.video.source === "file") return true;
  if (song.video.source === "server") return song.video.url !== "";
  return song.video.source === "link" && song.video.url.trim() !== "";
}

/** Ссылка, которую экран не откроет (не YouTube, VK Видео или Rutube). */
export function badVideoLink(song: Pick<LottoSong, "video">): boolean {
  return song.video.source === "link" && song.video.url.trim() !== "" && embedUrl(song.video.url) === null;
}

export const RULE_TITLES: Record<WinRule, string> = {
  row: "Линия по горизонтали",
  column: "Линия по вертикали",
  line: "Одна линия",
  twoLines: "Две линии",
  full: "Вся карточка",
};

export const RULE_HINTS: Record<WinRule, string> = {
  row: "Любой ряд целиком — слева направо.",
  column: "Любой столбец целиком — сверху вниз.",
  line: "Ряд, столбец или диагональ — самая быстрая игра.",
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
  return { id: newSongId(), title, artist, trackId: null, trackStart: 0, video: { source: "none", url: "", name: "" }, videoStart: 0, length: null, lyrics: [], times: [], lyricsShow: "reveal", lyricsAt: 0 };
}

export function createLotto(): LottoContent {
  return { songs: [], size: 4, rule: "line", fragment: 30, prizes: [300, 200, 100], cardStyle: "evening", videoHide: false, hint: true, drum: "full", playAfter: false };
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
    return {
      id,
      title: text(s.title, LOTTO_LIMITS.title),
      artist: text(s.artist, LOTTO_LIMITS.artist),
      trackId: typeof s.trackId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s.trackId) ? s.trackId : null,
      trackStart: int(s.trackStart, 0, 0, 3600),
      video: parseVideo(s.video, LOTTO_LIMITS.url),
      videoStart: int(s.videoStart, 0, 0, LOTTO_LIMITS.maxVideoStart),
      length: parseLength(s.length),
      ...parseLyrics(s.lyrics, s.times),
      lyricsShow: s.lyricsShow === "at" ? ("at" as const) : ("reveal" as const),
      lyricsAt: seconds(s.lyricsAt),
    };
  });
  const size = d.size === 3 || d.size === 5 ? d.size : 4;
  const rule: WinRule = WIN_RULES.includes(d.rule as WinRule) ? (d.rule as WinRule) : "line";
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
    hint: d.hint !== false,
    drum: d.drum === "full" || d.drum === "quick" ? d.drum : "off",
    playAfter: d.playAfter === true,
  };
}

/** Длина песни: null — общая, 0 — до конца, иначе от minFragment до maxLength. */
function parseLength(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  return Math.min(LOTTO_LIMITS.maxLength, Math.max(LOTTO_LIMITS.minFragment, Math.round(value)));
}

/** Секунда трека с точностью до десятых. */
export function seconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.round(Math.min(LOTTO_LIMITS.maxTrackSec, value) * 10) / 10;
}

/** Строки текста и их время: строк не больше лимита, время не больше строк и не убывает. */
export function parseLyrics(rawLines: unknown, rawTimes: unknown): { lyrics: string[]; times: number[] } {
  const lyrics = (Array.isArray(rawLines) ? rawLines : [])
    .filter((l): l is string => typeof l === "string")
    .map((l) => text(l, LOTTO_LIMITS.lyricsLine).trim())
    .filter(Boolean)
    .slice(0, LOTTO_LIMITS.lyricsLines);
  const times: number[] = [];
  for (const t of Array.isArray(rawTimes) ? rawTimes : []) {
    if (times.length >= lyrics.length) break;
    if (typeof t !== "number" || !Number.isFinite(t)) break;
    times.push(Math.max(seconds(t), times[times.length - 1] ?? 0));
  }
  return { lyrics, times };
}

/** Текст из поля «вставить текст» → строки (пустые строки убираются). */
export function lyricsFromText(input: string): string[] {
  return parseLyrics(input.split(/\r?\n/), []).lyrics;
}

/**
 * Файл .lrc («[01:02.50] строка») → строки и время. Служебные теги ([ar:…], [ti:…], [offset:…]) пропускаются,
 * несколько меток у строки — строка повторяется. Строк без времени нет — null (это не .lrc).
 */
export function parseLrc(input: string): { lyrics: string[]; times: number[] } | null {
  const rows: Array<{ t: number; line: string }> = [];
  let offset = 0;
  for (const raw of input.split(/\r?\n/)) {
    const meta = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (meta) {
      offset = Number(meta[1]) / 1000;
      continue;
    }
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (tags.length === 0) continue;
    const line = raw.replace(/\[[^\]]*\]/g, "").replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
    if (!line) continue;
    for (const tag of tags) {
      const frac = tag[3] ? Number(`0.${tag[3]}`) : 0;
      rows.push({ t: Number(tag[1]) * 60 + Number(tag[2]) + frac - offset, line });
    }
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.t - b.t);
  return parseLyrics(
    rows.map((r) => r.line),
    rows.map((r) => r.t),
  );
}

/** Текст и разметка → файл .lrc (скачать и поправить в другой программе). */
export function toLrc(song: Pick<LottoSong, "lyrics" | "times" | "title" | "artist">): string {
  const stamp = (t: number) => {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
  };
  const head = [song.title ? `[ti:${song.title}]` : "", song.artist ? `[ar:${song.artist}]` : ""].filter(Boolean);
  return [...head, ...song.lyrics.map((line, i) => (song.times[i] !== undefined ? `[${stamp(song.times[i] as number)}] ${line}` : line))].join("\n");
}

/** «1:05» / «1:05.3». */
export function clockOf(sec: number, tenths = false): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = tenths ? rest.toFixed(1).padStart(4, "0") : String(Math.floor(rest)).padStart(2, "0");
  return `${m}:${whole}`;
}

/** Какая строка звучит на секунде трека `t`: номер строки или -1 (ещё рано / текста нет). */
export function lyricIndex(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
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
