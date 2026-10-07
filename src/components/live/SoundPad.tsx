import { useState } from "react";
import type { CueSound, SoundCue } from "../../data";
import { Icon, type IconName } from "../Icon";

const PAD: Array<{ sound: CueSound; label: string; icon: IconName }> = [
  { sound: "gong", label: "Гонг", icon: "gong" },
  { sound: "drumroll", label: "Дробь", icon: "drum" },
  { sound: "fanfare", label: "Фанфары", icon: "fanfare" },
  { sound: "applause", label: "Аплодисменты", icon: "applause" },
  { sound: "wrong", label: "Ошибка", icon: "wrong" },
  { sound: "stop", label: "Стоп", icon: "stop" },
];

function cueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newCue(sound: CueSound): SoundCue {
  return { id: cueId(), sound };
}

/**
 * Звуки на пульте (CLAUDE.md, раздел 7, «Звуки»): квадратные плитки с картинкой. Нажали — плитка
 * вспыхивает, звук играет на экране зала (на телефонах гостей — никогда).
 */
export function SoundPad({ onCue }: { onCue: (cue: SoundCue) => Promise<void> }) {
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState(false);

  function press(sound: CueSound) {
    setError(false);
    setFlash(sound);
    window.setTimeout(() => setFlash((f) => (f === sound ? null : f)), 600);
    onCue(newCue(sound)).catch(() => setError(true));
  }

  return (
    <div className="stack">
      <div className="tiles" role="group" aria-label="Звуки на экране зала">
        {PAD.map((item) => (
          <button
            key={item.sound}
            type="button"
            className={flash === item.sound ? "tile is-flash" : "tile"}
            onClick={() => press(item.sound)}
          >
            <Icon name={item.icon} className="tile__icon" />
            <span className="tile__label">{item.label}</span>
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          Звук не отправился. Проверьте интернет.
        </p>
      )}
      <p className="muted small">Звук играет на экране зала. Нет звука — коснитесь экрана зала один раз.</p>
    </div>
  );
}
