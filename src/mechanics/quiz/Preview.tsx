import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import { Tabs } from "../../components/Tabs";
import type { Participant, ScreenMode, Session } from "../../data/types";
import { startState } from "../../core/session";
import { themeStyle } from "../../themes/registry";
import type { QuizContent } from "./content";
import { QuizPlayerView, QuizScreenView } from "./views";

type View = "screen" | "phone";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "screen", label: "Экран зала" },
  { id: "phone", label: "Телефон гостя" },
];

const GUEST: Participant = { id: "preview", name: "Гость", kind: "player", teamId: null, captainUid: "preview" };

/** Ненастоящая сессия: виды механики показывают вопрос так же, как в игре. */
function previewSession(gameId: string, themeId: string, step: number, revealed: boolean, screenMode: ScreenMode): Session {
  return {
    id: "preview",
    code: "000000",
    hostId: "",
    gameId,
    gameTitle: "",
    mechanic: "quiz",
    gameSnapshot: null,
    themeId,
    playMode: "solo",
    screenMode,
    state: { ...startState(), step, revealed, stage: revealed ? "reveal" : "question" },
    leaderboard: {},
    createdAt: null,
  };
}

interface Props {
  gameId: string;
  themeId: string;
  content: QuizContent;
  /** Номер вопроса или null — окно закрыто. */
  index: number | null;
  onIndex: (index: number | null) => void;
}

export function QuizPreview({ gameId, themeId, content, index, onIndex }: Props) {
  const [view, setView] = useState<View>("screen");
  const [revealed, setRevealed] = useState(false);
  const [noScreen, setNoScreen] = useState(false);
  // Ответ в предпросмотре: можно нажать вариант и посмотреть «Ответ принят» и «Верно».
  const [answer, setAnswer] = useState<{ step: number; value: unknown } | null>(null);
  const step = index ?? 0;
  const total = content.questions.length;
  const session = previewSession(gameId, themeId, step, revealed, noScreen ? "none" : "laptop");
  const question = content.questions[step];

  return (
    <Sheet
      open={index !== null && question !== undefined}
      title={`Предпросмотр: вопрос ${step + 1}`}
      onClose={() => onIndex(null)}
      footer={
        <div className="preview-nav">
          <button type="button" className="btn btn--secondary" disabled={step === 0} onClick={() => onIndex(step - 1)}>
            Предыдущий
          </button>
          <button type="button" className="btn btn--secondary" disabled={step >= total - 1} onClick={() => onIndex(step + 1)}>
            Следующий
          </button>
        </div>
      }
    >
      <Tabs items={VIEWS} value={view} onChange={setView} label="Что показать" idPrefix="preview" />
      <div role="tabpanel" id={`preview-panel-${view}`} aria-labelledby={`preview-tab-${view}`} className="stack">
        {view === "screen" ? (
          <div className="preview-screen" style={themeStyle(themeId)}>
            <QuizScreenView key={question?.id} session={session} content={content} />
          </div>
        ) : (
          <div className="preview-phone" style={themeStyle(themeId)}>
            <QuizPlayerView
              key={`${question?.id}-${revealed}`}
              session={session}
              content={content}
              participant={GUEST}
              pid={GUEST.id}
              role="player"
              myAnswer={answer?.step === step ? { value: answer.value } : null}
              sending={false}
              onAnswer={(value) => setAnswer({ step, value })}
            />
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn btn--secondary btn--block" aria-pressed={revealed} onClick={() => setRevealed((v) => !v)}>
            {revealed ? "Скрыть правильный ответ" : "Показать правильный ответ"}
          </button>
          {view === "phone" && (
            <button type="button" className="btn btn--quiet btn--block" aria-pressed={noScreen} onClick={() => setNoScreen((v) => !v)}>
              {noScreen ? "Как с экраном зала" : "Как в режиме «без экрана»"}
            </button>
          )}
        </div>
        <p className="muted small">
          {view === "screen"
            ? "Так вопрос увидят гости на экране зала. Таймер и ответы появятся в игре."
            : noScreen
              ? "Без экрана зала гости видят вопрос и уменьшенную картинку прямо на телефоне."
              : "С экраном зала на телефоне только кнопки ответа: вопрос и картинка — на экране."}
        </p>
      </div>
    </Sheet>
  );
}
