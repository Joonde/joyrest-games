// Формат содержимого квиза. Хранится в games/{id}.content и в снимке сессии.
// Картинок здесь нет — только imageId (документ games/{id}/media/{imageId}).
import { clipFields, parseClip, type Clip, type ClipJoin } from "../../core/clip";
import { parseDrawEffect, type DrawEffect } from "../../core/draw";
import { newLevels, parseLevels, parsePenalty, parsePickMode, parseStyle, superTrackIds, VOTE_TIME, type SuperLevel, type SuperPenalty, type SuperPickMode, type SuperStyle } from "../../core/supergame";

/**
 * Форматы вопроса. Классика: варианты, открытый, на скорость. Гонка «Кто быстрее» (`buzz`): кнопка,
 * слово первому нажавшему, ведущий решает «Верно» или «Неверно». Картинки (`pictures`): 2–4 фото, у
 * каждого свой ответ.
 */
export type QuestionKind = "choice" | "open" | "speed" | "buzz" | "pictures" | "super" | "order" | "number" | "auction";

/** «Аукцион»: как отвечает выигравший ставку — вариантами или своими словами. */
export type AuctionAnswer = "choice" | "open";

/** «Угадай число»: только ближайший — все очки; по близости — 1-е место 100%, 2-е 60%, 3-е 30%. */
export type NumberScoring = "closest" | "places";

/** Картинка в вопросе «Несколько картинок»: верные ответы к ней. */
export interface QuizPicture {
  imageId: string | null;
  answers: string[];
}

export interface QuizQuestion {
  /** Постоянный id вопроса: ключ в списке и в путях ошибок. */
  id: string;
  kind: QuestionKind;
  text: string;
  /** Варианты для «выбора» и «на скорость». */
  options: string[];
  /** Номер правильного варианта; -1 — ещё не выбран. */
  correct: number;
  /** Ещё верные варианты (кроме `correct`): засчитывается любой из отмеченных. */
  alsoCorrect?: number[];
  /** Верные ответы на открытый вопрос: подходит любой. */
  answers: string[];
  /** Время на ответ, секунды. */
  timeLimit: number;
  /** Очки за верный ответ (на скорость — максимум за самый быстрый). */
  points: number;
  imageId: string | null;
  /**
   * Музыка к вопросу («Узнай по нотам»): трек из музыки ведущего или общей, с какой секунды и
   * сколько секунд играть на экране зала. Нет — вопрос без музыки.
   */
  trackId?: string | null;
  trackStart?: number;
  trackLength?: number;
  /** Звучание фрагмента и припев после верного ответа (`src/core/clip.ts`). */
  fadeIn?: number;
  fadeOut?: number;
  chorusStart?: number | null;
  chorusLength?: number;
  join?: ClipJoin;
  confetti?: boolean;
  /**
   * «Музыка на ответ» (решение владельца 23 октября 2026): у любого вопроса — отрывок трека, который играет на экране зала,
   * когда ведущий показал верный ответ. Есть — играет он (вместо припева трека вопроса); нет — как раньше.
   */
  answerMusic?: AnswerMusic | null;
  /** Гонка: сколько делений к финишу даёт верный ответ (1–3, 3 — «супер»). */
  steps?: number;
  /** Несколько картинок: 2–4, у каждой свои верные ответы. */
  pictures?: QuizPicture[];
  /** Суперигра (`super`): 4 уровня, оформление и правило ошибки (`src/core/supergame.ts`). */
  levels?: SuperLevel[];
  superStyle?: SuperStyle;
  penalty?: SuperPenalty;
  /**
   * Суперигра: сначала голосование «Играем суперигру?» (решение владельца 25 октября 2026) — играем, если «за» больше
   * половины голосов. Нет поля (игры до 25 октября 2026) — без голосования. `voteTime` — секунд на голосование.
   */
  superVote?: boolean;
  voteTime?: number;
  /**
   * Суперигра: как выбирают уровень — `vote` весь зал голосует, играем один уровень (по умолчанию, и у игр без поля);
   * `each` — каждая команда выбирает свой (решение владельца 31 октября 2026). Время голосования — `voteTime`.
   */
  superPick?: SuperPickMode;
  /** С этого вопроса начинается раунд с таким названием; null — продолжается прежний. */
  round: string | null;
  /** Заметка ведущему (факт, шутка, подводка): видна только на пульте, не на экране и телефонах. */
  note?: string;
  /** «Расставь по порядку»: варианты (`options`) записаны в верном порядке; частично — очки за каждую на своём месте. */
  partial?: boolean;
  /** «Угадай число»: верное число, единица («ступеней», «км») и как считать очки. */
  number?: number | null;
  unit?: string;
  scoring?: NumberScoring;
  /**
   * «Аукцион» (решение владельца 23 октября 2026): тема видна до ставок, сам вопрос — после. Ставят все, отвечает
   * сделавший самую большую ставку (равные — жребий на экране), на своём телефоне: верно — +ставка, неверно — −ставка.
   */
  topic?: string;
  auctionAnswer?: AuctionAnswer;
  /** Секунды на ставки. */
  betTime?: number;
}

/** Отрывок «Музыки на ответ»: трек, с какой секунды, сколько секунд, плавное начало и конец. */
export interface AnswerMusic {
  trackId: string;
  start: number;
  length: number;
  fadeIn: number;
  fadeOut: number;
}

/** Разбор «Музыки на ответ»: без трека — null. */
export function parseAnswerMusic(raw: unknown): AnswerMusic | null {
  const clip = parseClip(raw);
  if (!clip.trackId) return null;
  return { trackId: clip.trackId, start: clip.start, length: clip.length, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut };
}

/** «Музыка на ответ» как фрагмент для таймлайна (без припева). */
export function answerClipOf(q: QuizQuestion): Clip {
  return { ...parseClip(q.answerMusic ?? {}), chorusStart: null };
}

/** Фрагмент с таймлайна → «Музыка на ответ» вопроса («Без музыки» — null). */
export function withAnswerClip(q: QuizQuestion, clip: Clip): QuizQuestion {
  return { ...q, answerMusic: clip.trackId ? { trackId: clip.trackId, start: clip.start, length: clip.length, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut } : null };
}

/** Музыкальный фрагмент вопроса (трек, угадывание, припев, звучание). */
export function clipOf(q: QuizQuestion): Clip {
  return parseClip(q);
}

/** Записать фрагмент в вопрос. */
export function withClip(q: QuizQuestion, clip: Clip): QuizQuestion {
  return { ...q, ...(clipFields(clip) as Partial<QuizQuestion>) };
}

/** Как ведущий проводит квиз (настройки игры в конструкторе). */
export interface QuizSettings {
  /** Заставка «Вопрос 2 из 8» перед вопросом; false — «Следующий вопрос» сразу открывает вопрос. */
  intro: boolean;
  /**
   * Таблица после ответа: `each` — после каждого вопроса, `rounds` — только в конце раунда
   * (без раундов — только в конце игры), `manual` — по кнопке ведущего.
   */
  board: "each" | "rounds" | "manual";
  /** Картинка вопроса на телефонах гостей и при экране зала (без экрана — всегда). */
  phoneImages: boolean;
  /** Гонка «Кто быстрее»: сколько делений до финиша. */
  raceTarget: number;
  /**
   * Гонка: бонус тому, кто первым дошёл до финиша (решение владельца 25 октября 2026 — гонка влияет на итог). Нет — 200,
   * 0 — без бонуса.
   */
  raceBonus?: number;
  /** «Аукцион»: чем тянуть жребий при равных ставках. Нет — монетка (игры до 23 октября 2026). */
  drawEffect?: DrawEffect;
  /**
   * Нарисованный фон экрана зала (решение владельца 23 октября 2026): `auto` или нет — по игре («Узнай по нотам» — рояль,
   * остальные — стол с кубком), иначе выбранная картина `public/covers/art/web/<id>.webp`.
   */
  art?: QuizArt;
}

/** Фоны квиза: id картины и подпись в конструкторе. */
export const QUIZ_ARTS = [
  { id: "auto", title: "Сам по игре", hint: "Квиз с треками — рояль, остальные — стол с кубком" },
  { id: "quiz-office", title: "Стол с кубком", hint: "Классический квиз" },
  { id: "quiz-author", title: "Кабинет с пером", hint: "Авторский квиз" },
  { id: "quiz-company", title: "Команда за столом", hint: "Квиз под компанию, корпоратив" },
  { id: "quiz-games", title: "Кубики и колесо", hint: "Квиз с элементами игр" },
  { id: "quiz-musicdance", title: "Граммофон и танцы", hint: "Квиз с музыкой и танцами" },
  { id: "melody-notes", title: "Рояль и нота", hint: "«Узнай по нотам»" },
  { id: "melody", title: "Микрофон и клавиши", hint: "Прежний фон «Узнай по нотам»" },
] as const;

export type QuizArt = (typeof QUIZ_ARTS)[number]["id"];

export function parseQuizArt(value: unknown): QuizArt {
  return QUIZ_ARTS.some((a) => a.id === value) ? (value as QuizArt) : "auto";
}

/** Какую картину ставить фоном экрана зала. */
export function quizArtOf(content: QuizContent): string {
  const art = settingsOf(content).art ?? "auto";
  if (art !== "auto") return art;
  return isMelodyQuiz(content) ? "melody-notes" : "quiz-office";
}

/** Бонус за финиш гонки по умолчанию и границы. */
export const RACE_BONUS = { def: 200, max: 2000 } as const;

export function raceBonusOf(content: QuizContent): number {
  return settingsOf(content).raceBonus ?? RACE_BONUS.def;
}

export const DEFAULT_SETTINGS: QuizSettings = { intro: true, board: "each", phoneImages: false, raceTarget: 5 };

export interface QuizContent {
  questions: QuizQuestion[];
  /** Нет — настройки по умолчанию (игры, созданные до настроек). */
  settings?: QuizSettings;
}

export function settingsOf(content: QuizContent): QuizSettings {
  return content.settings ?? DEFAULT_SETTINGS;
}

/** Эффект жребия «Аукциона» из настроек игры (старые игры — монетка). */
export function drawEffectOfSettings(content: QuizContent): DrawEffect {
  return settingsOf(content).drawEffect ?? "coin";
}

/** Отвечают ли на вопрос вариантами (у «Аукциона» — по его настройке). */
export function usesOptions(q: Pick<QuizQuestion, "kind" | "auctionAnswer">): boolean {
  return q.kind === "auction" ? q.auctionAnswer !== "open" : hasOptions(q.kind);
}

/** Пишут ли ответ словами (у «Аукциона» — по его настройке). */
export function usesAnswers(q: Pick<QuizQuestion, "kind" | "auctionAnswer">): boolean {
  return q.kind === "auction" ? q.auctionAnswer === "open" : hasAnswers(q.kind);
}

/** Все верные варианты вопроса с вариантами (по возрастанию). */
export function correctSet(q: Pick<QuizQuestion, "correct" | "alsoCorrect" | "options">): number[] {
  const all = new Set<number>([q.correct, ...(q.alsoCorrect ?? [])]);
  return [...all].filter((i) => i >= 0 && i < q.options.length).sort((a, b) => a - b);
}

/** Отметить или снять верный вариант: первый отмеченный — `correct`, остальные — `alsoCorrect`. */
export function toggleCorrect(q: QuizQuestion, index: number): QuizQuestion {
  const set = new Set(correctSet(q));
  if (set.has(index)) set.delete(index);
  else set.add(index);
  const sorted = [...set].sort((a, b) => a - b);
  return { ...q, correct: sorted[0] ?? -1, alsoCorrect: sorted.slice(1) };
}

/** Раунд квиза: вопросы с from по to включительно. */
export interface QuizRound {
  /** Номер раунда с 1. */
  number: number;
  /** Название; пусто — у первого раунда, если ведущий его не назвал. */
  title: string;
  from: number;
  to: number;
}

/**
 * Раунды квиза. Нет ни одного названия раунда — раундов нет (пустой список, игра как раньше).
 * Вопросы до первого названного раунда — безымянный первый раунд.
 */
export function quizRounds(content: QuizContent): QuizRound[] {
  const starts: Array<{ from: number; title: string }> = [];
  content.questions.forEach((q, i) => {
    if (q.round !== null) starts.push({ from: i, title: q.round });
  });
  if (starts.length === 0) return [];
  if (starts[0]?.from !== 0) starts.unshift({ from: 0, title: "" });
  return starts.map((start, i) => ({
    number: i + 1,
    title: start.title,
    from: start.from,
    to: (starts[i + 1]?.from ?? content.questions.length) - 1,
  }));
}

/** Раунд, в котором этот шаг; null — раундов нет. */
export function roundAt(content: QuizContent, step: number): QuizRound | null {
  return quizRounds(content).find((r) => step >= r.from && step <= r.to) ?? null;
}

/** «Раунд 2: Кино» или «Раунд 1». */
export function roundTitle(round: QuizRound): string {
  const plain = !round.title || /^раунд\s*\d*$/i.test(round.title);
  return plain ? `Раунд ${round.number}` : `Раунд ${round.number}: ${round.title}`;
}

export const LIMITS = {
  questions: 100,
  text: 300,
  option: 100,
  minOptions: 2,
  maxOptions: 6,
  answers: 10,
  answer: 100,
  minTime: 5,
  maxTime: 300,
  minPoints: 1,
  maxPoints: 1000,
  round: 60,
  note: 300,
  trackStart: 3600,
  minTrackLength: 3,
  maxTrackLength: 120,
  minPictures: 2,
  maxPictures: 4,
  maxSteps: 3,
  minRace: 1,
  maxRace: 20,
  minOrder: 3,
  unit: 20,
  topic: 80,
  minBetTime: 10,
  maxBetTime: 90,
  /** «Угадай число»: границы ответа (и верного числа). */
  maxNumber: 1_000_000_000_000,
} as const;

/** Фрагмент по умолчанию — 15 секунд с начала. */
export const DEFAULT_TRACK_LENGTH = 15;

export const DEFAULTS: Record<QuestionKind, { timeLimit: number; points: number }> = {
  choice: { timeLimit: 30, points: 100 },
  open: { timeLimit: 45, points: 100 },
  speed: { timeLimit: 15, points: 200 },
  buzz: { timeLimit: 60, points: 100 },
  pictures: { timeLimit: 60, points: 100 },
  super: { timeLimit: 90, points: 100 },
  order: { timeLimit: 45, points: 100 },
  number: { timeLimit: 30, points: 100 },
  auction: { timeLimit: 30, points: 200 },
};

/** Секунд на ставки «Аукциона» по умолчанию. */
export const DEFAULT_BET_TIME = 30;

export const KIND_TITLES: Record<QuestionKind, string> = {
  choice: "Выбор варианта",
  open: "Открытый ответ",
  speed: "На скорость",
  buzz: "Гонка: кто первый",
  pictures: "Несколько картинок",
  super: "Суперигра",
  order: "Расставь по порядку",
  number: "Угадай число",
  auction: "Аукцион",
};

export const KIND_HINTS: Record<QuestionKind, string> = {
  choice: "От 2 до 6 вариантов, верных — один или несколько.",
  open: "Гости пишут ответ сами. Регистр, ё/е, пробелы и знаки препинания не важны.",
  speed: "Варианты ответа; чем быстрее верный ответ, тем больше очков.",
  buzz: "Красная кнопка: слово первому нажавшему, «Верно» — шаг к финишу и очки.",
  pictures: "2–4 картинки, ответ к каждой; очки — за каждую угаданную.",
  super: "4 уровня — у каждого свой вопрос любого формата. Каждый выбирает уровень и отвечает. Верно — очки уровня, ошибка — по правилу.",
  order: "3–6 карточек: впишите их в верном порядке, гости увидят их вперемешку и расставят на телефоне.",
  number: "Ответ — число. Ближе всех — все очки; можно дать очки и 2-му, 3-му месту по близости.",
  auction: "Сначала видна только тема, все ставят очки. Отвечает поставивший больше всех (равные — жребий): верно +ставка, неверно −ставка.",
};

/** Блоки в «Добавить вопрос»: плитка — формат, у музыкальных сразу включается трек. */
export interface QuestionFormat {
  id: string;
  block: "classic" | "music" | "pictures" | "bets";
  kind: QuestionKind;
  title: string;
  music?: boolean;
}

export const QUESTION_FORMATS: QuestionFormat[] = [
  { id: "choice", block: "classic", kind: "choice", title: "Варианты" },
  { id: "open", block: "classic", kind: "open", title: "Открытый ответ" },
  { id: "speed", block: "classic", kind: "speed", title: "На скорость" },
  { id: "order", block: "classic", kind: "order", title: "Расставь по порядку" },
  { id: "number", block: "classic", kind: "number", title: "Угадай число" },
  { id: "music-choice", block: "music", kind: "choice", title: "Трек + варианты", music: true },
  { id: "music-open", block: "music", kind: "open", title: "Трек + напишите", music: true },
  { id: "buzz", block: "music", kind: "buzz", title: "Гонка: кто первый", music: true },
  { id: "image", block: "pictures", kind: "choice", title: "Одна картинка" },
  { id: "pictures", block: "pictures", kind: "pictures", title: "2–4 картинки" },
  { id: "auction", block: "bets", kind: "auction", title: "Аукцион: ставки" },
];

export const FORMAT_BLOCKS: Array<{ id: QuestionFormat["block"]; title: string }> = [
  { id: "classic", title: "Классика" },
  { id: "music", title: "Музыка" },
  { id: "pictures", title: "Картинки" },
  { id: "bets", title: "Ставки" },
];

/** Вопросы с вариантами ответа (варианты на телефоне). */
export function hasOptions(kind: QuestionKind): boolean {
  return kind === "choice" || kind === "speed";
}

/** Вопросы, где гость пишет текст (открытый ответ). */
export function hasAnswers(kind: QuestionKind): boolean {
  return kind === "open" || kind === "buzz";
}

export function newQuestionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "q" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newQuestion(kind: QuestionKind = "choice"): QuizQuestion {
  return {
    id: newQuestionId(),
    kind,
    text: kind === "buzz" ? "Узнайте песню" : kind === "super" ? "Суперигра" : "",
    options: hasOptions(kind) || kind === "auction" ? ["", ""] : kind === "order" ? ["", "", ""] : [],
    // Аукцион — без заранее отмеченного верного: проверка попросит отметить.
    correct: hasOptions(kind) ? 0 : -1,
    alsoCorrect: [],
    answers: hasAnswers(kind) || kind === "auction" ? [""] : [],
    ...(kind === "auction" ? { topic: "", auctionAnswer: "choice" as const, betTime: DEFAULT_BET_TIME } : {}),
    steps: 1,
    pictures: kind === "pictures" ? [newPicture(), newPicture()] : [],
    ...(kind === "super" ? { levels: newLevels(), superStyle: "chests" as const, penalty: "halfTop" as const, superVote: true, voteTime: VOTE_TIME.def, superPick: "vote" as const } : {}),
    ...(kind === "order" ? { partial: true } : {}),
    ...(kind === "number" ? { number: null, unit: "", scoring: "places" as const } : {}),
    ...DEFAULTS[kind],
    imageId: null,
    trackId: null,
    trackStart: 0,
    trackLength: DEFAULT_TRACK_LENGTH,
    round: null,
  };
}

export function newPicture(): QuizPicture {
  return { imageId: null, answers: [""] };
}

export function createContent(): QuizContent {
  return { questions: [], settings: { ...DEFAULT_SETTINGS, drawEffect: "wheel" } };
}

/** Смена типа вопроса сохраняет всё, что можно сохранить. */
export function changeKind(question: QuizQuestion, kind: QuestionKind): QuizQuestion {
  if (question.kind === kind) return question;
  const next: QuizQuestion = { ...question, kind };
  if (hasOptions(kind) && next.options.length < LIMITS.minOptions) {
    next.options = [...next.options, "", ""].slice(0, Math.max(LIMITS.minOptions, next.options.length));
  }
  if (hasAnswers(kind) && next.answers.length === 0) {
    const fromOption = question.options[question.correct];
    next.answers = [fromOption ?? ""];
  }
  if (kind === "pictures" && (next.pictures ?? []).length < LIMITS.minPictures) {
    const have = next.pictures ?? [];
    // Картинка вопроса становится первой из нескольких.
    const first = have[0] ?? { imageId: question.imageId, answers: question.answers.length > 0 ? [...question.answers] : [""] };
    next.pictures = [first, ...have.slice(1), newPicture()].slice(0, Math.max(LIMITS.minPictures, have.length));
  }
  if (kind === "buzz" && !next.text.trim()) next.text = "Узнайте песню";
  if (kind === "order") {
    // Варианты становятся карточками: первый верный — первым.
    const first = question.options[question.correct];
    const rest = question.options.filter((_, i) => i !== question.correct);
    const cards = first !== undefined ? [first, ...rest] : [...question.options];
    next.options = [...cards, "", "", ""].slice(0, Math.max(LIMITS.minOrder, cards.length));
    next.correct = -1;
    next.alsoCorrect = [];
    next.partial = next.partial ?? true;
  }
  if (kind === "number") {
    next.scoring = next.scoring ?? "places";
    next.unit = next.unit ?? "";
    if (next.number === undefined) {
      const guess = Number((question.answers[0] ?? question.options[question.correct] ?? "").replace(/\s/g, "").replace(",", "."));
      next.number = Number.isFinite(guess) && (question.answers[0] ?? question.options[question.correct] ?? "").trim() !== "" ? guess : null;
    }
  }
  if (kind === "auction") {
    next.auctionAnswer = next.auctionAnswer ?? (hasAnswers(question.kind) ? "open" : "choice");
    next.topic = next.topic ?? "";
    next.betTime = next.betTime ?? DEFAULT_BET_TIME;
    if (next.options.length < LIMITS.minOptions) next.options = [...next.options, "", ""].slice(0, LIMITS.minOptions);
    if (next.answers.length === 0) next.answers = [question.options[question.correct] ?? ""];
  }
  if (kind === "super") {
    if (!next.levels) next.levels = newLevels();
    next.superStyle = next.superStyle ?? "chests";
    next.penalty = next.penalty ?? "halfTop";
    if (!next.text.trim()) next.text = "Суперигра";
  }
  // Время и очки по умолчанию меняются, только если ведущий их не трогал.
  const before = DEFAULTS[question.kind];
  if (question.timeLimit === before.timeLimit) next.timeLimit = DEFAULTS[kind].timeLimit;
  if (question.points === before.points) next.points = DEFAULTS[kind].points;
  return next;
}

/** Копия вопроса с новым id; картинка общая (тот же imageId). */
export function duplicateQuestion(question: QuizQuestion): QuizQuestion {
  // Копия продолжает раунд, а не начинает новый с тем же названием.
  return {
    ...question,
    id: newQuestionId(),
    options: [...question.options],
    alsoCorrect: [...(question.alsoCorrect ?? [])],
    answers: [...question.answers],
    pictures: (question.pictures ?? []).map((p) => ({ imageId: p.imageId, answers: [...p.answers] })),
    ...(question.levels
      ? { levels: question.levels.map((l) => ({ ...l, answers: [...l.answers], ...(l.options ? { options: [...l.options] } : {}), ...(l.correct ? { correct: [...l.correct] } : {}) })) }
      : {}),
    round: null,
  };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

// ---------- Разбор сырого содержимого ----------

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value) ? value.slice(0, maxItems).map((v) => text(v, maxLength)) : [];
}

/** Название раунда: одна строка без управляющих символов; пусто — раунд не начинается. */
export function parseRound(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.round);
  return title.length > 0 ? title : null;
}

function parseKind(value: unknown): QuestionKind {
  return value === "open" || value === "speed" || value === "buzz" || value === "pictures" || value === "super" || value === "order" || value === "number" || value === "auction" ? value : "choice";
}

/** Число из данных: конечное и в разумных границах; иначе null. */
export function parseNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > LIMITS.maxNumber) return null;
  return Math.round(value * 1000) / 1000;
}

function parsePictures(value: unknown): QuizPicture[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, LIMITS.maxPictures).map((raw) => {
    const d = record(raw);
    return {
      imageId: typeof d.imageId === "string" && d.imageId.length > 0 ? d.imageId.slice(0, 64) : null,
      answers: strings(d.answers, LIMITS.answers, LIMITS.answer),
    };
  });
}

function parseQuestion(raw: unknown, index: number, seen: Set<string>): QuizQuestion {
  const data = record(raw);
  const kind = parseKind(data.kind);
  let id = typeof data.id === "string" && data.id.length > 0 ? data.id.slice(0, 40) : `q${index + 1}`;
  // Ключи в списке должны быть уникальны даже в испорченных данных.
  while (seen.has(id)) id = `${id}_`;
  seen.add(id);
  const options = strings(data.options, LIMITS.maxOptions, LIMITS.option);
  const correct = typeof data.correct === "number" && Number.isInteger(data.correct) ? data.correct : -1;
  const alsoCorrect = Array.isArray(data.alsoCorrect)
    ? [...new Set(data.alsoCorrect.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < options.length && i !== correct))].sort((a, b) => a - b)
    : [];
  return {
    id,
    kind,
    text: text(data.text, LIMITS.text),
    options,
    correct: correct >= 0 && correct < options.length ? correct : -1,
    alsoCorrect: kind === "open" ? [] : alsoCorrect,
    answers: strings(data.answers, LIMITS.answers, LIMITS.answer),
    timeLimit: int(data.timeLimit, DEFAULTS[kind].timeLimit, LIMITS.minTime, LIMITS.maxTime),
    points: int(data.points, DEFAULTS[kind].points, LIMITS.minPoints, LIMITS.maxPoints),
    imageId: typeof data.imageId === "string" && data.imageId.length > 0 ? data.imageId : null,
    ...(clipFields(parseClip(data)) as Partial<QuizQuestion>),
    answerMusic: parseAnswerMusic(data.answerMusic),
    steps: int(data.steps, 1, 1, LIMITS.maxSteps),
    pictures: kind === "pictures" ? parsePictures(data.pictures) : [],
    ...(kind === "super"
      ? {
          levels: parseLevels(data.levels),
          superStyle: parseStyle(data.superStyle),
          penalty: parsePenalty(data.penalty),
          superVote: data.superVote === true,
          voteTime: int(data.voteTime, VOTE_TIME.def, VOTE_TIME.min, VOTE_TIME.max),
          superPick: parsePickMode(data.superPick),
        }
      : {}),
    round: parseRound(data.round),
    note: text(data.note, LIMITS.note),
    ...(kind === "order" ? { partial: data.partial !== false } : {}),
    ...(kind === "number"
      ? { number: parseNumber(data.number), unit: text(data.unit, LIMITS.unit).trim(), scoring: data.scoring === "closest" ? ("closest" as const) : ("places" as const) }
      : {}),
    ...(kind === "auction"
      ? {
          topic: text(data.topic, LIMITS.topic).replace(/\s+/g, " "),
          auctionAnswer: data.auctionAnswer === "open" ? ("open" as const) : ("choice" as const),
          betTime: int(data.betTime, DEFAULT_BET_TIME, LIMITS.minBetTime, LIMITS.maxBetTime),
        }
      : {}),
  };
}

export function parseSettings(raw: unknown): QuizSettings {
  const data = record(raw);
  return {
    intro: data.intro !== false,
    board: data.board === "rounds" || data.board === "manual" ? data.board : "each",
    phoneImages: data.phoneImages === true,
    raceTarget: int(data.raceTarget, DEFAULT_SETTINGS.raceTarget, LIMITS.minRace, LIMITS.maxRace),
    ...(typeof data.raceBonus === "number" ? { raceBonus: int(data.raceBonus, RACE_BONUS.def, 0, RACE_BONUS.max) } : {}),
    ...(typeof data.drawEffect === "string" ? { drawEffect: parseDrawEffect(data.drawEffect) } : {}),
    ...(data.art !== undefined && parseQuizArt(data.art) !== "auto" ? { art: parseQuizArt(data.art) } : {}),
  };
}

/** Содержимое из базы → квиз. Ничего не бросает: мусор заменяется значениями по умолчанию. */
export function parseContent(raw: unknown): QuizContent {
  const data = record(raw);
  const list = Array.isArray(data.questions) ? data.questions.slice(0, LIMITS.questions) : [];
  const seen = new Set<string>();
  return { questions: list.map((q, i) => parseQuestion(q, i, seen)), settings: parseSettings(data.settings) };
}

/** Картинки вопроса: основная и картинки из «Несколько картинок». */
export function questionImages(q: QuizQuestion): string[] {
  return [q.imageId, ...(q.pictures ?? []).map((p) => p.imageId), ...(q.levels ?? []).map((l) => l.imageId)].filter((id): id is string => Boolean(id));
}

export function mediaIds(content: QuizContent): string[] {
  return [...new Set(content.questions.flatMap(questionImages))];
}

/** Треки игры (чтобы экран зала скачал их заранее). */
export function trackIds(content: QuizContent): string[] {
  return [...new Set(content.questions.flatMap((q) => [q.trackId, q.answerMusic?.trackId, ...superTrackIds(q.levels)].filter((id): id is string => Boolean(id))))];
}

/** Музыкальный квиз («Узнай по нотам»): есть треки или хотя бы половина вопросов начинается с «♪» (шаблон без треков). */
export function isMelodyQuiz(content: QuizContent): boolean {
  if (trackIds(content).length > 0) return true;
  const notes = content.questions.filter((q) => q.text.trimStart().startsWith("♪")).length;
  return notes > 0 && notes * 2 >= content.questions.length;
}
