/**
 * Личная карточка гостя для сторис (решения владельца 31 октября 2026): картинка 1080×1920 рисуется прямо на телефоне
 * (canvas, `storyPaint.ts`), сервер не нагружается. Три стиля — «Венок», «Ар-деко», «Светлый»: гость листает их вбок
 * (лента со щелчком по центру, точки и стрелки) и делится тем, что сейчас по центру. Главное правило — делимся ровно
 * той картинкой, что видна: превью каждого слайда — та же картинка (`Blob`), которую отправит кнопка, а номер слайда
 * перед отправкой пересчитывается по положению ленты (`closestSlide`). Пока картинка выбранного стиля рисуется,
 * кнопка ждёт («Рисуем карточку…»), другую не подставляет.
 * Картинки рисуются заранее, при открытии блока: меню «Поделиться» браузер открывает только сразу по касанию.
 * Касание — меню телефона с картинкой (Telegram, ВКонтакте, WhatsApp, сторис); меню нет или не умеет файлы — сохраняется.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import monoSvg from "../../../public/brand/joyrest-monogram.svg?inline-svg";
import { closestSlide, STORY_STYLES, storyCardText, type StoryCardInput, type StoryCardText, type StoryStyle } from "../../core/storyCard";
import { formatResultsText } from "../../core/results";
import type { GameResult } from "../../data";
import { resultsUrl } from "../links";
import { paintStoryCard, STORY_H, STORY_W } from "./storyPaint";

const SANS = '"Jost", system-ui, sans-serif';
const SERIF = '"Cormorant Garamond", Georgia, serif';

function loadImage(markup: string): Promise<HTMLImageElement | null> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Монограмма в цветах всех стилей — один раз на страницу. */
let monograms: Promise<Map<string, HTMLImageElement>> | null = null;
function loadMonograms(): Promise<Map<string, HTMLImageElement>> {
  monograms ??= Promise.all(
    ["#F3DFAE", "#B8924F"].map(async (color) => [color, await loadImage(monoSvg.replace(/currentColor/g, color))] as const),
  ).then((list) => new Map(list.filter((x): x is readonly [string, HTMLImageElement] => x[1] !== null)));
  return monograms;
}

let fontsReady: Promise<void> | null = null;
function loadFonts(): Promise<void> {
  if (!document.fonts?.load) return Promise.resolve();
  fontsReady ??= Promise.race([
    Promise.all([
      document.fonts.load(`500 120px ${SANS}`, "1234567890"),
      document.fonts.load(`400 40px ${SANS}`, "МЕСТО Квиз"),
      document.fonts.load(`600 60px ${SANS}`, "Команда"),
      document.fonts.load(`700 100px ${SERIF}`, "Я играл"),
      document.fonts.load(`600 60px ${SERIF}`, "Радость"),
    ]).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, 2500)),
  ]).catch(() => undefined);
  return fontsReady;
}

/** Рисует карточку стиля; null — браузер не умеет canvas. */
export async function drawStoryCard(text: StoryCardText, style: StoryStyle = "wreath"): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const [mono] = await Promise.all([loadMonograms(), loadFonts()]);
  paintStoryCard(ctx, text, style, (color) => mono.get(color) ?? null);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Имя файла со стилем: joyrest-pobeda-venok.png — разные стили не затирают друг друга в галерее. */
const FILE_SUFFIX: Record<StoryStyle, string> = { wreath: "venok", deco: "art-deco", light: "svetlyj" };
function fileName(text: StoryCardText, style: StoryStyle): string {
  return text.fileName.replace(/\.png$/, `-${FILE_SUFFIX[style]}.png`);
}

/** «Поделиться итогами игры»: вся таблица текстом и ссылкой (меню телефона, иначе — в буфер). Возвращает подсказку или null. */
export async function shareResults(result: GameResult): Promise<string | null> {
  const link = resultsUrl(result.id);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: `Итоги игры «${result.gameTitle || "Игра"}»`, text: formatResultsText(result), url: link });
      return null;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
    }
  }
  try {
    await navigator.clipboard.writeText(formatResultsText(result, link));
    return "Итоги скопированы — вставьте их в чат.";
  } catch {
    return `Ссылка на итоги: ${link}`;
  }
}

type Card = { blob: Blob; url: string };

/**
 * Лента стилей карточки и кнопки «Поделиться» / «Сохранить картинку». `onShared` — карточку отправили или сохранили
 * (шаг «Сторис» выполнен).
 */
export function StoryShare({
  input,
  onShared,
  start = 0,
  onPick,
}: {
  input: StoryCardInput;
  onShared?: () => void;
  /** С какого стиля открыть ленту (выбранный раньше — после «ещё раз»). */
  start?: number;
  /** Стиль по центру сменился. */
  onPick?: (index: number) => void;
}) {
  // Сессия обновляется и после игры (музыка, слайды) — карточки перерисовываем, только если поменялся их текст.
  const key = JSON.stringify(input);
  const text = useMemo(() => storyCardText(input), [key]);
  const [cards, setCards] = useState<Partial<Record<StoryStyle, Card>>>({});
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState<Partial<Record<StoryStyle, true>>>({});
  const [active, setActive] = useState(() => Math.min(Math.max(start, 0), STORY_STYLES.length - 1));
  const [note, setNote] = useState<string | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const slides = useRef<(HTMLButtonElement | null)[]>([]);

  // Рисуем по очереди, сначала первый (видимый) стиль; превью — те же картинки, что уйдут по кнопке.
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    setCards({});
    setFailed(false);
    setBroken({});
    (async () => {
      for (const { id } of STORY_STYLES) {
        const blob = await drawStoryCard(text, id).catch(() => null);
        if (!alive) return;
        if (!blob) {
          if (id === STORY_STYLES[0].id) setFailed(true);
          setBroken((prev) => ({ ...prev, [id]: true }));
          continue;
        }
        const url = URL.createObjectURL(blob);
        urls.push(url);
        setCards((prev) => ({ ...prev, [id]: { blob, url } }));
      }
    })();
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [text]);

  /** Какой слайд по центру прямо сейчас (по положению ленты, а не по запомненному числу). */
  const measure = useCallback((): number => {
    const el = track.current;
    if (!el) return active;
    const centers = slides.current.map((s) => (s ? s.offsetLeft + s.offsetWidth / 2 : Number.POSITIVE_INFINITY));
    return closestSlide(centers, el.scrollLeft + el.clientWidth / 2);
  }, [active]);

  // Открылись не с первого стиля — сразу ставим его по центру, без анимации.
  useEffect(() => {
    const el = track.current;
    const slide = slides.current[active];
    if (el && slide && active > 0) el.scrollLeft = slide.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2;
    // Только при открытии.
  }, []);

  useEffect(() => {
    onPick?.(active);
  }, [active, onPick]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(measure()));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [measure]);

  function go(i: number) {
    const el = track.current;
    const slide = slides.current[i];
    if (!el || !slide) return;
    const left = slide.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
    setActive(i);
  }

  /** Стиль, которым делимся: тот, что по центру сейчас. Если лента ещё ехала — подпись догоняет. */
  function current(): { style: StoryStyle; card: Card | undefined } {
    const i = measure();
    if (i !== active) setActive(i);
    const style = STORY_STYLES[i].id;
    return { style, card: cards[style] };
  }

  async function shareCard() {
    const { style, card } = current();
    if (!card) return;
    setNote(null);
    const file = new File([card.blob], fileName(text, style), { type: "image/png" });
    if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: text.shareText });
        onShared?.();
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    save(card.blob, fileName(text, style));
    setNote("Картинка сохранена — найдите её в загрузках или галерее и выложите в сторис.");
    onShared?.();
  }

  function saveCard() {
    const { style, card } = current();
    if (!card) return;
    save(card.blob, fileName(text, style));
    setNote("Картинка сохранена — найдите её в загрузках или галерее.");
    onShared?.();
  }

  if (failed) return null;
  const style = STORY_STYLES[active];
  const ready = Boolean(cards[style.id]);
  return (
    <div className="stack stack--tight story-share">
      <div className="story-pick" ref={track} aria-label="Стили карточки — листайте вбок">
        {STORY_STYLES.map((s, i) => {
          const card = cards[s.id];
          return (
            <button
              key={s.id}
              type="button"
              ref={(el) => {
                slides.current[i] = el;
              }}
              className={i === active ? "story-pick__slide is-active" : "story-pick__slide"}
              aria-label={`Стиль «${s.title}»${i === active ? " — выбран" : ""}`}
              aria-current={i === active}
              onClick={() => i !== active && go(i)}
            >
              {card ? (
                <img src={card.url} alt={`${text.who}: ${text.headline}. ${text.game}. Стиль «${s.title}»`} width={STORY_W / 4} height={STORY_H / 4} draggable={false} />
              ) : (
                <span className="story-pick__wait" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
      <div className="story-pick__nav">
        <button type="button" className="story-pick__arrow" aria-label="Предыдущий стиль" disabled={active === 0} onClick={() => go(active - 1)}>
          ‹
        </button>
        <span className="story-pick__dots" aria-hidden>
          {STORY_STYLES.map((s, i) => (
            <span key={s.id} className={i === active ? "is-on" : undefined} />
          ))}
        </span>
        <span className="story-pick__label" aria-live="polite">
          «{style.title}» · {active + 1} из {STORY_STYLES.length}
        </span>
        <button type="button" className="story-pick__arrow" aria-label="Следующий стиль" disabled={active === STORY_STYLES.length - 1} onClick={() => go(active + 1)}>
          ›
        </button>
      </div>
      <button type="button" className="btn btn--block" disabled={!ready} onClick={() => void shareCard()}>
        {ready ? `${text.button} · «${style.title}»` : broken[style.id] ? "Этот стиль не получился — выберите другой" : "Рисуем карточку…"}
      </button>
      <button type="button" className="btn btn--secondary btn--block" disabled={!ready} onClick={saveCard}>
        Сохранить картинку
      </button>
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
