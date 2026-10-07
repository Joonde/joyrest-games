/**
 * Перенос из Firebase на свой сервер (PR 5, CLAUDE.md, «Перенос из Firebase»): браузер
 * владельца агентства читает Firebase (отдельный экземпляр в памяти) и пачками пишет на
 * `/api/import/...`. Повторный запуск безопасен. Пароль Firebase уходит только в Firebase.
 */
import type { DocumentSnapshot } from "firebase/firestore";
import { ADMIN_UID } from "./config";
import { loadImportFirebase } from "./firebase";
import { toGame } from "./games";
import { chunks, mediaRefs } from "./importPlan";
import { mediaDocId } from "./media";
import { toResult } from "./results";
import { errorCodeOf } from "./retry";
import { api, ApiError, asRecord } from "./server/api";
import { toHost } from "./users";
import type { MediaIdsOf } from "./importPlan";
import type { Game, MediaVariant } from "./types";

export type ImportStage = "signin" | "users" | "games" | "media" | "results" | "verify";

export interface ImportProgress {
  stage: ImportStage;
  done: number;
  total: number;
}

export interface ImportCount {
  kind: "users" | "games" | "media" | "results";
  /** Сколько нашлось в Firebase. */
  firebase: number;
  /** Сколько из них есть на своём сервере после переноса. */
  server: number;
}

export interface ImportReport {
  counts: ImportCount[];
  /** Перенесённые ведущие без пароля: им нужен «Новый временный пароль». */
  withoutPassword: number;
  /** Ведущие, которых не перенесли: почта занята другим аккаунтом или пустая. */
  skippedHosts: Array<{ name: string; email: string; reason: "invalid" | "email-taken" }>;
  /** Картинки, которые перенести нельзя: нет в Firebase (удалены раньше) или файл повреждён. */
  lostImages: number;
}

export type { MediaIdsOf } from "./importPlan";

export interface FirebaseImport {
  run(email: string, password: string, mediaIdsOf: MediaIdsOf, onProgress: (progress: ImportProgress) => void): Promise<ImportReport>;
}

/** Ошибка переноса с понятным текстом: вошли не тем аккаунтом. */
export class NotOwnerError extends Error {
  constructor() {
    super("not-owner");
    this.name = "NotOwnerError";
  }
}

const VARIANTS: MediaVariant[] = ["full", "small"];
const PARALLEL_UPLOADS = 3;

/** Повтор при обрыве связи и сбое сервера: 1, 2, 4 секунды. */
async function retrying<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      const code = errorCodeOf(error);
      const network = code === "unavailable" || code === "deadline-exceeded" || error instanceof TypeError;
      if (!network || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

interface BytesLike {
  toUint8Array(): Uint8Array;
}

function isBytes(value: unknown): value is BytesLike {
  return typeof value === "object" && value !== null && typeof (value as BytesLike).toUint8Array === "function";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function putImport(path: string, bytes: Uint8Array, mime: string, width: number, height: number): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Content-Type": mime === "image/jpeg" ? "image/jpeg" : "image/webp",
        "X-JoyRest": "1",
        "X-Width": String(Math.max(1, Math.round(width))),
        "X-Height": String(Math.max(1, Math.round(height))),
      },
      body: new Blob([new Uint8Array(bytes)]),
    });
  } catch {
    throw new ApiError("unavailable", 0);
  }
  if (!response.ok) {
    const data = asRecord(await response.json().catch(() => null));
    throw new ApiError(typeof data.error === "string" ? data.error : response.status >= 500 ? "unavailable" : "invalid-argument", response.status);
  }
}

export const firebaseImport: FirebaseImport = {
  async run(email, password, mediaIdsOf, onProgress) {
    onProgress({ stage: "signin", done: 0, total: 1 });
    const { auth, authSdk, db, sdk } = await loadImportFirebase();
    const credential = await authSdk.signInWithEmailAndPassword(auth, email.trim(), password);
    try {
      // Переносит только владелец агентства: только он видит в Firebase все игры и историю.
      if (credential.user.uid !== ADMIN_UID) throw new NotOwnerError();

      // ---------- ведущие
      const userDocs = (await sdk.getDocs(sdk.collection(db, "users"))).docs;
      const hosts = userDocs.map((d) => toHost(d.id, d.data()));
      onProgress({ stage: "users", done: 0, total: hosts.length });
      const skippedHosts: ImportReport["skippedHosts"] = [];
      let usersDone = 0;
      for (const batch of chunks(hosts, 100)) {
        const data = asRecord(
          await retrying(() =>
            api("POST", "/api/import/users", {
              users: batch.map((h) => ({ uid: h.uid, email: h.email, name: h.name, role: h.role, active: h.active, createdAt: h.createdAt })),
            }),
          ),
        );
        for (const raw of Array.isArray(data.skipped) ? data.skipped : []) {
          const item = asRecord(raw);
          const host = batch.find((h) => h.uid === item.id);
          if (host) skippedHosts.push({ name: host.name, email: host.email, reason: item.reason === "email-taken" ? "email-taken" : "invalid" });
        }
        usersDone += batch.length;
        onProgress({ stage: "users", done: usersDone, total: hosts.length });
      }

      // ---------- игры
      const gameDocs: DocumentSnapshot[] = (await sdk.getDocs(sdk.collection(db, "games"))).docs;
      const games = gameDocs.map(toGame).filter((g): g is Game => g !== null);
      onProgress({ stage: "games", done: 0, total: games.length });
      let gamesDone = 0;
      for (const batch of chunks(games, 40, 1_500_000)) {
        await retrying(() => api("POST", "/api/import/games", { games: batch }));
        gamesDone += batch.length;
        onProgress({ stage: "games", done: gamesDone, total: games.length });
      }

      // ---------- картинки: сервер говорит, каких нет, браузер читает их из Firebase по id
      const refs = mediaRefs(games, mediaIdsOf);
      const missing: Array<{ game: string; media: string; variant: MediaVariant }> = [];
      for (const batch of chunks(refs, 1000)) {
        const data = asRecord(await retrying(() => api("POST", "/api/import/media-missing", { items: batch })));
        for (const raw of Array.isArray(data.missing) ? data.missing : []) {
          const item = asRecord(raw);
          if (typeof item.game === "string" && typeof item.media === "string" && (item.variant === "full" || item.variant === "small")) {
            missing.push({ game: item.game, media: item.media, variant: item.variant });
          }
        }
      }
      onProgress({ stage: "media", done: 0, total: missing.length });
      let lostImages = 0;
      let mediaDone = 0;
      let next = 0;
      const worker = async () => {
        while (next < missing.length) {
          const item = missing[next++];
          if (!item) break;
          const snap = await retrying(() => sdk.getDoc(sdk.doc(db, "games", item.game, "media", mediaDocId(item.media, item.variant))));
          const data = snap.data();
          if (!data || !isBytes(data.bytes)) {
            lostImages += 1;
          } else {
            const bytes = data.bytes.toUint8Array();
            try {
              await retrying(() =>
                putImport(
                  `/api/import/media/${encodeURIComponent(item.game)}/${encodeURIComponent(item.media)}/${item.variant}`,
                  bytes,
                  typeof data.mime === "string" ? data.mime : "image/webp",
                  num(data.width) || 1,
                  num(data.height) || 1,
                ),
              );
            } catch (error) {
              const code = errorCodeOf(error);
              // Под этим id уже другая картинка — оставляем ту, что на сервере.
              if (code === "invalid-argument") lostImages += 1;
              else if (code !== "already-exists") throw error;
            }
          }
          mediaDone += 1;
          onProgress({ stage: "media", done: mediaDone, total: missing.length });
        }
      };
      await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker));

      // ---------- история
      const resultDocs = (await sdk.getDocs(sdk.collection(db, "results"))).docs;
      const results = resultDocs.map(toResult).filter((r): r is NonNullable<ReturnType<typeof toResult>> => r !== null);
      onProgress({ stage: "results", done: 0, total: results.length });
      let resultsDone = 0;
      for (const batch of chunks(results, 150)) {
        await retrying(() => api("POST", "/api/import/results", { results: batch }));
        resultsDone += batch.length;
        onProgress({ stage: "results", done: resultsDone, total: results.length });
      }

      // ---------- сверка: сколько из найденного в Firebase есть на сервере
      onProgress({ stage: "verify", done: 0, total: 1 });
      const mediaKeys = refs.flatMap((r) => VARIANTS.map((variant) => ({ ...r, variant })));
      const found = { users: 0, games: 0, results: 0, media: 0, withoutPassword: 0 };
      const parts = Math.max(1, Math.ceil(Math.max(hosts.length, games.length, results.length, mediaKeys.length) / 4000));
      for (let i = 0; i < parts; i++) {
        const slice = <T,>(list: T[]) => list.slice(Math.ceil((list.length * i) / parts), Math.ceil((list.length * (i + 1)) / parts));
        const data = asRecord(
          await retrying(() =>
            api("POST", "/api/import/verify", {
              users: slice(hosts).map((h) => h.uid),
              games: slice(games).map((g) => g.id),
              results: slice(results).map((r) => r.id),
              media: slice(mediaKeys),
            }),
          ),
        );
        found.users += num(data.users);
        found.games += num(data.games);
        found.results += num(data.results);
        found.media += num(data.media);
        found.withoutPassword += num(data.withoutPassword);
      }
      onProgress({ stage: "verify", done: 1, total: 1 });

      return {
        counts: [
          { kind: "users", firebase: hosts.length, server: found.users },
          { kind: "games", firebase: games.length, server: found.games },
          // Потерянные в Firebase картинки перенести нельзя — в сверке их не ждём.
          { kind: "media", firebase: mediaKeys.length - lostImages, server: found.media },
          { kind: "results", firebase: results.length, server: found.results },
        ],
        withoutPassword: found.withoutPassword,
        skippedHosts,
        lostImages,
      };
    } finally {
      await authSdk.signOut(auth).catch(() => undefined);
    }
  },
};
