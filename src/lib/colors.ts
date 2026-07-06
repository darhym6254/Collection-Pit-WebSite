/** Color helpers — ports of the desktop's colors_subset_match and
 *  display-color logic. Colors travel as "W,U" CSV strings, same as the
 *  desktop database. */

const WUBRG = ["W", "U", "B", "R", "G"] as const;

export function colorLetters(csv: string | undefined): string[] {
  return (csv ?? "")
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter((p) => (WUBRG as readonly string[]).includes(p));
}

/** SUBSET semantics: a card matches when its colors are entirely within
 *  the checked set; colorless cards only when colorless_ok. Nothing
 *  checked (handled by the caller passing null) = no filtering. */
export function colorsSubsetMatch(
  cardColorsCsv: string | undefined,
  selected: Set<string>,
  colorlessOk: boolean,
): boolean {
  const card = colorLetters(cardColorsCsv);
  if (card.length === 0) {
    return colorlessOk;
  }
  return card.every((c) => selected.has(c));
}

const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

/** "W" -> "White", "W,U" -> "Multi", "" -> "Colorless" (desktop rule). */
export function displayColor(csv: string | undefined): string {
  const parts = colorLetters(csv);
  if (parts.length === 0) {
    return "Colorless";
  }
  if (parts.length > 1) {
    return "Multi";
  }
  return COLOR_NAMES[parts[0]] ?? parts[0];
}

export const COLOR_RANK: Record<string, number> = {
  White: 0,
  Blue: 1,
  Black: 2,
  Red: 3,
  Green: 4,
  Multi: 5,
  Colorless: 6,
};

/** Possible Commanders membership (desktop rule): legendary creatures,
 *  anything whose text says it can be your commander (commander
 *  planeswalkers), and Backgrounds. */
export function isCommanderEligible(
  typeLine: string | undefined,
  oracleText: string | undefined,
): boolean {
  const t = typeLine ?? "";
  if (t.includes("Legendary") && t.includes("Creature")) {
    return true;
  }
  if ((oracleText ?? "").toLowerCase().includes("can be your commander")) {
    return true;
  }
  return t.includes("Background");
}

/** "Legendary Creature — Ooze" -> "Creature" (desktop main-type rule). */
export function mainType(typeLine: string | undefined): string {
  const main = (typeLine ?? "").split("—")[0].trim();
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
      return t;
    }
  }
  return main;
}
