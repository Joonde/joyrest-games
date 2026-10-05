import type { ComponentType } from "react";
import type { Answer, Participant, Session } from "../data/types";

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

export interface PlayerViewProps<Content, AnswerValue> extends ViewProps<Content> {
  participant: Participant;
  canAnswer: boolean;
  onAnswer: (value: AnswerValue) => void;
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
  HostControls: ComponentType<ViewProps<Content>>;
  steps(content: Content): S[];
  score(step: S, answers: Answer[]): ScoreDelta[];
  validate(content: Content): ValidationError[];
}

/**
 * Механика в реестре: ядро не знает формат содержимого, поэтому работает с `unknown`
 * и всегда сначала вызывает `parse`, а потом передаёт результат остальным методам.
 */
export type AnyMechanic = Mechanic<unknown, unknown, Step>;
