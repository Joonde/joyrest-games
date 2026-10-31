/** Место ведущего под музыку и видео (решение владельца 31 октября 2026): строка и полоска во вкладках «Музыка» и «Видео». */
import { formatBytes } from "../../core/image";
import type { TrackUsage } from "../../data";

/** «Занято 493 МБ из 2 ГБ» с полоской; почти всё занято — подсказка, как освободить. */
export function TrackUsageLine({ usage }: { usage: TrackUsage }) {
  const share = Math.min(1, usage.usedBytes / usage.limitBytes);
  const almost = share >= 0.9;
  return (
    <div className="track-usage stack stack--tight">
      <p className={almost ? "small track-usage__text is-full" : "muted small track-usage__text"}>
        Ваша музыка и видео: занято {formatBytes(usage.usedBytes)} из {formatBytes(usage.limitBytes)}
        {almost ? " — почти всё. Удалите ненужные треки и видео или предложите треки в общую музыку: принятые в общую место не занимают." : ""}
      </p>
      <div className="track-usage__bar" role="progressbar" aria-label="Место под музыку и видео" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

