import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { importCards, subscribeCards } from "../lib/collection";
import { cardPrice, parseManaBoxCsv, type CardRow } from "../lib/manabox";

type SortKey = "name" | "set_code" | "rarity" | "quantity" | "price";

const RARITY_RANK: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Mythic: 3,
  Special: 4,
};

export function Library() {
  const { user } = useAuth();
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDesc, setSortDesc] = useState(false);
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeCards(user.uid, setCards);
  }, [user]);

  const filtered = useMemo(() => {
    if (!cards) {
      return [];
    }
    const q = search.trim().toLowerCase();
    const rows = q
      ? cards.filter((c) => c.name.toLowerCase().includes(q))
      : [...cards];
    const dir = sortDesc ? -1 : 1;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "quantity":
          cmp = a.quantity - b.quantity;
          break;
        case "price":
          cmp = cardPrice(a) - cardPrice(b);
          break;
        case "rarity":
          cmp =
            (RARITY_RANK[a.rarity] ?? 99) - (RARITY_RANK[b.rarity] ?? 99);
          break;
        case "set_code":
          cmp = a.set_code.localeCompare(b.set_code);
          break;
        default:
          cmp = a.name.localeCompare(b.name);
      }
      // Stable, predictable secondary order.
      return dir * (cmp || a.name.localeCompare(b.name));
    });
    return rows;
  }, [cards, search, sortKey, sortDesc]);

  const stats = useMemo(() => {
    const rows = cards ?? [];
    const total = rows.reduce((n, c) => n + c.quantity, 0);
    const names = new Set(rows.map((c) => c.name.toLowerCase())).size;
    const value = rows.reduce((v, c) => v + c.quantity * cardPrice(c), 0);
    return { total, names, value };
  }, [cards]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(false);
    }
  };

  const onFile = async (file: File) => {
    if (!user) {
      return;
    }
    setImporting(true);
    try {
      setStatus(`Reading ${file.name}…`);
      const text = await file.text();
      const { cards: parsed, warnings } = parseManaBoxCsv(text);
      if (warnings.length) {
        setStatus(warnings.join(" "));
        return;
      }
      if (!parsed.length) {
        setStatus("No cards found in that file.");
        return;
      }
      const copies = parsed.reduce((n, c) => n + c.quantity, 0);
      setStatus(`Uploading ${parsed.length} printings (${copies} cards)…`);
      await importCards(user.uid, parsed, (written, total) => {
        setStatus(`Uploading… ${written} / ${total} printings`);
      });
      setStatus(
        `Imported ${parsed.length} printings (${copies} cards) from ${file.name}.`,
      );
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setImporting(false);
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDesc ? " ▾" : " ▴") : "";

  return (
    <div className="library">
      <div className="lib-toolbar">
        <input
          className="search-field"
          placeholder="Search cards…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="primary-btn"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
        >
          {importing ? "Importing…" : "Import CSV"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) {
              void onFile(f);
            }
          }}
        />
      </div>

      <div className="lib-stats">
        <span>
          <b>{stats.total}</b> total cards
        </span>
        <span>
          <b>{stats.names}</b> unique
        </span>
        <span className="lib-value">
          <b>${stats.value.toFixed(2)}</b> value
        </span>
        {status && <span className="lib-status">{status}</span>}
      </div>

      {cards === null ? (
        <p className="placeholder">Loading your collection…</p>
      ) : cards.length === 0 ? (
        <div className="lib-empty">
          <p className="placeholder">
            Your collection is empty. Export a ManaBox-format CSV from the
            desktop app (Library → Export CSV) or from ManaBox itself, then
            click <b>Import CSV</b> above.
          </p>
        </div>
      ) : (
        <div className="lib-table-wrap">
          <table className="lib-table">
            <thead>
              <tr>
                <th onClick={() => onSort("name")}>Name{arrow("name")}</th>
                <th onClick={() => onSort("set_code")}>
                  Set{arrow("set_code")}
                </th>
                <th>#</th>
                <th>Foil</th>
                <th onClick={() => onSort("rarity")}>
                  Rarity{arrow("rarity")}
                </th>
                <th>Cond.</th>
                <th className="num" onClick={() => onSort("quantity")}>
                  Qty{arrow("quantity")}
                </th>
                <th className="num" onClick={() => onSort("price")}>
                  Price{arrow("price")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const price = cardPrice(c);
                return (
                  <tr key={i}>
                    <td className="card-name">{c.name}</td>
                    <td>{c.set_code}</td>
                    <td>{c.collector_number}</td>
                    <td>{c.foil ? "✦" : ""}</td>
                    <td className={`rar-${c.rarity.toLowerCase()}`}>
                      {c.rarity}
                    </td>
                    <td>{c.condition}</td>
                    <td className="num">{c.quantity}</td>
                    <td className="num price">
                      {price > 0 ? `$${price.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {search && (
            <p className="lib-foot">
              {filtered.length} of {cards.length} printings match “{search}”
            </p>
          )}
        </div>
      )}
    </div>
  );
}
