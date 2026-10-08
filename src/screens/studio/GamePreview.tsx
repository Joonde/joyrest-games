import { useMemo, useState } from "react";
import { BoardView } from "../../components/live/BoardView";
import { Podium, PodiumPhone } from "../../components/live/Podium";
import { Scene } from "../../components/live/Scene";
import { Sheet } from "../../components/Sheet";
import { Tabs } from "../../components/Tabs";
import type { PlayMode } from "../../data";
import { runPreview } from "../../mechanics/preview";
import type { AnyMechanic } from "../../mechanics/types";
import { getTheme, themeStyle } from "../../themes/registry";

type View = "screen" | "phone";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "screen", label: "Экран зала" },
  { id: "phone", label: "Телефон" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  mechanic: AnyMechanic;
  content: unknown;
  playMode: PlayMode;
  themeId: string;
}

/**
 * Предпросмотр игры: она проходит сама с тестовыми командами, ведущий листает моменты «Назад / Дальше»
 * и смотрит, что в этот момент на экране зала и на телефоне любой команды.
 */
export function GamePreview({ open, onClose, mechanic, content, playMode, themeId }: Props) {
  const [view, setView] = useState<View>("screen");
  const [index, setIndex] = useState(0);
  const [phoneAt, setPhoneAt] = useState(0);
  const run = useMemo(() => {
    if (!open || !mechanic.preview) return null;
    const parsed = mechanic.parse(content);
    const { driver, teams = 3, limit = 50 } = mechanic.preview;
    return { parsed, ...runPreview({ mechanic: mechanic.id, content: parsed, playMode, themeId, driver, teams, limit }) };
  }, [open, mechanic, content, playMode, themeId]);
  if (!run) return null;
  const { scenes, phones, parsed } = run;
  const at = Math.min(index, scenes.length - 1);
  const scene = scenes[at];
  const phone = phones[Math.min(phoneAt, phones.length - 1)];
  if (!scene || !phone) return null;
  const { session } = scene;
  const finished = session.state.phase === "finished";
  const podium = session.state.stage === "podium";
  const mine = scene.answers.find((a) => a.step === session.state.step && a.pid === phone.pid && (a.submittedAt ?? 0) >= (session.state.startedAt ?? 0));
  const { ScreenView, PlayerView } = mechanic;

  return (
    <Sheet
      open={open}
      title={`Предпросмотр: момент ${at + 1} из ${scenes.length}`}
      onClose={onClose}
      footer={
        <div className="stack stack--tight">
          <input
            type="range"
            className="game-preview__range"
            min={0}
            max={scenes.length - 1}
            value={at}
            aria-label="Момент игры"
            onChange={(e) => setIndex(Number(e.target.value))}
          />
          <div className="preview-nav">
            <button type="button" className="btn btn--secondary" disabled={at === 0} onClick={() => setIndex(at - 1)}>
              Назад
            </button>
            <button type="button" className="btn btn--secondary" disabled={at >= scenes.length - 1} onClick={() => setIndex(at + 1)}>
              Дальше
            </button>
          </div>
        </div>
      }
    >
      <p className="game-preview__label" aria-live="polite">
        {scene.label}
      </p>
      <Tabs items={VIEWS} value={view} onChange={setView} label="Что показать" idPrefix="game-preview" />
      <div role="tabpanel" id={`game-preview-panel-${view}`} aria-labelledby={`game-preview-tab-${view}`} className="stack">
        {view === "screen" ? (
          <div className="preview-screen" style={themeStyle(themeId)} data-shine={getTheme(themeId).effects?.shine ? "on" : undefined}>
            <Scene themeId={themeId} />
            {finished ? (
              <div className="quiz-screen quiz-screen--board">
                <BoardView leaderboard={session.leaderboard} title="Игра завершена" />
              </div>
            ) : podium ? (
              <Podium session={session} />
            ) : (
              <ScreenView session={session} content={parsed} />
            )}
          </div>
        ) : (
          <>
            {phones.length > 1 && (
              <div className="seg" role="group" aria-label="Чей телефон">
                {phones.map((p, i) => (
                  <button key={p.pid} type="button" className={i === phoneAt ? "seg__btn is-on" : "seg__btn"} aria-pressed={i === phoneAt} onClick={() => setPhoneAt(i)}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            <div className="preview-phone" style={themeStyle(themeId)}>
              {finished ? (
                <p className="muted">Игра окончена — гости видят своё место и итоги.</p>
              ) : podium ? (
                <PodiumPhone session={session} pid={phone.pid} />
              ) : (
                <PlayerView
                  key={`${session.state.step}-${phone.pid}`}
                  session={session}
                  content={parsed}
                  participant={phone.participant}
                  pid={phone.pid}
                  role={playMode === "teams" ? "captain" : "player"}
                  myAnswer={mine ? { value: mine.value } : null}
                  sending={false}
                  onAnswer={() => undefined}
                />
              )}
            </div>
          </>
        )}
        <p className="muted small">
          Игра идёт сама: команды «{phones.map((p) => p.name).join("», «")}» тестовые, их ответы придуманы. В настоящей игре так же — только отвечают гости, а кнопки
          нажимаете вы.
        </p>
      </div>
    </Sheet>
  );
}
