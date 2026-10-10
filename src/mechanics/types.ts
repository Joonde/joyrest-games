import type { ComponentType } from "react";
import type { Answer, Participant, Session, SessionChange, SessionState } from "../data/types";
import type { PreviewDriver } from "./preview";

export interface Step {
  id: string;
  /** Есть ли на шаге приём ответов. */
  answerable: boolean;
}

export interface ScoreDelta {
  pid: string;
  delta: number;
}

export interface ValidationError {
  /**
   * Где ошибка: `questions/<id вопроса>/<поле>` или `questions` для игры целиком.
   * Конструктор показывает подсказку рядом с этим местом.
   */
  path: string;
  /** Понятная подсказка: что исправить. */
  message: string;
}

export interface EditorProps<Content> {
  /** id игры: картинки хранятся в games/{gameId}/media. */
  gameId: string;
  /** Тема игры: в ней показывается предпросмотр. */
  themeId: string;
  content: Content;
  onChange: (content: Content) => void;
  /** false — игра из библиотеки JoyRest у ведущего: только просмотр. */
  editable: boolean;
}

export interface ViewProps<Content> {
  session: Session;
  content: Content;
}

/** Кто держит телефон: игрок (solo), капитан команды или участник команды (только смотрит). */
export type PhoneRole = "player" | "captain" | "member";

export interface PlayerViewProps<Content, AnswerValue> extends ViewProps<Content> {
  /** Телефон гостя. */
  participant: Participant;
  /** Кто получает очки: сам игрок или его команда. */
  pid: string;
  role: PhoneRole;
  /** Ответ на текущий шаг: null — ответа нет, undefined — ещё выясняем. */
  myAnswer: { value: unknown } | null | undefined;
  /** Ответ отправляется (нет связи — ждёт в очереди). */
  sending: boolean;
  onAnswer: (value: AnswerValue) => void;
  /**
   * Режим команд: свой ответ этого телефона (не за команду) на тот же шаг — один на шаг. Так капитан
   * просит подсказку, а участники голосуют («Помощь зала» в «Миллионере»). В режиме solo — нет.
   */
  personal?: PersonalAnswer;
}

export interface PersonalAnswer {
  /** Свой ответ на текущий шаг: null — нет, undefined — ещё выясняем. */
  value: { value: unknown } | null | undefined;
  sending: boolean;
  send: (value: unknown) => void;
}

/** Что нужно для подсчёта очков, кроме самих ответов. */
export interface ScoreContext {
  state: SessionState;
}

/** Моменты игры со встроенной музыкой (файлы — `BUILTIN_MUSIC` в `sound.ts`). */
/** `dragonLobby` и `dragonBattle` — один трек: громко в лобби, тихо фоном боя (громкость — `BUILTIN_VOLUME`). */
export type MusicMoment = "questionIntro" | "superPick" | "mafiaNight" | "dragonLobby" | "dragonBattle";

/**
 * Действия пульта. На настоящей сессии пишут в базу, в «Репетиции» — меняют сессию в памяти.
 */
export interface SessionControl {
  /** Шаг игры и правки таблицы лидеров одной записью. */
  apply(change: SessionChange): Promise<void>;
  /** Убрать ответы шага («Назад» с открытого вопроса). */
  clearAnswers(step: number): Promise<void>;
  /** Свежие ответы шага с сервера: перед подсчётом очков, чтобы не потерять пришедшие в последнюю секунду. */
  freshAnswers(step: number): Promise<Answer[]>;
  /** Спросить подтверждение и завершить игру. */
  requestFinish(): void;
}

export interface HostControlsProps<Content> extends ViewProps<Content> {
  /** Ответы на текущий шаг (их слушает только пульт). */
  answers: Answer[];
  /** Все участники: игроки, команды и телефоны команд. */
  participants: Participant[];
  control: SessionControl;
  /** Репетиция: гостей нет, ничего не записывается. */
  rehearsal: boolean;
}

/** Единый интерфейс механики (CLAUDE.md, раздел 6). Ядро знает только его. */
export interface Mechanic<Content, AnswerValue, S extends Step = Step> {
  id: string;
  title: string;
  supports: { solo: boolean; teams: boolean; noScreen: boolean };
  /** Содержимое новой игры. */
  create(): Content;
  /**
   * Сырое содержимое из базы (игра или снимок сессии) → формат механики.
   * Ничего не бросает: неизвестные и битые поля заменяются значениями по умолчанию.
   */
  parse(raw: unknown): Content;
  /** id картинок, на которые ссылается игра: копируются вместе с игрой. */
  mediaIds(content: Content): string[];
  Editor: ComponentType<EditorProps<Content>>;
  ScreenView: ComponentType<ViewProps<Content>>;
  PlayerView: ComponentType<PlayerViewProps<Content, AnswerValue>>;
  HostControls: ComponentType<HostControlsProps<Content>>;
  steps(content: Content): S[];
  score(step: S, answers: Answer[], context: ScoreContext): ScoreDelta[];
  validate(content: Content): ValidationError[];
  /** Пульт механики сам показывает кнопку «Таблица на экран» (общая карточка пульта не нужна). */
  ownPeek?: boolean;
  /** Встроенная музыка момента на экране зала (заставка вопроса, выбор в суперигре); null — нет. */
  music?: (session: Session, content: Content) => MusicMoment | null;
  /** Предпросмотр в конструкторе: игра проходит сама с тестовыми командами (`src/mechanics/preview.ts`). */
  preview?: { driver: PreviewDriver<Content>; teams?: number; limit?: number };
}

/**
 * Механика в реестре: ядро не знает формат содержимого, поэтому работает с `unknown`
 * и всегда сначала вызывает `parse`, а потом передаёт результат остальным методам.
 */
export type AnyMechanic = Mechanic<unknown, unknown, Step>;
