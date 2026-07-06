/**
 * Firestore collection layer — every user's cards live under
 * /users/{uid}/cards/{printingId}, which the deployed security rules
 * restrict to that signed-in user.
 *
 * Document IDs are deterministic (derived from the printing's identity
 * key), so re-importing the same ManaBox export is idempotent: matching
 * printings are overwritten with the export's quantities, never duplicated.
 */
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  doc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { cardKey, type CardRow } from "./manabox";

/** Firestore-safe deterministic doc id: base64url of the identity key
 *  (card names can contain "/", e.g. double-faced cards). */
export function cardDocId(c: CardRow): string {
  const bytes = new TextEncoder().encode(cardKey(c));
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cardsCol(uid: string) {
  return collection(db, "users", uid, "cards");
}

/** Upsert all parsed printings in batches (Firestore caps a batch at 500
 *  writes). Reports progress as (written, total). Returns docs written. */
export async function importCards(
  uid: string,
  cards: CardRow[],
  onProgress?: (written: number, total: number) => void,
): Promise<number> {
  const BATCH = 450;
  let written = 0;
  for (let i = 0; i < cards.length; i += BATCH) {
    const chunk = cards.slice(i, i + BATCH);
    const batch = writeBatch(db);
    for (const card of chunk) {
      batch.set(doc(cardsCol(uid), cardDocId(card)), card);
    }
    await batch.commit();
    written += chunk.length;
    onProgress?.(written, cards.length);
  }
  return written;
}

/** Live subscription to the user's whole collection, sorted by name. */
export function subscribeCards(
  uid: string,
  cb: (cards: CardRow[]) => void,
): Unsubscribe {
  const q = query(cardsCol(uid), orderBy("name"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => d.data() as CardRow));
  });
}

/** Merge Scryfall enrichment patches (keyed by scryfall_id) into every
 *  matching printing document. Batched like the importer. */
export async function applyEnrichment(
  uid: string,
  cards: CardRow[],
  patches: Map<string, Partial<CardRow>>,
  onProgress?: (written: number, total: number) => void,
): Promise<number> {
  const targets = cards.filter((c) => patches.has(c.scryfall_id));
  const BATCH = 450;
  let written = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    const batch = writeBatch(db);
    for (const card of chunk) {
      batch.set(
        doc(cardsCol(uid), cardDocId(card)),
        patches.get(card.scryfall_id)!,
        { merge: true },
      );
    }
    await batch.commit();
    written += chunk.length;
    onProgress?.(written, targets.length);
  }
  return written;
}
