import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { importCards } from "../lib/collection";
import { cardPrice, parseManaBoxCsv, type CardRow } from "../lib/manabox";

type SortKey =
  | "name"
  | "set_code"
  | "rarity"
  | "condition"
  | "quantity"
  | "price";

const RARITY_RANK: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Mythic: 3,
  Special: 4,
};

interface LibraryProps {
  cards: CardRow[] | null;
  /** Settings/persistence prefix, mirroring the desktop's per-view keys. */
  prefix: string;
  title?: string;
  subtitle?: string;
  /** Rare Binder lock: rarity list + $ floor (rarity OR value >= floor). */
  rarityLock?: string[];
  valueFloor?: number;
  /** Named-binder lock (Binders page). */
  binderFilter?: string;
  onBack?: () => void;
}

function loadSetting(prefix: string, key: string, fallback: string): string {
  return localStorage.getItem(`cp.${prefix}.${key}`) ?? fallback;
}

function saveSetting(prefix: string, key: string, value: string) {
  localStorage.setItem(`cp.${prefix}.${key}`, value);
}

export function Library({
  cards,
  prefix,
  title,
  subtitle,
  rarityLock,
  valueFloor,
  binderFilter,
  onBack,
}: LibraryProps) {
  const { user } = useAuth();
  const locked = Boolean(rarityLock || binderFilter);
  const [search, setSearch] = useState("");
  const [rarityF, setRarityF] = useState(() =>
    loadSetting(prefix, "rarity", "All Rarities"),
  );
  const [binderF, setBinderF] = useState(() =>
    loadSetting(prefix, "binder", "All Binders"),
  );
  const [foilOnly, setFoilOnly] = useState(
    () => loadSetting(prefix, "foil", "0") === "1",
  );
  const [sortKey, setSortKey] = useState<SortKey>(
    () => loadSetting(prefix, "sort", "name") as SortKey,
  );
  const [sortDesc, setSortDesc] = useState(
    () => loadSetting(prefix, "sortdesc", "0") === "1",
  );
  const [selected, setSelected] = useState<CardRow | null>(null);
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveSetting(prefix, "rarity", rarityF);
    saveSetting(prefix, "binder", binderF);
    saveSetting(prefix, "foil", foilOnly ? "1" : "0");
    saveSetting(prefix, "sort", sortKey);
    saveSetting(prefix, "sortdesc", sortDesc ? "1" : "0");
  }, [prefix, rarityF, binderF, foilOnly, sortKey, sortDesc]);

  // Membership: the same rules the desktop views use.
  const inScope = useMemo(() => {
    return (cards ?? []).filter((c) => {
      if (binderFilter !== undefined && c.binder !== binderFilter) {
        return false;
      }
      if (rarityLock) {
        const byRarity = rarityLock.includes(c.rarity);
        const byValue =
          valueFloor !== undefined && cardPrice(c) >= valueFloor;
        if (!byRarity && !byValue) {
          return false;
        }
      }
      return true;
    });
  }, [cards, rarityLock, valueFloor, binderFilter]);

  const binderNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of cards ?? []) {
      if (c.binder) {
        names.add(c.binder);
      }
    }
    return [...names].sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = inScope.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) {
        return false;
      }
      if (!locked && rarityF !== "All Rarities" && c.rarity !== rarityF) {
        return false;
      }
      if (!locked && binderF !== "All Binders") {
        if (binderF === "(No binder)" ? c.binder !== "" : c.binder !== binderF) {
          return false;
        }
      }
      if (foilOnly && !c.foil) {
        return false;
      }
      return true;
    });
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
          cmp = (RARITY_RANK[a.rarity] ?? 99) - (RARITY_RANK[b.rarity] ?? 99);
          break;
        case "set_code":
          cmp = a.set_code.localeCompare(b.set_code);
          break;
        case "condition":
          cmp = a.condition.localeCompare(b.condition);
          break;
        default:
          cmp = a.name.localeCompare(b.name);
      }
      return dir * (cmp || a.name.localeCompare(b.name));
    });
    return rows;
  }, [inScope, search, rarityF, binderF, foilOnly, sortKey, sortDesc, locked]);

  const stats = useMemo(() => {
    const total = inScope.reduce((n, c) => n + c.quantity, 0);
    const names = new Set(inScope.map((c) => c.name.toLowerCase())).size;
    const value = inScope.reduce((v, c) => v + c.quantity * cardPrice(c), 0);
    return { total, names, value };
  }, [inScope]);

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
      await importCards(user.uid, parsed, (written, total) => {
        setStatus(`Uploading… ${written} / ${total} printings`);
      });
      setStatus(`Imported ${parsed.length} printings (${copies} cards).`);
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setImporting(false);
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDesc ? " ▾" : " ▴") : "";

  return (
    <div className="collection-view">
      {(title || onBack) && (
        <div className="view-header">
          {onBack && (
            <button className="ghost-btn" onClick={onBack}>
              ← Back
            </button>
          )}
          <span className="view-title">{title}</span>
          {subtitle && <span className="view-subtitle">{subtitle}</span>}
        </div>
      )}

      <div className="toolbar">
        <input
          className="search-field"
          placeholder="Search cards…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!locked && (
          <>
            <select
              className="combo"
              value={rarityF}
              onChange={(e) => setRarityF(e.target.value)}
            >
              {["All Rarities", "Common", "Uncommon", "Rare", "Mythic"].map(
                (r) => (
                  <option key={r}>{r}</option>
                ),
              )}
            </select>
            <select
              className="combo"
              value={binderF}
              onChange={(e) => setBinderF(e.target.value)}
            >
              <option>All Binders</option>
              <option>(No binder)</option>
              {binderNames.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={foilOnly}
            onChange={(e) => setFoilOnly(e.target.checked)}
          />
          Foils only
        </label>
        <div className="toolbar-spacer" />
        {!locked && (
          <>
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
          </>
        )}
      </div>

      <div className="stat-bar">
        <span>
          <b>{stats.total}</b> total cards
        </span>
        <span>
          <b>{stats.names}</b> unique
        </span>
        <span className="stat-value">
          {rarityLock ? "Binder value: " : "Value: "}
          <b>${stats.value.toFixed(2)}</b>
        </span>
        {status && <span className="stat-status">{status}</span>}
      </div>

      <div className="lib-body">
        <div className="lib-table-wrap">
          {cards === null ? (
            <p className="placeholder pad">Loading your collection…</p>
          ) : inScope.length === 0 ? (
            <p className="placeholder pad">
              {locked
                ? "Nothing here yet."
                : "Your collection is empty — export a ManaBox-format CSV from the desktop app (Library → Export CSV) and click Import CSV."}
            </p>
          ) : (
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
                  <th onClick={() => onSort("condition")}>
                    Cond.{arrow("condition")}
                  </th>
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
                  const isSel = selected === c;
                  return (
                    <tr
                      key={i}
                      className={isSel ? "sel" : ""}
                      onClick={() => setSelected(c)}
                    >
                      <td className="card-name">{c.name}</td>
                      <td>{c.set_code}</td>
                      <td>{c.collector_number}</td>
                      <td className="foil-mark">{c.foil ? "✦" : ""}</td>
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
          )}
        </div>

        <Preview card={selected} />
      </div>
    </div>
  );
}

/** Right-hand card preview, like the desktop's panel: image via the
 *  printing's Scryfall ID plus the key details underneath. */
function Preview({ card }: { card: CardRow | null }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
  }, [card]);

  return (
    <aside className="preview">
      <div className="preview-img-slot">
        {card?.scryfall_id ? (
          <img
            key={card.scryfall_id}
            className={`preview-img${loaded ? " show" : ""}`}
            src={`https://api.scryfall.com/cards/${card.scryfall_id}?format=image&version=normal`}
            alt={card.name}
            onLoad={() => setLoaded(true)}
          />
        ) : (
          <span className="preview-hint">
            {card ? "No image for this printing" : "Select a card"}
          </span>
        )}
      </div>
      {card && (
        <div className="preview-details">
          <div className="preview-name">{card.name}</div>
          <div className="preview-line">
            {card.set_name || card.set_code}
            {card.collector_number ? ` · #${card.collector_number}` : ""}
            {card.foil ? " · ✦ foil" : ""}
          </div>
          <div className="preview-line">
            <span className={`rar-${card.rarity.toLowerCase()}`}>
              {card.rarity}
            </span>
            {" · "}
            {card.condition} · {card.language}
          </div>
          {card.binder && (
            <div className="preview-line">Binder: {card.binder}</div>
          )}
          <div className="preview-badges">
            <span className="badge">
              Owned
              <b>{card.quantity}</b>
            </span>
            <span className="badge gold">
              Value
              <b>${(card.quantity * cardPrice(card)).toFixed(2)}</b>
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
