import { useMemo, useState } from "react";
import type { CardRow } from "../lib/manabox";
import { ManaCost } from "./ManaCost";

export const CONDITIONS = [
  "mint",
  "near_mint",
  "excellent",
  "good",
  "light_played",
  "played",
  "poor",
];

const RARITIES = ["Common", "Uncommon", "Rare", "Mythic", "Special"];

/** Manual Add Card form — the web version of the desktop's Add Card
 *  dialog. Produces one printing; identical printings merge quantity. */
export function AddCardModal({
  binders,
  onSubmit,
  onClose,
}: {
  binders: string[];
  onSubmit: (card: CardRow) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [setCode, setSetCode] = useState("");
  const [collector, setCollector] = useState("");
  const [qty, setQty] = useState(1);
  const [foil, setFoil] = useState(false);
  const [condition, setCondition] = useState("near_mint");
  const [rarity, setRarity] = useState("Common");
  const [price, setPrice] = useState("");
  const [binder, setBinder] = useState("");

  const submit = () => {
    if (!name.trim()) {
      return;
    }
    const p = parseFloat(price) || 0;
    onSubmit({
      name: name.trim(),
      quantity: Math.max(1, qty),
      foil,
      condition,
      language: "EN",
      binder: binder.trim(),
      set_code: setCode.trim().toUpperCase(),
      set_name: "",
      collector_number: collector.trim(),
      rarity,
      scryfall_id: "",
      price_usd: foil ? 0 : p,
      price_foil: foil ? p : 0,
    });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal form-modal">
        <div className="modal-name">Add Card</div>
        <div className="form-grid">
          <label>Name *</label>
          <input
            className="search-field wide"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <label>Set code</label>
          <input
            className="search-field"
            value={setCode}
            onChange={(e) => setSetCode(e.target.value)}
          />
          <label>Collector #</label>
          <input
            className="search-field"
            value={collector}
            onChange={(e) => setCollector(e.target.value)}
          />
          <label>Quantity</label>
          <input
            className="spin"
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
          <label>Rarity</label>
          <select
            className="combo"
            value={rarity}
            onChange={(e) => setRarity(e.target.value)}
          >
            {RARITIES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <label>Condition</label>
          <select
            className="combo"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          >
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label>Price ($)</label>
          <input
            className="search-field"
            value={price}
            placeholder="0.00"
            onChange={(e) => setPrice(e.target.value)}
          />
          <label>Binder</label>
          <input
            className="search-field"
            value={binder}
            list="binder-names"
            onChange={(e) => setBinder(e.target.value)}
          />
          <datalist id="binder-names">
            {binders.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <label>Foil</label>
          <label className="check">
            <input
              type="checkbox"
              checked={foil}
              onChange={(e) => setFoil(e.target.checked)}
            />
            foil / etched
          </label>
        </div>
        <div className="modal-footer">
          <button className="stone-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            disabled={!name.trim()}
            onClick={submit}
          >
            Add Card
          </button>
        </div>
      </div>
    </div>
  );
}

interface SearchHit {
  name: string;
  type_line: string;
  mana_cost: string;
  set_code: string;
  rarity: string;
  price: number;
}

/** Card Search — searches ALL Magic cards via the Scryfall API,
 *  including cards you don't own (shopping-list wiring comes later). */
export function CardSearchModal({
  ownedNames,
  onAddToWishlist,
  onClose,
}: {
  ownedNames: Set<string>;
  onAddToWishlist?: (name: string, qty: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const run = async () => {
    const q = query.trim();
    if (q.length < 2) {
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`,
      );
      if (res.status === 404) {
        setHits([]);
        return;
      }
      if (!res.ok) {
        throw new Error(`Scryfall responded ${res.status}`);
      }
      const body = (await res.json()) as {
        total_cards: number;
        has_more: boolean;
        data: {
          name: string;
          type_line?: string;
          mana_cost?: string;
          set?: string;
          rarity?: string;
          prices?: { usd?: string | null };
          card_faces?: { mana_cost?: string }[];
        }[];
      };
      setHits(
        body.data.map((c) => ({
          name: c.name,
          type_line: c.type_line ?? "",
          mana_cost:
            c.mana_cost || (c.card_faces?.[0]?.mana_cost ?? ""),
          set_code: (c.set ?? "").toUpperCase(),
          rarity: c.rarity
            ? c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1)
            : "",
          price: parseFloat(c.prices?.usd ?? "") || 0,
        })),
      );
      if (body.has_more) {
        setNote(
          `Showing the first ${body.data.length} of ${body.total_cards} matches — refine the search to narrow down.`,
        );
      }
    } catch (err) {
      setNote(`Search failed: ${err instanceof Error ? err.message : err}`);
      setHits([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal search-modal">
        <div className="modal-name">Card Search — all cards</div>
        <div className="lib-toolbar-row">
          <input
            className="search-field wide"
            placeholder="Search every Magic card (Scryfall syntax works, e.g. t:goblin)…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void run();
              }
            }}
          />
          <button
            className="stone-btn"
            disabled={busy}
            onClick={() => {
              void run();
            }}
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="search-results">
          {hits === null ? (
            <p className="placeholder pad">
              Search by name or Scryfall syntax. Green = you own it.
            </p>
          ) : hits.length === 0 ? (
            <p className="placeholder pad">No cards found.</p>
          ) : (
            <table className="lib-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Mana</th>
                  <th>Set</th>
                  <th>Rarity</th>
                  <th className="num">Price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hits.map((h, i) => (
                  <tr key={i}>
                    <td
                      className="card-name"
                      style={
                        ownedNames.has(h.name.toLowerCase())
                          ? { color: "#5ab85a" }
                          : undefined
                      }
                    >
                      {h.name}
                    </td>
                    <td className="dim">{h.type_line}</td>
                    <td>
                      <ManaCost cost={h.mana_cost} />
                    </td>
                    <td className="dim">{h.set_code}</td>
                    <td className={`rar-${h.rarity.toLowerCase()}`}>
                      {h.rarity}
                    </td>
                    <td className="num price">
                      {h.price > 0 ? `$${h.price.toFixed(2)}` : "—"}
                    </td>
                    <td>
                      {onAddToWishlist && (
                        <button
                          className="ghost-btn small"
                          title="Add to Shopping List"
                          onClick={() => {
                            onAddToWishlist(h.name, 1);
                            setNote(`Added ${h.name} to the shopping list.`);
                          }}
                        >
                          + List
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {note && <p className="dim search-note">{note}</p>}
        <div className="modal-footer">
          <button className="stone-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Clear Library confirmation — checkbox-gated like the desktop. */
export function ConfirmClearModal({
  total,
  onConfirm,
  onClose,
}: {
  total: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal form-modal">
        <div className="modal-name banned">Clear Library</div>
        <p className="modal-line">
          This permanently deletes all {total} cards from your library.
          Binders and tags metadata stay, but every printing is removed.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          I understand — delete my whole library
        </label>
        <div className="modal-footer">
          <button className="stone-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="stone-btn danger"
            disabled={!checked}
            onClick={onConfirm}
          >
            Clear Library
          </button>
        </div>
      </div>
    </div>
  );
}

/** Right-click context menu with two-level items (condition/foil). */
export interface CtxAction {
  label: string;
  danger?: boolean;
  children?: { label: string; act: () => void }[];
  act?: () => void;
}

export function ContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: CtxAction[];
  onClose: () => void;
}) {
  const [submenu, setSubmenu] = useState<CtxAction | null>(null);
  const items = useMemo(
    () =>
      submenu
        ? [
            { label: "← back", act: () => setSubmenu(null), keep: true },
            ...submenu.children!.map((c) => ({ ...c, keep: false })),
          ]
        : actions.map((a) => ({
            label: a.children ? `${a.label} ▸` : a.label,
            danger: a.danger,
            keep: Boolean(a.children),
            act: a.children ? () => setSubmenu(a) : a.act!,
          })),
    [submenu, actions],
  );

  return (
    <div className="ctx-backdrop" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="ctx-menu"
        style={{ left: x, top: Math.min(y, window.innerHeight - 300) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((it, i) => (
          <button
            key={i}
            className={`ctx-item${"danger" in it && it.danger ? " danger" : ""}`}
            onClick={() => {
              it.act();
              if (!it.keep) {
                onClose();
              }
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
