/**
 * Shopping list — a manual want-list at /users/{uid}/wishlist plus the
 * automatic "missing from decks" aggregate, mirroring the desktop's
 * Shopping List view. Marking a card owned ADDS it to the library (the
 * only non-CSV path that does, same as the desktop's Mark as Owned).
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { allocatedMap, ownedMap, type Deck } from "./decks";
import type { CardRow } from "./manabox";

export interface WishEntry {
  card_name: string;
  quantity: number;
}

function wishCol(uid: string) {
  return collection(db, "users", uid, "wishlist");
}

function wishDocId(name: string): string {
  const bytes = new TextEncoder().encode(name.toLowerCase());
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function subscribeWishlist(
  uid: string,
  cb: (entries: WishEntry[]) => void,
): Unsubscribe {
  return onSnapshot(wishCol(uid), (snap) => {
    const list = snap.docs.map((d) => d.data() as WishEntry);
    list.sort((a, b) => a.card_name.localeCompare(b.card_name));
    cb(list);
  });
}

/** Add copies (merges into an existing entry by name). */
export async function addToWishlist(
  uid: string,
  existing: WishEntry[],
  name: string,
  qty: number,
): Promise<void> {
  const cur = existing.find(
    (e) => e.card_name.toLowerCase() === name.toLowerCase(),
  );
  await setDoc(doc(wishCol(uid), wishDocId(name)), {
    card_name: cur?.card_name ?? name,
    quantity: (cur?.quantity ?? 0) + qty,
  });
}

export async function removeFromWishlist(
  uid: string,
  name: string,
): Promise<void> {
  await deleteDoc(doc(wishCol(uid), wishDocId(name)));
}

/** Missing-from-decks aggregate: for every name any deck wants, compare
 *  the total desired copies against owned; missing rows include which
 *  decks want the card. */
export interface MissingRow {
  name: string;
  need: number;
  owned: number;
  missing: number;
  decks: string[];
}

export function missingFromDecks(
  cards: CardRow[],
  decks: Deck[],
): MissingRow[] {
  const owned = ownedMap(cards);
  const need = allocatedMap(decks);
  const deckNames = new Map<string, Set<string>>();
  const displayName = new Map<string, string>();
  for (const d of decks) {
    for (const c of d.cards) {
      const k = c.card_name.toLowerCase();
      deckNames.set(k, (deckNames.get(k) ?? new Set()).add(d.name));
      if (!displayName.has(k)) {
        displayName.set(k, c.card_name);
      }
    }
  }
  const rows: MissingRow[] = [];
  for (const [k, n] of need) {
    const own = owned.get(k) ?? 0;
    if (n > own) {
      rows.push({
        name: displayName.get(k) ?? k,
        need: n,
        owned: own,
        missing: n - own,
        decks: [...(deckNames.get(k) ?? [])].sort(),
      });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
