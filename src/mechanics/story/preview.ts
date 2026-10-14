import { leaderboardAdditions } from "../../core/leaderboard";
import type { Answer } from "../../data/types";
import type { PreviewDriver } from "../preview";
import { SECTION_TITLES, type StoryContent } from "./content";
import { endingNext, endingReveal, endingStart, endingVote, endingWrite } from "./ending";
import { liesNext, liesReveal, liesStart, liesWrite } from "./lies";
import { authorOf, kindOf, nextPart, nextStory, parseStoryResult, peopleOf, personName, revealAuthor, sameText, startGuessing, startWriting, storyPrimary, teamOfPhone, withEnding, withLies, withWords } from "./logic";
import { finishRating, newSentence, showSentence, spinWheel, startRating, wordsIntro } from "./words";

// Тексты тестовых гостей (по номеру телефона).
const STORIES = [
  "В детстве я три года ходила на бальные танцы и ни разу не вышла на сцену",
  "Я уснул в аэропорту и опоздал на собственный рейс в отпуск",
  "Я выиграла конкурс караоке с песней, слов которой не знала",
  "Однажды я полдня катался на верблюде и потом неделю не мог сидеть",
];
const SAID = [
  ["Банка огурцов от бабушки 2019 года", "Крем для лица — так он дольше хранится", "Батарейки, чтобы дольше работали", "Торт, который я прячу от всех"],
  ["Засыпаю за минуту где угодно", "Помню все дни рождения коллег", "Нахожу парковку с первого раза", "Угадываю песню с трёх нот"],
];
const FACTS: Array<{ facts: string[]; lie: number }> = [
  { facts: ["Я прыгала с парашютом", "Я знаю три языка", "Я ни разу не была на море"], lie: 1 },
  { facts: ["Я играю на баяне", "Я родился в самолёте", "Я пробежал марафон"], lie: 1 },
  { facts: ["У меня живёт черепаха Гоша", "Я пела в хоре на Красной площади", "Я боюсь бабочек"], lie: 0 },
  { facts: ["Я выше папы на голову", "Я сам построил баню", "Я снимался в рекламе сока"], lie: 2 },
];
const ENDINGS = [
  { start: "Однажды в отпуске я потеряла паспорт прямо в аэропорту, и тут", end: "его принесла уборщица из женского туалета" },
  { start: "На свадьбе друга меня попросили подержать кольца, а я", end: "отдал их ведущему вместо жениха" },
  { start: "Я впервые встала на лыжи на чёрной трассе, и", end: "доехала вниз на спине под аплодисменты" },
];
const FAKES = ["его нашёл таксист через неделю", "я улетела по водительским правам", "пришлось жить в аэропорту три дня", "кольца проглотил кот невесты", "я ушла пешком через весь лес", "пограничник оказался моим одноклассником"];
const STARS = [5, 4, 5, 3];

/** Повторяемая «случайность»: предпросмотр каждый раз одинаковый. */
function seeded(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const at = <T,>(list: T[], i: number): T => list[((i % list.length) + list.length) % list.length] as T;

export const storyPreview: PreviewDriver<StoryContent> = ({ session, content, participants, answers }) => {
  const r = parseStoryResult(session.state.result);
  const kind = kindOf(content, r.part);
  const step = session.state.step;
  const random = seeded(step + 7);
  const teamOf = teamOfPhone(participants);
  // В командах у телефона — имя гостя и его команда.
  const name = (pid: string | null) => {
    const team = participants.find((p) => p.id === pid)?.teamId;
    return team ? `${personName(session, pid)} (${session.leaderboard[team]?.name ?? "команда"})` : personName(session, pid);
  };
  // Телефоны гостей: в одиночной игре — игроки, в командах — телефоны капитанов (пишут и голосуют сами).
  const phones = participants.filter((p) => p.kind === "player").sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
  const index = (pid: string | null) => phones.findIndex((p) => p.id === pid);
  // Кто пишет: в «Чьей истории» — все, в остальных разделах — двое (предпросмотр короче).
  const writers = kind === "author" ? phones : phones.slice(0, 2);
  const textOf = (i: number) => (kind === "said" ? at(at(SAID, r.q), i) : at(STORIES, i));
  const written = writers.map((p) => ({ pid: p.id, text: textOf(index(p.id)) }));
  const facts = writers.map((p) => ({ pid: p.id, ...at(FACTS, index(p.id)) }));
  const endings = writers.map((p) => ({ pid: p.id, ...at(ENDINGS, index(p.id)) }));
  const add = () => leaderboardAdditions(session.leaderboard, participants, session.playMode);

  switch (storyPrimary(session, content)) {
    // «Чья история?» и «Кто это сказал?»
    case "write":
      return {
        label: kind === "said" ? `Пульт: «Первый вопрос» — «${content.saidQuestions[0] ?? ""}»` : "Пульт: «Пишем истории»",
        change: startWriting(session, participants),
      };
    case "start": {
      if (answers.length === 0) return { label: kind === "said" ? "Гости отвечают анонимно" : "Гости тайно пишут истории", answers: written.map((w) => ({ pid: w.pid, value: { story: w.text } })) };
      const change = startGuessing(session, content, answers, participants, random);
      return change ? { label: `Пульт: «Начать угадывание» — ${kind === "said" ? "ответ" : "история"} без имени на экране`, change } : null;
    }
    case "reveal": {
      const story = r.stories[r.current];
      if (!story) return null;
      const author = authorOf(story.text, written);
      if (answers.length === 0) {
        // Первую угадывают все, вторую — один, третью — никто (очки автору).
        const guessers = phones.filter((p) => p.id !== author);
        const list = guessers.map((p, i) => {
          const right = r.current % 3 === 0 || (r.current % 3 === 1 && i === 0);
          const wrong = phones.find((x) => x.id !== p.id && x.id !== author)?.id ?? author;
          return { pid: p.id, value: { guess: right ? author : wrong } };
        });
        return { label: kind === "said" ? "Гости угадывают, чей это ответ" : "Гости голосуют, чья это история", answers: list };
      }
      return { label: `Пульт: «Открыть автора» — это ${name(author)}`, change: revealAuthor(session, content, answers, written, teamOf) };
    }
    case "next":
      return { label: kind === "said" ? "Пульт: «Следующий ответ»" : "Пульт: «Следующая история»", change: nextStory(session, content) };
    case "nextPart":
      return { label: `Следующий раздел: «${SECTION_TITLES[kindOf(content, r.part + 1)]}»`, change: nextPart(session) };

    // «Сочиняем историю»
    case "wordsSentence": {
      const w = r.words;
      if (w && w.mode === "rated") return r.part + 1 < content.sections.length ? { label: `Следующий раздел: «${SECTION_TITLES[kindOf(content, r.part + 1)]}»`, change: nextPart(session) } : null;
      const order = participants.filter((p) => p.kind === (session.playMode === "teams" ? "team" : "player")).sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0)).map((p) => p.id);
      const made = newSentence(session, content, w ?? wordsIntro(), order, random);
      const change = withWords(session, made.words, made.change);
      return { label: "Пульт: «Новая история: раздать бумажки»", change: { ...change, state: { ...change.state, result: { ...(change.state?.result as object), ...peopleOf(session, participants) } } } };
    }
    case "wordsShow": {
      const w = r.words;
      if (!w) return null;
      if (answers.length === 0) {
        const list = w.papers.flatMap((p) => (p.pid ? [{ pid: p.pid, value: { word: p.slot % Math.max(1, p.words.length) } }] : []));
        if (list.length > 0) return { label: "Каждый выбирает слово на своей бумажке", answers: list };
      }
      const m = showSentence(session, w, answers, random);
      return { label: "Пульт: «Показать историю» — предложение целиком на экране", change: withWords(session, m.words, m.change) };
    }
    case "wordsSpin": {
      const w = r.words;
      if (!w) return null;
      const m = spinWheel(session, w, r.people.length > 0 ? r.people : peopleOf(session, participants).people, teamOf, random);
      return { label: `Рулетка: показывает ${name(m.words.performer)}`, change: withWords(session, m.words) };
    }
    case "wordsRate": {
      const w = r.words;
      if (!w) return null;
      const m = startRating(session, content, w);
      return { label: "Пульт: «Оценить показ»", change: withWords(session, m.words, m.change) };
    }
    case "wordsRated": {
      const w = r.words;
      if (!w) return null;
      const excluded = (phone: string) => phone === w.performer || (session.playMode === "teams" && w.scoreTo !== null && teamOf(phone) === w.scoreTo);
      if (answers.length === 0) {
        const list = phones.filter((p) => !excluded(p.id)).map((p, i) => ({ pid: p.id, value: { stars: at(STARS, i) } }));
        if (list.length > 0) return { label: "Зал ставит звёзды", answers: list };
      }
      const m = finishRating(session, content, w, answers, excluded);
      return { label: "Пульт: «Итог» — средняя оценка в очки", change: withWords(session, m.words, m.change) };
    }

    // «Что было дальше?»
    case "endingWrite": {
      const m = endingWrite(session);
      return { label: "Пульт: «Пишем истории» — начало и настоящий конец", change: { ...withEnding(session, m.ending, m.change), leaderboard: add() } };
    }
    case "endingStart": {
      const e = r.ending;
      if (!e) return null;
      if (answers.length === 0) return { label: "Гости пишут начало истории и чем всё кончилось", answers: endings.map((x) => ({ pid: x.pid, value: { start: x.start, end: x.end } })) };
      const m = endingStart(session, content, e, answers, random);
      return m ? { label: "Пульт: «Начать» — на экране начало истории", change: withEnding(session, m.ending, m.change) } : null;
    }
    case "endingVote": {
      const e = r.ending;
      const item = e?.items[e.current];
      if (!e || !item) return null;
      if (answers.length === 0) return { label: "Остальные придумывают концовку", answers: fakesOf(phones, item.pid, e.current, e.fakeStep ?? step).map((a) => ({ pid: a.pid, value: a.value })) };
      const m = endingVote(session, content, e, answers, endings, random);
      return { label: "Пульт: «Голосуем: где правда?»", change: withEnding(session, m.ending, m.change) };
    }
    case "endingReveal": {
      const e = r.ending;
      const item = e?.items[e.current];
      if (!e || !item) return null;
      const fakes = fakesOf(phones, item.pid, e.current, e.fakeStep ?? step - 1);
      if (answers.length === 0) {
        const real = endings.find((x) => x.pid === item.pid)?.end ?? "";
        const realId = e.options.find((o) => sameText(o.text, real))?.id;
        const list = phones
          .filter((p) => p.id !== item.pid)
          .flatMap((p, i) => {
            const own = fakes.find((f) => f.pid === p.id);
            const fake = e.options.find((o) => o.id !== realId && !(own && sameText(o.text, String((own.value as { fake: string }).fake))));
            const pick = i === 0 ? realId : (fake?.id ?? realId);
            return pick ? [{ pid: p.id, value: { pick } }] : [];
          });
        if (list.length > 0) return { label: "Гости ищут настоящую концовку", answers: list };
      }
      const m = endingReveal(session, content, e, answers, fakes, endings, teamOf);
      return { label: "Пульт: «Открыть правду»", change: withEnding(session, m.ending, m.change) };
    }
    case "endingNext": {
      const e = r.ending;
      if (!e) return null;
      const m = endingNext(session, content, e);
      return { label: "Пульт: «Следующая история»", change: withEnding(session, m.ending, m.change) };
    }

    // «Две правды и ложь»
    case "liesWrite": {
      const m = liesWrite(session);
      return { label: "Пульт: «Пишем факты»", change: { ...withLies(session, m.lies, m.change), leaderboard: add() } };
    }
    case "liesStart": {
      const l = r.lies;
      if (!l) return null;
      if (answers.length === 0) return { label: "Гости пишут три факта о себе, один — выдумка", answers: facts.map((f) => ({ pid: f.pid, value: { facts: f.facts, lie: f.lie } })) };
      const m = liesStart(session, content, l, answers, random);
      return m ? { label: "Пульт: «Показать игроков» — три карточки на экране", change: withLies(session, m.lies, m.change) } : null;
    }
    case "liesReveal": {
      const l = r.lies;
      const item = l?.items[l.current];
      if (!l || !item) return null;
      if (answers.length === 0) {
        const own = facts.find((f) => f.pid === item.pid);
        const lieAt = own ? item.facts.indexOf(own.facts[own.lie] ?? "") : 0;
        const list = phones.filter((p) => p.id !== item.pid).map((p, i) => ({ pid: p.id, value: { pick: i === 0 ? lieAt : (lieAt + 1) % 3 } }));
        if (list.length > 0) return { label: `Гости ищут ложь у ${name(item.pid)}`, answers: list };
      }
      const m = liesReveal(session, content, l, answers, facts, teamOf);
      return { label: "Пульт: «Открыть ложь»", change: withLies(session, m.lies, m.change) };
    }
    case "liesNext": {
      const l = r.lies;
      if (!l) return null;
      const m = liesNext(session, content, l);
      return { label: "Пульт: «Следующий игрок»", change: withLies(session, m.lies, m.change) };
    }
    default:
      // «Следующий вопрос», награждение — дальше общий хвост предпросмотра.
      return null;
  }
};

/** Выдуманные концовки: все, кроме автора истории (одинаковые на шаге концовок и при открытии правды). */
function fakesOf(phones: Array<{ id: string }>, author: string, item: number, step: number): Answer[] {
  return phones
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.id !== author)
    .map(({ p, i }) => ({ id: `${step}_${p.id}`, step, pid: p.id, uid: p.id, submittedAt: null, value: { fake: at(FAKES, i + item * 3) } }));
}
