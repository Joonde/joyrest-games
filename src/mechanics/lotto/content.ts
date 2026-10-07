// Музыкальное лото: у каждого игрока (команды) своя карточка из названий песен. Звучит песня —
// гости отмечают её на карточке; собрал линию — жмёт «Лото!». Сервер и пульт проверяют заявку по
// песням, которые уже звучали, и дают очки первым победителям.

export interface LottoSong {
  id: string;
  title: string;
  artist: string;
  /** Трек из музыки ведущего или общей; нет — ведущий ставит песню со своего плеера. */
  trackId: string | null;
  /** С какой секунды играть. */
  trackStart: number;
}

/** Что считается победой: одна линия, две линии или вся карточка. */
export type WinRule = "line" | "twoLines" | "full";

export interface LottoContent {
  songs: LottoSong[];
  /** Карточка size × size. */
  size: 3 | 4 | 5;
  rule: WinRule;
  /** Сколько секунд играет песня на экране зала. */
  fragment: number;
  /** Очки первым победителям по порядку; дальше — последнее число. */
  prizes: number[];
}

export const LOTTO_LIMITS = {
  songs: 100,
  title: 80,
  artist: 60,
  minFragment: 5,
  maxFragment: 180,
  maxPrize: 1000,
  prizes: 5,
} as const;

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

export function newSongId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "s" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newSong(title = "", artist = ""): LottoSong {
  return { id: newSongId(), title, artist, trackId: null, trackStart: 0 };
}

export function createLotto(): LottoContent {
  return { songs: [], size: 4, rule: "line", fragment: 30, prizes: [300, 200, 100] };
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
  };
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
