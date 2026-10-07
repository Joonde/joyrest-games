import { useState } from "react";
import type { CueSound, SoundCue } from "../../data";

const PAD: Array<{ sound: CueSound; label: string }> = [
  { sound: "gong", label: "Гонг" },
  { sound: "drumroll", label: "Барабанная дробь" },
  { sound: "fanfare", label: "Фанфары" },
  { sound: "applause", label: "Аплодисменты" },
  { sound: "wrong", label: "Ошибка" },
  { sound: "stop", label: "Стоп" },
];

function cueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function newCue(sound: CueSound): SoundCue {
  return { id: cueId(), sound };
}

/**
 * Кнопки звуков на пульте (CLAUDE.md, раздел 7, «Звуки»): нажали — звук играет на экране зала,
 * на телефонах гостей — никогда.
 */
export function SoundPad({ onCue }: { onCue: (cue: SoundCue) => Promise<void> }) {
  const [error, setError] = useState(false);
  return (
    <section className="card" aria-labelledby="sound-pad-title">
      <h2 id="sound-pad-title">Звуки на экране зала</h2>
      <div className="sound-pad">
        {PAD.map((item) => (
          <button
            key={item.sound}
            type="button"
            className={item.sound === "stop" ? "btn btn--quiet" : "btn btn--secondary"}
            onClick={() => {
              setError(false);
              onCue(newCue(item.sound)).catch(() => setError(true));
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          Звук не отправился. Проверьте интернет.
        </p>
      )}
      <p className="muted small">Звук играет только на экране зала, если там включён звук.</p>
    </section>
  );
}
