// Видео плитки на экране зала с управлением с пульта (решение владельца 12 октября 2026): пауза, дальше, −10 с,
// +10 с, остановить (в начало). Файл с устройства экрана — полностью; ролик YouTube и Rutube — через их
// postMessage-API встроенного плеера; у VK Видео API нет — «Остановить» убирает ролик, «Дальше» запускает заново.
// Видео JoyRest (`server`) — обычный <video> с файлом с сервера, команды — как у файла.
// Тот же плеер — у музыкального лото (клип или караоке к песне; `start` — с какой секунды).
import { useEffect, useRef, useState } from "react";
import { loadLocalVideo, saveLocalVideo } from "../../components/media/localVideo";
import { videosRepo } from "../../data";
import { embedUrl } from "../dance/content";
import type { VideoSource } from "../dance/content";
import type { VideoCmd } from "./logic";

/** Что показать: id (ключ файла на устройстве экрана), название и видео; `start` — с какой секунды. */
export interface VideoItem {
  id: string;
  title: string;
  video: { source: VideoSource; url: string; name: string };
  start?: number;
}

export type VideoHost = "youtube" | "rutube" | "vk";

/** Ссылка → встраиваемый плеер с включённым API управления; null — ссылку экран не откроет. */
export function videoTarget(raw: string, origin = typeof window !== "undefined" ? window.location.origin : "", start = 0): { host: VideoHost; src: string } | null {
  const src = embedUrl(raw);
  if (!src) return null;
  const from = Math.max(0, Math.floor(start));
  if (src.includes("youtube")) return { host: "youtube", src: `${src}&enablejsapi=1${origin ? `&origin=${encodeURIComponent(origin)}` : ""}${from ? `&start=${from}` : ""}` };
  if (src.includes("rutube.ru")) return { host: "rutube", src: `${src}${from ? `&t=${from}` : ""}` };
  return { host: "vk", src: `${src}${from ? `&t=${from}s` : ""}` };
}

/** Что умеет плеер этой плитки: у VK — только «остановить» и «запустить заново». */
export function canSeek(tile: VideoItem): boolean {
  if (tile.video.source === "file" || tile.video.source === "server") return true;
  if (tile.video.source !== "link") return false;
  return videoTarget(tile.video.url)?.host !== "vk";
}

interface Props {
  tile: VideoItem;
  video: { n: number; cmd: VideoCmd; paused: boolean };
}

export function StageVideo({ tile, video }: Props) {
  if (tile.video.source === "file") return <FileVideo tile={tile} video={video} />;
  if (tile.video.source === "server") {
    if (!videosRepo) return <p className="stage-video__note">Видео JoyRest открывается только на платформе JoyRest (games.joy-rest.ru).</p>;
    if (!tile.video.url) return null;
    return <PlainVideo key={tile.video.url} src={videosRepo.fileUrl(tile.video.url)} start={Math.max(0, tile.start ?? 0)} video={video} />;
  }
  if (tile.video.source === "link") {
    const target = videoTarget(tile.video.url, undefined, tile.start ?? 0);
    if (!target) return <p className="stage-video__note">Ссылку на видео не открыть. Проверьте её в конструкторе: подходят YouTube, VK Видео и Rutube.</p>;
    return <LinkVideo key={target.src} target={target} title={tile.title} video={video} start={tile.start ?? 0} />;
  }
  return null;
}

/** Команды, пришедшие после открытия экрана: старые не повторяем (иначе перезагрузка снова перемотает). */
function useCommands(video: Props["video"], apply: (cmd: VideoCmd) => void) {
  const seen = useRef(video.n);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (video.n === seen.current) return;
    seen.current = video.n;
    applyRef.current(video.cmd);
  }, [video.n, video.cmd]);
}

function FileVideo({ tile, video }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    void loadLocalVideo(tile.id).then((v) => {
      if (cancelled) return;
      if (!v) return setMissing(true);
      made = URL.createObjectURL(v.blob);
      setUrl(made);
      setMissing(false);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [tile.id]);

  if (missing) {
    return (
      <div className="stage-video__pick">
        <p>На этом устройстве нет видео «{tile.video.name || tile.title || "плитки"}».</p>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Выбрать видео на этом устройстве
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setUrl(URL.createObjectURL(file));
            setMissing(false);
            void saveLocalVideo(tile.id, file).catch(() => undefined);
          }}
        />
      </div>
    );
  }
  return url ? <PlainVideo src={url} start={Math.max(0, tile.start ?? 0)} video={video} /> : null;
}

/**
 * Обычный <video>: файл с устройства экрана или видео JoyRest с сервера (браузер берёт его частями — Range,
 * играет, не дожидаясь всего файла). Команды пульта — как у файла.
 */
function PlainVideo({ src, start, video }: { src: string; start: number; video: Props["video"] }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  // Открыли экран посреди выступления: пауза — так пауза.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (video.paused) el.pause();
    else void el.play().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при появлении видео
  }, [src]);

  useCommands(video, (cmd) => {
    const el = ref.current;
    if (!el) return;
    if (cmd === "play") void el.play().catch(() => undefined);
    if (cmd === "pause") el.pause();
    if (cmd === "back") el.currentTime = Math.max(0, el.currentTime - 10);
    if (cmd === "fwd") el.currentTime = Math.min(el.duration || el.currentTime + 10, el.currentTime + 10);
    if (cmd === "stop") {
      el.pause();
      el.currentTime = start;
    }
  });

  if (failed) return <p className="stage-video__note">Видео не открылось: этот браузер не умеет такой формат или файл удалили. Попробуйте другой браузер (Chrome) или загрузите видео в MP4.</p>;
  return (
    <video
      ref={ref}
      className="stage-video__frame"
      src={src}
      playsInline
      preload="auto"
      autoPlay={!video.paused}
      controls={false}
      onError={() => setFailed(true)}
      onLoadedMetadata={(e) => {
        if (start > 0 && start < (e.currentTarget.duration || Infinity)) e.currentTarget.currentTime = start;
      }}
    />
  );
}

function LinkVideo({ target, title, video, start }: { target: { host: VideoHost; src: string }; title: string; video: Props["video"]; start: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const time = useRef(0);
  const ready = useRef(false);
  const queue = useRef<Array<() => void>>([]);
  // VK: «Остановить» убирает ролик, «Дальше» — заново с начала.
  const [vkRun, setVkRun] = useState(0);
  const [vkStopped, setVkStopped] = useState(false);

  const post = (msg: unknown) => ref.current?.contentWindow?.postMessage(JSON.stringify(msg), "*");
  const yt = (func: string, args: unknown[] = []) => post({ event: "command", func, args });
  const rt = (type: string, data: Record<string, unknown> = {}) => post({ type, data });
  const send = (fn: () => void) => (ready.current ? fn() : queue.current.push(fn));

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      let data: unknown = e.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
      if (target.host === "youtube") {
        if (d.event === "onReady" || d.event === "initialDelivery") markReady();
        const info = (typeof d.info === "object" && d.info !== null ? d.info : {}) as Record<string, unknown>;
        if (typeof info.currentTime === "number") time.current = info.currentTime;
      }
      if (target.host === "rutube") {
        if (d.type === "player:ready") markReady();
        const inner = (typeof d.data === "object" && d.data !== null ? d.data : {}) as Record<string, unknown>;
        if (d.type === "player:currentTime" && typeof inner.time === "number") time.current = inner.time;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один слушатель на плеер
  }, [target.host]);

  function markReady() {
    if (ready.current) return;
    ready.current = true;
    const waiting = queue.current;
    queue.current = [];
    waiting.forEach((fn) => fn());
  }

  function onLoad() {
    // YouTube присылает время и готовность, когда попросили «слушать».
    if (target.host === "youtube") post({ event: "listening", id: "joyrest", channel: "widget" });
    // Готовность может не прийти (старый плеер) — через 2 с всё равно отправляем команды.
    window.setTimeout(markReady, 2000);
    if (video.paused) send(() => (target.host === "youtube" ? yt("pauseVideo") : rt("player:pause")));
  }

  useCommands(video, (cmd) => {
    if (target.host === "vk") {
      if (cmd === "stop" || cmd === "pause") setVkStopped(true);
      if (cmd === "play") {
        setVkStopped(false);
        setVkRun((n) => n + 1);
      }
      return;
    }
    send(() => {
      if (target.host === "youtube") {
        if (cmd === "play") yt("playVideo");
        if (cmd === "pause") yt("pauseVideo");
        if (cmd === "back") yt("seekTo", [Math.max(0, time.current - 10), true]);
        if (cmd === "fwd") yt("seekTo", [time.current + 10, true]);
        if (cmd === "stop") {
          yt("seekTo", [start, true]);
          yt("pauseVideo");
        }
        return;
      }
      if (cmd === "play") rt("player:play");
      if (cmd === "pause") rt("player:pause");
      if (cmd === "back") rt("player:relativelySeek", { time: -10 });
      if (cmd === "fwd") rt("player:relativelySeek", { time: 10 });
      if (cmd === "stop") {
        rt("player:setCurrentTime", { time: start });
        rt("player:pause");
      }
    });
  });

  if (target.host === "vk" && vkStopped) return <div className="stage-video__stopped">Видео остановлено</div>;
  return <iframe key={vkRun} ref={ref} className="stage-video__frame" src={target.src} title={title || "Видео"} onLoad={onLoad} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />;
}
