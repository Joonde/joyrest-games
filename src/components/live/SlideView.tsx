import { useEffect, useRef } from "react";
import { countdownLabel } from "../../core/slides";
import type { SlideState } from "../../data";
import { Logo } from "../Logo";
import { QrCode } from "../QrCode";
import { formatSessionCode } from "../../core/code";
import { VPN_HINT } from "../../core/texts";
import { joinHint, playUrl } from "../links";
import { playSound } from "./sound";
import { useServerNow } from "./useServerNow";

const SOUNDS: Partial<Record<SlideState["kind"], Parameters<typeof playSound>[0]>> = {
  intro: "whoosh",
  round: "whoosh",
  award: "fanfare",
  thanks: "applause",
};

/** Канал JoyRest для слайда «Спасибо». */
const CHANNEL = "https://t.me/JoyRest";

/**
 * Слайд поверх экрана зала (CLAUDE.md, раздел 7, «Слайды»): шаблон в стиле темы на её живом фоне.
 * Размеры — в единицах контейнера, как у вопросов: предпросмотр совпадает с телевизором.
 */
export function SlideView({ slide, preview = false, code }: { slide: SlideState; preview?: boolean; code?: string }) {
  const now = useServerNow(500, slide.kind === "break" && slide.endsAt !== null);
  const last = useRef(slide.id);

  useEffect(() => {
    // Звук — при новом показе, не при перезагрузке экрана и не в предпросмотре.
    if (preview || last.current === slide.id) return;
    last.current = slide.id;
    const sound = SOUNDS[slide.kind];
    if (sound) playSound(sound);
  }, [slide.id, slide.kind, preview]);

  const timer = slide.kind === "break" ? countdownLabel(slide, now) : null;

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
      {slide.kind === "thanks" && (
        <div className="slide__channel">
          <QrCode value={CHANNEL} label="QR-код канала JoyRest в Telegram" className="slide__qr" />
          <p className="slide__text">Фото и новые игры — в канале t.me/JoyRest</p>
        </div>
      )}
      {slide.kind !== "intro" && <Logo kind="monogram" className="slide__mark" title="" />}
    </div>
  );
}
