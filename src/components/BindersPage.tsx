import { useMemo } from "react";
import { cardPrice, type CardRow } from "../lib/manabox";

interface BindersPageProps {
  cards: CardRow[] | null;
  onOpenRare: () => void;
  onOpenBinder: (name: string) => void;
}

const BINDER_RARITIES = ["Rare", "Mythic", "Special"];

/** Binders page: the automatic Rare Binder row first (same rarity-OR-$1+
 *  rule as the desktop), then every named binder from the imports. */
export function BindersPage({ cards, onOpenRare, onOpenBinder }: BindersPageProps) {
  const rows = cards ?? [];

  const rareTotal = useMemo(
    () =>
      rows
        .filter(
          (c) => BINDER_RARITIES.includes(c.rarity) || cardPrice(c) >= 1.0,
        )
        .reduce((n, c) => n + c.quantity, 0),
    [rows],
  );

  const binders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of rows) {
      if (c.binder) {
        counts.set(c.binder, (counts.get(c.binder) ?? 0) + c.quantity);
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div className="collection-view">
      <div className="view-header">
        <span className="view-title">Binders</span>
      </div>
      <div className="binder-list">
        <div className="binder-row">
          <div>
            <div className="binder-name">Rare Binder</div>
            <div className="binder-sub">
              automatic — every Rare/Mythic/Special you own, plus any card
              worth $1.00 or more ({rareTotal} cards)
            </div>
          </div>
          <button className="ghost-btn" onClick={onOpenRare}>
            Open
          </button>
        </div>
        {binders.map(([name, count]) => (
          <div className="binder-row" key={name}>
            <div>
              <div className="binder-name">{name}</div>
              <div className="binder-sub">
                {count ? `${count} card(s)` : "empty"}
              </div>
            </div>
            <button className="ghost-btn" onClick={() => onOpenBinder(name)}>
              Open
            </button>
          </div>
        ))}
        {binders.length === 0 && (
          <p className="placeholder pad">
            Named binders come from your ManaBox export's “Binder Name”
            column — import a CSV that has them and they'll show up here.
          </p>
        )}
      </div>
    </div>
  );
}
