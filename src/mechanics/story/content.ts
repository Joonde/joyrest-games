// «Не моя история»: каждый гость тайно пишет на телефоне случай из жизни. На экране — история без
// имени, все голосуют, чья она. Угадал — очки; никто не угадал — очки автору.

/** Разделы игры: «Чья история» — угадать автора; «Сочиняем историю» — слова с бумажек, рулетка, показ. */
export type SectionKind = "author" | "words";

export const SECTION_TITLES: Record<SectionKind, string> = { author: "Чья история?", words: "Сочиняем историю" };

export interface StoryContent {
  /** Разделы по порядку. */
  sections: SectionKind[];
  /** «Сочиняем историю»: предложения с пропусками [кто], [куда]… */
  templates: string[];
  /** Слова для бумажек: пропуск → варианты. */
  bank: Record<string, string[]>;
  /** Слов на бумажке. */
  paperWords: number;
  /** Секунд на оценку показа. */
  rateSeconds: number;
  /** Очки за звезду (среднее × очки). */
  starPoints: number;
  /** Подсказка гостям: о чём писать. */
  prompt: string;
  /** Примеры под полем ввода (по одному в строке). */
  examples: string[];
  /** Секунд на голосование. */
  guessSeconds: number;
  /** Очки за верную догадку. */
  guessPoints: number;
  /** Очки автору, если никто не угадал. */
  authorBonus: number;
  /** Сколько историй играть (0 — все). */
  maxStories: number;
}

export const STORY_LIMITS = { prompt: 160, example: 120, examples: 6, story: 280, minSeconds: 10, maxSeconds: 120, maxPoints: 1000, maxStories: 50, templates: 30, template: 240, label: 24, words: 40, word: 40 } as const;

/** Пропуски шаблона по порядку: «[кто]» → «кто». */
export function slotsOf(template: string): string[] {
  return [...template.matchAll(/\[([^\]\[]{1,24})\]/g)].map((m) => (m[1] ?? "").trim().toLowerCase());
}

/** Шаблон с подставленными словами (null — пропуск ещё пустой). */
export function fillTemplate(template: string, words: Array<string | null>): Array<{ text: string; slot: number | null }> {
  const parts: Array<{ text: string; slot: number | null }> = [];
  let last = 0;
  let i = 0;
  for (const m of template.matchAll(/\[([^\]\[]{1,24})\]/g)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: template.slice(last, at), slot: null });
    parts.push({ text: words[i] ?? "", slot: i });
    i++;
    last = at + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last), slot: null });
  return parts;
}

export const DEFAULT_TEMPLATES = [
  "Однажды [кто] отправился в [куда], чтобы [что сделать], но по дороге встретил [кого] и они [что сделали].",
  "На свадьбе [кто] решил [что сделать], схватил [предмет] и [как] побежал к [кому].",
  "Утром [кто] проснулся [где], рядом лежал [предмет], а за окном [кто] [что делал].",
  "Начальник вызвал [кого] и сказал: «Завтра ты летишь в [куда] и берёшь с собой [предмет]», — и тогда [кто] [что сделал].",
];

export const DEFAULT_BANK: Record<string, string[]> = {
  "кто": ["жираф", "бабушка Зина", "директор банка", "бравый пожарный", "кот Барсик", "тамада", "космонавт", "невеста", "дед Мороз", "оперная певица", "фитнес-тренер", "пингвин", "сосед с третьего этажа", "супергерой", "маленький динозавр"],
  "куда": ["Париж", "баню", "космос", "Икею", "деревню Простоквашино", "караоке", "Антарктиду", "музей", "ночной клуб", "зоопарк", "Мальдивы", "подвал", "оперу", "налоговую"],
  "что сделать": ["станцевать ламбаду", "найти любовь", "купить батон", "спеть арию", "выиграть миллион", "научиться летать", "сварить борщ", "сделать селфи", "покорить Эверест", "сдать экзамен", "поймать такси", "помириться с тёщей"],
  "кого": ["жирафа", "тёщу", "бывшего", "Филиппа Киркорова", "гуся", "робота-пылесоса", "инопланетянина", "полицейского", "двух бабушек", "ведущего", "медведя", "почтальона"],
  "что сделали": ["станцевали танго", "уснули в обнимку", "открыли ресторан", "спели дуэтом", "поженились", "сбежали в Сочи", "подрались подушками", "запустили фейерверк", "заблудились", "стали лучшими друзьями"],
  "предмет": ["огромный арбуз", "резиновую уточку", "гитару", "торт", "лопату", "надувной матрас", "букет роз", "микрофон", "сковородку", "шляпу с перьями", "огнетушитель", "баян"],
  "как": ["вприпрыжку", "задом наперёд", "на цыпочках", "с песней", "ползком", "танцуя", "рыдая от счастья", "с криком «Ура!»", "как балерина", "в замедленной съёмке"],
  "кому": ["жениху", "тамаде", "бабушке", "диджею", "официанту", "свидетелю", "соседу", "директору", "кошке", "фотографу"],
  "где": ["в ванне", "на крыше", "в шкафу", "на сцене", "в багажнике", "посреди поля", "в торте", "на люстре", "в бассейне", "под столом"],
  "что делал": ["танцевал ламбаду", "пел серенаду", "жарил шашлык", "катался на роликах", "играл на балалайке", "показывал фокусы", "делал зарядку", "читал стихи", "ловил бабочек", "кричал «Горько!»"],
  "что сделал": ["расплакался", "станцевал", "выпил чаю", "сбежал", "запел", "сделал предложение", "уволился", "упал в обморок", "заказал пиццу", "купил билет"],
};

export function createStory(): StoryContent {
  return {
    sections: ["author", "words"],
    templates: DEFAULT_TEMPLATES,
    bank: DEFAULT_BANK,
    paperWords: 5,
    rateSeconds: 20,
    starPoints: 20,
    prompt: "Напишите случай из своей жизни, о котором здесь почти никто не знает",
    examples: ["В детстве я три года подряд ходил в кружок балета", "Я однажды опоздала на самолёт, потому что уснула в аэропорту", "Я пел в метро и заработал 300 рублей"],
    guessSeconds: 30,
    guessPoints: 100,
    authorBonus: 150,
    maxStories: 15,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function parseStory(raw: unknown): StoryContent {
  const d = record(raw);
  const base = createStory();
  const examples = Array.isArray(d.examples) ? d.examples.map((e) => cleanText(e, STORY_LIMITS.example)).filter(Boolean).slice(0, STORY_LIMITS.examples) : base.examples;
  const sections = (Array.isArray(d.sections) ? d.sections : base.sections).filter((x): x is SectionKind => x === "author" || x === "words").slice(0, 6);
  const templates = Array.isArray(d.templates) ? d.templates.map((t) => cleanText(t, STORY_LIMITS.template)).filter((t) => slotsOf(t).length > 0).slice(0, STORY_LIMITS.templates) : base.templates;
  const bank: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(record(d.bank ?? base.bank))) {
    const label = cleanText(k, STORY_LIMITS.label).toLowerCase();
    const words = Array.isArray(v) ? v.map((w) => cleanText(w, STORY_LIMITS.word)).filter(Boolean).slice(0, STORY_LIMITS.words) : [];
    if (label && words.length > 0) bank[label] = words;
  }
  return {
    sections: sections.length > 0 ? sections : base.sections,
    templates,
    bank,
    paperWords: int(d.paperWords, base.paperWords, 2, 8),
    rateSeconds: int(d.rateSeconds, base.rateSeconds, STORY_LIMITS.minSeconds, STORY_LIMITS.maxSeconds),
    starPoints: int(d.starPoints, base.starPoints, 0, 200),
    prompt: cleanText(d.prompt, STORY_LIMITS.prompt) || base.prompt,
    examples,
    guessSeconds: int(d.guessSeconds, base.guessSeconds, STORY_LIMITS.minSeconds, STORY_LIMITS.maxSeconds),
    guessPoints: int(d.guessPoints, base.guessPoints, 0, STORY_LIMITS.maxPoints),
    authorBonus: int(d.authorBonus, base.authorBonus, 0, STORY_LIMITS.maxPoints),
    maxStories: int(d.maxStories, base.maxStories, 0, STORY_LIMITS.maxStories),
  };
}
