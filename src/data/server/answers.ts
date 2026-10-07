/**
 * Ответы на своём сервере: один ответ на шаг (повтор — «rejected»), время ставит сервер.
 * Список ответов шага слушает только пульт.
 */
import type { AnswersRepository } from "../contracts";
import { errorCodeOf } from "../retry";
import type { Answer } from "../types";
import { api, asRecord, asText } from "./api";
import { openStream } from "./stream";

function parseAnswer(value: unknown): Answer | null {
  const d = asRecord(value);
  const pid = asText(d.pid);
  if (!pid || typeof d.step !== "number") return null;
  return {
    id: asText(d.id) || `${d.step}_${pid}`,
    step: d.step,
    pid,
    uid: asText(d.uid),
    value: d.value ?? null,
    submittedAt: typeof d.submittedAt === "number" ? d.submittedAt : null,
  };
}

function parseList(value: unknown): Answer[] {
  return (Array.isArray(value) ? value : []).map(parseAnswer).filter((a): a is Answer => a !== null);
}

const base = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/answers`;

export const serverAnswersRepository: AnswersRepository = {
  async submit(sessionId, step, pid, _uid, value) {
    const data = asRecord(await api("POST", base(sessionId), { step, pid, value }));
    return data.result === "sent" ? "sent" : "rejected";
  },

  async getOwn(sessionId, step, pid) {
    try {
      return parseAnswer(await api("GET", `${base(sessionId)}/${step}/${encodeURIComponent(pid)}`));
    } catch (error) {
      if (errorCodeOf(error) === "not-found") return null;
      throw error;
    }
  },

  async clearStep(sessionId, step) {
    await api("DELETE", `${base(sessionId)}/${step}`);
  },

  watch(sessionId, step, onChange, onError) {
    const all = new Map<string, Answer>();
    const emit = () => onChange([...all.values()]);
    const onEvent = (event: { type?: string; answers?: unknown; answer?: unknown }) => {
      if (event.type === "snapshot") {
        all.clear();
        for (const a of parseList(event.answers)) all.set(a.id, a);
      } else if (event.type === "answer") {
        const a = parseAnswer(event.answer);
        if (!a || a.step !== step) return;
        all.set(a.id, a);
      } else if (event.type === "clear") {
        all.clear();
      } else return;
      emit();
    };
    return openStream({
      url: `/api/stream/answers/${encodeURIComponent(sessionId)}/${step}`,
      onEvent,
      onError,
      poll: async () => onEvent({ type: "snapshot", answers: await api("GET", `${base(sessionId)}/${step}`) }),
    });
  },
};
