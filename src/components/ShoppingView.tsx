import { useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { addCardManual } from "../lib/collection";
import type { Deck } from "../lib/decks";
import type { CardRow } from "../lib/manabox";
import type { RefEntry } from "../lib/reference";
import {
  missingFromDecks,
  removeFromWishlist,
  type WishEntry,
} from "../lib/wishlist";
import { ManaCost } from "./ManaCost";

interface ShoppingViewProps {
  cards: CardRow[] | null;
  decks: Deck[];
  wishlist: WishEntry[];
  refMap: Map<string, RefEntry> | null;
}

/** Shopping List — the manual want-list (red until owned, Mark as Owned
 *  moves copies into the library) plus the automatic cross-deck missing
 *  aggregate, like the desktop view. */
export function ShoppingView({
  cards,
  decks,
  wishlist,
  refMap,
}: ShoppingViewProps) {
  const { user } = useAuth();
  const [status, setStatus] = useState("");

  const owned = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards ?? []) {
      const k = c.name.toLowerCase();
      m.set(k, (m.get(k) ?? 0) + c.quantity);
    }
    return m;
  }, [cards]);

  const missing = useMemo(
    () => missingFromDecks(cards ?? [], decks),
    [cards, decks],
  );

  const markOwned = async (entry: WishEntry) => {
    if (!user || !cards) {
      return;
    }
    const qty = parseInt(
      window.prompt(
        `How many copies of ${entry.card_name} do you now own?`,
        String(entry.quantity),
      ) ?? "",
      10,
    );
    if (!Number.isFinite(qty) || qty <= 0) {
      return;
    }
    const ref = refMap?.get(entry.card_name.toLowerCase());
    await addCardManual(user.uid, cards, {
      name: entry.card_name,
      quantity: qty,
      foil: false,
      condition: "near_mint",
      language: "EN",
      binder: "",
      set_code: "",
      set_name: "",
      collector_number: "",
      rarity: "",
      scryfall_id: "",
      price_usd: 0,
      price_foil: 0,
      ...(ref
        ? {
            type_line: ref.type_line,
            colors: ref.colors,
            color_identity: ref.color_identity,
            mana_cost: ref.mana_cost,
            cmc: ref.cmc,
            oracle_text: ref.oracle_text,
            banned_in: ref.banned_in,
          }
        : {}),
    });
    await removeFromWishlist(user.uid, entry.card_name);
    setStatus(`Added ${qty}× ${entry.card_name} to your library.`);
  };

  const copyAll = () => {
    const lines = [
      ...wishlist.map((w) => `${w.quantity} ${w.card_name}`),
      ...missing.map((m) => `${m.missing} ${m.name}`),
    ];
    void navigator.clipboard.writeText(lines.join("\n"));
    setStatus(`Copied ${lines.length} lines.`);
  };

  const exportTxt = () => {
    const lines = [
      "// Want list",
      ...wishlist.map((w) => `${w.quantity} ${w.card_name}`),
      "",
      "// Missing from decks",
      ...missing.map((m) => `${m.missing} ${m.name} (${m.decks.join(", ")})`),
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shopping_list_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="collection-view">
      <div className="view-header">
        <span className="view-title">Shopping List</span>
        <div className="toolbar-spacer" />
        <button
          className="stone-btn"
          disabled={!wishlist.length && !missing.length}
          onClick={copyAll}
        >
          Copy List
        </button>
        <button
          className="stone-btn"
          disabled={!wishlist.length && !missing.length}
          onClick={exportTxt}
        >
          Export
        </button>
      </div>
      {status && <div className="stat-bar">{status}</div>}

      <div className="shopping-body">
        <div className="dash-panel">
          <div className="dash-panel-title">
            Want list ({wishlist.length})
          </div>
          {wishlist.length === 0 ? (
            <p className="placeholder">
              Add cards from Card Search (Library → Card Search…).
            </p>
          ) : (
            wishlist.map((w) => {
              const k = w.card_name.toLowerCase();
              const own = owned.get(k) ?? 0;
              const ref = refMap?.get(k);
              return (
                <div className="wish-row" key={k}>
                  <span
                    className="card-name"
                    style={{ color: own > 0 ? "#5ab85a" : "#f05a5a" }}
                  >
                    {w.quantity}× {w.card_name}
                  </span>
                  {ref && <ManaCost cost={ref.mana_cost} />}
                  <span className="dim">
                    {own > 0 ? `own ${own}` : "unowned"}
                  </span>
                  <div className="toolbar-spacer" />
                  {user && (
                    <>
                      <button
                        className="ghost-btn small"
                        onClick={() => {
                          void markOwned(w);
                        }}
                      >
                        Mark as Owned
                      </button>
                      <button
                        className="ghost-btn small"
                        title="Remove from list"
                        onClick={() => {
                          void removeFromWishlist(user.uid, w.card_name);
                        }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="dash-panel">
          <div className="dash-panel-title">
            Missing from decks ({missing.length})
          </div>
          {missing.length === 0 ? (
            <p className="placeholder">
              Every deck is fully covered by your collection. ✓
            </p>
          ) : (
            missing.map((m) => (
              <div className="wish-row" key={m.name}>
                <span className="card-name deck-missing">
                  {m.missing}× {m.name}
                </span>
                <span className="dim">
                  need {m.need}, own {m.owned} — {m.decks.join(", ")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
