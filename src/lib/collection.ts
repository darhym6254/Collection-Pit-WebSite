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
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
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

/** Update printings with a patch. Doc ids derive from the identity key
 *  (name/set/collector/foil/condition/language/binder), so key-field
 *  changes MOVE the document — and when the destination printing already
 *  exists, quantities merge (the desktop's ON CONFLICT upsert rule). */
export async function movePrintings(
  uid: string,
  all: CardRow[],
  targets: CardRow[],
  patch: Partial<CardRow>,
): Promise<void> {
  const byId = new Map(all.map((c) => [cardDocId(c), c]));
  const targetIds = new Set(targets.map((t) => cardDocId(t)));
  const batch = writeBatch(db);
  for (const p of targets) {
    const np = { ...p, ...patch };
    const oldId = cardDocId(p);
    const newId = cardDocId(np);
    if (newId === oldId) {
      batch.set(doc(cardsCol(uid), newId), np);
      continue;
    }
    const existing = byId.get(newId);
    if (existing && !targetIds.has(newId)) {
      np.quantity += existing.quantity;
    }
    batch.delete(doc(cardsCol(uid), oldId));
    batch.set(doc(cardsCol(uid), newId), np);
  }
  await batch.commit();
}

/** Delete specific printings. */
export async function deletePrintings(
  uid: string,
  targets: CardRow[],
): Promise<void> {
  const batch = writeBatch(db);
  for (const p of targets) {
    batch.delete(doc(cardsCol(uid), cardDocId(p)));
  }
  await batch.commit();
}

/** Adjust one printing's quantity (floors at 1 — deleting is explicit). */
export async function adjustQuantity(
  uid: string,
  printing: CardRow,
  delta: number,
): Promise<void> {
  const q = Math.max(1, printing.quantity + delta);
  await updateDoc(doc(cardsCol(uid), cardDocId(printing)), { quantity: q });
}

/** Manually add a printing; merges quantity into an existing identical
 *  printing (same identity key) instead of duplicating. */
export async function addCardManual(
  uid: string,
  all: CardRow[],
  card: CardRow,
): Promise<void> {
  const id = cardDocId(card);
  const existing = all.find((c) => cardDocId(c) === id);
  const merged = existing
    ? { ...existing, ...card, quantity: existing.quantity + card.quantity }
    : card;
  await setDoc(doc(cardsCol(uid), id), merged);
}

/** Delete the WHOLE library (decks/binders metadata untouched). */
export async function clearLibrary(
  uid: string,
  all: CardRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const BATCH = 450;
  let done = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    const batch = writeBatch(db);
    for (const c of chunk) {
      batch.delete(doc(cardsCol(uid), cardDocId(c)));
    }
    await batch.commit();
    done += chunk.length;
    onProgress?.(done, all.length);
  }
  return done;
}

// ── Named binders (persist even when empty, like the desktop) ──────────────

function bindersCol(uid: string) {
  return collection(db, "users", uid, "binders");
}

export function subscribeBinders(
  uid: string,
  cb: (names: string[]) => void,
): Unsubscribe {
  return onSnapshot(bindersCol(uid), (snap) => {
    cb(snap.docs.map((d) => (d.data() as { name: string }).name).sort());
  });
}

export async function createBinder(uid: string, name: string): Promise<void> {
  const bytes = new TextEncoder().encode(name.toLowerCase());
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  const id = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await setDoc(doc(bindersCol(uid), id), { name });
}

// ── Card tags (name-keyed, like the desktop's card_tags table) ─────────────

function tagsCol(uid: string) {
  return collection(db, "users", uid, "cardTags");
}

function tagDocId(name: string): string {
  const bytes = new TextEncoder().encode(name.toLowerCase());
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Live map of lowercased card name -> tags. */
export function subscribeTags(
  uid: string,
  cb: (tags: Map<string, string[]>) => void,
): Unsubscribe {
  return onSnapshot(tagsCol(uid), (snap) => {
    const map = new Map<string, string[]>();
    for (const d of snap.docs) {
      const data = d.data() as { name: string; tags: string[] };
      map.set(data.name.toLowerCase(), data.tags ?? []);
    }
    cb(map);
  });
}

/** Replace a card's tag list (empty list removes the doc). */
export async function setCardTags(
  uid: string,
  name: string,
  tags: string[],
): Promise<void> {
  const ref = doc(tagsCol(uid), tagDocId(name));
  if (tags.length === 0) {
    await deleteDoc(ref);
  } else {
    await setDoc(ref, { name, tags });
  }
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
