// Холсты 3D-барабана: нижний (барабан и бочонки), затемнение между ними и верхний (выбранный бочонок, крышка, искры —
// не темнеют вместе с барабаном). Сцена — scene.ts; время — по часам сервера от начала песни.
import { useEffect, useRef } from "react";
import { clock } from "../../../data";
import { createDrumScene, DRUM_TIMELINES, type DrumScene, type DrumSpeed } from "./scene";

interface Props {
  numbers: number[];
  pick: number;
  speed: DrumSpeed;
  seed: string;
  startedAt: number;
  /** Нет WebGL или сцена упала — показываем без 3D. */
  onFail: () => void;
  /** Затемнение под выбранным бочонком (0…1). */
  dim: number;
}

/** Сдвиг барабана влево — справа табло (доля ширины кадра). */
const OFFSET = 0.172;

export default function DrumCanvas({ numbers, pick, speed, seed, startedAt, onFail, dim }: Props) {
  const main = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const key = numbers.join(",");

  useEffect(() => {
    if (!main.current || !top.current) return;
    const canvases = { main: main.current, top: top.current };
    const made = ((): DrumScene | null => {
      try {
        return createDrumScene({ ...canvases, numbers, pick, speed, offset: OFFSET, seed });
      } catch {
        return null;
      }
    })();
    if (!made) {
      failRef.current();
      return;
    }
    const scene = made;
    const end = DRUM_TIMELINES[speed].end + 0.3;
    let raf = 0;
    // Слабое устройство (телевизор без видеокарты): меньше ~8 кадров в секунду за первые полторы секунды — без 3D,
    // сразу номер (время барабана то же).
    const begun = performance.now();
    let frames = 0;
    const loop = () => {
      frames += 1;
      const spent = performance.now() - begun;
      if (spent > 1500 && spent < 3000 && frames / (spent / 1000) < 8) {
        failRef.current();
        return;
      }
      const t = (Date.now() + clock.offset() - startedAt) / 1000;
      try {
        scene.frame(Math.max(0, t));
      } catch {
        failRef.current();
        return;
      }
      if (t < end) raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => scene.resize()) : null;
    observer?.observe(canvases.main);
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      scene.dispose();
    };
    // Сцена строится один раз на барабан: номера, выбранный и начало не меняются, пока он крутится.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pick, speed, seed, startedAt]);

  return (
    <>
      <canvas ref={main} className="lh-drum__canvas" aria-hidden="true" />
      <div className="lh-drum__dim" style={{ opacity: dim }} />
      <canvas ref={top} className="lh-drum__canvas" aria-hidden="true" />
    </>
  );
}
