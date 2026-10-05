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
  path: string;
  message: string;
}

export interface EditorProps<Content> {
  content: Content;
  onChange: (content: Content) => void;
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
export interface Mechanic<Content, AnswerValue> {
  id: string;
  title: string;
  supports: { solo: boolean; teams: boolean; noScreen: boolean };
  Editor: ComponentType<EditorProps<Content>>;
  ScreenView: ComponentType<ViewProps<Content>>;
  PlayerView: ComponentType<PlayerViewProps<Content, AnswerValue>>;
  HostControls: ComponentType<ViewProps<Content>>;
  steps(content: Content): Step[];
  score(step: Step, answers: Answer[]): ScoreDelta[];
  validate(content: Content): ValidationError[];
}
