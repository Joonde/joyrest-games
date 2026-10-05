// Без импорта firebase/firestore: модуль попадает в общий чанк, а SDK грузится отдельно.

interface TimestampLike {
  toMillis(): number;
}

function isTimestamp(value: unknown): value is TimestampLike {
  return typeof value === "object" && value !== null && typeof (value as TimestampLike).toMillis === "function";
}

export function toMillis(value: unknown): number | null {
  return isTimestamp(value) ? value.toMillis() : null;
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
