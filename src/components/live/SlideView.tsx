import { useEffect, useRef } from "react";
import { drawFrame, drawNames } from "../../core/draw";
import { countdownLabel } from "../../core/slides";
import type { SlideState } from "../../data";
import { Logo } from "../Logo";
import { QrCode } from "../QrCode";
import { formatSessionCode } from "../../core/code";
import { VPN_HINT } from "../../core/texts";
import { joinHint, playUrl } from "../links";
import { Confetti } from "./Confetti";
import { FinaleQrs } from "./Finale";
import { playSound } from "./sound";
import { useServerNow } from "./useServerNow";

const SOUNDS: Partial<Record<SlideState["kind"], Parameters<typeof playSound>[0]>> = {
  intro: "whoosh",
  round: "whoosh",
  award: "fanfare",
  thanks: "applause",
};

/**
 * Слайд поверх экрана зала (CLAUDE.md, раздел 7, «Слайды»): шаблон в стиле темы на её живом фоне.
 * Размеры — в единицах контейнера, как у вопросов: предпросмотр совпадает с телевизором.
 */
export function SlideView({ slide, preview = false, code, sessionId }: { slide: SlideState; preview?: boolean; code?: string; sessionId?: string }) {
  if (slide.kind === "draw") return <DrawSlide slide={slide} preview={preview} />;
  return <TemplateSlide slide={slide} preview={preview} code={code} sessionId={sessionId} />;
}

/**
 * Жеребьёвка: монетка переворачивается, на каждой стороне — следующее имя, всё медленнее; останавливается
 * на победителе — «Первым ходит», фанфары и конфетти. Экран открыли позже — сразу итог.
 */
function DrawSlide({ slide, preview }: { slide: SlideState; preview: boolean }) {
  const names = drawNames(slide);
  const endsAt = slide.endsAt ?? 0;
  const now = useServerNow(50, !preview);
  const left = preview ? 0 : endsAt - now;
  const { index, flips } = drawFrame(names, left);
  const done = left <= 0;
  const sawSpin = useRef(!done);
  const lastFlip = useRef(flips);
  useEffect(() => {
    if (preview || !sawSpin.current) return;
    if (flips !== lastFlip.current && !done) playSound("tick");
    lastFlip.current = flips;
  }, [flips, done, preview]);
  useEffect(() => {
    if (done && sawSpin.current && !preview) playSound("fanfare");
  }, [done, preview]);
  return (
    <div className={`slide slide--draw${done ? " is-done" : ""}`}>
      {done && sawSpin.current && <Confetti burst={`draw:${slide.id}`} count={90} />}
      <p className="slide__eyebrow">{done ? "Первым ходит" : "Жеребьёвка"}</p>
      <div className="draw-coin" aria-hidden={!done}>
        <div key={flips} className={`draw-coin__face${done ? " is-final" : ""}`}>
          <span className="draw-coin__name">{names[index] ?? slide.title}</span>
        </div>
      </div>
      {done ? <h2 className="slide__title draw-winner">{slide.title}</h2> : <p className="slide__text">Монетка решит, кто начинает</p>}
      <Logo kind="monogram" className="slide__mark" title="" />
    </div>
  );
}

function TemplateSlide({ slide, preview, code, sessionId }: { slide: SlideState; preview: boolean; code?: string; sessionId?: string }) {
  const now = useServerNow(500, (slide.kind === "break" || slide.kind === "tech") && slide.endsAt !== null);
  const last = useRef(slide.id);

  useEffect(() => {
    // Звук — при новом показе, не при перезагрузке экрана и не в предпросмотре.
    if (preview || last.current === slide.id) return;
    last.current = slide.id;
    const sound = SOUNDS[slide.kind];
    if (sound) playSound(sound);
  }, [slide.id, slide.kind, preview]);

  const timer = slide.kind === "break" || slide.kind === "tech" ? countdownLabel(slide, now) : null;

  return (
    <div className={`slide slide--${slide.kind}`}>
      {slide.kind === "intro" && <Logo kind="emblem" className="slide__emblem" title="" />}
      {slide.kind === "round" && <p className="slide__eyebrow">Следующий раунд</p>}
      {slide.kind === "tech" && <p className="slide__eyebrow">Пауза</p>}
      {slide.title && <h2 className="slide__title">{slide.title}</h2>}
      {slide.kind === "rules" && slide.lines.length > 0 && (
        <ol className="slide__rules">
          {slide.lines.map((line, i) => (
            <li key={i}>
              <span className="slide__num">{i + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      )}
      {timer && (
        <p className="slide__timer" role="timer">
          {timer}
        </p>
      )}
      {slide.text && <p className="slide__text">{slide.text}</p>}
      {slide.kind === "join" && code && (
        <div className="slide__join">
          <QrCode value={playUrl(code)} label={`QR-код для входа в игру ${formatSessionCode(code)}`} className="slide__qr slide__qr--join" />
          <div className="slide__join-text">
            <p className="slide__text">Наведите камеру на QR-код или откройте {joinHint()}</p>
            <div className="big-code">{formatSessionCode(code)}</div>
            <p className="slide__text slide__text--small">{VPN_HINT}</p>
          </div>
        </div>
      )}
      {slide.kind === "thanks" && <FinaleQrs sessionId={preview ? null : sessionId} />}
      {slide.kind !== "intro" && <Logo kind="monogram" className="slide__mark" title="" />}
    </div>
  );
}
