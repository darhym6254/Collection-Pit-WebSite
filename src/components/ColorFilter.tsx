import { useEffect, useRef, useState } from "react";

/** Multi-select color filter — the web port of the desktop's
 *  ColorFilterButton: a stay-open dropdown of W/U/B/R/G/Colorless
 *  checkboxes with SUBSET semantics handled by the caller. */

const COLORS: [string, string][] = [
  ["W", "White"],
  ["U", "Blue"],
  ["B", "Black"],
  ["R", "Red"],
  ["G", "Green"],
];

export interface ColorSelection {
  colors: Set<string>;
  colorless: boolean;
}

export function encodeSelection(sel: ColorSelection): string {
  const parts = [...sel.colors].sort();
  if (sel.colorless) {
    parts.push("C");
  }
  return parts.join(",");
}

export function decodeSelection(text: string): ColorSelection {
  const parts = new Set(
    text
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean),
  );
  return {
    colors: new Set([...parts].filter((p) => "WUBRG".includes(p))),
    colorless: parts.has("C"),
  };
}

export function ColorFilter({
  value,
  onChange,
}: {
  value: ColorSelection;
  onChange: (sel: ColorSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const label = (() => {
    const sel = COLORS.filter(([c]) => value.colors.has(c))
      .map(([c]) => c)
      .join("");
    if (value.colorless) {
      return sel ? `Colors: ${sel}C` : "Colors: Colorless";
    }
    return sel ? `Colors: ${sel}` : "All Colors";
  })();

  const toggle = (code: string) => {
    if (code === "C") {
      onChange({ ...value, colorless: !value.colorless });
    } else {
      const next = new Set(value.colors);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      onChange({ ...value, colors: next });
    }
  };

  return (
    <div className="color-filter" ref={ref}>
      <button className="combo drop" onClick={() => setOpen((o) => !o)}>
        {label} <span className="drop-arrow">▾</span>
      </button>
      {open && (
        <div className="color-menu">
          {[...COLORS, ["C", "Colorless"] as [string, string]].map(
            ([code, name]) => (
              <label className="color-item" key={code}>
                <input
                  type="checkbox"
                  checked={
                    code === "C" ? value.colorless : value.colors.has(code)
                  }
                  onChange={() => toggle(code)}
                />
                {code !== "C" ? (
                  <img
                    className="mana-icon"
                    src={`/assets/mana/${
                      {
                        W: "White_Mana",
                        U: "Blue_Mana",
                        B: "Black_Mana",
                        R: "Red_Mana",
                        G: "Green_Mana",
                      }[code]
                    }.png`}
                    alt=""
                  />
                ) : (
                  <img
                    className="mana-icon"
                    src="/assets/mana/Colorless_Mana.png"
                    alt=""
                  />
                )}
                {name}
              </label>
            ),
          )}
        </div>
      )}
    </div>
  );
}
