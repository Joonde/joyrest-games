import { useEffect, useRef, useState } from "react";
import { decksRepo, type SessionBranding, type SlideMedia } from "../../data";
import { ClientLogo } from "../ClientLogo";
import { drawCaptionsOf, drawEffectOf, drawFrame, drawNames, drawPool, reelFrame, wheelFrame } from "../../core/draw";
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
export function SlideView({
  slide,
  preview = false,
  code,
  sessionId,
  branding,
}: {
  slide: SlideState;
  preview?: boolean;
  code?: string;
  sessionId?: string;
  /** Оформление под заказчика: логотип над слайдом. */
  branding?: SessionBranding | null;
}) {
  if (slide.kind === "draw") return <DrawSlide slide={slide} preview={preview} />;
  if (slide.kind === "image" && slide.media) return <ImageSlide media={slide.media} title={slide.title} />;
  return <TemplateSlide slide={slide} preview={preview} code={code} sessionId={sessionId} branding={branding ?? null} />;
}

/** Фото или страница PDF на весь экран; следующую страницу экран загружает заранее (листание без паузы). */
function ImageSlide({ media, title }: { media: SlideMedia; title: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!media.next || !decksRepo) return;
    const img = new Image();
    img.decoding = "async";
    img.src = decksRepo.pageUrl(media.next);
  }, [media.next]);
  if (!decksRepo) return null;
  return (
    <div className="slide slide--image">
      {failed === media.sha ? (
        <p className="slide__text">Не загрузилась страница {media.page + 1}. Проверьте интернет — или покажите следующую.</p>
      ) : (
        <img
          key={media.sha}
          className="slide__image"
          src={decksRepo.pageUrl(media.sha)}
          width={media.w}
          height={media.h}
          alt={title ? `${title}, страница ${media.page + 1}` : `Страница ${media.page + 1}`}
          onError={() => setFailed(media.sha)}
        />
      )}
    </div>
  );
}

/**
 * Жеребьёвка: монетка переворачивается, на каждой стороне — следующее имя, всё медленнее; останавливается
 * на победителе — «Первым ходит», фанфары и конфетти. Экран открыли позже — сразу итог.
 */
function DrawSlide({ slide, preview }: { slide: SlideState; preview: boolean }) {
  const names = drawNames(slide);
  const caps = drawCaptionsOf(slide);
  const pool = drawPool(slide);
  const effect = drawEffectOf(slide);
  const win = Math.max(0, pool.indexOf(slide.title));
  const endsAt = slide.endsAt ?? 0;
  const now = useServerNow(effect === "coin" ? 50 : 33, !preview);
  const left = preview ? 0 : endsAt - now;
  const coin = drawFrame(names, left);
  const wheel = wheelFrame(pool.length, win, left);
  const reel = reelFrame(pool.length, win, left);
  // Смена имени под стрелкой / в окне — щелчок (как у монетки).
  const tickKey = effect === "coin" ? coin.flips : effect === "wheel" ? Math.floor(wheel.angle / (360 / Math.max(1, pool.length))) : Math.floor(reel.pos);
  const done = left <= 0;
  // «Уменьшить движение»: колесо не крутится — стоит, а подсвечивается сектор, на котором сейчас жребий.
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const sawSpin = useRef(!done);
  const lastTick = useRef(tickKey);
  useEffect(() => {
    if (preview || !sawSpin.current) return;
    if (tickKey !== lastTick.current && !done) playSound("tick");
    lastTick.current = tickKey;
  }, [tickKey, done, preview]);
  useEffect(() => {
    if (done && sawSpin.current && !preview) playSound("fanfare");
  }, [done, preview]);
  return (
    <div className={`slide slide--draw slide--draw-${effect}${done ? " is-done" : ""}`}>
      {done && sawSpin.current && <Confetti burst={`draw:${slide.id}`} count={90} />}
      <p className="slide__eyebrow">{done ? caps.doneEyebrow : caps.spinEyebrow}</p>
      {effect === "coin" && (
        <div className="draw-coin" aria-hidden={!done}>
          <div key={coin.flips} className={`draw-coin__face${done ? " is-final" : ""}`}>
            <span className="draw-coin__name">{names[coin.index] ?? slide.title}</span>
          </div>
        </div>
      )}
      {effect === "wheel" && <DrawWheel pool={pool} angle={done ? wheelFrame(pool.length, win, 0).angle : still ? 0 : wheel.angle} active={done ? win : wheel.index} done={done} still={still} />}
      {effect === "reel" && <DrawReel pool={pool} pos={done ? reelFrame(pool.length, win, 0).pos : reel.pos} done={done} />}
      {done ? <h2 className="slide__title draw-winner">{slide.title}</h2> : <p className="slide__text">{caps.spinText}</p>}
      {done && caps.doneText.trim() && <p className="slide__text">{caps.doneText}</p>}
      {effect !== "wheel" && pool.length > 1 && pool.length <= 8 && (
        <ul className="draw-pool" aria-label="Между кем жребий">
          {pool.map((n) => (
            <li key={n} className={`draw-pool__name${done ? (n === slide.title ? " is-win" : " is-out") : ""}`}>
              {n}
            </li>
          ))}
        </ul>
      )}
      <Logo kind="monogram" className="slide__mark" title="" />
    </div>
  );
}

/** Цвета секторов колеса — пастель команд, текст тёмный. */
const WHEEL_COLORS = ["#E3AA9C", "#E3C68C", "#A3C2AA", "#D2A0AC", "#B3AADD", "#F0D9B5"];

/** Колесо фортуны: секторы с именами, стрелка сверху; колесо поворачивается на `angle`. */
function DrawWheel({ pool, angle, active, done, still }: { pool: string[]; angle: number; active: number; done: boolean; still: boolean }) {
  const n = Math.max(1, pool.length);
  const seg = 360 / n;
  const r = 100;
  const point = (deg: number, rad = r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(rad * Math.cos(a)).toFixed(2)} ${(rad * Math.sin(a)).toFixed(2)}`;
  };
  const short = (s: string) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);
  const font = n <= 4 ? 13 : n <= 8 ? 11 : 9;
  return (
    <div className={`draw-wheel${done ? " is-done" : ""}`} aria-hidden={!done}>
      <svg className="draw-wheel__svg" viewBox="-112 -118 224 230" role="img">
        <g transform={`rotate(${angle.toFixed(2)})`} className="draw-wheel__disk">
          {pool.map((name, i) => {
            const from = i * seg;
            const to = (i + 1) * seg;
            const mid = from + seg / 2;
            const d = n === 1 ? `M ${point(0)} A ${r} ${r} 0 1 1 ${point(359.99)} Z` : `M 0 0 L ${point(from)} A ${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${point(to)} Z`;
            return (
              <g key={`${name}-${i}`} className={(done || still) && i === active ? "draw-wheel__seg is-win" : done || still ? "draw-wheel__seg is-out" : "draw-wheel__seg"}>
                <path d={d} fill={WHEEL_COLORS[i % WHEEL_COLORS.length]} stroke="#221E1B" strokeWidth="1.2" />
                <text transform={`rotate(${mid}) translate(0 ${-r * 0.6}) rotate(${mid > 90 && mid < 270 ? 180 : 0})`} textAnchor="middle" dominantBaseline="middle" fontSize={font} fontWeight="700" fill="#221E1B">
                  {short(name)}
                </text>
              </g>
            );
          })}
          <circle r="104" fill="none" stroke="#E3C68C" strokeWidth="5" />
          {pool.map((_, i) => (
            <circle key={i} cx={point(i * seg, 104).split(" ")[0]} cy={point(i * seg, 104).split(" ")[1]} r="2.6" fill="#FBF6F1" />
          ))}
        </g>
        <circle r="14" fill="#221E1B" stroke="#E3C68C" strokeWidth="3" />
        <path d="M -9 -116 L 9 -116 L 0 -97 Z" fill="#FBF6F1" stroke="#221E1B" strokeWidth="1.5" className="draw-wheel__pointer" />
      </svg>
      <p className="draw-wheel__now">{pool[active] ?? ""}</p>
    </div>
  );
}

/** Барабан: имена бегут вертикальной лентой, в окне — текущее; к концу останавливается на победителе. */
function DrawReel({ pool, pos, done }: { pool: string[]; pos: number; done: boolean }) {
  const n = Math.max(1, pool.length);
  const base = Math.floor(pos);
  const frac = pos - base;
  // В окне видно 3 строки: прошлая, текущая, следующая; лента рисуется вокруг текущей позиции.
  const rows = [-2, -1, 0, 1, 2].map((k) => ({ k, name: pool[(((base + k) % n) + n) % n] ?? "" }));
  return (
    <div className={`draw-reel${done ? " is-done" : ""}`} aria-hidden={!done}>
      <div className="draw-reel__window">
        <div className="draw-reel__strip" style={{ transform: `translateY(calc(${(-1 - frac).toFixed(3)} * var(--reel-row)))` }}>
          {rows.map((row) => (
            <div key={base + row.k} className={`draw-reel__row${row.k === 0 && frac < 0.5 ? " is-now" : row.k === 1 && frac >= 0.5 ? " is-now" : ""}`}>
              {row.name}
            </div>
          ))}
        </div>
        <span className="draw-reel__mark draw-reel__mark--l" />
        <span className="draw-reel__mark draw-reel__mark--r" />
      </div>
    </div>
  );
}

function TemplateSlide({ slide, preview, code, sessionId, branding }: { slide: SlideState; preview: boolean; code?: string; sessionId?: string; branding: SessionBranding | null }) {
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
      {/* Заставка вечера с логотипом заказчика: его логотип вместо эмблемы JoyRest (знак JoyRest — в углу экрана). */}
      {slide.kind === "intro" && (branding?.logo ? <ClientLogo branding={branding} className="client-logo--intro" /> : <Logo kind="emblem" className="slide__emblem" title="" />)}
      {slide.kind !== "intro" && slide.kind !== "join" && <ClientLogo branding={branding} className="client-logo--slide" />}
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
