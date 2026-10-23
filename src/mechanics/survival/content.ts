// «Гонка на выживание»: до 30 раундов из любых заданий, никто не выбывает — гонка по очкам. Каждый
// 5-й раунд — «Войнушка»: ставки (не меньше половины своего счёта), вопрос «кто первый верно» —
// победитель забирает банк (ставки + приз, растущий 100, 200, 300…). После второй войнушки в раундах,
// которые отметил ведущий (до 3), — аукцион «билета освобождения»: билет позволяет один раз пропустить
// войнушку без ставки.
import { dashMark, dashStartsQuestion, isQuestionHeader, listedOption, listOption, newListedRun, nextLines, pointsSuffix, QUESTION_NUMBERING, splitAnswers, splitLines, stripBold, type ListedRun } from "../quiz/listText";
import { DEFAULT_SURVIVAL_LOOK, parseShowLook, SURVIVAL_LOOKS, type ShowLook } from "../showLook";

export type SurvivalKind = "choice" | "open" | "task";

export interface SurvivalRound {
  id: string;
  kind: SurvivalKind;
  /** Вопрос или задание. */
  text: string;
  /** Задание для режима «каждый сам» (командное задание — как выполнить одному); пусто — тот же `text`. */
  solo: string;
  /** Варианты (вопрос с вариантами и вопрос войнушки). */
  options: string[];
  correct: number;
  /** Ответ для открытого вопроса (через «|» — несколько верных) или подсказка ведущему к заданию. */
  answer: string;
  points: number;
  /** Время на ответ, секунд (задание — без таймера). */
  seconds: number;
}

export interface SurvivalContent {
  rounds: SurvivalRound[];
  /** Каждый какой раунд — войнушка (5). */
  warEvery: number;
  /** Приз первой войнушки; дальше — ×2, ×3… */
  warPrize: number;
  /** Раунды (номера с 1), перед которыми идёт аукцион билета; только после второй войнушки, до 3. */
  tickets: number[];
  betSeconds: number;
  auctionSeconds: number;
  /** Оформление экрана зала (`../showLook.ts`: «Классика», «Трасса», «Вечер JoyRest»). Старые игры без поля — «Классика». */
  look: ShowLook;
}

export const SURVIVAL_LIMITS = { minRounds: 5, maxRounds: 30, text: 300, option: 120, answer: 200, maxPoints: 10_000, maxTickets: 3, minSeconds: 5, maxSeconds: 180 } as const;

export const KIND_TITLES: Record<SurvivalKind, string> = { choice: "Вопрос с вариантами", open: "Открытый вопрос", task: "Задание" };

export const LETTERS = ["A", "B", "C", "D"];

function id(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "r" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newSurvivalRound(kind: SurvivalKind = "choice"): SurvivalRound {
  return { id: id(), kind, text: "", solo: "", options: ["", "", "", ""], correct: -1, answer: "", points: 100, seconds: kind === "task" ? 0 : 30 };
}

/** Войнушка ли раунд (номер с 1). */
export function isWar(content: Pick<SurvivalContent, "warEvery">, number: number): boolean {
  return content.warEvery > 0 && number % content.warEvery === 0;
}

/** Номер войнушки (1, 2, …) для раунда-войнушки. */
export function warIndex(content: Pick<SurvivalContent, "warEvery">, number: number): number {
  return content.warEvery > 0 ? Math.floor(number / content.warEvery) : 0;
}

/** Где можно поставить аукцион: после второй войнушки и не в раунд войнушки. */
export function ticketAllowed(content: Pick<SurvivalContent, "warEvery" | "rounds">, number: number): boolean {
  return number > content.warEvery * 2 && number <= content.rounds.length && !isWar(content, number);
}

export function createSurvival(): SurvivalContent {
  const rounds = Array.from({ length: 30 }, (_, i) => newSurvivalRound((i + 1) % 5 === 0 ? "choice" : i % 3 === 2 ? "task" : "choice"));
  return { rounds, warEvery: 5, warPrize: 100, tickets: [13, 18, 23], betSeconds: 30, auctionSeconds: 30, look: DEFAULT_SURVIVAL_LOOK };
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);

export function parseSurvival(raw: unknown): SurvivalContent {
  const d = rec(raw);
  const seen = new Set<string>();
  const rounds = (Array.isArray(d.rounds) ? d.rounds : []).slice(0, SURVIVAL_LIMITS.maxRounds).map((item, i) => {
    const r = rec(item);
    let rid = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : `r${i + 1}`;
    while (seen.has(rid)) rid += "_";
    seen.add(rid);
    const kind: SurvivalKind = r.kind === "open" || r.kind === "task" ? r.kind : "choice";
    return {
      id: rid,
      kind,
      text: str(r.text, SURVIVAL_LIMITS.text),
      solo: kind === "task" ? str(r.solo, SURVIVAL_LIMITS.text) : "",
      options: Array.from({ length: 4 }, (_, k) => str(Array.isArray(r.options) ? r.options[k] : "", SURVIVAL_LIMITS.option)),
      correct: int(r.correct, -1, -1, 3),
      answer: str(r.answer, SURVIVAL_LIMITS.answer),
      points: int(r.points, 100, 0, SURVIVAL_LIMITS.maxPoints),
      seconds: int(r.seconds, kind === "task" ? 0 : 30, 0, SURVIVAL_LIMITS.maxSeconds),
    };
  });
  const warEvery = int(d.warEvery, 5, 2, 10);
  const base = { rounds, warEvery };
  const tickets = Array.isArray(d.tickets)
    ? [...new Set(d.tickets.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && ticketAllowed(base, n)))].sort((a, b) => a - b).slice(0, SURVIVAL_LIMITS.maxTickets)
    : [];
  return {
    rounds,
    warEvery,
    warPrize: int(d.warPrize, 100, 0, SURVIVAL_LIMITS.maxPoints),
    tickets,
    betSeconds: int(d.betSeconds, 30, SURVIVAL_LIMITS.minSeconds, SURVIVAL_LIMITS.maxSeconds),
    auctionSeconds: int(d.auctionSeconds, 30, SURVIVAL_LIMITS.minSeconds, SURVIVAL_LIMITS.maxSeconds),
    look: parseShowLook(d.look, SURVIVAL_LOOKS),
  };
}

/** Текст раунда для режима игры: задание в «каждый сам» — `solo`, если он есть. */
export function roundText(round: Pick<SurvivalRound, "kind" | "text" | "solo">, playMode: string | undefined): string {
  return round.kind === "task" && playMode === "solo" && round.solo ? round.solo : round.text;
}

/** Верные ответы открытого вопроса. */
export function acceptedAnswers(round: SurvivalRound): string[] {
  return round.answer
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Задание с тайными словами (решение владельца 11 октября 2026): в поле ответа задания — слова через «|»
 * («слон | жираф | кенгуру»). Капитан каждой команды видит на телефоне своё слово (по порядку команд), ведущий
 * — у кого какое, и засчитывает угадавших. Команды показывают по очереди. Без слов — обычное задание.
 */
export function taskWords(round: Pick<SurvivalRound, "kind" | "answer">): string[] {
  if (round.kind !== "task") return [];
  return round.answer
    .split("|")
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Тайное слово команды в задании (null — слов нет или команды нет в очереди). */
export function taskWordFor(round: Pick<SurvivalRound, "kind" | "answer">, order: string[], pid: string): string | null {
  const words = taskWords(round);
  const i = order.indexOf(pid);
  return words.length > 0 && i >= 0 ? (words[i % words.length] ?? null) : null;
}

export interface SurvivalImport {
  rounds: SurvivalRound[];
  /** Номера строк (с 1), которые не удалось разобрать: вариант без вопроса, пятый вариант. */
  skipped: number[];
  /** Замечания по строкам: «(1799)» похоже на год — очки не поставлены. */
  notes: Array<{ line: number; text: string }>;
}

/**
 * «Вопрос? = ответ»: ответ — после последнего «=», только если он есть и это не продолжение вопроса («2+2=?»,
 * «Если x=5, сколько x+1?» — не ответ).
 */
export function openAnswerSplit(body: string): { question: string; answers: string[] } | null {
  // Ответ начинается с первого «=» после вопросительного знака («Формула? = E=mc2» → «E=mc2»); без «?» — с « = »
  // с пробелами, иначе с последнего «=».
  const q = Math.max(body.lastIndexOf("?"), body.lastIndexOf("？"));
  const spaced = body.indexOf(" = ");
  const at = q >= 0 ? body.indexOf("=", q) : spaced >= 0 ? spaced + 1 : body.lastIndexOf("=");
  if (at < 0) return null;
  const tail = body.slice(at + 1).trim();
  if (!tail || /[?？]\s*$/.test(tail)) return null;
  const answers = splitAnswers(tail);
  return answers.length > 0 ? { question: body.slice(0, at).trim(), answers } : null;
}

/**
 * Список: строка — раунд по порядку. «Вопрос?» и строки «- вариант», «* верный» (или «- верный *») — вопрос с
 * вариантами; «Вопрос? = ответ | ответ2» (или « / » с пробелами; «AC/DC» — один ответ) — открытый; «Задание: …» — задание («Задание: … = слон | жираф» —
 * тайные слова командам; «Задание: для команд || для каждого сам = слова» — второй текст в режиме «каждый сам»).
 * «(150)» или «(150 очков)» в конце — очки («(1799)» без слова — похоже на год: очки не ставим, пишем замечание).
 * Варианты — и «а)», «1.»; нумерация «1.» перед вопросом снимается. Без «*» верный вариант не отмечен — проверка попросит
 * отметить.
 */
export function parseSurvivalImport(text: string): SurvivalImport {
  const out: SurvivalRound[] = [];
  const skipped: number[] = [];
  const notes: SurvivalImport["notes"] = [];
  let current: SurvivalRound | null = null;
  let run: ListedRun = newListedRun();
  let dashed = false;
  const flush = () => {
    if (current && current.text) out.push(current);
    current = null;
  };
  const lines = splitLines(text);
  const ahead = nextLines(lines);
  const ahead2 = nextLines(lines, 1);
  let mark: string | null = null;
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (!line) return;
    // «Вопрос 1» отдельной строкой — заголовок: текст вопроса — на следующей строке. Прошлый вопрос закончен: варианты
    // сразу под заголовком не достаются ему, а попадают в «Не разобрали строки».
    if (isQuestionHeader(line)) {
      flush();
      return;
    }
    const dash = listOption(line);
    const cur0 = current as SurvivalRound | null;
    const room = cur0 !== null && cur0.kind === "choice" && cur0.options.some((o) => !o);
    // «— Как зовут кота?» (с тире, со знаком вопроса, без «*») там, где вариант не нужен, — новый вопрос, а не вариант.
    const dashQuestion = dash && !dash.correct && /[?？]\s*$/.test(dash.text) && (!room || dashStartsQuestion(raw, mark, ahead[index])) ? dash.text : null;
    const opt = dashQuestion ? null : dash ?? listedOption(stripBold(line).trim(), room && !dashed ? run : null, ahead[index], ahead2[index]);
    if (dash && !dashQuestion) {
      dashed = true;
      mark ??= dashMark(raw);
    }
    if (opt) {
      const cur = current as SurvivalRound | null;
      if (!cur || cur.kind !== "choice") {
        skipped.push(lineNo);
        return;
      }
      const free = cur.options.findIndex((o) => !o);
      if (free < 0 || !opt.text) {
        skipped.push(lineNo);
        return;
      }
      cur.options[free] = opt.text.slice(0, SURVIVAL_LIMITS.option);
      if (opt.correct && cur.correct < 0) cur.correct = free;
      return;
    }
    flush();
    run = newListedRun();
    dashed = false;
    mark = null;
    const { body: numbered, points: given, note } = pointsSuffix(stripBold(dashQuestion ?? line), SURVIVAL_LIMITS.maxPoints);
    if (note) notes.push({ line: lineNo, text: note });
    const body = numbered.replace(QUESTION_NUMBERING, "").trim();
    const points = given ?? 100;
    const open = openAnswerSplit(body);
    if (/^задание\s*[:.]/i.test(body)) {
      const rest = body.replace(/^задание\s*[:.]\s*/i, "");
      const at = rest.indexOf("=");
      const task = at >= 0 ? rest.slice(0, at) : rest;
      const words = at >= 0 ? rest.slice(at + 1) : "";
      const [teamPart = "", soloPart = ""] = task.split(/\s*\|\|\s*/);
      current = { ...newSurvivalRound("task"), text: teamPart.trim().slice(0, SURVIVAL_LIMITS.text), solo: soloPart.trim().slice(0, SURVIVAL_LIMITS.text), answer: words.trim().slice(0, SURVIVAL_LIMITS.answer), points };
    } else if (open) {
      current = { ...newSurvivalRound("open"), text: open.question.slice(0, SURVIVAL_LIMITS.text), answer: open.answers.join(" | ").slice(0, SURVIVAL_LIMITS.answer), points };
    } else {
      current = { ...newSurvivalRound("choice"), text: body.slice(0, SURVIVAL_LIMITS.text), points };
    }
  });
  flush();
  return { rounds: out.slice(0, SURVIVAL_LIMITS.maxRounds), skipped, notes };
}

/** То же, только раунды (шаблон и старые вызовы). */
export function parseSurvivalList(text: string): SurvivalRound[] {
  return parseSurvivalImport(text).rounds;
}
