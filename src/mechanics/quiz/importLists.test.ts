// «Вставить списком» и неотмеченный верный вариант (QA 22 октября 2026: C1, C2 и частый ввод).
import { describe, expect, it } from "vitest";
import { createDragon, newDragonTask, parseDragon, parseDragonImport, parseDragonList } from "../dragon/content";
import { DEMO_DRAGON, DEMO_DRAGON_KIDS } from "../dragon/demo";
import { validateDragon } from "../dragon/validate";
import { newMillionaireQuestion, parseMillionaire, parseMillionaireImport } from "../millionaire/content";
import { DEMO_MILLIONAIRE } from "../millionaire/demo";
import { validateMillionaire } from "../millionaire/validate";
import { newSurvivalRound, parseSurvival, parseSurvivalImport } from "../survival/content";
import { DEMO_SURVIVAL } from "../survival/demo";
import { validateSurvival } from "../survival/validate";
import { changeKind, newQuestion } from "./content";
import { parseImport } from "./importText";
import { listOption, parseNumberText, pointsSuffix, splitAnswers } from "./listText";

const first = (text: string) => parseImport(text).questions[0];

describe("квиз: «Угадай число» — число обязательно", () => {
  it("«~ примерно 300 м» — числа нет: не 0, а замечание", () => {
    const q = first("Высота башни?\n~ примерно 300 м");
    expect(q?.question.number).toBeNull();
    expect(q?.problems.join(" ")).toMatch(/не нашли число/);
  });

  it("регрессии: «~ 1665 ступеней», «~ 1 665», «~ 1.665», «~ 1,665» — 1665; «~ 1.5 кг» — дробь", () => {
    expect(first("А?\n~ 1665 ступеней")?.question).toMatchObject({ kind: "number", number: 1665, unit: "ступеней" });
    expect(first("А?\n~ 1 665")?.question.number).toBe(1665);
    expect(first("А?\n~ 1.665 ступеней")?.question.number).toBe(1665);
    expect(first("А?\n~ 1,665")?.question.number).toBe(1665);
    expect(first("А?\n~ 1.5 кг")?.question).toMatchObject({ number: 1.5, unit: "кг" });
    expect(first("А?\n~ 0.125 л")?.question.number).toBe(0.125);
    expect(first("А?\n~ −40 °C")?.question).toMatchObject({ number: -40, unit: "°C" });
    expect(first("А?\n~ 1665 ступеней")?.problems).toEqual([]);
  });

  it("parseNumberText: тысячи и дроби", () => {
    expect(parseNumberText("300 000 руб")).toEqual({ value: 300000, unit: "руб" });
    expect(parseNumberText("1.665.000")).toEqual({ value: 1665000, unit: "" });
    expect(parseNumberText("1.665,5 м")).toEqual({ value: 1665.5, unit: "м" });
    expect(parseNumberText("100,5").value).toBe(100.5);
    expect(parseNumberText("около 1665").value).toBeNull();
    expect(parseNumberText("").value).toBeNull();
  });
});

describe("квиз: частый ввод", () => {
  it("варианты «а)», «Б.», «1)», «1.» под вопросом — варианты, а не новые вопросы", () => {
    const { questions } = parseImport("Столица России?\nа) Москва *\nб) Питер\nв) Казань\nКакая река?\nА) Волга\nБ. *Дон\nСколько?\n1) Один\n2. Два *");
    expect(questions.map((q) => [q.question.text, q.question.options, q.question.correct])).toEqual([
      ["Столица России?", ["Москва", "Питер", "Казань"], 0],
      ["Какая река?", ["Волга", "Дон"], 1],
      ["Сколько?", ["Один", "Два"], 1],
    ]);
  });

  it("«1. Какой город?» и «2. Какая река?» с «?» остаются вопросами; нумерация снимается", () => {
    const { questions } = parseImport("1. Какой город?\n1. Москва\n2. Питер *\n2. Какая река?\n- Волга\n* Дон");
    expect(questions.map((q) => [q.question.text, q.question.options])).toEqual([
      ["Какой город?", ["Москва", "Питер"]],
      ["Какая река?", ["Волга", "Дон"]],
    ]);
  });

  it("вопросы без «?» с номерами по порядку — разные вопросы", () => {
    expect(parseImport("1. Назовите столицу\n2. Назовите реку").questions.map((q) => q.question.text)).toEqual(["Назовите столицу", "Назовите реку"]);
  });

  it("«#1 Вопрос?» и «#2. Вопрос?» — вопросы; «# Раунд: Кино» и «# Кино 2» — раунды", () => {
    const { questions, skipped } = parseImport("#1 Какой город?\n- А\n* Б\n#2. Какая река?\n- В\n* Г\n# Раунд: Кино\nФильм?\n= Мимино\n# Кино 2\nЕщё?\n= да");
    expect(skipped).toEqual([]);
    expect(questions.map((q) => [q.question.text, q.question.round])).toEqual([
      ["Какой город?", null],
      ["Какая река?", null],
      ["Фильм?", "Кино"],
      ["Ещё?", "Кино 2"],
    ]);
  });

  it("«**Москва**» — вариант без звёздочек и не верный", () => {
    expect(first("Вопрос?\n**Москва**\n- Питер *")?.question).toMatchObject({ options: ["Москва", "Питер"], correct: 1 });
  });

  it("ответы через «|» и «/», «1/2» не делится; «= ?» — не ответ", () => {
    expect(first("Сколько?\n= 30 / тридцать | 1/2")?.question.answers).toEqual(["30", "тридцать", "1/2"]);
    expect(splitAnswers("?")).toEqual([]);
  });

  it("переводы строк «\\r» и «\\r\\n»", () => {
    expect(first("Вопрос?\r- а\r* б\r")?.question).toMatchObject({ text: "Вопрос?", options: ["а", "б"], correct: 1 });
    expect(first("Вопрос?\r\n- а\r\n* б")?.question.correct).toBe(1);
  });

  it("вопрос с тире в начале списка — вопрос, а не пропущенная строка", () => {
    const { questions, skipped } = parseImport("— Как зовут кота?\n- Барсик\n* Мурзик");
    expect(skipped).toEqual([]);
    expect(questions[0]?.question).toMatchObject({ text: "Как зовут кота?", correct: 1 });
  });

  it("смена типа на «Выбор варианта» не отмечает A заранее", () => {
    expect(changeKind(newQuestion("open"), "choice").correct).toBe(-1);
    expect(changeKind({ ...newQuestion("order"), options: ["a", "b", "c"] }, "choice").correct).toBe(-1);
  });

  it("listOption: «- Париж *», «* Париж», «- *Париж» — верный, «2*2» — текст", () => {
    expect(listOption("- Париж *")).toEqual({ text: "Париж", correct: true });
    expect(listOption("* Париж")).toEqual({ text: "Париж", correct: true });
    expect(listOption("- *Париж")).toEqual({ text: "Париж", correct: true });
    expect(listOption("- 2*2")).toEqual({ text: "2*2", correct: false });
    expect(listOption("**Москва**")).toEqual({ text: "Москва", correct: false });
    expect(listOption("Москва")).toBeNull();
  });
});

describe("«Миллион на кону», «Гонка», «Дракон»: верный вариант не отмечен заранее", () => {
  it("новый вопрос — без верного, проверка просит отметить", () => {
    const q = { ...newMillionaireQuestion(1), text: "Вопрос", options: ["а", "б", "в", "г"] };
    expect(q.correct).toBe(-1);
    expect(validateMillionaire({ ...DEMO_MILLIONAIRE, questions: [...DEMO_MILLIONAIRE.questions, q] }).map((e) => e.path)).toEqual([`questions/${q.id}/correct`]);

    const r = { ...newSurvivalRound("choice"), text: "Вопрос", options: ["а", "б", "в", "г"] };
    expect(r.correct).toBe(-1);
    const rounds = [...DEMO_SURVIVAL.rounds];
    rounds[0] = r;
    expect(validateSurvival({ ...DEMO_SURVIVAL, rounds }).map((e) => e.path)).toEqual([`rounds/${r.id}/correct`]);

    const t = { ...newDragonTask("choice"), text: "Вопрос", options: ["а", "б", "в", "г"] };
    expect(t.correct).toBe(-1);
    const battles = DEMO_DRAGON.battles.map((b, i) => (i === 0 ? { ...b, tasks: [...b.tasks, t] } : b));
    expect(validateDragon({ ...DEMO_DRAGON, battles }).map((e) => e.path)).toEqual([`tasks/${t.id}/correct`]);
    expect(validateDragon(createDragon()).some((e) => e.path.endsWith("/correct"))).toBe(true);
  });

  it("старые данные: верный из данных сохраняется, без поля — не отмечен", () => {
    expect(parseMillionaire({ questions: [{ id: "a", correct: 2 }, { id: "b" }] }).questions.map((q) => q.correct)).toEqual([2, -1]);
    expect(parseSurvival({ rounds: [{ id: "a", correct: 0 }, { id: "b" }] }).rounds.map((r) => r.correct)).toEqual([0, -1]);
    expect(parseDragon({ battles: [{ id: "b", tasks: [{ id: "a", correct: 3 }, { id: "c" }] }] }).battles[0]?.tasks.map((t) => t.correct)).toEqual([3, -1]);
  });

  it("шаблоны проходят проверку", () => {
    expect(validateMillionaire(DEMO_MILLIONAIRE)).toEqual([]);
    expect(validateSurvival(DEMO_SURVIVAL)).toEqual([]);
    expect(validateDragon(DEMO_DRAGON)).toEqual([]);
    expect(validateDragon(DEMO_DRAGON_KIDS)).toEqual([]);
  });

  it("«Миллион»: «- Париж *» отмечает верный, без «*» — не отмечен, лишние строки — в «не разобрали»", () => {
    const { questions, skipped } = parseMillionaireImport("- до вопроса\nСтолица Франции?\n- Рим\n- Париж *\n- Берлин\n- Мадрид\n- Лишний\nВторой?\n**Да**\n- *Нет\n- Может\n- Никогда\nТретий?\n- а\n- б\n- в\n- г");
    expect(skipped).toEqual([1, 7]);
    expect(questions.map((q) => [q.options[q.correct] ?? null, q.correct])).toEqual([
      ["Париж", 1],
      ["Нет", 1],
      [null, -1],
    ]);
    expect(questions[0]?.options).toEqual(["Рим", "Париж", "Берлин", "Мадрид"]);
  });

  it("«Гонка»: год в скобках — не очки, «2+2=?» — не открытый вопрос, ответы через «/»", () => {
    const { rounds, skipped } = parseSurvivalImport(
      "Пушкин (1799)\n- а *\n- б\n- в\n- г\n2+2=?\n- 3\n* 4\n- 5\n- 6\nГод рождения Пушкина? = 1799 / тысяча семьсот девяносто девятый (150 очков)\nЗадание: спойте (200)\n- лишний",
    );
    expect(skipped).toEqual([13]);
    expect(rounds.map((r) => [r.kind, r.text, r.points, r.correct])).toEqual([
      ["choice", "Пушкин (1799)", 100, 0],
      ["choice", "2+2=?", 100, 1],
      ["open", "Год рождения Пушкина?", 150, -1],
      ["task", "спойте", 200, -1],
    ]);
    expect(rounds[2]?.answer).toBe("1799 | тысяча семьсот девяносто девятый");
  });

  it("очки в скобках: «(150)», «(1200 очков)»; «(1799)» без слова — не очки", () => {
    expect(pointsSuffix("Задание (150)", 10000)).toEqual({ body: "Задание", points: 150 });
    expect(pointsSuffix("Задание (1200 очков)", 10000)).toEqual({ body: "Задание", points: 1200 });
    expect(pointsSuffix("Пушкин (1799)", 10000)).toEqual({ body: "Пушкин (1799)", points: null });
  });

  it("«Дракон»: «- 988 *» — верный, год в задании — не урон, вариант без вопроса — в «не разобрали»", () => {
    const { battles, skipped } = parseDragonImport("# Бой: Огненный 800\nУм: Год крещения Руси?\n- 988 *\n- 1000\n- 1200\n- 1380\nСила: присесть 10 раз (1799)\n- без вопроса");
    expect(skipped).toEqual([8]);
    expect(battles[0]?.tasks.map((t) => [t.kind, t.correct, t.power])).toEqual([
      ["choice", 0, 100],
      ["task", -1, 100],
    ]);
    expect(parseDragonList("Ум: 2+2?\n- 3\n- 4\n- 5\n- 6")[0]?.tasks[0]?.correct).toBe(-1);
  });
});
