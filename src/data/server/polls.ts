/** «Опрос гостей заранее» для «100 к 1» на своём сервере: `/api/polls…` (`server/src/polls.ts`). */
import { parsePollEdits, parsePollQuestions } from "../../core/polls";
import type { PollsRepository } from "../contracts";
import type { PollForm, PollSummary } from "../types";
import { api, ApiError, asRecord, asText } from "./api";

const enc = encodeURIComponent;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Повтор на обрыве связи: анкету открывают дома с мобильного интернета. */
async function retrying<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const retriable = error instanceof ApiError && error.code === "unavailable";
      if (!retriable || attempt >= attempts - 1) throw error;
      await pause(1000 * 2 ** attempt);
    }
  }
}

function parseForm(value: unknown): PollForm | null {
  const d = asRecord(value);
  const id = asText(d.id);
  if (!id) return null;
  return { id, title: asText(d.title), questions: parsePollQuestions(d.questions), open: d.open === true };
}

function parseResponses(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [qid, list] of Object.entries(asRecord(value))) out[qid] = Array.isArray(list) ? list.filter((t): t is string => typeof t === "string") : [];
  return out;
}

const missing = (error: unknown) => error instanceof ApiError && (error.code === "not-found" || error.code === "permission-denied");

export const serverPollsRepository: PollsRepository = {
  async form(id) {
    try {
      return parseForm(await retrying(() => api("GET", `/api/polls/${enc(id)}/form`)));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
  async submit(input) {
    await retrying(() => api("POST", `/api/polls/${enc(input.pollId)}/answers`, { id: input.respondentId, answers: input.answers, website: input.website }));
  },
  async get(id) {
    try {
      const d = asRecord(await api("GET", `/api/polls/${enc(id)}`));
      const form = parseForm(d);
      if (!form) return null;
      const summary: PollSummary = {
        ...form,
        gameId: asText(d.gameId),
        respondents: typeof d.respondents === "number" ? d.respondents : 0,
        responses: parseResponses(d.responses),
        edits: parsePollEdits(d.edits),
      };
      return summary;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
  async save(poll) {
    await api("POST", "/api/polls", poll);
  },
  async remove(id) {
    await api("DELETE", `/api/polls/${enc(id)}`);
  },
};
