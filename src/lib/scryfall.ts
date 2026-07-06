/**
 * Opt-in Scryfall enrichment — the web cousin of the desktop's
 * "Scryfall Online" button. Looks up every printing by its Scryfall ID
 * (which ManaBox exports carry) in batches of 75 via the /cards/collection
 * endpoint, and returns gameplay-field patches: type line, colors,
 * identity, mana cost, mana value, oracle text, banned-in summary, and
 * refreshed prices. Never runs automatically.
 */
import type { CardRow } from "./manabox";

const ENDPOINT = "https://api.scryfall.com/cards/collection";
const BATCH = 75;
const DELAY_MS = 120; // stay well under Scryfall's rate limit

interface ScryCard {
  id: string;
  type_line?: string;
  colors?: string[] | null;
  color_identity?: string[];
  mana_cost?: string;
  cmc?: number;
  oracle_text?: string;
  card_faces?: {
    colors?: string[];
    mana_cost?: string;
    oracle_text?: string;
  }[];
  legalities?: Record<string, string>;
  prices?: { usd?: string | null; usd_foil?: string | null };
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

function toPatch(sc: ScryCard): Partial<CardRow> {
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
  const usd = parseFloat(sc.prices?.usd ?? "");
  const usdFoil = parseFloat(sc.prices?.usd_foil ?? "");
  if (Number.isFinite(usd)) {
    patch.price_usd = usd;
  }
  if (Number.isFinite(usdFoil)) {
    patch.price_foil = usdFoil;
  }
  return patch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch patches for every unique Scryfall ID among `cards` that still
 *  lacks a type_line (pass force=true to re-fetch everything, e.g. for a
 *  price refresh). Returns scryfall_id -> patch. */
export async function fetchEnrichment(
  cards: CardRow[],
  onProgress?: (done: number, total: number) => void,
  force = false,
): Promise<Map<string, Partial<CardRow>>> {
  const ids = [
    ...new Set(
      cards
        .filter((c) => c.scryfall_id && (force || !c.type_line))
        .map((c) => c.scryfall_id),
    ),
  ];
  const patches = new Map<string, Partial<CardRow>>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: chunk.map((id) => ({ id })) }),
    });
    if (!res.ok) {
      throw new Error(`Scryfall responded ${res.status}`);
    }
    const body = (await res.json()) as { data?: ScryCard[] };
    for (const sc of body.data ?? []) {
      patches.set(sc.id, toPatch(sc));
    }
    onProgress?.(Math.min(i + BATCH, ids.length), ids.length);
    if (i + BATCH < ids.length) {
      await sleep(DELAY_MS);
    }
  }
  return patches;
}

/** Card image URL for a printing (preview panel). */
export function imageUrl(scryfallId: string): string {
  return `https://api.scryfall.com/cards/${scryfallId}?format=image&version=normal`;
}
