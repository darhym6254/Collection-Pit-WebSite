/**
 * Opt-in Scryfall enrichment — the web cousin of the desktop's
 * "Scryfall Online" button. Two strategies:
 *
 * 1. Per-printing lookups via POST /cards/collection (75 ids per batch,
 *    retried with backoff, gently paced). Most precise: exact printing
 *    data plus refreshed prices.
 * 2. Bulk fallback: download Scryfall's oracle-cards file (one GET, the
 *    same kind of request card images use, so it survives ad-blockers
 *    that kill API POSTs) and match by card NAME — exactly how the
 *    desktop's AtomicCards reference works. No price refresh.
 *
 * Never runs automatically.
 */
import type { CardRow } from "./manabox";

const ENDPOINT = "https://api.scryfall.com/cards/collection";
const BULK_META = "https://api.scryfall.com/bulk-data/oracle-cards";
const BATCH = 75;
const DELAY_MS = 250; // ~4 requests/s — well under Scryfall's limit
const RETRIES = 3;

interface ScryCard {
  id: string;
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
  prices?: { usd?: string | null; usd_foil?: string | null };
}

export interface EnrichResult {
  patches: Map<string, Partial<CardRow>>;
  /** True when some batches failed even after retries — the caller
   *  should fall back to the bulk path for the remainder. */
  incomplete: boolean;
}

const FORMAT_LABELS: Record<string, string> = {
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  commander: "Commander",
  pauper: "Pauper",
};

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

function toPatch(sc: ScryCard, withPrices: boolean): Partial<CardRow> {
  // DFC/modal cards keep colors on their faces (desktop from_scryfall rule).
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
  const mana =
    sc.mana_cost || (sc.card_faces ? (sc.card_faces[0].mana_cost ?? "") : "");
  const patch: Partial<CardRow> = {
    type_line: sc.type_line ?? "",
    colors: (colors ?? []).join(","),
    color_identity: (sc.color_identity ?? []).join(","),
    mana_cost: mana,
    cmc: sc.cmc ?? 0,
    oracle_text: oracle,
    banned_in: bannedIn(sc.legalities),
  };
  if (withPrices) {
    const usd = parseFloat(sc.prices?.usd ?? "");
    const usdFoil = parseFloat(sc.prices?.usd_foil ?? "");
    if (Number.isFinite(usd)) {
      patch.price_usd = usd;
    }
    if (Number.isFinite(usdFoil)) {
      patch.price_foil = usdFoil;
    }
  }
  return patch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postBatch(ids: string[]): Promise<ScryCard[]> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(800 * attempt * attempt); // 0.8s, 3.2s backoff
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ids.map((id) => ({ id })) }),
      });
      if (res.status === 429) {
        lastErr = new Error("rate limited");
        continue;
      }
      if (!res.ok) {
        throw new Error(`Scryfall responded ${res.status}`);
      }
      const body = (await res.json()) as { data?: ScryCard[] };
      return body.data ?? [];
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function idsNeeding(cards: CardRow[], force: boolean): string[] {
  return [
    ...new Set(
      cards
        .filter((c) => c.scryfall_id && (force || !c.type_line))
        .map((c) => c.scryfall_id),
    ),
  ];
}

/** Strategy 1: precise per-printing lookups. Returns whatever succeeded;
 *  incomplete=true when batches kept failing (blocked network etc). */
export async function fetchEnrichment(
  cards: CardRow[],
  onProgress?: (done: number, total: number) => void,
  force = false,
): Promise<EnrichResult> {
  const ids = idsNeeding(cards, force);
  const patches = new Map<string, Partial<CardRow>>();
  let incomplete = false;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    try {
      for (const sc of await postBatch(chunk)) {
        patches.set(sc.id, toPatch(sc, true));
      }
    } catch {
      incomplete = true;
      break; // keep what we have; the bulk fallback covers the rest
    }
    onProgress?.(Math.min(i + BATCH, ids.length), ids.length);
    if (i + BATCH < ids.length) {
      await sleep(DELAY_MS);
    }
  }
  return { patches, incomplete };
}

/** Strategy 2: one bulk GET, matched by NAME (the desktop's reference
 *  approach). Patches carry no prices. */
export async function fetchBulkEnrichment(
  cards: CardRow[],
  onStatus?: (msg: string) => void,
): Promise<Map<string, Partial<CardRow>>> {
  onStatus?.("Fetching Scryfall bulk index…");
  const metaRes = await fetch(BULK_META);
  if (!metaRes.ok) {
    throw new Error(`bulk index responded ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as { download_uri: string };
  onStatus?.("Downloading Scryfall card data (~40 MB, one-time)…");
  const dataRes = await fetch(meta.download_uri);
  if (!dataRes.ok) {
    throw new Error(`bulk download responded ${dataRes.status}`);
  }
  const all = (await dataRes.json()) as ScryCard[];
  onStatus?.(`Matching ${all.length} cards by name…`);

  // Placeholder layouts (reversible-card "Card // Card" objects, art
  // series, tokens) share names with real cards — never let them match.
  const SKIP_LAYOUTS = new Set([
    "reversible_card",
    "art_series",
    "token",
    "double_faced_token",
    "emblem",
  ]);
  const byName = new Map<string, Partial<CardRow>>();
  for (const sc of all) {
    if (SKIP_LAYOUTS.has(sc.layout ?? "")) {
      continue;
    }
    const patch = toPatch(sc, false);
    const full = (sc.name ?? "").toLowerCase();
    if (full && !byName.has(full)) {
      byName.set(full, patch);
    }
    // Front-face alias so "A // B" matches exports that use just "A".
    const front = (sc.card_faces?.[0]?.name ?? "").toLowerCase();
    if (front && !byName.has(front)) {
      byName.set(front, patch);
    }
  }

  const patches = new Map<string, Partial<CardRow>>();
  for (const c of cards) {
    if (!c.scryfall_id || c.type_line) {
      continue;
    }
    const patch = byName.get(c.name.toLowerCase());
    if (patch) {
      patches.set(c.scryfall_id, patch);
    }
  }
  return patches;
}

/** Card image URL for a printing (preview panel). */
export function imageUrl(scryfallId: string): string {
  return `https://api.scryfall.com/cards/${scryfallId}?format=image&version=normal`;
}

/** Printing identifiers for deck cards you don't own, looked up by NAME
 *  via /cards/collection (75 per call), cached per session. */
export interface NamePrinting {
  scryfall_id: string;
  set_code: string;
  rarity: string;
}

const nameCache = new Map<string, NamePrinting | null>();

export async function lookupPrintingsByName(
  names: string[],
): Promise<Map<string, NamePrinting>> {
  const wanted = [...new Set(names.map((n) => n.toLowerCase()))];
  const missing = wanted.filter((n) => !nameCache.has(n));
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifiers: chunk.map((name) => ({ name })),
        }),
      });
      if (!res.ok) {
        break; // blocked (ad-blocker) — leave uncached, degrade gracefully
      }
      const body = (await res.json()) as {
        data?: (ScryCard & { set?: string; rarity?: string; name?: string })[];
      };
      const seen = new Set<string>();
      for (const sc of body.data ?? []) {
        const k = (sc.name ?? "").toLowerCase();
        seen.add(k);
        nameCache.set(k, {
          scryfall_id: sc.id,
          set_code: (sc.set ?? "").toUpperCase(),
          rarity: sc.rarity
            ? sc.rarity.charAt(0).toUpperCase() + sc.rarity.slice(1)
            : "",
        });
        // Front-face alias for DFC names.
        const front = (sc.card_faces?.[0]?.name ?? "").toLowerCase();
        if (front && !nameCache.has(front)) {
          nameCache.set(front, nameCache.get(k)!);
        }
      }
      for (const n of chunk) {
        if (!seen.has(n) && !nameCache.has(n)) {
          nameCache.set(n, null); // not found — don't re-ask
        }
      }
      if (i + BATCH < missing.length) {
        await sleep(DELAY_MS);
      }
    } catch {
      break;
    }
  }
  const out = new Map<string, NamePrinting>();
  for (const n of wanted) {
    const hit = nameCache.get(n);
    if (hit) {
      out.set(n, hit);
    }
  }
  return out;
}

/** Fuzzy by-name lookup — fills in printing identifiers (Scryfall ID,
 *  set, collector number, rarity, prices) for manually added cards so
 *  images and prices work without a CSV import. Returns null when the
 *  name doesn't resolve. */
export async function lookupByName(name: string): Promise<
  | (Partial<CardRow> & {
      scryfall_id: string;
      set_code: string;
      set_name: string;
      collector_number: string;
      rarity: string;
    })
  | null
> {
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
    );
    if (!res.ok) {
      return null;
    }
    const sc = (await res.json()) as ScryCard & {
      set?: string;
      set_name?: string;
      collector_number?: string;
      rarity?: string;
      name?: string;
    };
    const patch = toPatch(sc, true);
    return {
      ...patch,
      name: sc.name ?? name,
      scryfall_id: sc.id,
      set_code: (sc.set ?? "").toUpperCase(),
      set_name: sc.set_name ?? "",
      collector_number: sc.collector_number ?? "",
      rarity: sc.rarity
        ? sc.rarity.charAt(0).toUpperCase() + sc.rarity.slice(1)
        : "",
    };
  } catch {
    return null;
  }
}
