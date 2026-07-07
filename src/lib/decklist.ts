/**
 * Decklist parsing — mirrors the desktop's services/decklist.py:
 * "1 Sol Ring", "4x Bolt", "SB: 2 Negate", "Commander: X" lines, bare
 * section headers (Deck/Mainboard/Sideboard/Commander), and trailing
 * "(SET) 123" printing suffixes. CSV form: Name + Quantity (+ Section).
 */
import { parseCsv } from "./manabox";
import type { DeckCard } from "./decks";

/** "Sol Ring (C21) 263" -> "Sol Ring" (printing suffixes from Arena/
 *  Moxfield-style exports). */
function stripPrintingSuffix(name: string): string {
  return name.replace(/\s*\(([A-Z0-9]{2,6})\)(\s+[\w★-]+)?\s*$/i, "").trim();
}

function entry(
  name: string,
  qty: number,
  commander = false,
  sideboard = false,
): DeckCard {
  return {
    card_name: stripPrintingSuffix(name),
    quantity: qty,
    is_commander: commander,
    is_sideboard: commander ? false : sideboard,
    category: "",
  };
}

export function parseDecklistText(text: string): DeckCard[] {
  const out: DeckCard[] = [];
  let section: "main" | "side" | "commander" = "main";

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) {
      continue;
    }

    // Bare section headers (with optional counts like "Sideboard (15)").
    const header = line.replace(/\s*\(\d+\)\s*$/, "").toLowerCase();
    if (["deck", "main", "mainboard", "maindeck"].includes(header)) {
      section = "main";
      continue;
    }
    if (["sideboard", "side board", "side"].includes(header)) {
      section = "side";
      continue;
    }
    if (["commander", "commanders"].includes(header)) {
      section = "commander";
      continue;
    }

    // Inline markers.
    let commander = section === "commander";
    let sideboard = section === "side";
    const cmdInline = line.match(/^commander:\s*(.+)$/i);
    if (cmdInline) {
      line = cmdInline[1];
      commander = true;
      sideboard = false;
    }
    if (/^SB:\s*/i.test(line)) {
      line = line.replace(/^SB:\s*/i, "");
      sideboard = true;
      commander = false;
    }

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const qty = m ? parseInt(m[1], 10) : 1;
    const name = (m ? m[2] : line).trim();
    if (!name) {
      continue;
    }
    out.push(entry(name, qty, commander, sideboard));
  }
  return out;
}

/** CSV decklists: a header row with Name plus Quantity/Count/Qty and an
 *  optional Section column ("sideboard"/"commander"). */
export function parseDecklistCsv(text: string): DeckCard[] {
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const table = parseCsv(text);
  if (table.length < 2) {
    return [];
  }
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const nameIdx = headers.findIndex((h) =>
    ["name", "card name", "card"].includes(h),
  );
  if (nameIdx < 0) {
    return [];
  }
  const qtyIdx = headers.findIndex((h) =>
    ["quantity", "count", "qty"].includes(h),
  );
  const secIdx = headers.findIndex((h) => h === "section");

  const out: DeckCard[] = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const name = (row[nameIdx] ?? "").trim();
    if (!name) {
      continue;
    }
    const qty = qtyIdx >= 0 ? parseInt(row[qtyIdx] ?? "1", 10) || 1 : 1;
    const sec = secIdx >= 0 ? (row[secIdx] ?? "").trim().toLowerCase() : "";
    out.push(
      entry(name, qty, sec.startsWith("commander"), sec.startsWith("side")),
    );
  }
  return out;
}

/** File dispatcher: .csv goes through the CSV path (falling back to the
 *  text parser when no Name header is found), everything else is text. */
export function parseDecklistFile(fileName: string, text: string): DeckCard[] {
  if (/\.csv$/i.test(fileName)) {
    const rows = parseDecklistCsv(text);
    if (rows.length > 0) {
      return rows;
    }
  }
  return parseDecklistText(text);
}
