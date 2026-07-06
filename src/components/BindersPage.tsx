import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { createBinder, subscribeBinders } from "../lib/collection";
import { isCommanderEligible } from "../lib/colors";
import { cardPrice, type CardRow } from "../lib/manabox";
import type { RefEntry } from "../lib/reference";

interface BindersPageProps {
  cards: CardRow[] | null;
  refMap: Map<string, RefEntry> | null;
  onOpenRare: () => void;
  onOpenCommanders: () => void;
  onOpenBinder: (name: string) => void;
}

const BINDER_RARITIES = ["Rare", "Mythic", "Special"];

/** Binders page: the two automatic binders first (same membership rules
 *  as the desktop), then every named binder — persistent ones from
 *  Firestore plus any names found in imports. */
export function BindersPage({
  cards,
  refMap,
  onOpenRare,
  onOpenCommanders,
  onOpenBinder,
}: BindersPageProps) {
  const { user } = useAuth();
  const rows = cards ?? [];
  const [persistent, setPersistent] = useState<string[]>([]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeBinders(user.uid, setPersistent);
  }, [user]);

  const rareTotal = useMemo(
    () =>
      rows
        .filter(
          (c) => BINDER_RARITIES.includes(c.rarity) || cardPrice(c) >= 1.0,
        )
        .reduce((n, c) => n + c.quantity, 0),
    [rows],
  );

  const commanderTotal = useMemo(() => {
    let n = 0;
    for (const c of rows) {
      const ref = refMap?.get(c.name.toLowerCase());
      const type = c.type_line || ref?.type_line;
      const oracle = c.oracle_text || ref?.oracle_text;
      if (isCommanderEligible(type, oracle)) {
        n += c.quantity;
      }
    }
    return n;
  }, [rows, refMap]);

  const binders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const name of persistent) {
      counts.set(name, 0);
    }
    for (const c of rows) {
      if (c.binder) {
        counts.set(c.binder, (counts.get(c.binder) ?? 0) + c.quantity);
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, persistent]);

  const onCreate = () => {
    const name = window.prompt("Binder name:");
    if (name?.trim() && user) {
      void createBinder(user.uid, name.trim());
    }
  };

  return (
    <div className="collection-view">
      <div className="view-header">
        <span className="view-title">Binders</span>
        <div className="toolbar-spacer" />
        <button className="primary-btn" onClick={onCreate}>
          + Create Binder
        </button>
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
          <button className="stone-btn" onClick={onOpenRare}>
            Open
          </button>
        </div>
        <div className="binder-row">
          <div>
            <div className="binder-name">Possible Commanders</div>
            <div className="binder-sub">
              automatic — legendary creatures, commander planeswalkers and
              Backgrounds you own ({commanderTotal} cards)
            </div>
          </div>
          <button className="stone-btn" onClick={onOpenCommanders}>
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
            <button className="stone-btn" onClick={() => onOpenBinder(name)}>
              Open
            </button>
          </div>
        ))}
        {binders.length === 0 && (
          <p className="placeholder pad">
            Create a binder above, or import a ManaBox CSV that has a
            “Binder Name” column — named binders appear here, and you can
            move cards into them from the Library's right-click menu.
          </p>
        )}
      </div>
    </div>
  );
}
