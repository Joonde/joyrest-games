import { useEffect, useState } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  /** Что подставить, если поле оставили пустым. */
  fallback: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * Числовое поле, которое не мешает набирать: пока человек печатает, видно то, что он ввёл
 * («1» на пути к «15»), а в границы число приводится, когда он уходит с поля.
 */
export function ClampedNumber({ value, min, max, fallback, disabled, onChange }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const commit = (text: string) => {
    const parsed = Number.parseInt(text, 10);
    const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setDraft(e.target.value);
        // Число уже в границах — сохраняем сразу (автосохранение не ждёт ухода с поля).
        const parsed = Number.parseInt(e.target.value, 10);
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max && parsed !== value) onChange(parsed);
      }}
      onBlur={(e) => {
        setEditing(false);
        commit(e.target.value);
      }}
    />
  );
}
