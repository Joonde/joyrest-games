import type { DocumentSnapshot } from "firebase/firestore";
import { sortGames } from "../core/games";
import type { GamesRepository } from "./contracts";
import { asString, toMillis } from "./convert";
import { loadFirestore } from "./firebase";
import { mediaDocId } from "./media";
import { parsePlayMode } from "./sessions";
import type { AgeRating, Game, MediaVariant } from "./types";

/** Сколько игр загружается в одну вкладку студии. */
const LIST_LIMIT = 200;

/**
 * Пакет записи при копировании картинок. Запрос к Firestore — не больше 10 МБ,
 * картинка с уменьшенной копией — до ~0,5 МБ, поэтому пачки по 8 картинок.
 */
const COPY_BATCH_IMAGES = 8;
/** Пакет удаления: не больше 500 операций. */
const DELETE_BATCH = 400;
const VARIANTS: MediaVariant[] = ["full", "small"];

async function gamesCol() {
  const { db, sdk } = await loadFirestore();
  return { col: sdk.collection(db, "games"), sdk };
}

function parseAgeRating(value: unknown): AgeRating {
  return value === "12+" || value === "18+" ? value : "0+";
}

function toGame(snap: DocumentSnapshot): Game | null {
  const data = snap.data();
  if (!data) return null;
  return {
    id: snap.id,
    scope: data.scope === "agency" ? "agency" : "personal",
    ownerId: asString(data.ownerId),
    title: asString(data.title),
    mechanic: asString(data.mechanic, "quiz"),
    themeId: asString(data.themeId, "joyrest"),
    ageRating: parseAgeRating(data.ageRating),
    playMode: parsePlayMode(data.playMode),
    content: data.content ?? null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function toGames(docs: DocumentSnapshot[]): Game[] {
  return sortGames(docs.map(toGame).filter((g): g is Game => g !== null));
}

export const gamesRepository: GamesRepository = {
  async listAgency() {
    const { col, sdk } = await gamesCol();
    const snap = await sdk.getDocs(sdk.query(col, sdk.where("scope", "==", "agency"), sdk.limit(LIST_LIMIT)));
    return toGames(snap.docs);
  },

  async listPersonal(ownerId) {
    const { col, sdk } = await gamesCol();
    const snap = await sdk.getDocs(
      sdk.query(col, sdk.where("scope", "==", "personal"), sdk.where("ownerId", "==", ownerId), sdk.limit(LIST_LIMIT)),
    );
    return toGames(snap.docs);
  },

  async get(gameId) {
    const { col, sdk } = await gamesCol();
    return toGame(await sdk.getDoc(sdk.doc(col, gameId)));
  },

  async create(game) {
    const { col, sdk } = await gamesCol();
    const ref = await sdk.addDoc(col, {
      ...game,
      content: game.content ?? null,
      createdAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
    });
    return ref.id;
  },

  async copy(sourceGameId, mediaIds, draft) {
    const { db, sdk } = await loadFirestore();
    const gameRef = sdk.doc(sdk.collection(db, "games"));
    const unique = [...new Set(mediaIds)];
    // Читаем картинки до записи: если источник недоступен, копия не создаётся.
    const sources = await Promise.all(
      unique.flatMap((mediaId) =>
        VARIANTS.map((variant) => sdk.getDoc(sdk.doc(db, "games", sourceGameId, "media", mediaDocId(mediaId, variant)))),
      ),
    );
    const found = sources.filter((snap) => snap.exists());
    const written: string[] = [];
    try {
      // Первая пачка создаёт игру: правила проверяют права на картинки по игре после записи.
      for (let i = 0; i === 0 || i < found.length; i += COPY_BATCH_IMAGES * 2) {
        const batch = sdk.writeBatch(db);
        if (i === 0) {
          batch.set(gameRef, {
            ...draft,
            content: draft.content ?? null,
            createdAt: sdk.serverTimestamp(),
            updatedAt: sdk.serverTimestamp(),
          });
        }
        for (const snap of found.slice(i, i + COPY_BATCH_IMAGES * 2)) {
          const data = snap.data() ?? {};
          batch.set(sdk.doc(gameRef, "media", snap.id), { ...data, createdAt: sdk.serverTimestamp() });
          written.push(snap.id);
        }
        await batch.commit();
      }
    } catch (error) {
      // Без половинчатых копий: убираем то, что успели записать.
      await deleteGameDocs(gameRef.id, written).catch(() => undefined);
      throw error;
    }
    return gameRef.id;
  },

  async update(gameId, patch) {
    const { col, sdk } = await gamesCol();
    await sdk.updateDoc(sdk.doc(col, gameId), { ...patch, updatedAt: sdk.serverTimestamp() });
  },

  async remove(gameId) {
    const { db, sdk } = await loadFirestore();
    const media = await sdk.getDocs(sdk.collection(db, "games", gameId, "media"));
    await deleteGameDocs(
      gameId,
      media.docs.map((d) => d.id),
    );
  },
};

/** Удаляет картинки игры пачками и последней записью — саму игру. */
async function deleteGameDocs(gameId: string, mediaDocIds: string[]): Promise<void> {
  const { db, sdk } = await loadFirestore();
  const gameRef = sdk.doc(db, "games", gameId);
  for (let i = 0; i === 0 || i < mediaDocIds.length; i += DELETE_BATCH) {
    const batch = sdk.writeBatch(db);
    for (const id of mediaDocIds.slice(i, i + DELETE_BATCH)) batch.delete(sdk.doc(gameRef, "media", id));
    // Права на картинки проверяются по игре, поэтому игра удаляется в последней пачке.
    if (i + DELETE_BATCH >= mediaDocIds.length) batch.delete(gameRef);
    await batch.commit();
  }
}
