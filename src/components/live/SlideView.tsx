import { useEffect, useId, useRef, useState } from "react";
import { HallTimer, useCountdownTotal } from "./HallTimer";
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
        <div className={`draw-coin${done ? " is-done" : ""}`} aria-hidden={!done}>
          <div className="draw-coin__rays" />
          <div className="draw-coin__toss">
            <div key={coin.flips} className={`draw-coin__face${done ? " is-final" : ""}`}>
              <span className="draw-coin__star">✦</span>
              <span className="draw-coin__name">{names[coin.index] ?? slide.title}</span>
              <span className="draw-coin__star">✦</span>
            </div>
          </div>
          <div className="draw-coin__shadow" />
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

/** Секторы колеса — глубокие «драгоценные» тона, надписи кремовые (контраст ≥ 7). */
const WHEEL_COLORS = ["#7A2E3B", "#1F5E4F", "#2B3A67", "#8C5A1C", "#5B2C5E", "#1E5A66"];
const WHEEL_BULBS = 24;

/** Колесо фортуны: золотой обод с лампочками, секторы с именами, язычок сверху щёлкает по штырькам. */
function DrawWheel({ pool, angle, active, done, still }: { pool: string[]; angle: number; active: number; done: boolean; still: boolean }) {
  const uid = useId().replace(/:/g, "");
  const n = Math.max(1, pool.length);
  const seg = 360 / n;
  const r = 100;
  const point = (deg: number, rad = r): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [+(rad * Math.cos(a)).toFixed(2), +(rad * Math.sin(a)).toFixed(2)];
  };
  const pt = (deg: number, rad = r) => point(deg, rad).join(" ");
  // До 4 секторов надпись поперёк сектора, больше — вдоль радиуса (узкий сектор). Надпись всегда читается сверху вниз
  // и слева направо: на левой половине экрана — перевёрнута (по углу сектора с учётом поворота колеса).
  const radial = n > 4;
  const max = radial ? (n <= 8 ? 13 : 11) : 14;
  const short = (s: string) => (Array.from(s).length > max ? `${Array.from(s).slice(0, max - 1).join("")}…` : s);
  const font = n <= 4 ? 13 : n <= 8 ? 10.5 : 9;
  // Язычок: штырёк прошёл под ним — отскок и плавный возврат (колесо крутится по часовой — язычок уходит влево).
  const under = (((-angle % 360) + 360) % 360) / seg;
  const f = under - Math.floor(under);
  const flap = done || still ? 0 : f > 0.78 ? -24 * ((f - 0.78) / 0.22) : 0;
  return (
    <div className={`draw-wheel${done ? " is-done" : ""}${still ? " is-still" : ""}`} aria-hidden={!done}>
      <svg className="draw-wheel__svg" viewBox="-124 -134 248 260" role="img">
        <defs>
          <radialGradient id={`${uid}rim`} cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#FFF3C4" />
            <stop offset="45%" stopColor="#E3C68C" />
            <stop offset="80%" stopColor="#C9A15F" />
            <stop offset="100%" stopColor="#7A5A26" />
          </radialGradient>
          <radialGradient id={`${uid}shade`} cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
          </radialGradient>
          <linearGradient id={`${uid}sheen`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${uid}hub`} cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#FFF3C4" />
            <stop offset="60%" stopColor="#C9A15F" />
            <stop offset="100%" stopColor="#6E5224" />
          </radialGradient>
        </defs>
        <circle r="117" fill={`url(#${uid}rim)`} />
        <circle r="103" fill="#221E1B" />
        <g className="draw-wheel__bulbs">
          {Array.from({ length: WHEEL_BULBS }, (_, i) => {
            const [x, y] = point((i * 360) / WHEEL_BULBS, 110);
            return <circle key={i} className="draw-wheel__bulb" cx={x} cy={y} r="3.2" style={{ animationDelay: `${(i % 2) * 0.35}s` }} />;
          })}
        </g>
        <g transform={`rotate(${angle.toFixed(2)})`} className="draw-wheel__disk">
          {pool.map((name, i) => {
            const from = i * seg;
            const to = (i + 1) * seg;
            const mid = from + seg / 2;
            const d = n === 1 ? `M ${pt(0)} A ${r} ${r} 0 1 1 ${pt(359.99)} Z` : `M 0 0 L ${pt(from)} A ${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${pt(to)} Z`;
            return (
              <g key={`${name}-${i}`} className={(done || still) && i === active ? "draw-wheel__seg is-win" : done || still ? "draw-wheel__seg is-out" : "draw-wheel__seg"}>
                <path d={d} fill={WHEEL_COLORS[(n % 2 === 1 && i === n - 1 && n > 1 ? 2 : i) % WHEEL_COLORS.length]} />
                <text transform={labelTransform(mid, angle, radial, r)} textAnchor="middle" dominantBaseline="middle" fontSize={font} fontWeight="600" fill="#FBF6F1" className="draw-wheel__label">
                  {short(name)}
                </text>
              </g>
            );
          })}
          <circle r={r} fill={`url(#${uid}shade)`} pointerEvents="none" />
          {n > 1 &&
            pool.map((_, i) => {
              const [x, y] = point(i * seg, r);
              const [px, py] = point(i * seg, 95);
              return (
                <g key={`peg${i}`}>
                  <line x1="0" y1="0" x2={x} y2={y} stroke="#E3C68C" strokeWidth="1.1" opacity="0.9" />
                  <circle cx={px} cy={py} r="2.4" fill="#FFF3C4" stroke="#7A5A26" strokeWidth="0.6" />
                </g>
              );
            })}
        </g>
        <circle r={r} fill={`url(#${uid}sheen)`} pointerEvents="none" />
        <circle r="17" fill={`url(#${uid}hub)`} stroke="#6E5224" strokeWidth="1" />
        <circle r="12" fill="#221E1B" />
        <text className="draw-wheel__hub" textAnchor="middle" dominantBaseline="central" fontSize="9" fill="#E3C68C">
          J✦R
        </text>
        <g transform={`rotate(${flap.toFixed(1)} 0 -124)`} className="draw-wheel__pointer">
          <path d="M 0 -96 C -6 -106 -11 -114 -11 -121 A 11 11 0 0 1 11 -121 C 11 -114 6 -106 0 -96 Z" fill={`url(#${uid}rim)`} stroke="#6E5224" strokeWidth="1.2" />
          <circle cy="-122" r="3.4" fill="#7A2E3B" stroke="#FFF3C4" strokeWidth="0.8" />
        </g>
      </svg>
      <p className="draw-wheel__now">{pool[active] ?? ""}</p>
    </div>
  );
}

/** Поворот надписи сектора: по экранному углу (сектор + поворот колеса), чтобы не было вверх ногами. */
function labelTransform(mid: number, angle: number, radial: boolean, r: number): string {
  const screen = (((mid + angle) % 360) + 360) % 360;
  if (radial) {
    // Вдоль радиуса: справа — от центра наружу, слева — снаружи к центру.
    const flip = screen > 180;
    return `rotate(${mid}) translate(0 ${-r * 0.58}) rotate(${flip ? 90 : -90})`;
  }
  return `rotate(${mid}) translate(0 ${-r * 0.6}) rotate(${screen > 90 && screen < 270 ? 180 : 0})`;
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
  const timerLeft = timer !== null && slide.endsAt !== null ? Math.max(0, Math.ceil((slide.endsAt - now) / 1000)) : null;
  const timerTotal = useCountdownTotal(timer !== null ? slide.endsAt : null, timerLeft);

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
        <div className="slide__timer">
          <HallTimer left={timerLeft} total={timerTotal} size="40cqh" stopText="Продолжаем!" />
        </div>
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
