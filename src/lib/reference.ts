/**
 * Card reference — the web equivalent of the desktop's MTGJSON
 * AtomicCards table. Downloads Scryfall's oracle-cards JSON once (a plain
 * GET), builds a name-keyed lookup of gameplay fields, and caches it in
 * IndexedDB so later visits load instantly and work offline.
 *
 * READ-ONLY by design: the reference never adds cards to the collection
 * and never writes to Firestore — it's joined at display time.
 */

export interface RefEntry {
  type_line: string;
  colors: string;
  color_identity: string;
  mana_cost: string;
  cmc: number;
  oracle_text: string;
  banned_in: string;
}

const BULK_META = "https://api.scryfall.com/bulk-data/oracle-cards";
const DB_NAME = "cp-reference";
const STORE = "kv";

const FORMAT_LABELS: Record<string, string> = {
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  commander: "Commander",
  pauper: "Pauper",
};

// Placeholder layouts share names with real cards — never match them.
const SKIP_LAYOUTS = new Set([
  "reversible_card",
  "art_series",
  "token",
  "double_faced_token",
  "emblem",
]);

interface ScryCard {
  layout?: string;
  name?: string;
  type_line?: string;
  colors?: string[] | null;
  color_identity?: string[];
  mana_cost?: string;
  cmc?: number;
  oracle_text?: string;
  card_faces?: {
    name?: string;
    colors?: string[];
    mana_cost?: string;
    oracle_text?: string;
  }[];
  legalities?: Record<string, string>;
}

function bannedIn(legalities: Record<string, string> | undefined): string {
  if (!legalities) {
    return "";
  }
  const hits: string[] = [];
  for (const [fmt, label] of Object.entries(FORMAT_LABELS)) {
    const v = legalities[fmt];
    if (v === "banned") {
      hits.push(label);
    } else if (v === "restricted") {
      hits.push(`${label} (restricted)`);
    }
  }
  return hits.join(", ");
}

function toEntry(sc: ScryCard): RefEntry {
  let colors = sc.colors ?? null;
  if (colors === null && sc.card_faces) {
    const seen: string[] = [];
    for (const face of sc.card_faces) {
      for (const c of face.colors ?? []) {
        if (!seen.includes(c)) {
          seen.push(c);
        }
      }
    }
    colors = seen;
  }
  let oracle = sc.oracle_text ?? "";
  if (!oracle && sc.card_faces) {
    oracle = sc.card_faces
      .map((f) => f.oracle_text ?? "")
      .filter(Boolean)
      .join("\n//\n");
  }
  return {
    type_line: sc.type_line ?? "",
    colors: (colors ?? []).join(","),
    color_identity: (sc.color_identity ?? []).join(","),
    mana_cost:
      sc.mana_cost ||
      (sc.card_faces ? (sc.card_faces[0].mana_cost ?? "") : ""),
    cmc: sc.cmc ?? 0,
    oracle_text: oracle,
    banned_in: bannedIn(sc.legalities),
  };
}

// ── Tiny IndexedDB key-value helpers ────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Loading ─────────────────────────────────────────────────────────────────

function buildIndex(all: ScryCard[]): Map<string, RefEntry> {
  const byName = new Map<string, RefEntry>();
  for (const sc of all) {
    if (SKIP_LAYOUTS.has(sc.layout ?? "")) {
      continue;
    }
    const entry = toEntry(sc);
    const full = (sc.name ?? "").toLowerCase();
    if (full && !byName.has(full)) {
      byName.set(full, entry);
    }
    // Front-face alias so "A // B" also matches plain "A".
    const front = (sc.card_faces?.[0]?.name ?? "").toLowerCase();
    if (front && !byName.has(front)) {
      byName.set(front, entry);
    }
  }
  return byName;
}

/** Load the reference: cached copy first (instant, offline-friendly),
 *  refreshed automatically when Scryfall publishes a new bulk file. */
export async function loadReference(
  onStatus?: (msg: string) => void,
): Promise<Map<string, RefEntry>> {
  // 1. Which bulk file is current? (Cheap GET; skipped errors fall back
  //    to whatever is cached.)
  let currentUri = "";
  try {
    const metaRes = await fetch(BULK_META);
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as { download_uri: string };
      currentUri = meta.download_uri;
    }
  } catch {
    // offline — try the cache
  }

  // 2. Cached and current? Use it.
  try {
    const cachedUri = await kvGet<string>("uri");
    if (cachedUri && (currentUri === "" || cachedUri === currentUri)) {
      const entries = await kvGet<[string, RefEntry][]>("entries");
      if (entries && entries.length > 0) {
        onStatus?.(`Reference: ${entries.length.toLocaleString()} cards`);
        return new Map(entries);
      }
    }
  } catch {
    // cache unreadable — fall through to download
  }

  if (!currentUri) {
    throw new Error("No cached reference and Scryfall is unreachable.");
  }

  // 3. Download and cache.
  onStatus?.("Downloading card reference (~40 MB, one-time)…");
  const res = await fetch(currentUri);
  if (!res.ok) {
    throw new Error(`reference download responded ${res.status}`);
  }
  const all = (await res.json()) as ScryCard[];
  onStatus?.("Indexing reference…");
  const map = buildIndex(all);
  try {
    await kvSet("entries", [...map.entries()]);
    await kvSet("uri", currentUri);
  } catch {
    // cache write failed (private mode / quota) — still usable in-memory
  }
  onStatus?.(`Reference: ${map.size.toLocaleString()} cards`);
  return map;
}
