/**
 * Decks — Firestore-backed, mirroring the desktop's deck model and
 * services (models/deck.py, services/decklist.py, services/legality.py).
 *
 * A deck entry holds the DESIRED copy count — decks may reference cards
 * you don't own, and the library's owned counts are never changed by
 * deck operations.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { colorLetters } from "./colors";
import type { CardRow } from "./manabox";
import type { RefEntry } from "./reference";

export interface DeckCard {
  card_name: string;
  quantity: number;
  is_commander: boolean;
  is_sideboard: boolean;
  category: string;
}

export interface Deck {
  id: string;
  name: string;
  format: string;
  cards: DeckCard[];
}

export const FORMATS = [
  "Commander",
  "Standard",
  "Pioneer",
  "Modern",
  "Legacy",
  "Vintage",
  "Pauper",
];

export const COMMANDER_FORMATS = new Set(["Commander"]);
const SINGLETON_FORMATS = new Set(["Commander"]);

// ── CRUD ────────────────────────────────────────────────────────────────────

function decksCol(uid: string) {
  return collection(db, "users", uid, "decks");
}

export function subscribeDecks(
  uid: string,
  cb: (decks: Deck[]) => void,
): Unsubscribe {
  return onSnapshot(decksCol(uid), (snap) => {
    const decks = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Deck, "id">),
    }));
    decks.sort((a, b) => a.name.localeCompare(b.name));
    cb(decks);
  });
}

export async function createDeck(
  uid: string,
  name: string,
  format: string,
  cards: DeckCard[] = [],
): Promise<string> {
  const ref = await addDoc(decksCol(uid), { name, format, cards });
  return ref.id;
}

export async function saveDeck(uid: string, deck: Deck): Promise<void> {
  await setDoc(doc(decksCol(uid), deck.id), {
    name: deck.name,
    format: deck.format,
    cards: deck.cards,
  });
}

export async function deleteDeck(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(decksCol(uid), id));
}

/** Merge copies into a deck entry (same name + zone), like the desktop. */
export function withCardAdded(
  deck: Deck,
  name: string,
  qty: number,
  isCommander = false,
  isSideboard = false,
): Deck {
  const cards = [...deck.cards];
  const at = cards.findIndex(
    (c) =>
      c.card_name.toLowerCase() === name.toLowerCase() &&
      c.is_commander === isCommander &&
      c.is_sideboard === isSideboard,
  );
  if (at >= 0) {
    cards[at] = { ...cards[at], quantity: cards[at].quantity + qty };
  } else {
    cards.push({
      card_name: name,
      quantity: qty,
      is_commander: isCommander,
      is_sideboard: isSideboard,
      category: "",
    });
  }
  return { ...deck, cards };
}

// ── Decklist parsing (services/decklist.py) ─────────────────────────────────

/** Parse "4 Lightning Bolt" / "4x Lightning Bolt" text decklists with
 *  optional sideboard sections ("Sideboard", "SB:" prefixes). */
export function parseDecklistText(text: string): DeckCard[] {
  const out: DeckCard[] = [];
  let sideboard = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) {
      continue;
    }
    if (/^(sideboard|side board)\b/i.test(line)) {
      sideboard = true;
      continue;
    }
    let sb = sideboard;
    if (/^SB:\s*/i.test(line)) {
      sb = true;
      line = line.replace(/^SB:\s*/i, "");
    }
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const qty = m ? parseInt(m[1], 10) : 1;
    const name = (m ? m[2] : line).trim();
    if (!name) {
      continue;
    }
    out.push({
      card_name: name,
      quantity: qty,
      is_commander: false,
      is_sideboard: sb,
      category: "",
    });
  }
  return out;
}

// ── Ownership / availability math (the desktop's invariants) ───────────────
//   owned(name)     = SUM(cards.quantity)      — never reduced by decks
//   allocated(name) = SUM(deck_cards.quantity) — across ALL decks
//   available       = owned - allocated

export function ownedMap(cards: CardRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) {
    const k = c.name.toLowerCase();
    m.set(k, (m.get(k) ?? 0) + c.quantity);
  }
  return m;
}

export function allocatedMap(decks: Deck[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of decks) {
    for (const c of d.cards) {
      const k = c.card_name.toLowerCase();
      m.set(k, (m.get(k) ?? 0) + c.quantity);
    }
  }
  return m;
}

/** Row status like the desktop's deck_row_status: red = you don't own
 *  enough copies at all; amber = owned but tied up in other decks. */
export function rowStatus(
  need: number,
  owned: number,
  otherAllocated: number,
): { status: "ok" | "tight" | "missing"; missing: number } {
  if (owned >= need + otherAllocated) {
    return { status: "ok", missing: 0 };
  }
  if (owned >= need) {
    return { status: "tight", missing: 0 };
  }
  return { status: "missing", missing: need - owned };
}

// ── Legality (services/legality.py, data via the Scryfall reference) ────────

export interface DeckVerdict {
  legal: boolean;
  issues: [string, string][]; // (card name, reason)
  unknown: string[]; // names the reference doesn't know — never asserted
}

export function validateDeck(
  deck: Deck,
  lookup: (name: string) => RefEntry | undefined,
): DeckVerdict {
  const fmt = deck.format.toLowerCase();
  const issues: [string, string][] = [];
  const unknown: string[] = [];

  // Commander color identity: union of the commanders' identities.
  let commanderIdentity: Set<string> | null = null;
  if (COMMANDER_FORMATS.has(deck.format)) {
    const commanders = deck.cards.filter((c) => c.is_commander);
    if (commanders.length > 0) {
      commanderIdentity = new Set<string>();
      for (const c of commanders) {
        const ref = lookup(c.card_name);
        if (!ref) {
          commanderIdentity = null; // unknown commander -> don't assert
          break;
        }
        for (const l of colorLetters(ref.color_identity)) {
          commanderIdentity.add(l);
        }
      }
    }
  }

  const seen = new Set<string>();
  for (const entry of deck.cards) {
    const key = entry.card_name.toLowerCase();
    const ref = lookup(entry.card_name);
    if (!ref) {
      if (!seen.has(key)) {
        unknown.push(entry.card_name);
        seen.add(key);
      }
      continue;
    }
    const status = ref.legalities[fmt] ?? "not_legal";
    if (status === "banned") {
      issues.push([entry.card_name, `banned in ${deck.format}`]);
    } else if (status === "not_legal") {
      issues.push([entry.card_name, `not legal in ${deck.format}`]);
    } else if (status === "restricted" && entry.quantity > 1) {
      issues.push([entry.card_name, `restricted — max 1 copy`]);
    }
    const isBasic = ref.type_line.includes("Basic");
    if (
      SINGLETON_FORMATS.has(deck.format) &&
      !isBasic &&
      entry.quantity > 1
    ) {
      issues.push([entry.card_name, "singleton format — max 1 copy"]);
    }
    if (commanderIdentity && !entry.is_commander) {
      const identity = colorLetters(ref.color_identity);
      if (!identity.every((l) => commanderIdentity!.has(l))) {
        issues.push([
          entry.card_name,
          "outside the commander's color identity",
        ]);
      }
    }
  }
  return { legal: issues.length === 0, issues, unknown };
}

// ── Analytics (services/analytics.py) ───────────────────────────────────────

export interface DeckAnalytics {
  curve: number[]; // buckets 0,1,2,3,4,5,6,7+ (non-land)
  colors: Map<string, number>; // identity letters incl. C
  types: Map<string, number>;
  avgMv: number;
  total: number;
  lands: number;
}

export function computeAnalytics(
  deck: Deck,
  lookup: (name: string) => RefEntry | undefined,
): DeckAnalytics {
  const curve = new Array(8).fill(0);
  const colors = new Map<string, number>();
  const types = new Map<string, number>();
  let mvSum = 0;
  let mvCount = 0;
  let total = 0;
  let lands = 0;
  for (const entry of deck.cards) {
    if (entry.is_sideboard) {
      continue;
    }
    total += entry.quantity;
    const ref = lookup(entry.card_name);
    if (!ref) {
      continue;
    }
    const isLand = ref.type_line.includes("Land");
    if (isLand) {
      lands += entry.quantity;
    } else {
      const bucket = Math.min(7, Math.max(0, Math.round(ref.cmc)));
      curve[bucket] += entry.quantity;
      mvSum += ref.cmc * entry.quantity;
      mvCount += entry.quantity;
    }
    const idents = colorLetters(ref.color_identity);
    if (idents.length === 0) {
      colors.set("C", (colors.get("C") ?? 0) + entry.quantity);
    }
    for (const l of idents) {
      colors.set(l, (colors.get(l) ?? 0) + entry.quantity);
    }
    const main = ref.type_line.split("—")[0].trim();
    for (const t of [
      "Creature",
      "Planeswalker",
      "Battle",
      "Instant",
      "Sorcery",
      "Enchantment",
      "Artifact",
      "Land",
    ]) {
      if (main.includes(t)) {
        types.set(t, (types.get(t) ?? 0) + entry.quantity);
        break;
      }
    }
  }
  return {
    curve,
    colors,
    types,
    avgMv: mvCount ? mvSum / mvCount : 0,
    total,
    lands,
  };
}
