/** Mana-cost renderer — the web port of the desktop's ManaCostDelegate:
 *  real symbol icons for colors and two-color hybrids, circular slate
 *  pips for generic numbers / X / twobrid / phyrexian. */

const ICONS: Record<string, string> = {
  W: "White_Mana",
  U: "Blue_Mana",
  B: "Black_Mana",
  R: "Red_Mana",
  G: "Green_Mana",
  C: "Colorless_Mana",
};

// Sorted-pair key -> filename (two files ship with lowercase "mana").
const HYBRID: Record<string, string> = {
  UW: "WhiteBlue_Mana",
  BW: "WhiteBlack_mana",
  BU: "BlueBlack_Mana",
  RU: "BlueRed_mana",
  BR: "BlackRed_Mana",
  BG: "BlackGreen_Mana",
  GR: "GreenRed_Mana",
  RW: "RedWhite_Mana",
  GW: "WhiteGreen_Mana",
  GU: "GreenBlue_Mana",
};

export function parseMana(text: string | undefined): string[] {
  return [...(text ?? "").matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

function hybridKey(token: string): string | null {
  const parts = token.toUpperCase().split("/");
  if (parts.length !== 2) {
    return null;
  }
  if (!parts.every((p) => p.length === 1 && "WUBRG".includes(p))) {
    return null;
  }
  if (parts[0] === parts[1]) {
    return null;
  }
  return [...parts].sort().join("");
}

export function ManaCost({ cost }: { cost: string | undefined }) {
  const tokens = parseMana(cost);
  if (tokens.length === 0) {
    return null;
  }
  return (
    <span className="mana-cost">
      {tokens.map((token, i) => {
        const key = token.toUpperCase();
        let icon = ICONS[key];
        if (!icon) {
          const hk = hybridKey(token);
          if (hk) {
            icon = HYBRID[hk];
          }
        }
        return icon ? (
          <img
            key={i}
            className="mana-icon"
            src={`/assets/mana/${icon}.png`}
            alt={`{${token}}`}
          />
        ) : (
          <span key={i} className="mana-pip">
            {token}
          </span>
        );
      })}
    </span>
  );
}
