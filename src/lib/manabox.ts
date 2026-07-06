/**
 * ManaBox CSV parser — the exact same format the desktop app imports and
 * exports (services/importer.py is the reference implementation). Pure:
 * no Firebase, no DOM, unit-testable in plain Node.
 */

export interface CardRow {
  name: string;
  quantity: number;
  foil: boolean;
  condition: string;
  language: string;
  binder: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  scryfall_id: string;
  price_usd: number;
  price_foil: number;
  // Gameplay fields, filled in by the opt-in Scryfall enrichment (the web
  // cousin of the desktop's reference/Scryfall lookup). Absent until then.
  type_line?: string;
  colors?: string; // "W,U" CSV like the desktop
  color_identity?: string;
  mana_cost?: string; // "{2}{W/U}"
  cmc?: number;
  oracle_text?: string;
  banned_in?: string; // "Modern, Legacy" — formats where banned/restricted
}

// Header aliases: old and new ManaBox export formats (mirrors _COL_MAP
// in the desktop importer).
const COL_MAP: Record<string, string[]> = {
  quantity: ["Count", "Quantity", "Qty", "qty"],
  name: ["Name", "Card Name"],
  set_name: ["Edition", "Set name", "Set Name"],
  set_code: ["Edition code", "Set code", "Set Code"],
  condition: ["Condition"],
  language: ["Language"],
  foil: ["Foil"],
  collector_number: ["Collector number", "Collector Number"],
  price: ["Purchase price", "Price", "price"],
  rarity: ["Rarity"],
  scryfall_id: ["Scryfall ID", "Scryfall Id", "scryfall_id"],
  binder: ["Binder Name", "Binder", "binder_name"],
};

/** Minimal RFC-4180 CSV reader: quoted fields, embedded commas/quotes/
 *  newlines, CRLF or LF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Skip completely blank lines.
    if (row.length > 1 || row[0] !== "") {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    pushRow();
  }
  return rows;
}

function findCol(headers: string[], field: string): number {
  for (const candidate of COL_MAP[field] ?? []) {
    const idx = headers.indexOf(candidate);
    if (idx >= 0) {
      return idx;
    }
  }
  return -1;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
}

/** Parse a ManaBox CSV export. Returns the card rows plus any warnings —
 *  performs no writes; the caller decides where to persist. */
export function parseManaBoxCsv(text: string): {
  cards: CardRow[];
  warnings: string[];
} {
  // Strip a UTF-8 BOM if present (ManaBox exports have one).
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const table = parseCsv(text);
  if (table.length < 2) {
    return { cards: [], warnings: ["CSV file is empty."] };
  }
  const headers = table[0].map((h) => h.trim());
  const nameIdx = findCol(headers, "name");
  if (nameIdx < 0) {
    return {
      cards: [],
      warnings: [`Could not find a Name column. Headers: ${headers.join(", ")}`],
    };
  }
  const qtyIdx = findCol(headers, "quantity");
  const setCIdx = findCol(headers, "set_code");
  const setNIdx = findCol(headers, "set_name");
  const condIdx = findCol(headers, "condition");
  const langIdx = findCol(headers, "language");
  const foilIdx = findCol(headers, "foil");
  const numIdx = findCol(headers, "collector_number");
  const priceIdx = findCol(headers, "price");
  const rarIdx = findCol(headers, "rarity");
  const sfidIdx = findCol(headers, "scryfall_id");
  const binderIdx = findCol(headers, "binder");

  const get = (row: string[], idx: number) =>
    idx >= 0 ? (row[idx] ?? "").trim() : "";

  // Merge duplicate printings (same identity key) by summing quantity, so
  // re-ordered or split exports still land on one document per printing.
  const byKey = new Map<string, CardRow>();

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const name = get(row, nameIdx);
    if (!name) {
      continue;
    }

    let qty = parseInt(get(row, qtyIdx), 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      qty = 1;
    }

    const foilVal = get(row, foilIdx).toLowerCase();
    const foil = ["yes", "true", "1", "foil", "etched"].includes(foilVal);

    const rawPrice = parseFloat(get(row, priceIdx)) || 0;

    const card: CardRow = {
      name,
      quantity: qty,
      foil,
      condition: get(row, condIdx) || "NM",
      language: get(row, langIdx) || "EN",
      binder: get(row, binderIdx),
      set_code: get(row, setCIdx).toUpperCase(),
      set_name: get(row, setNIdx),
      collector_number: get(row, numIdx),
      rarity: capitalize(get(row, rarIdx)),
      scryfall_id: get(row, sfidIdx),
      price_usd: foil ? 0 : rawPrice,
      price_foil: foil ? rawPrice : 0,
    };

    const key = cardKey(card);
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += card.quantity;
    } else {
      byKey.set(key, card);
    }
  }

  return { cards: [...byKey.values()], warnings: [] };
}

/** Identity key for one physical printing — the same uniqueness the
 *  desktop app enforces: (name, set, collector#, foil, condition,
 *  language, binder). */
export function cardKey(c: CardRow): string {
  return [
    c.name.toLowerCase(),
    c.set_code,
    c.collector_number,
    c.foil ? "1" : "0",
    c.condition,
    c.language,
    c.binder,
  ].join("|");
}

/** Effective per-copy value: non-foil price, falling back to foil. */
export function cardPrice(c: CardRow): number {
  return c.price_usd > 0 ? c.price_usd : c.price_foil;
}

// ── Export (mirrors the desktop's _MANABOX_HEADERS/_manabox_row) ───────────

const MANABOX_HEADERS = [
  "Name",
  "Set code",
  "Set name",
  "Collector number",
  "Foil",
  "Rarity",
  "Quantity",
  "ManaBox ID",
  "Scryfall ID",
  "Purchase price",
  "Misprint",
  "Altered",
  "Condition",
  "Language",
  "Purchase price currency",
  "Binder Name",
];

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize printings to a ManaBox-format CSV (round-trips with the
 *  importer and with the desktop app). */
export function toManaBoxCsv(cards: CardRow[]): string {
  const lines = [MANABOX_HEADERS.join(",")];
  for (const c of cards) {
    const price = c.foil ? c.price_foil : c.price_usd;
    lines.push(
      [
        c.name,
        c.set_code,
        c.set_name,
        c.collector_number,
        c.foil ? "foil" : "normal",
        c.rarity.toLowerCase(),
        c.quantity,
        "",
        c.scryfall_id,
        price || "",
        "false",
        "false",
        c.condition || "NM",
        c.language || "EN",
        "USD",
        c.binder,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
