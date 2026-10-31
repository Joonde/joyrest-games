import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { formatNumber, readNumber } from "./orderNumber";
import { questionsLabel } from "../../core/results";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionMenu, type MenuAction } from "../../components/Menu";
import { Toast, useToast } from "../../components/Toast";
import { compressImage, ImageError } from "../../components/media/compressImage";
import { MediaImage } from "../../components/media/MediaImage";
import { mediaRepo, tracksRepo } from "../../data";
import type { EditorProps, ValidationError } from "../types";
import {
  changeKind,
  clipOf,
  correctSet,
  FORMAT_BLOCKS,
  usesAnswers,
  hasOptions,
  LIMITS as QUIZ_LIMITS,
  newPicture,
  QUESTION_FORMATS,
  questionImages,
  settingsOf,
  withClip,
  answerClipOf,
  withAnswerClip,
  toggleCorrect,
  duplicateQuestion,
  KIND_HINTS,
  KIND_TITLES,
  LIMITS,
  moveItem,
  newQuestion,
  quizRounds,
  roundAt,
  type QuestionKind,
  type QuizContent,
  type QuizQuestion,
  type QuizSettings,
  QUIZ_ARTS,
  RACE_BONUS,
} from "./content";
import { ImportSheet } from "./ImportSheet";
import { RoundHeader, RoundMap, roundColor, roundName } from "./RoundBlocks";
import { insertAfter, moveKeepingRounds, moveToRound, nextRoundTitle, removeKeepingRound, removeRoundAt, roundCount, startRoundAt } from "./roundsEdit";
import { TrackTimeline } from "../../components/music/TrackTimeline";
import { parseClip } from "../../core/clip";
import { ClampedNumber } from "../../components/ClampedNumber";
import { Fold } from "../../components/Fold";
import { KindIcon } from "./KindIcon";
import { DRAW_EFFECTS } from "../../core/draw";
import { QuizPreview } from "./Preview";
import { errorsFor, validateContent, type QuestionField } from "./validate";
import { LETTERS } from "./views";
import { LevelIcon } from "../../components/live/SuperGame";
import { activeLevels, LEVEL_NAMES, levelKind, newLevels, parsePenalty, parsePickMode, parseStyle, PENALTY_TITLES, penaltyFor, PICK_MODE_TITLES, STYLE_TITLES, SUPER_MIN_LEVELS, SUPER_KIND_HINTS, SUPER_KIND_TITLES, SUPER_KINDS, SUPER_LIMITS, VOTE_TIME, withLevelKind, type SuperLevel, type SuperPenalty, type SuperPickMode, type SuperStyle } from "../../core/supergame";

/**
 * Новый вопрос в конструкторе: правильный вариант не отмечен заранее — ведущий отмечает сам
 * (иначе «A» остаётся верным, если забыть поставить галочку; проверка просит «Отметьте правильный вариант»).
 */
function blankQuestion(kind: QuestionKind): QuizQuestion {
  const q = newQuestion(kind);
  return hasOptions(kind) ? { ...q, correct: -1, alsoCorrect: [] } : q;
}

/** Название суперигры по раунду: «Суперигра «Кино»» (без раундов — просто «Суперигра»). */
function superTitle(round?: string): string {
  return round ? `Суперигра «${round}»` : "Суперигра";
}

/** Ключ свёрнутого раунда: название (раунд без названия — один, первый). */
function foldKey(round: { title: string }): string {
  return round.title || "\u0000auto";
}

/** Подпись суперигры в списке: «4 уровня · Сундуки · 100–500 очк.». */
function superMeta(q: QuizQuestion): string {
  const points = (q.levels ?? []).filter((l) => !l.off).map((l) => l.points).filter((n) => Number.isFinite(n));
  const range = points.length > 0 ? `${Math.min(...points)}–${Math.max(...points)} очк.` : "";
  const n = activeLevels(q.levels ?? newLevels()).length;
  // Уровней 2–4: «2 уровня», «3 уровня», «4 уровня».
  return [`${n} уровня`, STYLE_TITLES[parseStyle(q.superStyle)], range].filter(Boolean).join(" · ");
}

// Суперигра — не формат вопроса, а отдельный финал раунда (своя кнопка «👑 Суперигра»); её уровни берут форматы ниже.
const KINDS: QuestionKind[] = ["choice", "open", "speed", "order", "number", "buzz", "pictures", "auction"];

/** Конструктор квиза: список вопросов, правка, порядок, импорт списком и предпросмотр. */
export function QuizEditor({ gameId, themeId, content, onChange, editable }: EditorProps<QuizContent>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<QuizQuestion | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Свёрнутые раунды: id первого вопроса раунда.
  // Свёрнутые раунды — по названию (переживает перенос вопросов), запоминаются на устройстве для этой игры.
  const foldStore = `joyrest.quiz.folded.${gameId}`;
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(foldStore) ?? "[]");
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  // Убрали раунд — несколько секунд можно «Вернуть».
  const [undo, setUndo] = useState<{ text: string; prev: QuizQuestion[] } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const [toast, showToast] = useToast(3500);
  // Картинки, загруженные в этот раз: их можно сразу удалить при замене. Старые картинки
  // остаются до удаления игры — на них может ссылаться уже запущенная сессия.
  const uploadedHere = useRef(new Set<string>());
  // Сжатие занимает секунды: картинку ставим в актуальный список, а не в тот, что был до сжатия.
  const latest = useRef(content);
  latest.current = content;
  const errors = useMemo(() => validateContent(content), [content]);
  const questions = content.questions;
  const rounds = useMemo(() => quizRounds({ questions }), [questions]);
  const room = LIMITS.questions - questions.length;

  /**
   * Каждая запись — от свежего содержимого (`latest`), а не от списка этого рендера: колбэки, которые
   * срабатывают позже (догрузился трек, сжалась картинка), не откатывают правки, сделанные за это время (QA M6).
   * `latest` сразу получает новое значение — две записи подряд в одном касании не теряют друг друга.
   */
  function commit(next: QuizContent) {
    latest.current = next;
    onChange(next);
  }

  function setQuestions(next: QuizQuestion[]) {
    commit({ ...latest.current, questions: next });
  }

  function updateQuestion(id: string, patch: Partial<QuizQuestion> | ((q: QuizQuestion) => QuizQuestion)) {
    const current = latest.current;
    commit({ ...current, questions: current.questions.map((q) => (q.id === id ? (typeof patch === "function" ? patch(q) : { ...q, ...patch }) : q)) });
  }

  // «Показать, что исправить» (GameEditor шлёт событие и ищет `.edit-issue`): свёрнутые раунды с ошибками раскрываются.
  const issueRounds = useMemo(() => {
    const keys = new Set<string>();
    rounds.forEach((r) => {
      if (questions.slice(r.from, r.to + 1).some((q) => errorsFor(errors, q.id).length > 0)) keys.add(foldKey(r));
    });
    return keys;
  }, [rounds, questions, errors]);
  const issueRoundsRef = useRef(issueRounds);
  issueRoundsRef.current = issueRounds;
  useEffect(() => {
    function reveal() {
      const keys = issueRoundsRef.current;
      setFolded((prev) => {
        if (![...prev].some((k) => keys.has(k))) return prev;
        const next = new Set([...prev].filter((k) => !keys.has(k)));
        try {
          localStorage.setItem(foldStore, JSON.stringify([...next]));
        } catch {
          // Нет хранилища — свёрнутое живёт до перезагрузки.
        }
        return next;
      });
    }
    window.addEventListener("joyrest:reveal-issues", reveal);
    return () => window.removeEventListener("joyrest:reveal-issues", reveal);
  }, [foldStore]);

  /** Убирает картинку из базы, если она загружена сейчас и больше ни в одном вопросе. */
  function releaseImage(mediaId: string | null, remaining: QuizQuestion[]) {
    if (!mediaId || !uploadedHere.current.has(mediaId)) return;
    if (remaining.some((q) => questionImages(q).includes(mediaId))) return;
    uploadedHere.current.delete(mediaId);
    void mediaRepo.remove(gameId, mediaId).catch(() => undefined);
  }

  function focusLater(selector: string) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
  }

  /** Открыть вопрос на правку (другой сворачивается) и поставить его начало вверх экрана — видно, где вы. */
  function toggle(id: string) {
    if (openId === id) {
      collapse(id);
      return;
    }
    setOpenId(id);
    requestAnimationFrame(() => document.getElementById(`q-${id}-card`)?.scrollIntoView({ block: "start", behavior: smoothScroll() }));
  }

  /** Свернуть вопрос и вернуть к нему взгляд: после длинной формы карточка не «теряется» выше экрана. */
  function collapse(id: string) {
    setOpenId(null);
    requestAnimationFrame(() => document.getElementById(`q-${id}-card`)?.scrollIntoView({ block: "nearest", behavior: smoothScroll() }));
  }

  function add(kind: QuestionKind = "choice") {
    if (kind === "super") {
      // Суперигра — всегда в конец раунда открытого вопроса (ничего не открыто — последнего раунда или игры).
      const openIndex = questions.findIndex((x) => x.id === openId);
      const target = openIndex >= 0 ? rounds.find((r) => openIndex >= r.from && openIndex <= r.to) : rounds[rounds.length - 1];
      addSuper(target ? target.to : questions.length - 1, target);
      setAdding(false);
      return;
    }
    const q = blankQuestion(kind);
    // Сразу под вопросом, с которым работаете (решение владельца 22 октября 2026); ничего не открыто — в конец игры.
    const openIndex = questions.findIndex((x) => x.id === openId);
    const at = openIndex >= 0 ? openIndex : questions.length - 1;
    const into = rounds.find((r) => at >= r.from && at <= r.to);
    unfold(into);
    setQuestions(insertAfter(questions, at, q));
    if (openIndex >= 0) showToast(`Вопрос ${at + 2} добавлен под вопросом ${at + 1}${into ? ` — раунд «${roundName(into)}»` : ""}`);
    setOpenId(q.id);
    setAdding(false);
    focusLater(`#q-${q.id}-text`);
  }

  function duplicate(index: number) {
    const source = questions[index];
    if (!source || room <= 0) return;
    const copy = duplicateQuestion(source);
    setQuestions([...questions.slice(0, index + 1), copy, ...questions.slice(index + 1)]);
    setOpenId(copy.id);
    showToast("Вопрос продублирован");
  }

  function remove(question: QuizQuestion) {
    const remaining = removeKeepingRound(questions, question.id);
    setQuestions(remaining);
    for (const id of questionImages(question)) releaseImage(id, remaining);
    setToDelete(null);
    const gone = rounds.find((r) => r.from === r.to && questions[r.from]?.id === question.id && r.title);
    showToast(gone && roundCount(remaining) < rounds.length ? `Вопрос удалён. Раунд «${gone.title}» убран — в нём не осталось вопросов` : "Вопрос удалён");
  }

  function move(index: number, to: number, focus?: "up" | "down") {
    const id = questions[index]?.id;
    // Блоки раундов остаются на местах: вопрос, перенесённый через блок, уходит в соседний раунд.
    const before = roundAt({ questions } as QuizContent, index);
    const next = moveKeepingRounds(questions, index, to);
    setQuestions(next);
    const after = quizRounds({ questions: next } as QuizContent).find((r) => to >= r.from && to <= r.to);
    if (before && after && before.from !== after.from) showToast(`Вопрос перенесён в «${roundName(after)}»`);
    // Фокус остаётся на той же кнопке у перемещённого вопроса.
    if (id && focus) focusLater(`[data-move="${id}-${focus}"]`);
  }

  /** Новый вопрос в раунде — сразу после `index`. */
  function addAfter(index: number) {
    if (room <= 0) return;
    const q = blankQuestion("choice");
    setQuestions(insertAfter(questions, index, q));
    setOpenId(q.id);
    focusLater(`#q-${q.id}-text`);
    showToast(`Вопрос ${index + 2} добавлен под вопросом ${index + 1}`);
  }

  /** Суперигра раунда — после `index` (последнего вопроса раунда), с названием по раунду. */
  function addSuper(index: number, round: (typeof rounds)[number] | undefined) {
    if (room <= 0) return;
    const name = round ? roundName(round) : "";
    const q = { ...newQuestion("super"), text: superTitle(name) };
    unfold(round);
    setQuestions(insertAfter(questions, index, q));
    setOpenId(q.id);
    showToast(round ? `Суперигра встала в конец раунда «${name}»` : "Суперигра встала последним вопросом игры");
    requestAnimationFrame(() => document.getElementById(`q-${q.id}-card`)?.scrollIntoView({ block: "start", behavior: smoothScroll() }));
  }

  /** Новый раунд после `index`: блок и первый вопрос в нём. */
  function addRoundAfter(index: number) {
    if (room <= 0) return;
    const q = { ...blankQuestion("choice"), round: nextRoundTitle(questions, index + 1) };
    setQuestions(insertAfter(questions, index, q));
    setOpenId(q.id);
    focusLater(`#q-${q.id}-text`);
    showToast(`Новый раунд «${q.round}» — переименуйте его кнопкой ✎`);
  }

  /** С этого вопроса — новый раунд: он и вопросы ниже (до следующего блока) уходят в него. */
  function startRound(index: number) {
    const next = startRoundAt(questions, index);
    setQuestions(next);
    showToast(`С вопроса ${index + 1} начинается «${next[index]?.round ?? ""}»`);
  }

  function renameRound(index: number, title: string) {
    const name = title.replace(/\s+/g, " ").trim().slice(0, LIMITS.round);
    const current = questions[index];
    if (!current) return;
    // Пустое название — прежнее (раунд не пропадает: блок убирают кнопкой ✕).
    const round = name || current.round || nextRoundTitle(questions, index);
    // Суперигра раунда с названием по умолчанию переименовывается вместе с раундом.
    const block = rounds.find((r) => r.from === index);
    const before = block ? roundName(block) : "";
    const auto = new Set([superTitle(before), superTitle()]);
    setQuestions(
      questions.map((q, i) => {
        const inRound = block ? i >= block.from && i <= block.to : i === index;
        const text = inRound && q.kind === "super" && auto.has(q.text.trim()) ? superTitle(round) : q.text;
        return i === index ? { ...q, round, text } : text === q.text ? q : { ...q, text };
      }),
    );
  }

  function dropRound(index: number) {
    const name = questions[index]?.round;
    const next = removeRoundAt(questions, index);
    const prev = questions;
    setQuestions(next);
    const left = roundCount(next) > 0;
    window.clearTimeout(undoTimer.current);
    setUndo({ text: left ? `Раунд «${name}» убран, вопросы остались — в раунде выше` : `Раунд «${name}» убран, вопросы остались — игра без раундов`, prev });
    undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
  }

  function undoDrop() {
    if (!undo) return;
    window.clearTimeout(undoTimer.current);
    setQuestions(undo.prev);
    setUndo(null);
  }

  function unfold(round: (typeof rounds)[number] | undefined) {
    if (round && folded.has(foldKey(round))) toggleFold(foldKey(round));
  }

  /** «⋯ → В раунд «…»»: вопрос — в конец выбранного раунда. */
  function sendToRound(question: QuizQuestion, target: (typeof rounds)[number]) {
    const key = questions[target.from]?.id;
    if (!key) return;
    const before = rounds.length;
    const next = moveToRound(questions, question.id, key);
    setQuestions(next);
    const after = quizRounds({ questions: next } as QuizContent);
    const now = next.findIndex((q) => q.id === question.id);
    const into = after.find((r) => now >= r.from && now <= r.to);
    unfold(target);
    showToast(`Вопрос перенесён в «${roundName(into ?? target)}» — теперь № ${now + 1}${after.length < before ? ". Прежний раунд опустел и убран" : ""}`);
    requestAnimationFrame(() => document.getElementById(`q-${question.id}-card`)?.scrollIntoView({ block: "center", behavior: smoothScroll() }));
  }

  function toggleFold(key: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(foldStore, JSON.stringify([...next]));
      } catch {
        // Нет хранилища — свёрнутое живёт до перезагрузки.
      }
      return next;
    });
  }

  /** Карта раундов далеко наверху — вернуться к ней одним касанием. */
  function toMap() {
    document.getElementById("quiz-round-map")?.scrollIntoView({ block: "start", behavior: smoothScroll() });
  }

  /** Касание карты: раунд разворачивается, вопрос открывается и встаёт в начало экрана. */
  function pick(index: number) {
    const q = questions[index];
    if (!q) return;
    unfold(rounds.find((r) => index >= r.from && index <= r.to));
    setOpenId(q.id);
    requestAnimationFrame(() => document.getElementById(`q-${q.id}-card`)?.scrollIntoView({ block: "start", behavior: smoothScroll() }));
  }

  /** Картинка вопроса (`slot` не задан) или одна из нескольких картинок (номер поля). */
  async function pickImage(question: QuizQuestion, file: File, slot?: Slot) {
    try {
      const image = await compressImage(file);
      const { mediaId, saved } = mediaRepo.upload(gameId, image);
      uploadedHere.current.add(mediaId);
      const current = latest.current;
      const found = current.questions.find((q) => q.id === question.id);
      const previous = found ? slotImage(found, slot) : null;
      const next = current.questions.map((q) => (q.id === question.id ? withSlotImage(q, slot, mediaId) : q));
      commit({ ...current, questions: next });
      releaseImage(previous, next);
      saved.catch(() => showToast("Картинка не сохранилась. Проверьте интернет и выберите её ещё раз."));
    } catch (error) {
      showToast(error instanceof ImageError ? error.message : "Не получилось добавить картинку.");
    }
  }

  function removeImage(question: QuizQuestion, slot?: Slot) {
    const before = slotImage(question, slot);
    const next = questions.map((q) => (q.id === question.id ? withSlotImage(q, slot, null) : q));
    setQuestions(next);
    releaseImage(before, next);
  }

  // Перетаскивание мышью (на телефоне — кнопки вверх и вниз).
  function onDragOver(event: DragEvent, index: number) {
    if (!dragId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const from = questions.findIndex((q) => q.id === dragId);
    if (from >= 0 && dropIndex !== null) move(from, dropIndex > from ? dropIndex - 1 : dropIndex);
    setDragId(null);
    setDropIndex(null);
  }

  const generalErrors = errors.filter((e) => !e.path.startsWith("questions/"));

  return (
    <>
      <section className="card">
        <div className="stack stack--tight">
          <h2>Вопросы</h2>
          <p className="muted">
            {questions.length === 0
              ? editable
                ? "Добавьте первый вопрос или вставьте готовый список."
                : "В игре пока нет вопросов."
              : questionsLabel(questions.length)}
          </p>
        </div>
        {editable && generalErrors.map((e) => (
          <p key={e.message} className="error small edit-issue">
            {e.message}
          </p>
        ))}
        {editable && (
          <div className="actions">
            <button type="button" className="btn btn--block" disabled={room <= 0} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
              Добавить вопрос
            </button>
            <button type="button" className="btn btn--secondary btn--block" disabled={room <= 0} onClick={() => setImportOpen(true)}>
              Добавить списком
            </button>
          </div>
        )}
      </section>

      {editable && adding && <AddQuestion onPick={add} onClose={() => setAdding(false)} />}

      {editable && (
        <SettingsCard
          settings={settingsOf(content)}
          hasRace={questions.filter((q) => q.kind === "buzz").length}
          hasAuction={questions.some((q) => q.kind === "auction")}
          onChange={(settings) => onChange({ ...content, settings })}
        />
      )}

      {questions.length > 0 && (
        <RoundMap
          questions={questions}
          rounds={rounds}
          openIndex={questions.findIndex((q) => q.id === openId)}
          editable={editable}
          issueFrom={editable ? new Set(rounds.filter((r) => issueRounds.has(foldKey(r))).map((r) => r.from)) : undefined}
          onPick={pick}
          onSplit={() => startRound(Math.min(questions.length - 1, Math.max(1, Math.ceil(questions.length / 2))))}
        />
      )}

      {questions.length > 0 && (
        <ol className="q-list" aria-label="Вопросы игры" onDragLeave={(e) => e.currentTarget === e.target && setDropIndex(null)}>
          {questions.map((q, index) => {
            const own = errorsFor(errors, q.id);
            const expanded = openId === q.id;
            const menu: MenuAction[] = [{ label: "Предпросмотр", onClick: () => setPreview(index) }];
            if (editable) {
              if (room > 0) menu.push({ label: "Дублировать", onClick: () => duplicate(index) });
              rounds.forEach((r) => {
                if (index < r.from || index > r.to) menu.push({ label: `Перенести в «${roundName(r)}»`, onClick: () => sendToRound(q, r) });
              });
              menu.push({ label: "Удалить", onClick: () => setToDelete(q) });
            }
            const classes = ["card", "q-card"];
            if (expanded) classes.push("is-open");
            if (dragId === q.id) classes.push("is-dragging");
            if (dropIndex === index) classes.push("drop-before");
            if (dropIndex === index + 1 && index === questions.length - 1) classes.push("drop-after");
            const roundIndex = rounds.findIndex((r) => index >= r.from && index <= r.to);
            const round = roundIndex >= 0 ? rounds[roundIndex] : undefined;
            const roundKey = round ? foldKey(round) : "";
            const isFolded = round ? folded.has(roundKey) : false;
            if (round) classes.push("q-card--round");
            const isSuper = q.kind === "super";
            if (isSuper) classes.push("q-card--super");
            const lastAt = round ? round.to : questions.length - 1;
            const superLate = isSuper && index !== lastAt;
            const roundHasSuper = round ? questions.slice(round.from, round.to + 1).some((x) => x.kind === "super") : false;
            const cardStyle = round ? ({ "--rc": roundColor(roundIndex) } as CSSProperties) : undefined;
            const header = round && round.from === index && (
              <RoundHeader
                round={round}
                index={roundIndex}
                auto={!round.title}
                folded={isFolded}
                editable={editable}
                onFold={() => toggleFold(roundKey)}
                onRename={(title) => renameRound(index, title)}
                onRemove={() => dropRound(index)}
                issues={editable ? questions.slice(round.from, round.to + 1).reduce((n, x) => n + errorsFor(errors, x.id).length, 0) : 0}
              />
            );
            const addRow = editable && round && round.to === index && room > 0 && (
              <li className="q-round-add" style={cardStyle}>
                <button type="button" className="q-round-add__btn" onClick={() => addAfter(index)}>
                  + Вопрос в этот раунд
                </button>
                <button type="button" className="q-round-add__btn" onClick={() => addRoundAfter(index)}>
                  + Новый раунд
                </button>
                {!roundHasSuper && (
                  <button type="button" className="q-round-add__btn q-round-add__btn--super" onClick={() => addSuper(index, round)}>
                    👑 + Суперигра в конец «{roundName(round)}»
                  </button>
                )}
              </li>
            );
            if (isFolded) return <Fragment key={q.id}>{header}</Fragment>;
            return (
              <Fragment key={q.id}>
              {header}
              <li
                style={cardStyle}
                id={`q-${q.id}-card`}
                className={classes.join(" ")}
                onDragOver={(e) => onDragOver(e, index)}
                onDrop={onDrop}
              >
                <div className="q-card__head">
                  {editable && (
                    <span
                      className="q-card__handle"
                      draggable
                      title="Перетащите, чтобы поменять порядок"
                      aria-hidden="true"
                      onDragStart={(e) => {
                        setDragId(q.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", q.id);
                        const card = e.currentTarget.closest("li");
                        if (card) e.dataTransfer.setDragImage(card, 24, 24);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropIndex(null);
                      }}
                    >
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" />
                      </svg>
                    </span>
                  )}
                  <button
                    type="button"
                    className="q-card__summary"
                    aria-expanded={expanded}
                    aria-controls={`q-${q.id}-form`}
                    onClick={() => toggle(q.id)}
                  >
                    <span className="q-card__number" aria-label={isSuper ? `Вопрос ${index + 1}, суперигра` : undefined}>
                      {isSuper ? "👑" : index + 1}
                    </span>
                    <span className="q-card__titles">
                      <span className="q-card__text">
                        {isSuper ? "👑 " : ""}
                        {q.text.trim() || "Без текста"}
                      </span>
                      <span className="q-card__meta muted small">
                        {isSuper ? superMeta(q) : `${KIND_TITLES[q.kind]} · ${q.timeLimit} с · ${q.points} очк.`}
                        {q.imageId ? " · картинка" : ""}
                        {round ? ` · ${index - round.from + 1}\u00a0из\u00a0${round.to - round.from + 1}` : ""}
                      </span>
                      {isSuper && !superLate && <span className="q-card__super-badge">👑 {round ? "Финал раунда" : "Финал игры"}</span>}
                      {editable && own.length > 0 && <span className="q-card__issue edit-issue">Нужно исправить: {own.length}</span>}
                      {expanded && <span className="q-card__editing">✎ Вы правите вопрос {index + 1}</span>}
                    </span>
                  </button>
                  <ActionMenu icon="dots" label={`Действия с вопросом ${index + 1}`} actions={menu} />
                </div>

                {editable && superLate && (
                  <div className="q-card__super-warn" role="note">
                    <span>
                      <b>Суперигра лучше в конце {round ? `раунда «${roundName(round)}»` : "игры"} — перенести?</b>{" "}
                      {round ? "Её очки идут в счёт этого раунда, поэтому она идёт после всех его вопросов." : "Её ставят последним вопросом."}
                    </span>
                    <button type="button" className="btn btn--secondary btn--block" onClick={() => move(index, lastAt)}>
                      Перенести в конец {round ? "раунда" : "игры"}
                    </button>
                  </div>
                )}

                {editable && (
                  <div className="q-card__toolbar">
                    <button
                      type="button"
                      className="btn btn--quiet q-card__move"
                      data-move={`${q.id}-up`}
                      disabled={index === 0}
                      aria-label={`Поднять вопрос ${index + 1} выше`}
                      onClick={() => move(index, index - 1, "up")}
                    >
                      <Arrow up />
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet q-card__move"
                      data-move={`${q.id}-down`}
                      disabled={index === questions.length - 1}
                      aria-label={`Опустить вопрос ${index + 1} ниже`}
                      onClick={() => move(index, index + 1, "down")}
                    >
                      <Arrow />
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={() => toggle(q.id)}>
                      {expanded ? "Свернуть" : "Изменить"}
                    </button>
                  </div>
                )}

                {expanded && (
                  <div id={`q-${q.id}-form`} className="q-card__body">
                    {(round || editable) && (
                      <div className="q-card__round-bar">
                        {round && (
                          <span className="q-card__round-tag">
                            ◆ {roundName(round)} · {isSuper ? "финал раунда" : `вопрос ${index - round.from + 1} из ${round.to - round.from + 1}`}
                          </span>
                        )}
                        {isSuper && <span className="muted small">Суперигра — последняя в раунде, её очки идут в счёт раунда.</span>}
                        {editable && !isSuper && (!round || round.from !== index) && (
                          <button type="button" className="btn btn--quiet q-card__round-start" onClick={() => startRound(index)}>
                            + Новый раунд с этого вопроса
                          </button>
                        )}
                        {editable && !round && <span className="muted small">Вопросы выше станут «Раундом 1», этот и ниже — «Раундом 2».</span>}
                        {questions.length >= 8 && (
                          <button type="button" className="btn btn--quiet q-card__to-map" onClick={toMap}>
                            ↑ К карте раундов
                          </button>
                        )}
                      </div>
                    )}
                    {editable ? (
                      <QuestionForm
                        gameId={gameId}
                        question={q}
                        errors={own}
                        onChange={(patch) => updateQuestion(q.id, patch)}
                        onPickImage={(file, slot) => pickImage(q, file, slot)}
                        onRemoveImage={(slot) => removeImage(q, slot)}
                      />
                    ) : (
                      <QuestionReadOnly gameId={gameId} question={q} />
                    )}
                    <div className="actions">
                      <button type="button" className="btn btn--secondary btn--block" onClick={() => setPreview(index)}>
                        Предпросмотр
                      </button>
                      {editable && room > 0 && (
                        <button type="button" className="btn btn--secondary btn--block" onClick={() => addAfter(index)}>
                          + Добавить вопрос ниже
                        </button>
                      )}
                      {index < questions.length - 1 && (
                        <button type="button" className="btn btn--secondary btn--block" onClick={() => pick(index + 1)}>
                          Дальше — вопрос {index + 2} →
                        </button>
                      )}
                      <button type="button" className="btn btn--quiet btn--block" onClick={() => collapse(q.id)}>
                        Готово — свернуть вопрос {index + 1}
                      </button>
                    </div>
                  </div>
                )}
              </li>
              {addRow}
              </Fragment>
            );
          })}
        </ol>
      )}

      {editable && questions.length >= 3 && (
        <div className="actions">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={room <= 0}
            onClick={() => {
              setAdding(true);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Добавить вопрос
          </button>
        </div>
      )}

      <QuizPreview gameId={gameId} themeId={themeId} content={content} index={preview} onIndex={setPreview} />
      {editable && (
        <ImportSheet
          open={importOpen}
          room={room}
          onClose={() => setImportOpen(false)}
          onAdd={(added) => {
            setQuestions([...questions, ...added]);
            setImportOpen(false);
            showToast(`Добавлено: ${questionsLabel(added.length)}`);
          }}
        />
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title="Удалить вопрос?"
        confirmLabel="Удалить вопрос"
        onConfirm={() => toDelete && remove(toDelete)}
        onCancel={() => setToDelete(null)}
      >
        <p>«{toDelete?.text.trim() || "Без текста"}» пропадёт из игры. Запущенные сессии не изменятся.</p>
      </ConfirmDialog>
      <Toast text={undo ? null : toast} />
      {undo && (
        <div className="toast toast--undo" role="status">
          <span>{undo.text}</span>
          <button type="button" className="toast__action" onClick={undoDrop}>
            Вернуть
          </button>
        </div>
      )}
    </>
  );
}

const BOARD_MODES: Array<{ id: QuizSettings["board"]; title: string; hint: string }> = [
  { id: "each", title: "После каждого вопроса", hint: "Ответ → таблица → следующий вопрос." },
  { id: "rounds", title: "В конце раунда", hint: "Таблица — только после последнего вопроса раунда (без раундов — в конце игры)." },
  { id: "manual", title: "По кнопке", hint: "После ответа — сразу следующий вопрос; таблицу ведущий показывает, когда захочет." },
];

/** «Настройки показа» квиза: заставка вопроса, когда таблица, картинки на телефонах. */
function SettingsCard({ settings, hasRace, hasAuction, onChange }: { settings: QuizSettings; hasRace: number; hasAuction: boolean; onChange: (settings: QuizSettings) => void }) {
  return (
    <details className="card quiz-settings">
      <summary>
        <h2>⚙️ Настройки показа</h2>
        <span className="muted small">
          {settings.intro ? "с заставкой вопроса" : "без заставки"} · {BOARD_MODES.find((b) => b.id === settings.board)?.title.toLowerCase()}
          {settings.phoneImages ? " · картинки на телефонах" : ""}
        </span>
      </summary>
      <label className="choice">
        <input type="checkbox" checked={settings.intro} onChange={(e) => onChange({ ...settings, intro: e.target.checked })} />
        <span className="choice__text">
          <span className="choice__title">Заставка «Вопрос 2 из 8»</span>
          <span className="choice__hint">Без неё «Следующий вопрос» сразу открывает вопрос и таймер. Заставка раунда остаётся.</span>
        </span>
      </label>
      <fieldset>
        <legend>Таблица</legend>
        {BOARD_MODES.map((mode) => (
          <label key={mode.id} className="choice">
            <input type="radio" name="quiz-board" checked={settings.board === mode.id} onChange={() => onChange({ ...settings, board: mode.id })} />
            <span className="choice__text">
              <span className="choice__title">{mode.title}</span>
              <span className="choice__hint">{mode.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="choice">
        <input type="checkbox" checked={settings.phoneImages} onChange={(e) => onChange({ ...settings, phoneImages: e.target.checked })} />
        <span className="choice__text">
          <span className="choice__title">Картинки вопросов на телефонах гостей</span>
          <span className="choice__hint">Уменьшенная картинка над вариантами. В режиме «без экрана» показывается всегда.</span>
        </span>
      </label>
      <Fold title="Фон экрана зала" value={QUIZ_ARTS.find((x) => x.id === (settings.art ?? "auto"))?.title}>
        <fieldset className="stack stack--tight" aria-label="Фон экрана зала">
          <p className="muted small">Картина под игрой в темах JoyRest (вечерней и дневной) и темах «под игру». Праздничные темы остаются со своим фоном.</p>
          {QUIZ_ARTS.map((x) => (
            <label key={x.id} className="choice show-look">
              <input type="radio" name="quiz-art" checked={(settings.art ?? "auto") === x.id} onChange={() => onChange({ ...settings, art: x.id })} />
              <span className="choice__text">
                <span className="choice__title">{x.title}</span>
                <span className="choice__hint">{x.hint}</span>
              </span>
              {x.id !== "auto" && <span className="show-look__thumb" style={{ backgroundImage: `url("/covers/art/web/${x.id}-1280.webp")` }} aria-hidden="true" />}
            </label>
          ))}
        </fieldset>
      </Fold>
      {hasRace > 0 && (
        <label className="field">
          Гонка «Кто первый»: делений до финиша
          <ClampedNumber value={settings.raceTarget} min={QUIZ_LIMITS.minRace} max={QUIZ_LIMITS.maxRace} fallback={5} onChange={(raceTarget) => onChange({ ...settings, raceTarget })} />
          <span className="muted small">Настройка видна, потому что в игре есть вопросы формата «Гонка: кто первый» ({hasRace} шт.): гости жмут кнопку, кто первый угадал трек — двигается на деление вперёд. Кто первым наберёт столько делений (супер-трек — 2–3 деления), выигрывает гонку. Остальных вопросов это не касается.</span>
        </label>
      )}
      {hasRace > 0 && (
        <label className="field">
          Бонус за победу в гонке, очков
          <ClampedNumber value={settings.raceBonus ?? RACE_BONUS.def} min={0} max={RACE_BONUS.max} fallback={RACE_BONUS.def} onChange={(raceBonus) => onChange({ ...settings, raceBonus })} />
          <span className="muted small">Кто первым дошёл до финиша, получает эти очки сверху — гонка влияет на итог игры. Один раз за игру. 0 — без бонуса.</span>
        </label>
      )}
      {hasAuction && (
        <fieldset className="stack stack--tight">
          <legend>Жребий в «Аукционе» при равных ставках</legend>
          <p className="muted small">Самая большая ставка у нескольких — на экране зала жребий между ними, выпавший отвечает. Ведущий может сменить эффект и на пульте, перед «Ставки сделаны».</p>
          <div className="pick-chips" role="radiogroup" aria-label="Эффект жребия">
            {DRAW_EFFECTS.map((f) => (
              <button key={f.id} type="button" className="pick-chip" role="radio" aria-checked={(settings.drawEffect ?? "coin") === f.id} aria-pressed={(settings.drawEffect ?? "coin") === f.id} title={f.hint} onClick={() => onChange({ ...settings, drawEffect: f.id })}>
                {f.title}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </details>
  );
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={up ? undefined : { transform: "rotate(180deg)" }}>
      <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function FieldErrors({ errors, field, questionId }: { errors: ValidationError[]; field: QuestionField; questionId: string }) {
  const own = errorsFor(errors, questionId, field);
  if (own.length === 0) return null;
  return (
    <span className="error small edit-issue" id={`q-${questionId}-${field}-error`}>
      {own.map((e) => e.message).join(" ")}
    </span>
  );
}

interface FormProps {
  gameId: string;
  question: QuizQuestion;
  errors: ValidationError[];
  onChange: (patch: Partial<QuizQuestion> | ((q: QuizQuestion) => QuizQuestion)) => void;
  onPickImage: (file: File, slot?: Slot) => Promise<void>;
  onRemoveImage: (slot?: Slot) => void;
}

/** Где картинка: у вопроса (нет), в поле «Несколько картинок» (номер) или у уровня суперигры. */
type Slot = number | { level: number };

function slotImage(q: QuizQuestion, slot?: Slot): string | null {
  if (slot === undefined) return q.imageId;
  if (typeof slot === "number") return q.pictures?.[slot]?.imageId ?? null;
  return q.levels?.[slot.level]?.imageId ?? null;
}

function withSlotImage(q: QuizQuestion, slot: Slot | undefined, imageId: string | null): QuizQuestion {
  if (slot === undefined) return { ...q, imageId };
  if (typeof slot === "number") return { ...q, pictures: (q.pictures ?? []).map((p, i) => (i === slot ? { ...p, imageId } : p)) };
  return { ...q, levels: (q.levels ?? []).map((l, i) => (i === slot.level ? { ...l, imageId } : l)) };
}

function QuestionForm({ gameId, question: q, errors, onChange, onPickImage, onRemoveImage }: FormProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  // Поле числа: пока ведущий печатает — как набрал («1 6»), в игру уходит уже разобранное число.
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  // Удалили вариант, карточку или ответ — 7 секунд можно «Вернуть» (прежние строки и галочки целиком).
  const [restore, setRestore] = useState<{ text: string; snap: Pick<QuizQuestion, "options" | "answers" | "correct" | "alsoCorrect"> } | null>(null);
  const restoreTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(restoreTimer.current), []);
  function remember(text: string) {
    window.clearTimeout(restoreTimer.current);
    setRestore({ text, snap: { options: q.options, answers: q.answers, correct: q.correct, alsoCorrect: q.alsoCorrect } });
    restoreTimer.current = window.setTimeout(() => setRestore(null), 7000);
  }
  function undoRemove() {
    if (!restore) return;
    const snap = restore.snap;
    window.clearTimeout(restoreTimer.current);
    onChange((cur) => ({ ...cur, ...snap }));
    setRestore(null);
  }
  const removedBar = restore && (
    <div className="q-restore" role="status">
      <span>{restore.text}</span>
      <button type="button" className="btn btn--quiet q-restore__btn" onClick={undoRemove}>
        Вернуть
      </button>
    </div>
  );
  const has = (field: QuestionField) => errorsFor(errors, q.id, field).length > 0;
  const describedBy = (field: QuestionField) => (has(field) ? `q-${q.id}-${field}-error` : undefined);

  function setOption(i: number, value: string) {
    onChange((cur) => ({ ...cur, options: cur.options.map((o, j) => (j === i ? value : o)) }));
  }

  function removeOption(i: number) {
    onChange((cur) => {
      const options = cur.options.filter((_, j) => j !== i);
      // Верные варианты после удалённого сдвигаются на один вверх.
      const shifted = correctSet(cur)
        .filter((c) => c !== i)
        .map((c) => (c > i ? c - 1 : c));
      return { ...cur, options, correct: shifted[0] ?? -1, alsoCorrect: shifted.slice(1) };
    });
  }

  /** Enter в строке варианта: к следующей строке, в последней — новая строка (как в списке на бумаге). */
  function nextRow(event: KeyboardEvent<HTMLInputElement>, i: number, count: number, max: number, add: () => void, prefix: string) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (i < count - 1) {
      document.querySelector<HTMLInputElement>(`[data-row="${prefix}-${i + 1}"]`)?.focus();
      return;
    }
    if (count >= max) return;
    add();
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-row="${prefix}-${i + 1}"]`)?.focus());
  }
  function setAnswer(i: number, value: string) {
    onChange((cur) => ({ ...cur, answers: cur.answers.map((a, j) => (j === i ? value : a)) }));
  }

  function numberValue(raw: string): number {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  return (
    <div className="stack">
      {q.kind !== "super" && (
      <Fold title="Формат вопроса" value={KIND_TITLES[q.kind]} open={!q.text.trim()}>
      <fieldset>
        <legend className="visually-hidden">Формат вопроса</legend>
        <div className="format-tiles" role="radiogroup" aria-label="Формат вопроса">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={q.kind === kind}
              className={q.kind === kind ? "format-tile is-on" : "format-tile"}
              onClick={() => onChange((cur) => changeKind(cur, kind))}
            >
              <KindIcon kind={kind} />
              <span>{KIND_TITLES[kind]}</span>
            </button>
          ))}
        </div>
        <p className="muted small">{KIND_HINTS[q.kind]}</p>
      </fieldset>
      </Fold>
      )}

      {q.kind === "auction" && (
        <>
          <label className="field">
            Тема — видна до ставок
            <input maxLength={LIMITS.topic} value={q.topic ?? ""} placeholder="Например: «Кино 90-х»" onChange={(e) => onChange({ topic: e.target.value })} />
            <span className="muted small">Сам вопрос гости увидят только после ставок. Пусто — «Тема скрыта».</span>
          </label>
          <div className="field">
            <span>Как отвечает выигравший ставку</span>
            <div className="seg" role="group" aria-label="Как отвечает выигравший ставку">
              <button type="button" className={q.auctionAnswer !== "open" ? "seg__btn is-on" : "seg__btn"} aria-pressed={q.auctionAnswer !== "open"} onClick={() => onChange({ auctionAnswer: "choice" })}>
                Варианты
              </button>
              <button type="button" className={q.auctionAnswer === "open" ? "seg__btn is-on" : "seg__btn"} aria-pressed={q.auctionAnswer === "open"} onClick={() => onChange((cur) => ({ ...cur, auctionAnswer: "open", answers: cur.answers.length > 0 ? cur.answers : [""] }))}>
                Пишет ответ
              </button>
            </div>
          </div>
        </>
      )}

      <label className="field">
        {q.kind === "super" ? "Название на заставке" : q.kind === "auction" ? "Вопрос — после ставок" : "Вопрос"}
        <textarea
          id={`q-${q.id}-text`}
          rows={3}
          maxLength={LIMITS.text}
          value={q.text}
          aria-invalid={has("text")}
          aria-describedby={describedBy("text")}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        <FieldErrors errors={errors} field="text" questionId={q.id} />
      </label>

      {q.kind === "super" ? (
        <SuperEditor gameId={gameId} question={q} errors={errors} onChange={onChange} onPickImage={onPickImage} onRemoveImage={onRemoveImage} />
      ) : q.kind === "pictures" ? (
        <PicturesEditor gameId={gameId} question={q} errors={errors} onChange={onChange} onPickImage={onPickImage} onRemoveImage={onRemoveImage} />
      ) : null}

      {q.kind === "order" ? (
        <fieldset aria-describedby={describedBy("options")}>
          <legend>Карточки — в верном порядке</legend>
          <p className="muted small">
            Впишите сверху вниз так, как правильно. Гости увидят их вперемешку и расставят на телефоне. От {LIMITS.minOrder} до {LIMITS.maxOptions} карточек.
          </p>
          {q.options.map((option, i) => (
            <div key={i} className="q-row">
              <span className="q-row__num" aria-hidden="true">
                {i + 1}
              </span>
              <input
                className="q-row__input"
                aria-label={`Карточка ${i + 1}`}
                data-row={`${q.id}-card-${i}`}
                enterKeyHint={i < q.options.length - 1 ? "next" : "enter"}
                maxLength={LIMITS.option}
                value={option}
                onChange={(e) => setOption(i, e.target.value)}
                onKeyDown={(e) => nextRow(e, i, q.options.length, LIMITS.maxOptions, () => onChange((cur) => ({ ...cur, options: [...cur.options, ""] })), `${q.id}-card`)} />
              <button type="button" className="btn btn--quiet" aria-label={`Карточку ${i + 1} — выше`} disabled={i === 0} onClick={() => onChange((cur) => ({ ...cur, options: moveItem(cur.options, i, i - 1) }))}>
                ↑
              </button>
              <RemoveButton
                label={`Удалить карточку ${i + 1}`}
                disabled={q.options.length <= LIMITS.minOrder}
                onClick={() => {
                  remember(`Карточка ${i + 1}${option.trim() ? ` «${option.trim()}»` : ""} удалена`);
                  onChange((cur) => ({ ...cur, options: cur.options.filter((_, j) => j !== i) }));
                }}
              />
            </div>
          ))}
          {removedBar}
          <FieldErrors errors={errors} field="options" questionId={q.id} />
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={q.options.length >= LIMITS.maxOptions}
            onClick={() => onChange((cur) => ({ ...cur, options: [...cur.options, ""] }))}
          >
            Добавить карточку
          </button>
          <label className="choice">
            <input type="checkbox" checked={q.partial !== false} onChange={(e) => onChange({ partial: e.target.checked })} />
            <span className="choice__text">
              <span className="choice__title">Частично — очки за каждую карточку на своём месте</span>
              <span className="choice__hint">Выключите — очки только за весь порядок без ошибок.</span>
            </span>
          </label>
        </fieldset>
      ) : q.kind === "number" ? (
        <fieldset aria-describedby={describedBy("number")}>
          <legend>Верное число</legend>
          <div className="q-numbers">
            <label className="field">
              Число
              <input
                inputMode="decimal"
                value={numberDraft ?? (q.number === null || q.number === undefined ? "" : formatNumber(q.number))}
                aria-invalid={has("number")}
                placeholder="Например, 1 665"
                onChange={(e) => {
                  setNumberDraft(e.target.value);
                  onChange({ number: readNumber(e.target.value) });
                }}
                onBlur={() => setNumberDraft(null)}
              />
            </label>
            <label className="field">
              Единица (по желанию)
              <input maxLength={LIMITS.unit} value={q.unit ?? ""} placeholder="ступеней, км, лет" onChange={(e) => onChange({ unit: e.target.value })} />
            </label>
          </div>
          <FieldErrors errors={errors} field="number" questionId={q.id} />
          <div className="seg" role="group" aria-label="Как считать очки">
            <button type="button" className={q.scoring !== "closest" ? "seg__btn is-on" : "seg__btn"} aria-pressed={q.scoring !== "closest"} onClick={() => onChange({ scoring: "places" })}>
              По близости: 100 / 60 / 30%
            </button>
            <button type="button" className={q.scoring === "closest" ? "seg__btn is-on" : "seg__btn"} aria-pressed={q.scoring === "closest"} onClick={() => onChange({ scoring: "closest" })}>
              Только ближайший
            </button>
          </div>
          <p className="muted small">Одинаково близкие делят место. Точно в цель — ещё +50% очков.</p>
        </fieldset>
      ) : q.kind === "pictures" || q.kind === "super" ? null : usesAnswers(q) ? (
        <fieldset aria-describedby={describedBy("answers")}>
          <legend>{q.kind === "buzz" ? "Правильный ответ — видит только ведущий" : "Верные ответы"}</legend>
          <p className="muted small">
            {q.kind === "buzz"
              ? "Гость называет ответ вслух, ведущий сверяет и жмёт «Верно» или «Неверно»."
              : "Засчитывается любой из них. Регистр, ё/е, пробелы и знаки препинания не важны."}
          </p>
          {q.answers.map((answer, i) => (
            <div key={i} className="q-row">
              <input
                className="q-row__input"
                aria-label={`Верный ответ ${i + 1}`}
                data-row={`${q.id}-answer-${i}`}
                maxLength={LIMITS.answer}
                value={answer}
                onChange={(e) => setAnswer(i, e.target.value)}
                onKeyDown={(e) => nextRow(e, i, q.answers.length, LIMITS.answers, () => onChange((cur) => ({ ...cur, answers: [...cur.answers, ""] })), `${q.id}-answer`)}
              />
              <RemoveButton
                label={`Удалить ответ ${i + 1}`}
                disabled={q.answers.length <= 1}
                onClick={() => {
                  remember(`Ответ${answer.trim() ? ` «${answer.trim()}»` : ""} удалён`);
                  onChange((cur) => ({ ...cur, answers: cur.answers.filter((_, j) => j !== i) }));
                }}
              />
            </div>
          ))}
          {removedBar}
          <FieldErrors errors={errors} field="answers" questionId={q.id} />
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={q.answers.length >= LIMITS.answers}
            onClick={() => onChange((cur) => ({ ...cur, answers: [...cur.answers, ""] }))}
          >
            Добавить вариант написания
          </button>
        </fieldset>
      ) : (
        <fieldset aria-describedby={[describedBy("options"), describedBy("correct")].filter(Boolean).join(" ") || undefined}>
          <legend>Варианты ответа</legend>
          <p className="muted small">Отметьте галочкой правильный вариант — можно несколько, тогда засчитается любой. От 2 до 6 вариантов.</p>
          {q.options.map((option, i) => (
            <div key={i} className={correctSet(q).includes(i) ? "q-row q-row--correct" : "q-row"}>
              <input
                type="checkbox"
                className="check"
                checked={correctSet(q).includes(i)}
                aria-label={`Вариант ${LETTERS[i]} — правильный`}
                onChange={() => onChange((cur) => toggleCorrect(cur, i))}
              />
              <input
                className="q-row__input"
                aria-label={`Вариант ${LETTERS[i]}`}
                data-row={`${q.id}-option-${i}`}
                enterKeyHint={i < q.options.length - 1 ? "next" : "enter"}
                placeholder={`Вариант ${LETTERS[i]}`}
                maxLength={LIMITS.option}
                value={option}
                onChange={(e) => setOption(i, e.target.value)}
                onKeyDown={(e) => nextRow(e, i, q.options.length, LIMITS.maxOptions, () => onChange((cur) => ({ ...cur, options: [...cur.options, ""] })), `${q.id}-option`)}
              />
              <RemoveButton label={`Удалить вариант ${LETTERS[i]}`} disabled={q.options.length <= LIMITS.minOptions} onClick={() => {
                  remember(`Вариант ${LETTERS[i]}${option.trim() ? ` «${option.trim()}»` : ""} удалён${correctSet(q).includes(i) ? " (он был правильным)" : ""}`);
                  removeOption(i);
                }} />
            </div>
          ))}
          {removedBar}
          <FieldErrors errors={errors} field="options" questionId={q.id} />
          <FieldErrors errors={errors} field="correct" questionId={q.id} />
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={q.options.length >= LIMITS.maxOptions}
            onClick={() => onChange((cur) => ({ ...cur, options: [...cur.options, ""] }))}
          >
            Добавить вариант
          </button>
        </fieldset>
      )}


      {q.kind === "buzz" && (
        <div className="field">
          <span>За верный ответ — делений к финишу</span>
          <div className="seg" role="group" aria-label="Делений к финишу">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={(q.steps ?? 1) === n ? "seg__btn is-on" : "seg__btn"} aria-pressed={(q.steps ?? 1) === n} onClick={() => onChange({ steps: n })}>
                {n === 3 ? "3 · супер" : n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="q-numbers">
        {q.kind !== "buzz" && (
        <label className="field">
          Время, секунд
          <input
            type="number"
            inputMode="numeric"
            min={LIMITS.minTime}
            max={LIMITS.maxTime}
            step={5}
            value={q.timeLimit || ""}
            aria-invalid={has("timeLimit")}
            aria-describedby={describedBy("timeLimit")}
            onChange={(e) => onChange({ timeLimit: numberValue(e.target.value) })}
          />
          <FieldErrors errors={errors} field="timeLimit" questionId={q.id} />
        </label>
        )}
        {q.kind !== "super" && (
        <label className="field">
          {q.kind === "speed" ? "Очки, максимум" : q.kind === "pictures" ? "Очки за все картинки" : q.kind === "auction" ? "Ставка до — у кого очков меньше" : "Очки"}
          <input
            type="number"
            inputMode="numeric"
            min={LIMITS.minPoints}
            max={LIMITS.maxPoints}
            step={10}
            value={q.points || ""}
            aria-invalid={has("points")}
            aria-describedby={describedBy("points")}
            onChange={(e) => onChange({ points: numberValue(e.target.value) })}
          />
          <FieldErrors errors={errors} field="points" questionId={q.id} />
        </label>
        )}
      </div>
      {q.kind !== "buzz" && q.kind !== "super" && (
        <div className="q-quick" role="group" aria-label="Время одним касанием">
          <span className="q-quick__label">Время:</span>
          {[15, 20, 30, 45, 60, 90].map((t) => (
            <button key={t} type="button" className={q.timeLimit === t ? "q-quick__btn is-on" : "q-quick__btn"} aria-pressed={q.timeLimit === t} onClick={() => onChange({ timeLimit: t })}>
              {t} с
            </button>
          ))}
        </div>
      )}
      {q.kind !== "super" && (
        <div className="q-quick" role="group" aria-label="Очки одним касанием">
          <span className="q-quick__label">Очки:</span>
          {[50, 100, 200, 300, 500].map((p) => (
            <button key={p} type="button" className={q.points === p ? "q-quick__btn is-on" : "q-quick__btn"} aria-pressed={q.points === p} onClick={() => onChange({ points: p })}>
              {p}
            </button>
          ))}
        </div>
      )}
      {q.kind === "speed" && <p className="muted small">Самый быстрый верный ответ получает максимум, остальные — меньше.</p>}
      {q.kind === "pictures" && <p className="muted small">Очки делятся на картинки: угадал 3 из 4 — три четверти очков.</p>}
      {q.kind === "auction" && (
        <>
          <p className="muted small">Ставят до своего счёта; у кого очков меньше — до этого числа. Ставок не будет — вопрос для всех за эти очки.</p>
          <div className="q-quick" role="group" aria-label="Секунд на ставки">
            <span className="q-quick__label">Ставки:</span>
            {[15, 20, 30, 45, 60].map((t) => (
              <button key={t} type="button" className={(q.betTime ?? 30) === t ? "q-quick__btn is-on" : "q-quick__btn"} aria-pressed={(q.betTime ?? 30) === t} onClick={() => onChange({ betTime: t })}>
                {t} с
              </button>
            ))}
          </div>
        </>
      )}



      <label className="field">
        Заметка ведущему — видно только на пульте
        <textarea
          maxLength={LIMITS.note}
          rows={2}
          placeholder="Факт, шутка или подводка — видно только вам на пульте"
          value={q.note ?? ""}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </label>

      {q.kind !== "super" && q.kind !== "pictures" && (
        <Fold title="Картинка к вопросу" value={q.imageId ? "есть" : "нет"} open={Boolean(q.imageId)}>
      <div className="field">
        <span>Картинка</span>
        {q.imageId ? (
          <div className="q-image">
            <MediaImage className="q-image__img" gameId={gameId} mediaId={q.imageId} variant="full" alt="Картинка к вопросу" />
            <div className="actions">
              <button type="button" className="btn btn--secondary btn--block" disabled={processing} onClick={() => fileRef.current?.click()}>
                {processing ? "Сжимаем…" : "Заменить картинку"}
              </button>
              <button type="button" className="btn btn--quiet btn--block" disabled={processing} onClick={() => onRemoveImage()}>
                Убрать картинку
              </button>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button type="button" className="btn btn--secondary btn--block" disabled={processing} onClick={() => fileRef.current?.click()}>
              {processing ? "Сжимаем…" : "Добавить картинку"}
            </button>
          </div>
        )}
        <span className="muted small">Картинку покажет экран зала. Мы уменьшим её на этом устройстве, чтобы она быстро грузилась.</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setProcessing(true);
            // Сжатие идёт на устройстве; запись картинки уходит в очередь и дойдёт при связи.
            void onPickImage(file).finally(() => setProcessing(false));
          }}
        />
      </div>
        </Fold>
      )}
      {q.kind !== "super" && tracksRepo && (
        <Fold title={q.kind === "buzz" ? "Трек — что угадывают" : "Трек к вопросу"} value={q.trackId ? "выбран" : "нет"} open={q.kind === "buzz" || Boolean(q.trackId)}>
          <TrackTimeline clip={clipOf(q)} onChange={(clip) => onChange((cur) => withClip(cur, clip))} />
        </Fold>
      )}
      {tracksRepo && (
        <Fold title="🎵 Музыка на ответ" value={q.answerMusic ? "выбрана" : "нет"} open={Boolean(q.answerMusic)}>
          <p className="muted small">
            Отрывок играет на экране зала, когда вы показали верный ответ. Подходит к любому вопросу — с вариантами, картинкой, открытым ответом.
            {q.trackId ? " У вопроса есть трек — на ответе вместо его припева сыграет эта музыка." : ""}
          </p>
          <TrackTimeline answer clip={answerClipOf(q)} onChange={(clip) => onChange((cur) => withAnswerClip(cur, clip))} />
        </Fold>
      )}
    </div>
  );
}

function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn--quiet q-row__remove" aria-label={label} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </button>
  );
}

function QuestionReadOnly({ gameId, question: q }: { gameId: string; question: QuizQuestion }) {
  return (
    <div className="stack stack--tight">
      <p>{q.text}</p>
      {q.imageId && <MediaImage className="q-image__img" gameId={gameId} mediaId={q.imageId} variant="full" alt="Картинка к вопросу" />}
      {q.kind === "pictures" ? (
        <ol className="import-item__options">
          {(q.pictures ?? []).map((p, i) => (
            <li key={i}>{p.answers.join(" / ") || "—"}</li>
          ))}
        </ol>
      ) : usesAnswers(q) ? (
        <p className="muted">Верные ответы: {q.answers.join(" / ")}</p>
      ) : (
        <ul className="import-item__options">
          {q.options.map((o, i) => (
            <li key={i} className={correctSet(q).includes(i) ? "is-correct" : undefined}>
              {LETTERS[i]}. {o}
              {correctSet(q).includes(i) && <span className="visually-hidden"> (верный)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** «Добавить вопрос»: плитки форматов по блокам — классика, музыка, картинки. */
function AddQuestion({ onPick, onClose }: { onPick: (kind: QuestionKind) => void; onClose: () => void }) {
  return (
    <section className="card add-question" aria-label="Какой вопрос добавить">
      <div className="add-question__head">
        <h2>Добавить вопрос</h2>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {FORMAT_BLOCKS.map((block, i) => (
        <Fold key={block.id} title={block.title} value={`${QUESTION_FORMATS.filter((f) => f.block === block.id).length}`} open={i === 0}>
          <div className="format-tiles">
            {QUESTION_FORMATS.filter((f) => f.block === block.id).map((f) => (
              <button key={f.id} type="button" className={`format-tile format-tile--${block.id}`} onClick={() => onPick(f.kind)}>
                <KindIcon kind={f.kind} music={f.music} picture={f.id === "image"} />
                <span>{f.title}</span>
              </button>
            ))}
          </div>
        </Fold>
      ))}
      <div className="add-question__super">
        <button type="button" className="btn btn--secondary btn--block" onClick={() => onPick("super")}>
          👑 Суперигра — финал раунда
        </button>
        <p className="muted small">Отдельный финал в конце раунда: 4 уровня, у каждого — свой формат вопроса, картинка и музыка. Очки войдут в счёт раунда.</p>
      </div>
    </section>
  );
}

/** Несколько картинок: 2–4 поля, в каждом картинка и верные ответы к ней. */
function PicturesEditor({
  gameId,
  question: q,
  errors,
  onChange,
  onPickImage,
  onRemoveImage,
}: {
  gameId: string;
  question: QuizQuestion;
  errors: ValidationError[];
  onChange: FormProps["onChange"];
  onPickImage: FormProps["onPickImage"];
  onRemoveImage: FormProps["onRemoveImage"];
}) {
  const [processing, setProcessing] = useState<number | null>(null);
  const pics = q.pictures ?? [];
  const setAnswers = (slot: number, answers: string[]) =>
    onChange((cur) => ({ ...cur, pictures: (cur.pictures ?? []).map((p, i) => (i === slot ? { ...p, answers } : p)) }));
  return (
    <fieldset className="pictures-editor">
      <legend>Картинки и ответы</legend>
      <p className="muted small">От 2 до 4. Номер картинки гости увидят на экране и на телефоне.</p>
      {pics.map((p, i) => (
        <div key={i} className="pictures-editor__slot">
          <span className="pictures-editor__num">{i + 1}</span>
          <div className="stack stack--tight">
            {p.imageId ? (
              <MediaImage className="q-image__img" gameId={gameId} mediaId={p.imageId} variant="small" alt={`Картинка ${i + 1}`} />
            ) : (
              <span className="pictures-editor__empty">Нет картинки</span>
            )}
            <div className="actions actions--row">
              <label className="btn btn--secondary">
                {processing === i ? "Сжимаем…" : p.imageId ? "Заменить" : "Добавить картинку"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={processing !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setProcessing(i);
                    void onPickImage(file, i).finally(() => setProcessing(null));
                  }}
                />
              </label>
              {p.imageId && (
                <button type="button" className="btn btn--quiet" onClick={() => onRemoveImage(i)}>
                  Убрать
                </button>
              )}
            </div>
            {p.answers.map((a, j) => (
              <div key={j} className="q-row">
                <input
                  className="q-row__input"
                  aria-label={`Верный ответ к картинке ${i + 1}`}
                  placeholder="Верный ответ"
                  maxLength={QUIZ_LIMITS.answer}
                  value={a}
                  onChange={(e) => setAnswers(i, p.answers.map((x, k) => (k === j ? e.target.value : x)))}
                />
                <RemoveButton label="Удалить вариант написания" disabled={p.answers.length <= 1} onClick={() => setAnswers(i, p.answers.filter((_, k) => k !== j))} />
              </div>
            ))}
            <button type="button" className="btn btn--quiet" disabled={p.answers.length >= QUIZ_LIMITS.answers} onClick={() => setAnswers(i, [...p.answers, ""])}>
              + вариант написания
            </button>
            {pics.length > QUIZ_LIMITS.minPictures && (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  if (p.imageId) onRemoveImage(i);
                  onChange((cur) => ({ ...cur, pictures: (cur.pictures ?? []).filter((_, k) => k !== i) }));
                }}
              >
                Удалить картинку {i + 1}
              </button>
            )}
          </div>
        </div>
      ))}
      <FieldErrors errors={errors} field="pictures" questionId={q.id} />
      {pics.length < QUIZ_LIMITS.maxPictures && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => onChange((cur) => ({ ...cur, pictures: [...(cur.pictures ?? []), newPicture()] }))}>
          Добавить ещё картинку
        </button>
      )}
    </fieldset>
  );
}

/** Суперигра: оформление, правило ошибки и четыре уровня — очки, вопрос, картинка, верные ответы. */
function SuperEditor({
  gameId,
  question: q,
  errors,
  onChange,
  onPickImage,
  onRemoveImage,
}: {
  gameId: string;
  question: QuizQuestion;
  errors: ValidationError[];
  onChange: FormProps["onChange"];
  onPickImage: FormProps["onPickImage"];
  onRemoveImage: FormProps["onRemoveImage"];
}) {
  const [processing, setProcessing] = useState<number | null>(null);
  const levels = q.levels ?? newLevels();
  const style = parseStyle(q.superStyle);
  const penalty = parsePenalty(q.penalty);
  const pickMode = parsePickMode(q.superPick);
  const active = activeLevels(levels);
  const setLevel = (i: number, patch: Partial<SuperLevel>) =>
    onChange((cur) => ({ ...cur, levels: (cur.levels ?? newLevels()).map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  const toggleLevel = (i: number, on: boolean) =>
    onChange((cur) => ({
      ...cur,
      levels: (cur.levels ?? newLevels()).map((l, k) => {
        if (k !== i) return l;
        if (on) {
          const { off: _off, ...rest } = l;
          return rest;
        }
        return { ...l, off: true };
      }),
    }));
  return (
    <div className="stack super-editor">
      <div className="field">
        <span>Оформление</span>
        <div className="seg" role="group" aria-label="Оформление уровней">
          {(Object.keys(STYLE_TITLES) as SuperStyle[]).map((id) => (
            <button key={id} type="button" className={style === id ? "seg__btn is-on" : "seg__btn"} aria-pressed={style === id} onClick={() => onChange({ superStyle: id })}>
              {STYLE_TITLES[id]}
            </button>
          ))}
        </div>
      </div>
      <fieldset>
        <legend>Если ответ неверный</legend>
        <div className="stack stack--tight">
          {(Object.keys(PENALTY_TITLES) as SuperPenalty[]).map((id) => (
            <label key={id} className="choice">
              <input type="radio" name={`penalty-${q.id}`} checked={penalty === id} onChange={() => onChange({ penalty: id })} />
              <span className="choice__text">
                <span className="choice__title">{PENALTY_TITLES[id]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Голосование перед суперигрой</legend>
        <label className="choice">
          <input type="checkbox" checked={q.superVote === true} onChange={(e) => onChange({ superVote: e.target.checked })} />
          <span className="choice__text">
            <span className="choice__title">Играем, только если большинство «за»</span>
            <span className="choice__hint">Гости на телефонах жмут «Голосовать за» или «Против»: суперигра может стоить очков раунда. На экране — сколько за и против.</span>
          </span>
        </label>
      </fieldset>
      <fieldset>
        <legend>Как выбирают уровень</legend>
        <div className="stack stack--tight">
          {(Object.keys(PICK_MODE_TITLES) as SuperPickMode[]).map((id) => (
            <label key={id} className="choice">
              <input type="radio" name={`pick-${q.id}`} checked={pickMode === id} onChange={() => onChange({ superPick: id })} />
              <span className="choice__text">
                <span className="choice__title">{PICK_MODE_TITLES[id]}</span>
                <span className="choice__hint">
                  {id === "vote"
                    ? "Гости касаются уровня на телефонах, играем тот, за который больше голосов (поровну — жребий на экране). На экране — одна картинка и её вопрос, отвечают все."
                    : "Каждый капитан (или игрок) выбирает свой уровень и отвечает на его вопрос. На экране — все уровни сразу."}
                </span>
              </span>
            </label>
          ))}
        </div>
        {(q.superVote === true || pickMode === "vote") && (
          <label className="field">
            Время на голосование, секунд
            <input
              type="number"
              inputMode="numeric"
              min={VOTE_TIME.min}
              max={VOTE_TIME.max}
              step={5}
              value={q.voteTime ?? VOTE_TIME.def}
              onChange={(e) => onChange({ voteTime: Math.min(VOTE_TIME.max, Math.max(VOTE_TIME.min, Number.parseInt(e.target.value, 10) || VOTE_TIME.def)) })}
            />
          </label>
        )}
      </fieldset>
      <p className="muted small">Уровней в суперигре — от {SUPER_MIN_LEVELS} до 4: снимите галочку у уровня, которого не будет (например, только Бронза и Серебро).</p>
      {levels.map((l, i) => (
        <fieldset key={i} className={`super-editor__level super-level--${["bronze", "silver", "gold", "diamond"][i]}${l.off ? " is-off" : ""}`}>
          <legend className="super-editor__legend">
            <span className="super-editor__icon">
              <LevelIcon style={style} level={i} />
            </span>
            {LEVEL_NAMES[i]}
          </legend>
          <label className="choice super-editor__on">
            <input
              type="checkbox"
              checked={!l.off}
              disabled={!l.off && active.length <= SUPER_MIN_LEVELS}
              onChange={(e) => toggleLevel(i, e.target.checked)}
            />
            <span className="choice__text">
              <span className="choice__title">{l.off ? `«${LEVEL_NAMES[i]}» не играем` : `«${LEVEL_NAMES[i]}» есть в суперигре`}</span>
              {!l.off && active.length <= SUPER_MIN_LEVELS && <span className="choice__hint">Меньше {SUPER_MIN_LEVELS} уровней нельзя.</span>}
            </span>
          </label>
          {!l.off && (
          <>
          <label className="field">
            Очки за верный ответ
            <input
              type="number"
              inputMode="numeric"
              min={SUPER_LIMITS.minPoints}
              max={SUPER_LIMITS.maxPoints}
              step={50}
              value={l.points || ""}
              onChange={(e) => setLevel(i, { points: Number.parseInt(e.target.value, 10) || 0 })}
            />
            <span className="muted small">{penaltyFor(penalty, i, l.points) > 0 ? `Ошибка — минус ${penaltyFor(penalty, i, l.points)}` : "Ошибка без штрафа"}</span>
          </label>
          <div className="field">
            <span>Формат вопроса уровня</span>
            <div className="seg seg--wrap" role="group" aria-label={`Формат, ${LEVEL_NAMES[i]}`}>
              {SUPER_KINDS.map((k) => (
                <button key={k} type="button" className={levelKind(l) === k ? "seg__btn is-on" : "seg__btn"} aria-pressed={levelKind(l) === k} onClick={() => onChange((cur) => ({ ...cur, levels: (cur.levels ?? newLevels()).map((x, n) => (n === i ? withLevelKind(x, k) : x)) }))}>
                  {SUPER_KIND_TITLES[k]}
                </button>
              ))}
            </div>
            <span className="muted small">{SUPER_KIND_HINTS[levelKind(l)]}</span>
          </div>
          <label className="field">
            Вопрос уровня
            <textarea rows={2} maxLength={SUPER_LIMITS.text} value={l.text} onChange={(e) => setLevel(i, { text: e.target.value })} />
          </label>
          <SuperLevelAnswers level={l} index={i} setLevel={setLevel} />
          {l.imageId ? (
            <div className="stack stack--tight">
              <MediaImage className="q-image__img" gameId={gameId} mediaId={l.imageId} variant="small" alt={`Картинка уровня «${LEVEL_NAMES[i]}»`} />
              <button type="button" className="btn btn--quiet" onClick={() => onRemoveImage({ level: i })}>
                Убрать картинку
              </button>
            </div>
          ) : (
            <label className="btn btn--secondary">
              {processing === i ? "Сжимаем…" : "Добавить картинку"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={processing !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setProcessing(i);
                  void onPickImage(file, { level: i }).finally(() => setProcessing(null));
                }}
              />
            </label>
          )}
          {tracksRepo && (
            <Fold title="🎵 Трек уровня" value={l.trackId ? "выбран" : "нет"} open={Boolean(l.trackId)}>
              <p className="muted small">Музыку уровня ведущий включает на экране зала кнопкой «▶ Трек» на пульте, пока гости отвечают.</p>
              <TrackTimeline
                answer
                clip={parseClip({ trackId: l.trackId ?? null, trackStart: l.trackStart, trackLength: l.trackLength, fadeIn: l.fadeIn, fadeOut: l.fadeOut })}
                onChange={(clip) => setLevel(i, { trackId: clip.trackId, trackStart: clip.start, trackLength: clip.length, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut })}
              />
            </Fold>
          )}
          </>
          )}
        </fieldset>
      ))}
      <FieldErrors errors={errors} field="levels" questionId={q.id} />
      <p className="muted small">
        {pickMode === "vote"
          ? "Зал голосует за уровень на телефонах, играем один — его вопрос на экране и у всех капитанов. После «Показать ответы» — кто угадал и сколько очков."
          : "Капитаны выбирают уровень на телефоне, видят вопрос только своего уровня и отвечают в его формате. Экран зала показывает, кто какой уровень выбрал, а после «Показать ответы» — верно или нет и сколько очков."}
      </p>
    </div>
  );
}

/** Ответ уровня по его формату: верные ответы, варианты с отметкой верного, карточки по порядку или число. */
function SuperLevelAnswers({ level: l, index: i, setLevel }: { level: SuperLevel; index: number; setLevel: (i: number, patch: Partial<SuperLevel>) => void }) {
  const kind = levelKind(l);
  const options = l.options ?? [];
  if (kind === "choice" || kind === "order") {
    const correct = l.correct ?? [];
    const min = kind === "choice" ? SUPER_LIMITS.minOptions : SUPER_LIMITS.minOrder;
    return (
      <div className="stack stack--tight">
        <span className="small">{kind === "choice" ? "Варианты — коснитесь ✓ у верного" : "Карточки — сверху вниз в верном порядке"}</span>
        {options.map((o, j) => (
          <div key={j} className="q-row">
            {kind === "choice" ? (
              <button
                type="button"
                className={correct.includes(j) ? "q-row__mark is-on" : "q-row__mark"}
                aria-pressed={correct.includes(j)}
                aria-label={`Верный вариант ${j + 1}`}
                onClick={() => setLevel(i, { correct: correct.includes(j) ? correct.filter((c) => c !== j) : [...correct, j].sort((a, b) => a - b) })}
              >
                ✓
              </button>
            ) : (
              <span className="q-row__n">{j + 1}</span>
            )}
            <input
              className="q-row__input"
              aria-label={`${kind === "choice" ? "Вариант" : "Карточка"} ${j + 1}, ${LEVEL_NAMES[i]}`}
              maxLength={SUPER_LIMITS.answer}
              value={o}
              onChange={(e) => setLevel(i, { options: options.map((x, k) => (k === j ? e.target.value : x)) })}
            />
            <RemoveButton
              label="Удалить"
              disabled={options.length <= min}
              onClick={() =>
                setLevel(i, {
                  options: options.filter((_, k) => k !== j),
                  correct: correct.filter((c) => c !== j).map((c) => (c > j ? c - 1 : c)),
                })
              }
            />
          </div>
        ))}
        <button type="button" className="btn btn--quiet" disabled={options.length >= SUPER_LIMITS.maxOptions} onClick={() => setLevel(i, { options: [...options, ""] })}>
          + {kind === "choice" ? "вариант" : "карточка"}
        </button>
      </div>
    );
  }
  if (kind === "number") {
    return (
      <div className="q-row q-row--fields">
        <label className="field">
          Верное число
          <input
            inputMode="decimal"
            value={l.number === null || l.number === undefined ? "" : String(l.number)}
            onChange={(e) => {
              const raw = e.target.value.replace(/[\s\u00a0]/g, "").replace(",", ".");
              const n = Number(raw);
              setLevel(i, { number: raw === "" || !Number.isFinite(n) ? null : n });
            }}
          />
        </label>
        <label className="field">
          Единица
          <input maxLength={SUPER_LIMITS.unit} value={l.unit ?? ""} placeholder="м, год, шт." onChange={(e) => setLevel(i, { unit: e.target.value })} />
        </label>
        <label className="field">
          Засчитать ±
          <input type="number" inputMode="numeric" min={0} value={l.tolerance ?? 0} onChange={(e) => setLevel(i, { tolerance: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      </div>
    );
  }
  return (
    <div className="stack stack--tight">
      <span className="small">Верные ответы — подходит любой</span>
      {l.answers.map((a, j) => (
        <div key={j} className="q-row">
          <input
            className="q-row__input"
            aria-label={`Верный ответ, ${LEVEL_NAMES[i]}`}
            placeholder="Верный ответ"
            maxLength={SUPER_LIMITS.answer}
            value={a}
            onChange={(e) => setLevel(i, { answers: l.answers.map((x, k) => (k === j ? e.target.value : x)) })}
          />
          <RemoveButton label="Удалить вариант написания" disabled={l.answers.length <= 1} onClick={() => setLevel(i, { answers: l.answers.filter((_, k) => k !== j) })} />
        </div>
      ))}
      <button type="button" className="btn btn--quiet" disabled={l.answers.length >= SUPER_LIMITS.answers} onClick={() => setLevel(i, { answers: [...l.answers, ""] })}>
        + вариант написания
      </button>
    </div>
  );
}

function smoothScroll(): ScrollBehavior {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
