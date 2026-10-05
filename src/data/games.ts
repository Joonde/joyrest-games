import type { DocumentSnapshot } from "firebase/firestore";
import { sortGames } from "../core/games";
import type { GamesRepository } from "./contracts";
import { asString, toMillis } from "./convert";
import { loadFirestore } from "./firebase";
import type { AgeRating, Game } from "./types";

/** Сколько игр загружается в одну вкладку студии. */
const LIST_LIMIT = 200;

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

  async update(gameId, patch) {
    const { col, sdk } = await gamesCol();
    await sdk.updateDoc(sdk.doc(col, gameId), { ...patch, updatedAt: sdk.serverTimestamp() });
  },

  async remove(gameId) {
    const { col, sdk } = await gamesCol();
    await sdk.deleteDoc(sdk.doc(col, gameId));
  },
};
