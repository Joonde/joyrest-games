import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { drawingsRepo } from "../../data";
import type { PlayerViewProps, ViewProps } from "../types";
import { CREDIT_TEXT, CREDIT_URL, SCENE_TITLES, type AquariumContent, type SceneId } from "./content";
import { figureById, figuresOf, type FigureDef } from "./figures";
import { cleanName, keyOf, NAME_MAX, parseAquaResult, phoneItems, type AquaItem, type PhoneItem } from "./logic";
import { autoPaint, clearPaint, ctx2d, demoPaint, drawThumb, linesOf, maskOf } from "./paint";
import type { AquaStage } from "./scene";
import "./aquarium.css";

export type AquariumAnswer = { items: PhoneItem[] };

const LIVE_LABEL: Record<SceneId, (name: string) => string> = {
  aqua: (n) => (n ? `Рыбка от: ${n}` : "Новая рыбка!"),
  tree: (n) => (n ? `Игрушка от: ${n}` : "Новая игрушка!"),
};

/** Раскраска с сервера: картинка; нет файла или не открылся — готовая раскраска, чтобы фигура всё равно появилась. */
function loadPaint(item: AquaItem, fig: FigureDef): Promise<CanvasImageSource> {
  if (!item.sha || !drawingsRepo) return Promise.resolve(demoPaint(fig));
  const url = drawingsRepo.url(item.sha);
  const once = () =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image"));
      img.src = url;
    });
  return once()
    .catch(() => new Promise<HTMLImageElement>((r) => window.setTimeout(r, 2000)).then(once))
    .catch(() => demoPaint(fig));
}

/** Экран зала: 3D-аквариум или ёлка на весь экран, рисунки гостей появляются сами. */
export function AquariumScreenView({ session, content }: ViewProps<AquariumContent>) {
  const r = parseAquaResult(session.state.result, content);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<AquaStage | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [count, setCount] = useState({ guests: 0, total: 0, max: 40 });
  const placed = useRef(new Map<string, SceneId>());
  const loading = useRef(new Set<string>());
  const first = useRef(true);
  const feedSeen = useRef<number | null>(null);
  const latest = useRef(session);
  latest.current = session;
  const scene = r.scene;

  useEffect(() => {
    let alive = true;
    void import("./scene").then((m) => {
      if (!alive || !box.current) return;
      const st = m.createStage(box.current, { starters: content.starters, scene });
      if (!st) {
        setFailed(true);
        return;
      }
      stage.current = st;
      setReady(true);
    });
    return () => {
      alive = false;
      stage.current?.dispose();
      stage.current = null;
    };
    // Сцена создаётся один раз: дальше всё меняется командами.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage.current?.setScene(scene);
  }, [scene, ready]);
  useEffect(() => {
    stage.current?.setGarland(r.garland);
  }, [r.garland, ready]);
  useEffect(() => {
    if (!ready) return;
    // Корм — только если покормили, пока экран открыт.
    if (feedSeen.current !== null && r.feed > feedSeen.current) stage.current?.feed();
    feedSeen.current = r.feed;
  }, [r.feed, ready]);

  const itemsKey = r.items.map((i) => `${keyOf(i)}@${i.scene}`).join("|");
  useEffect(() => {
    const st = stage.current;
    if (!ready || !st) return;
    const live = !first.current;
    first.current = false;
    const want = new Map(r.items.map((i) => [keyOf(i), i]));
    // Убранные ведущим — уходят со сцены.
    placed.current.forEach((sc, key) => {
      if (!want.has(key)) {
        st.remove(sc, key);
        placed.current.delete(key);
      }
    });
    for (const item of r.items) {
      const key = keyOf(item);
      if (placed.current.has(key) || loading.current.has(key)) continue;
      const fig = figureById(item.fig);
      if (!fig) continue;
      loading.current.add(key);
      void loadPaint(item, fig).then((paint) => {
        loading.current.delete(key);
        const now = stage.current;
        if (!now) return;
        // Пока грузилась — её убрали.
        if (!parseAquaResult(latest.current.state.result, content).items.some((i) => keyOf(i) === key)) return;
        const name = content.names && item.onBody && item.name ? item.name : null;
        now.add(item.scene, { id: key, fig, paint, name, label: LIVE_LABEL[item.scene](item.name) }, live);
        placed.current.set(key, item.scene);
        setCount(now.count(scene));
      });
    }
    setCount(st.count(scene));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, ready]);

  useEffect(() => {
    if (!ready) return;
    const t = window.setInterval(() => {
      const st = stage.current;
      if (st) setCount(st.count(scene));
    }, 1000);
    return () => window.clearInterval(t);
  }, [ready, scene]);

  return (
    <div className={`aq-stage aq-stage--${scene}`}>
      <div className="aq-box" ref={box} />
      {failed ? (
        <div className="aq-nogl">На этом устройстве не включился 3D (WebGL). Откройте экран зала в Chrome или Safari с аппаратным ускорением.</div>
      ) : (
        <>
          <div className="aq-corner">
            <div className="aq-hint">
              <b>{scene === "aqua" ? "Раскрасьте рыбку на телефоне" : "Раскрасьте игрушку на телефоне"}</b> — {scene === "aqua" ? "она приплывёт сюда" : "она повиснет на ёлке"}
            </div>
            <a className="aq-credit" href={CREDIT_URL} target="_blank" rel="noopener noreferrer">
              {CREDIT_TEXT[scene]}
            </a>
          </div>
          <div className="aq-count">
            {scene === "aqua" ? "Рыбок" : "Игрушек"}: {count.total} / {count.max}
          </div>
        </>
      )}
    </div>
  );
}

const COLORS = ["#e63946", "#ff7f50", "#ffb703", "#ffe45e", "#8ac926", "#2a9d8f", "#4cc9f0", "#3a86ff", "#7b2cbf", "#f15bb5", "#ffafcc", "#8d5524", "#c9ada7", "#ffffff", "#6c757d", "#1b1b1e"];
type Tool = "fill" | "brush" | "eraser";
const TOOL_TITLES: Record<Tool, string> = { fill: "Заливка", brush: "Кисть", eraser: "Ластик" };

const hexRGB = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Имя гостя без смайлика в начале. */
function plainName(name: string): string {
  return cleanName(name.replace(/^\p{Extended_Pictographic}️?\s*/u, ""));
}

function newItemId(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
}

/** Раскраска → WebP или JPEG до 60 КБ (как просит сервер). */
async function toUpload(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = (type: string, q: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
  for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
    let b = await blob("image/webp", q);
    if (!b || b.type !== "image/webp") {
      // Safari на iPhone не кодирует WebP: JPEG на белом фоне.
      const flat = document.createElement("canvas");
      flat.width = canvas.width;
      flat.height = canvas.height;
      const x = ctx2d(flat);
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, flat.width, flat.height);
      x.drawImage(canvas, 0, 0);
      b = await new Promise<Blob | null>((resolve) => flat.toBlob(resolve, "image/jpeg", q));
    }
    if (b && b.size <= 60 * 1024) return b;
  }
  throw new Error("too-big");
}

/** Телефон гостя: раскраска рыбки или игрушки и «Выпустить в аквариум!». */
export function AquariumPlayerView({ session, content, participant, myAnswer, sending, onAnswer, personal }: PlayerViewProps<AquariumContent, AquariumAnswer>) {
  const r = parseAquaResult(session.state.result, content);
  const scene = r.scene;
  const sentRaw = personal ? personal.value : myAnswer;
  const isSending = personal ? personal.sending : sending;
  const [local, setLocal] = useState<PhoneItem[]>([]);
  const sent = useMemo(() => {
    const server = sentRaw ? phoneItems(sentRaw.value) : [];
    const ids = new Set(server.map((i) => i.id));
    return [...server, ...local.filter((i) => !ids.has(i.id))];
  }, [sentRaw, local]);
  const left = Math.max(0, content.perGuest - sent.length);
  const [painting, setPainting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  if (session.state.stage !== "question") {
    return (
      <div className="stack aq-phone">
        <h2 className="aq-phone__title">{scene === "aqua" ? "Скоро раскрашиваем рыбок" : "Скоро раскрашиваем игрушки"}</h2>
        <p className="muted">Ведущий откроет раскраску — и вы нарисуете свою {scene === "aqua" ? "рыбку для аквариума" : "игрушку для ёлки"} прямо на телефоне.</p>
      </div>
    );
  }

  async function release(canvas: HTMLCanvasElement, fig: FigureDef, name: string, onBody: boolean) {
    setError(null);
    setUploading(true);
    try {
      let sha: string | null = null;
      if (drawingsRepo) {
        const blob = await toUpload(canvas);
        sha = await drawingsRepo.upload(session.id, blob);
      }
      const item: PhoneItem = { id: newItemId(), scene, fig: fig.id, name: cleanName(name), onBody: content.names && onBody, sha };
      const next = [...sent, item].slice(-content.perGuest);
      setLocal((l) => [...l, item]);
      const value: AquariumAnswer = { items: next };
      if (personal) personal.send(value);
      else onAnswer(value);
      setPainting(false);
    } catch {
      setError("Не получилось отправить рисунок. Проверьте интернет и нажмите ещё раз.");
    } finally {
      setUploading(false);
    }
  }

  if (!painting || left === 0) {
    return (
      <div className="stack aq-phone">
        <h2 className="aq-phone__title">{scene === "tree" ? "Игрушка на ёлке!" : "Рыбка плывёт на экран!"}</h2>
        <p className="muted">
          {content.moderation === "host" ? "Ведущий посмотрит рисунок и выпустит его на экран." : "Смотрите на большой экран — ваш рисунок уже там."} Отправлено: {sent.length} из {content.perGuest}.
        </p>
        {left > 0 ? (
          <button type="button" className="btn btn--block" onClick={() => setPainting(true)}>
            {scene === "aqua" ? "Раскрасить ещё рыбку" : "Раскрасить ещё игрушку"}
          </button>
        ) : (
          <p className="muted small">Это все рисунки с одного телефона. Спасибо!</p>
        )}
      </div>
    );
  }

  return (
    <PaintSheet
      key={scene}
      scene={scene}
      names={content.names}
      defaultName={plainName(participant.name)}
      busy={uploading || isSending}
      error={error}
      left={left}
      onRelease={(c, fig, name, onBody) => void release(c, fig, name, onBody)}
    />
  );
}

interface SheetProps {
  scene: SceneId;
  names: boolean;
  defaultName: string;
  busy: boolean;
  error: string | null;
  left: number;
  onRelease: (canvas: HTMLCanvasElement, fig: FigureDef, name: string, onBody: boolean) => void;
}

/** Лист раскраски — как в прототипе: фигура, заливка, кисть, ластик, палитра, «Раскрасить за меня», имя. */
function PaintSheet({ scene, names, defaultName, busy, error, left, onRelease }: SheetProps) {
  const list = figuresOf(scene);
  const [fig, setFig] = useState<FigureDef>(list[0] as FigureDef);
  const [tool, setTool] = useState<Tool>("fill");
  const [color, setColor] = useState(COLORS[2] as string);
  const [size, setSize] = useState(16);
  const [name, setName] = useState(defaultName);
  const [onBody, setOnBody] = useState(true);
  const paint = useRef<HTMLCanvasElement>(null);
  const lines = useRef<HTMLCanvasElement>(null);
  const masks = useRef<{ line: Uint8Array; mask: Uint8Array } | null>(null);
  const drawing = useRef<[number, number] | null>(null);

  useEffect(() => {
    const p = paint.current;
    const l = lines.current;
    if (!p || !l) return;
    const W = fig.w;
    const H = fig.h;
    p.width = l.width = W;
    p.height = l.height = H;
    const lc = ctx2d(l, true);
    lc.clearRect(0, 0, W, H);
    lc.drawImage(linesOf(fig, "#3b3142"), 0, 0);
    const la = lc.getImageData(0, 0, W, H).data;
    const ma = ctx2d(maskOf(fig), true).getImageData(0, 0, W, H).data;
    const line = new Uint8Array(W * H);
    const mask = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) {
      line[k] = (la[k * 4 + 3] ?? 0) > 70 ? 1 : 0;
      mask[k] = (ma[k * 4 + 3] ?? 0) > 127 ? 1 : 0;
    }
    masks.current = { line, mask };
    clearPaint(fig, ctx2d(p, true));
  }, [fig]);

  const pctx = () => (paint.current ? ctx2d(paint.current, true) : null);

  function flood(x0: number, y0: number) {
    const x = pctx();
    const m = masks.current;
    if (!x || !m) return;
    const W = fig.w;
    const H = fig.h;
    const k0 = y0 * W + x0;
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H || !m.mask[k0] || m.line[k0]) return;
    const img = x.getImageData(0, 0, W, H);
    const p = img.data;
    const [r, g, b] = hexRGB(color);
    const sr = p[k0 * 4] ?? 0;
    const sg = p[k0 * 4 + 1] ?? 0;
    const sb = p[k0 * 4 + 2] ?? 0;
    if (Math.abs(sr - r) + Math.abs(sg - g) + Math.abs(sb - b) < 6) return;
    const seen = new Uint8Array(W * H);
    const st = [k0];
    seen[k0] = 1;
    const filled: number[] = [];
    const ok = (n: number) => !seen[n] && m.mask[n] && !m.line[n] && Math.abs((p[n * 4] ?? 0) - sr) + Math.abs((p[n * 4 + 1] ?? 0) - sg) + Math.abs((p[n * 4 + 2] ?? 0) - sb) < 110;
    while (st.length) {
      const k = st.pop() as number;
      filled.push(k);
      const xx = k % W;
      if (xx > 0 && ok(k - 1)) {
        seen[k - 1] = 1;
        st.push(k - 1);
      }
      if (xx < W - 1 && ok(k + 1)) {
        seen[k + 1] = 1;
        st.push(k + 1);
      }
      if (k >= W && ok(k - W)) {
        seen[k - W] = 1;
        st.push(k - W);
      }
      if (k < W * (H - 1) && ok(k + W)) {
        seen[k + W] = 1;
        st.push(k + W);
      }
    }
    const paintPx = (k: number) => {
      p[k * 4] = r;
      p[k * 4 + 1] = g;
      p[k * 4 + 2] = b;
      p[k * 4 + 3] = 255;
    };
    filled.forEach((k) => {
      paintPx(k);
      const xx = k % W;
      [k - 1, k + 1, k - W, k + W].forEach((n) => {
        if (n >= 0 && n < W * H && Math.abs((n % W) - xx) <= 1 && m.line[n] && m.mask[n] && !seen[n]) {
          seen[n] = 1;
          paintPx(n);
        }
      });
    });
    x.putImageData(img, 0, 0);
  }

  function stroke(a: [number, number], b: [number, number]) {
    const x = pctx();
    if (!x) return;
    x.globalCompositeOperation = "source-over";
    x.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    x.lineWidth = size;
    x.lineCap = "round";
    x.lineJoin = "round";
    x.beginPath();
    x.moveTo(a[0], a[1]);
    x.lineTo(b[0] + 0.01, b[1]);
    x.stroke();
    x.globalCompositeOperation = "destination-in";
    x.drawImage(maskOf(fig), 0, 0);
    x.globalCompositeOperation = "source-over";
  }

  function pos(e: PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * fig.w, ((e.clientY - rect.top) / rect.height) * fig.h];
  }

  const thing = scene === "aqua" ? "рыбку" : "игрушку";
  return (
    <div className="stack aq-phone aq-sheet">
      <h2 className="aq-phone__title">{scene === "aqua" ? "Раскрась рыбку" : "Раскрась игрушку"}</h2>
      <p className="muted small">Выберите фигуру, раскрасьте и отправьте на большой экран.{left < 10 ? ` Можно ещё: ${left}.` : ""}</p>
      <div className="aq-species" role="group" aria-label="Фигура">
        {list.map((f) => (
          <SpeciesButton key={f.id} fig={f} active={f.id === fig.id} onPick={() => setFig(f)} />
        ))}
      </div>
      <div className="aq-cwrap" style={{ aspectRatio: `${fig.w} / ${fig.h}`, maxWidth: fig.kind === "orn" ? "300px" : "100%" }}>
        <canvas ref={paint} />
        <canvas
          ref={lines}
          onPointerDown={(e) => {
            e.preventDefault();
            const pt = pos(e);
            if (tool === "fill") {
              flood(Math.round(pt[0]), Math.round(pt[1]));
              return;
            }
            drawing.current = pt;
            stroke(pt, pt);
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // нет захвата — рисуем без него
            }
          }}
          onPointerMove={(e) => {
            const last = drawing.current;
            if (!last) return;
            const pt = pos(e);
            stroke(last, pt);
            drawing.current = pt;
          }}
          onPointerUp={() => (drawing.current = null)}
          onPointerCancel={() => (drawing.current = null)}
          onPointerLeave={() => (drawing.current = null)}
        />
      </div>
      <div className="aq-tools">
        <div className="aq-seg" role="group" aria-label="Инструмент">
          {(["fill", "brush", "eraser"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)}>
              {TOOL_TITLES[t]}
            </button>
          ))}
        </div>
        <label className="aq-size">
          Толщина <input type="range" min={4} max={44} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
      </div>
      <div className="aq-pal">
        {COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            className="aq-sw"
            style={{ background: c }}
            aria-label={`Цвет ${i + 1}`}
            aria-pressed={c === color}
            onClick={() => {
              setColor(c);
              if (tool === "eraser") setTool("fill");
            }}
          />
        ))}
      </div>
      <div className="aq-row">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            const x = pctx();
            if (x) autoPaint(fig, x);
          }}
        >
          Раскрасить за меня
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            const x = pctx();
            if (x) clearPaint(fig, x);
          }}
        >
          Очистить
        </button>
      </div>
      <label className="aq-name">
        Имя или кличка (необязательно)
        <input value={name} maxLength={NAME_MAX} placeholder="Например, Маша или Бульк" autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </label>
      {names && (
        <label className="aq-check">
          <input type="checkbox" checked={onBody} onChange={(e) => setOnBody(e.target.checked)} /> {scene === "aqua" ? "Написать имя на боку рыбки" : "Написать имя на игрушке"}
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn--block"
        disabled={busy}
        onClick={() => {
          if (paint.current) onRelease(paint.current, fig, name, onBody && name.trim().length > 0);
        }}
      >
        {busy ? "Отправляем…" : scene === "aqua" ? "Выпустить в аквариум!" : "Повесить на ёлку!"}
      </button>
      <p className="muted small">Нарисуйте свою {thing}: она появится на большом экране. {SCENE_TITLES[scene]} — по мотивам Paper Aquarium (автор MrMoT9I).</p>
    </div>
  );
}

function SpeciesButton({ fig, active, onPick }: { fig: FigureDef; active: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawThumb(fig, ref.current);
  }, [fig]);
  return (
    <button type="button" className="aq-sp" aria-pressed={active} onClick={onPick}>
      <canvas ref={ref} width={128} height={80} />
      {fig.name}
    </button>
  );
}
