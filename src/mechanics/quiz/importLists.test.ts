// «Вставить списком» и неотмеченный верный вариант (QA 22 октября 2026: C1, C2 и частый ввод).
import { describe, expect, it } from "vitest";
import { createDragon, newDragonTask, parseDragon, parseDragonImport, parseDragonList } from "../dragon/content";
import { DEMO_DRAGON, DEMO_DRAGON_KIDS } from "../dragon/demo";
import { validateDragon } from "../dragon/validate";
import { newMillionaireQuestion, parseMillionaire, parseMillionaireImport } from "../millionaire/content";
import { DEMO_MILLIONAIRE } from "../millionaire/demo";
import { validateMillionaire } from "../millionaire/validate";
import { newSurvivalRound, openAnswerSplit, parseSurvival, parseSurvivalImport } from "../survival/content";
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

  it("третий круг: слитное «/» — часть ответа, делит только « / » с пробелами и «|»", () => {
    expect(first("Группа?\n= AC/DC")?.question.answers).toEqual(["AC/DC"]);
    expect(first("Скорость?\n= 300 км/ч")?.question.answers).toEqual(["300 км/ч"]);
    expect(first("Какой?\n= б/у")?.question.answers).toEqual(["б/у"]);
    expect(first("Откуда поезд?\n= Ж/Д вокзал | вокзал")?.question.answers).toEqual(["Ж/Д вокзал", "вокзал"]);
    expect(first("Город?\n= Москва / Питер")?.question.answers).toEqual(["Москва", "Питер"]);
    expect(first("Половина?\n= 1/2")?.question.answers).toEqual(["1/2"]);
    expect(splitAnswers("AC/DC / ЭйСи-ДиСи|ACDC")).toEqual(["AC/DC", "ЭйСи-ДиСи", "ACDC"]);
    // «Гонка»: открытый вопрос в одну строку.
    expect(parseSurvivalImport("Группа с молнией? = AC/DC | ЭйСи").rounds[0]).toMatchObject({ kind: "open", text: "Группа с молнией?", answer: "AC/DC | ЭйСи" });
  });

  it("третий круг: «Вопрос N» — номер снимается только перед «.», «)», «:» или тире", () => {
    expect(first("Вопрос 1?\n= да")?.question.text).toBe("Вопрос 1?");
    expect(first("Вопрос 5 — самый сложный: сколько?\n= 5")?.question.text).toBe("самый сложный: сколько?");
    expect(first("Вопрос 1 – Какой город?\n= Москва")?.question.text).toBe("Какой город?");
    expect(first("Вопрос 2: Какая река?\n= Волга")?.question.text).toBe("Какая река?");
    expect(first("Вопрос №3. Столица?\n= Москва")?.question.text).toBe("Столица?");
    expect(first("№4 Столица?\n= Москва")?.question.text).toBe("Столица?");
    expect(first("1 января какой праздник?\n= Новый год")?.question.text).toBe("1 января какой праздник?");
    expect(first("**Вопрос 1.** Столица?\n- Москва *\n- Питер")?.question.text).toBe("Столица?");
  });

  it("третий круг: строка «Вопрос 1» без текста — заголовок, текст вопроса — следующая строка", () => {
    const { questions, skipped } = parseImport("Вопрос 1\nКакой город столица?\n- Москва *\n- Питер\nВопрос 2\nНазовите реку\n- Волга *\n- Нил");
    expect(skipped).toEqual([]);
    expect(questions.map((q) => [q.question.text, q.question.options, q.question.correct, q.line])).toEqual([
      ["Какой город столица?", ["Москва", "Питер"], 0, 2],
      ["Назовите реку", ["Волга", "Нил"], 0, 6],
    ]);
    expect(parseMillionaireImport("Вопрос 1\nСтолица?\n- а\n- б *\n- в\n- г").questions.map((q) => q.text)).toEqual(["Столица?"]);
    expect(parseSurvivalImport("Вопрос 1\nСтолица? = Москва").rounds.map((r) => r.text)).toEqual(["Столица?"]);
    expect(parseDragonImport("Вопрос 1\nУм: Столица?\n- а *\n- б").battles[0]?.tasks.map((t) => t.text)).toEqual(["Столица?"]);
  });

  it("третий круг: «#N …» без «?» — раунд, как раньше; с «?» — вопрос", () => {
    const { questions } = parseImport("#1. Кино\nФильм?\n= Мимино\n#2 Музыка\nПесня?\n= да\n#3. Назовите город\nА?\n= а\n#4. Назовите город?\n= Москва\n#5 Вопрос?\n= да");
    expect(questions.map((q) => [q.question.text, q.question.round])).toEqual([
      ["Фильм?", "Кино"],
      ["Песня?", "Музыка"],
      ["А?", "Назовите город"],
      ["Назовите город?", null],
      ["Вопрос?", null],
    ]);
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
    expect(pointsSuffix("Пушкин (1799)", 10000)).toMatchObject({ body: "Пушкин (1799)", points: null });
  });

  it("Р3: 4+ цифры без слова — очки, если не похоже на год и в пределах игры; иначе замечание", () => {
    expect(pointsSuffix("Вопрос (2500)", 10000)).toEqual({ body: "Вопрос", points: 2500 });
    expect(pointsSuffix("Вопрос (999)", 10000)).toEqual({ body: "Вопрос", points: 999 });
    const year = pointsSuffix("Пушкин родился (1799)", 10000);
    expect(year.points).toBeNull();
    expect(year.body).toBe("Пушкин родился (1799)");
    expect(year.note ?? "").toMatch(/похоже на год — очки не поставлены/);
    expect(pointsSuffix("Вопрос (1500)", 10000).note ?? "").toMatch(/похоже на год/);
    const big = pointsSuffix("Удар (7000)", 5000, "урон не поставлен");
    expect(big).toMatchObject({ body: "Удар (7000)", points: null });
    expect(big.note ?? "").toMatch(/больше 5000 — урон не поставлен/);
    // Со словом — очки, даже если похоже на год (лимит игры — потолок).
    expect(pointsSuffix("Задание (1800 очков)", 10000)).toEqual({ body: "Задание", points: 1800 });
  });

  it("Р3: замечание видно в итогах импорта «Гонки» и «Дракона»", () => {
    const s = parseSurvivalImport("Пушкин родился в (1799)\n- а *\n- б\n- в\n- г\nЗадание: спой (3000)");
    expect(s.rounds.map((r) => [r.text, r.points])).toEqual([
      ["Пушкин родился в (1799)", 100],
      ["спой", 3000],
    ]);
    expect(s.notes.map((n) => n.line)).toEqual([1]);
    const d = parseDragonImport("Сила: отжаться (1380)\nХаризма: спеть (2500)");
    expect(d.battles[0]?.tasks.map((t) => t.power)).toEqual([100, 2500]);
    expect(d.notes.map((n) => [n.line, /урон не поставлен/.test(n.text)])).toEqual([[1, true]]);
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

describe("квиз: нумерованные вопросы без «?» (QA повтор, Р1–Р2)", () => {
  const rows = (text: string) => parseImport(text).questions.map((q) => [q.question.text, q.question.options, q.question.correct, q.question.round]);

  it("заголовок и «1. Назовите…» с вариантами «-» — заголовок отдельно, два вопроса", () => {
    expect(rows("Квиз на день рождения Ани\n1. Назовите любимый цвет\n- Красный *\n- Синий\n2. Назовите её любимое блюдо\n- Суши *\n- Пицца")).toEqual([
      ["Квиз на день рождения Ани", ["", ""], -1, null],
      ["Назовите любимый цвет", ["Красный", "Синий"], 0, null],
      ["Назовите её любимое блюдо", ["Суши", "Пицца"], 0, null],
    ]);
  });

  it("нумерация заново в каждом раунде — два раунда по вопросу, раунд не пропадает", () => {
    expect(rows("# Раунд: Кино\n1. Назовите режиссёра «Титаника»\n- Кэмерон *\n- Спилберг\n# Раунд: Музыка\n1. Назовите солиста Queen\n- Меркьюри *\n- Леннон")).toEqual([
      ["Назовите режиссёра «Титаника»", ["Кэмерон", "Спилберг"], 0, "Кино"],
      ["Назовите солиста Queen", ["Меркьюри", "Леннон"], 0, "Музыка"],
    ]);
  });

  it("«N. X» прямо перед «=», «~», «>», «а)» — вопрос", () => {
    const { questions } = parseImport("Столица Франции\n= Париж\n1. Столица Германии\n= Берлин\n2. Высота башни\n~ 330 м\n3. По порядку\n> А\n> Б\n> В\n4. Река\nа) Волга *\nб) Дон");
    expect(questions.map((q) => [q.question.kind, q.question.text])).toEqual([
      ["open", "Столица Франции"],
      ["open", "Столица Германии"],
      ["number", "Высота башни"],
      ["order", "По порядку"],
      ["choice", "Река"],
    ]);
  });

  it("«1. Назовите цвет» перед «1. Красный» — вопрос, варианты с 1", () => {
    expect(rows("Квиз\n1. Назовите цвет\n1. Красный *\n2. Синий")).toEqual([
      ["Квиз", ["", ""], -1, null],
      ["Назовите цвет", ["Красный", "Синий"], 0, null],
    ]);
  });

  it("прежние случаи: варианты «1.», «а)» без «-» под вопросом остаются вариантами", () => {
    expect(rows("Выберите столицу Франции\n1. Париж *\n2. Берлин\nВыберите столицу Германии\n1. Берлин *\n2. Рим")).toEqual([
      ["Выберите столицу Франции", ["Париж", "Берлин"], 0, null],
      ["Выберите столицу Германии", ["Берлин", "Рим"], 0, null],
    ]);
    expect(rows("1. Сколько будет 2+2?\n1. 3\n2. 4 *\n3. 5")).toEqual([["Сколько будет 2+2?", ["3", "4", "5"], 1, null]]);
    expect(rows("Вопрос?\n*1. Да\n2. Нет")).toEqual([["Вопрос?", ["Да", "Нет"], 0, null]]);
    expect(rows("Кто написал «Онегина»?\nА. С. Пушкин *\nМ. Ю. Лермонтов")).toEqual([["Кто написал «Онегина»?", ["А. С. Пушкин", "М. Ю. Лермонтов"], 0, null]]);
  });

  it("Р2: «#1 раунд», «#1 Раунд: Кино», «# Раунд 2: Музыка» — раунды; «#1 Вопрос?» — вопрос", () => {
    const { questions } = parseImport("#1 раунд\nА?\n= а\n#2 Раунд: Кино\nБ?\n= б\n# Раунд 3: Музыка\nВ?\n= в\n#4 Какой город?\n= Москва");
    expect(questions.map((q) => [q.question.text, q.question.round])).toEqual([
      ["А?", "Раунд 1"],
      ["Б?", "Кино"],
      ["В?", "Музыка"],
      ["Какой город?", null],
    ]);
  });
});

describe("«Миллион», «Гонка», «Дракон»: варианты «а)» / «1.», нумерация вопросов", () => {
  it("«Миллион»: «1. Вопрос» без «?» — номер снят; варианты буквами и цифрами", () => {
    const { questions, skipped } = parseMillionaireImport("1. Столица Франции\nа) Рим\nб) Париж *\nв) Берлин\nг) Мадрид\n2. Сколько будет 2+2\n1. 3\n2. 4 *\n3. 5\n4. 6\n3. Следующий вопрос\n- а\n- б *\n- в\n- г");
    expect(skipped).toEqual([]);
    expect(questions.map((q) => [q.text, q.options, q.correct])).toEqual([
      ["Столица Франции", ["Рим", "Париж", "Берлин", "Мадрид"], 1],
      ["Сколько будет 2+2", ["3", "4", "5", "6"], 1],
      ["Следующий вопрос", ["а", "б", "в", "г"], 1],
    ]);
  });

  it("«Гонка»: варианты «а)», номер вопроса снят", () => {
    const { rounds } = parseSurvivalImport("1. Столица?\nа) Рим\nб) Париж *\nв) Берлин\nг) Мадрид\n2. Задание: спойте (200)");
    expect(rounds.map((r) => [r.kind, r.text, r.options, r.correct, r.points])).toEqual([
      ["choice", "Столица?", ["Рим", "Париж", "Берлин", "Мадрид"], 1, 100],
      ["task", "спойте", ["", "", "", ""], -1, 200],
    ]);
  });

  it("«Дракон»: варианты «1.», «Удача Бросайте кубик» без двоеточия — кубик, «Сила тока…» — вопрос", () => {
    const { battles, skipped } = parseDragonImport("Ум: Столица?\n1. Рим\n2. Париж *\n3. Берлин\n4. Мадрид\nУдача Бросайте кубик\nУдача\nСила тока измеряется в\n- амперах *\n- вольтах\n- омах\n- ваттах");
    expect(skipped).toEqual([]);
    expect(battles[0]?.tasks.map((t) => [t.kind, t.stat, t.text, t.correct])).toEqual([
      ["choice", "mind", "Столица?", 1],
      ["dice", "luck", "Бросайте кубик", -1],
      ["dice", "luck", "Бросайте кубик!", -1],
      ["choice", "mind", "Сила тока измеряется в", 0],
    ]);
  });
});

describe("«Гонка»: ответ после «=»", () => {
  it("ответ — с первого «=» после «?»; без «?» — с « = »", () => {
    expect(openAnswerSplit("Формула? = E=mc2")).toEqual({ question: "Формула?", answers: ["E=mc2"] });
    expect(openAnswerSplit("Если x=5, сколько x+1? = 6")).toEqual({ question: "Если x=5, сколько x+1?", answers: ["6"] });
    expect(openAnswerSplit("Сколько будет 2+2 = 4")).toEqual({ question: "Сколько будет 2+2", answers: ["4"] });
    expect(openAnswerSplit("2+2=?")).toBeNull();
  });
});

describe("Круг 4: нумерация и тире", () => {
  it("«N. Вопрос» без «?», за которым варианты снова с «1.», — новый вопрос", () => {
    const r = parseImport("4. Назовите реку\n1. Волга *\n2. Обь\n3. Лена\n5. Назовите город\n1. Москва *\n2. Тула");
    expect(r.questions.map((q) => [q.question.text, q.question.options])).toEqual([
      ["Назовите реку", ["Волга", "Обь", "Лена"]],
      ["Назовите город", ["Москва", "Тула"]],
    ]);
  });
  it("«— Вопрос?» с тире начинает вопрос в «Миллионе», «Гонке» и «Драконе»", () => {
    const text = "— Как зовут кота?\n- Мурзик\n- Барсик *\n- Пушок\n- Рыжик";
    expect(parseMillionaireImport(text).questions[0]?.text).toBe("Как зовут кота?");
    expect(parseSurvivalImport(text).rounds[0]?.text).toBe("Как зовут кота?");
    expect(parseDragonImport(text).battles[0]?.tasks[0]?.text).toBe("Как зовут кота?");
  });
});

describe("Круг 5: тире у вопроса и нумерация заново", () => {
  const text = "— Сколько лап у кота?\n- 4 *\n- 3\n- 5\n— Какого цвета снег?\n- Белый *\n- Синий";
  it("квиз: «— Вопрос?» после вариантов с дефисом — новый вопрос", () => {
    const r = parseImport(text);
    expect(r.skipped).toEqual([]);
    expect(r.questions.map((q) => [q.question.text, q.question.options])).toEqual([
      ["Сколько лап у кота?", ["4", "3", "5"]],
      ["Какого цвета снег?", ["Белый", "Синий"]],
    ]);
  });
  it("«Миллион», «Гонка», «Дракон»: второй вопрос с тире не становится четвёртым вариантом", () => {
    expect(parseMillionaireImport(text).questions.map((q) => q.text)).toEqual(["Сколько лап у кота?", "Какого цвета снег?"]);
    expect(parseSurvivalImport(text).rounds.map((q) => q.text)).toEqual(["Сколько лап у кота?", "Какого цвета снег?"]);
    expect(parseDragonImport(text).battles.flatMap((b) => b.tasks.map((t) => t.text))).toEqual(["Сколько лап у кота?", "Какого цвета снег?"]);
  });
  it("тот же знак у вопроса и вариантов — строка с «?» остаётся вариантом", () => {
    const r = parseImport("Что сказал кот?\n- Мяу *\n- Гав?\n- Кря");
    expect(r.questions.map((q) => q.question.options)).toEqual([["Мяу", "Гав?", "Кря"]]);
  });
  it("нумерация вопросов заново: «3. Лена» → «1. Назовите город» → «1. Москва» — Лена остаётся вариантом", () => {
    const r = parseImport("Назовите реку\n1. Волга *\n2. Обь\n3. Лена\n1. Назовите город\n1. Москва *\n2. Тула");
    expect(r.questions.map((q) => [q.question.text, q.question.options])).toEqual([
      ["Назовите реку", ["Волга", "Обь", "Лена"]],
      ["Назовите город", ["Москва", "Тула"]],
    ]);
  });
});
