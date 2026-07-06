import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import {
  addCardManual,
  adjustQuantity,
  applyEnrichment,
  clearLibrary,
  deletePrintings,
  importCards,
  movePrintings,
  setCardTags,
} from "../lib/collection";
import {
  cardPrice,
  parseManaBoxCsv,
  toManaBoxCsv,
  type CardRow,
} from "../lib/manabox";
import {
  COLOR_RANK,
  colorsSubsetMatch,
  displayColor,
  mainType,
} from "../lib/colors";
import {
  fetchBulkEnrichment,
  fetchEnrichment,
  imageUrl,
} from "../lib/scryfall";
import type { RefEntry } from "../lib/reference";
import { CardInfoModal } from "./CardInfoModal";
import {
  AddCardModal,
  CardSearchModal,
  ConfirmClearModal,
  ContextMenu,
  CONDITIONS,
  type CtxAction,
} from "./LibraryModals";
import { ManaCost } from "./ManaCost";
import {
  ColorFilter,
  decodeSelection,
  encodeSelection,
  type ColorSelection,
} from "./ColorFilter";

type SortKey =
  | "name"
  | "type"
  | "colors"
  | "mana"
  | "set_code"
  | "rarity"
  | "quantity"
  | "price";

const RARITY_RANK: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Mythic: 3,
  Special: 4,
};

const TYPES = [
  "All Types",
  "Creature",
  "Instant",
  "Sorcery",
  "Land",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Battle",
];

/** One Library row: a card NAME aggregated over its printings, exactly
 *  like the desktop's GROUP BY cards.name. */
export interface AggRow {
  name: string;
  quantity: number;
  price: number;
  rarity: string;
  set_code: string;
  binder: string;
  foil: boolean;
  type_line: string;
  colors: string;
  color_identity: string;
  mana_cost: string;
  cmc: number;
  oracle_text: string;
  banned_in: string;
  scryfall_id: string;
  printings: CardRow[];
}

function aggregate(
  cards: CardRow[],
  refMap: Map<string, RefEntry> | null,
): AggRow[] {
  const byName = new Map<string, AggRow>();
  for (const c of cards) {
    const key = c.name.toLowerCase();
    let row = byName.get(key);
    if (!row) {
      row = {
        name: c.name,
        quantity: 0,
        price: 0,
        rarity: "",
        set_code: c.set_code,
        binder: "",
        foil: false,
        type_line: "",
        colors: "",
        color_identity: "",
        mana_cost: "",
        cmc: 0,
        oracle_text: "",
        banned_in: "",
        scryfall_id: "",
        printings: [],
      };
      byName.set(key, row);
    }
    row.quantity += c.quantity;
    row.price = Math.max(row.price, cardPrice(c));
    if ((RARITY_RANK[c.rarity] ?? -1) > (RARITY_RANK[row.rarity] ?? -1)) {
      row.rarity = c.rarity;
    }
    row.foil = row.foil || c.foil;
    if (c.binder && !row.binder.includes(c.binder)) {
      row.binder = row.binder ? `${row.binder}, ${c.binder}` : c.binder;
    }
    if (!row.scryfall_id && c.scryfall_id) {
      row.scryfall_id = c.scryfall_id;
    }
    if (!row.type_line && c.type_line) {
      row.type_line = c.type_line;
      row.colors = c.colors ?? "";
      row.color_identity = c.color_identity ?? "";
      row.mana_cost = c.mana_cost ?? "";
      row.cmc = c.cmc ?? 0;
      row.oracle_text = c.oracle_text ?? "";
      row.banned_in = c.banned_in ?? "";
    }
    row.printings.push(c);
  }
  const rows = [...byName.values()];
  // Reference join (the desktop's LEFT JOIN card_reference): any card the
  // per-printing data didn't cover gets its gameplay fields by name.
  if (refMap) {
    for (const row of rows) {
      if (!row.type_line) {
        const ref = refMap.get(row.name.toLowerCase());
        if (ref) {
          row.type_line = ref.type_line;
          row.colors = ref.colors;
          row.color_identity = ref.color_identity;
          row.mana_cost = ref.mana_cost;
          row.cmc = ref.cmc;
          row.oracle_text = ref.oracle_text;
          row.banned_in = ref.banned_in;
        }
      }
    }
  }
  return rows;
}

interface LibraryProps {
  cards: CardRow[] | null;
  refMap: Map<string, RefEntry> | null;
  /** Lowercased card name -> tags (searchable, shown in Card Info). */
  tagsMap?: Map<string, string[]>;
  prefix: string;
  title?: string;
  subtitle?: string;
  rarityLock?: string[];
  valueFloor?: number;
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
  refMap,
  tagsMap,
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
  const [typeF, setTypeF] = useState(() =>
    loadSetting(prefix, "type", "All Types"),
  );
  const [colorSel, setColorSel] = useState<ColorSelection>(() =>
    decodeSelection(loadSetting(prefix, "colorsel", "")),
  );
  const [rarityF, setRarityF] = useState(() =>
    loadSetting(prefix, "rarity", "All Rarities"),
  );
  const [binderF, setBinderF] = useState(() =>
    loadSetting(prefix, "binder", "All Binders"),
  );
  const [mvMin, setMvMin] = useState(() =>
    parseInt(loadSetting(prefix, "mvmin", "0"), 10),
  );
  const [mvMax, setMvMax] = useState(() =>
    parseInt(loadSetting(prefix, "mvmax", "20"), 10),
  );
  const [textSearch, setTextSearch] = useState(
    () => loadSetting(prefix, "text", "0") === "1",
  );
  const [identity, setIdentity] = useState(
    () => loadSetting(prefix, "identity", "0") === "1",
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
  const [selected, setSelected] = useState<AggRow | null>(null);
  // Card Info modal: index into the CURRENT filtered list, null = closed.
  const [modalAt, setModalAt] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: AggRow } | null>(
    null,
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveSetting(prefix, "type", typeF);
    saveSetting(prefix, "colorsel", encodeSelection(colorSel));
    saveSetting(prefix, "rarity", rarityF);
    saveSetting(prefix, "binder", binderF);
    saveSetting(prefix, "mvmin", String(mvMin));
    saveSetting(prefix, "mvmax", String(mvMax));
    saveSetting(prefix, "text", textSearch ? "1" : "0");
    saveSetting(prefix, "identity", identity ? "1" : "0");
    saveSetting(prefix, "foil", foilOnly ? "1" : "0");
    saveSetting(prefix, "sort", sortKey);
    saveSetting(prefix, "sortdesc", sortDesc ? "1" : "0");
  }, [
    prefix,
    typeF,
    colorSel,
    rarityF,
    binderF,
    mvMin,
    mvMax,
    textSearch,
    identity,
    foilOnly,
    sortKey,
    sortDesc,
  ]);

  // Lock membership on the raw printings (Rare Binder / named binder).
  const inScope = useMemo(() => {
    return (cards ?? []).filter((c) => {
      if (binderFilter !== undefined && c.binder !== binderFilter) {
        return false;
      }
      if (rarityLock) {
        const byRarity = rarityLock.includes(c.rarity);
        const byValue = valueFloor !== undefined && cardPrice(c) >= valueFloor;
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

  const aggregated = useMemo(
    () => aggregate(inScope, refMap),
    [inScope, refMap],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const colorActive = colorSel.colors.size > 0 || colorSel.colorless;
    const rows = aggregated.filter((r) => {
      if (q) {
        let hit = r.name.toLowerCase().includes(q);
        if (!hit) {
          // Tags always match the search box (desktop rule).
          hit =
            tagsMap
              ?.get(r.name.toLowerCase())
              ?.some((t) => t.toLowerCase().includes(q)) ?? false;
        }
        if (!hit && textSearch) {
          hit =
            r.oracle_text.toLowerCase().includes(q) ||
            r.type_line.toLowerCase().includes(q);
        }
        if (!hit) {
          return false;
        }
      }
      if (typeF !== "All Types" && !r.type_line.includes(typeF)) {
        return false;
      }
      if (colorActive) {
        const field = identity ? r.color_identity : r.colors;
        if (!colorsSubsetMatch(field, colorSel.colors, colorSel.colorless)) {
          return false;
        }
      }
      if (!rarityLock && rarityF !== "All Rarities" && r.rarity !== rarityF) {
        return false;
      }
      if (binderFilter === undefined && binderF !== "All Binders") {
        const match =
          binderF === "(No binder)"
            ? r.printings.some((p) => p.binder === "")
            : r.printings.some((p) => p.binder === binderF);
        if (!match) {
          return false;
        }
      }
      if (mvMin > 0 && r.cmc < mvMin) {
        return false;
      }
      if (mvMax < 20 && r.cmc > mvMax) {
        return false;
      }
      if (foilOnly && !r.foil) {
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
          cmp = a.price - b.price;
          break;
        case "mana":
          cmp = a.cmc - b.cmc;
          break;
        case "rarity":
          cmp = (RARITY_RANK[a.rarity] ?? 99) - (RARITY_RANK[b.rarity] ?? 99);
          break;
        case "colors":
          cmp =
            (COLOR_RANK[displayColor(a.colors)] ?? 99) -
            (COLOR_RANK[displayColor(b.colors)] ?? 99);
          break;
        case "type":
          cmp = mainType(a.type_line).localeCompare(mainType(b.type_line));
          break;
        case "set_code":
          cmp = a.set_code.localeCompare(b.set_code);
          break;
        default:
          cmp = a.name.localeCompare(b.name);
      }
      return dir * (cmp || a.name.localeCompare(b.name));
    });
    return rows;
  }, [
    aggregated,
    search,
    typeF,
    colorSel,
    rarityF,
    binderF,
    mvMin,
    mvMax,
    textSearch,
    identity,
    foilOnly,
    sortKey,
    sortDesc,
    rarityLock,
    binderFilter,
  ]);

  const stats = useMemo(() => {
    const total = inScope.reduce((n, c) => n + c.quantity, 0);
    const names = aggregated.length;
    const value = inScope.reduce((v, c) => v + c.quantity * cardPrice(c), 0);
    return { total, names, value };
  }, [inScope, aggregated]);

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
    setBusy(true);
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
      setStatus(
        `Imported ${parsed.length} printings (${copies} cards). ` +
          `Click "Scryfall Online" to fill in types, colors and mana.`,
      );
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  };

  const onEnrich = async () => {
    if (!user || !cards) {
      return;
    }
    setBusy(true);
    try {
      // Strategy 1: precise per-printing lookups (also refreshes prices).
      let done = 0;
      let incomplete = false;
      const patchedIds = new Set<string>();
      try {
        const r = await fetchEnrichment(cards, (d, total) => {
          setStatus(`Scryfall lookup… ${d} / ${total} printings`);
        });
        incomplete = r.incomplete;
        if (r.patches.size > 0) {
          await applyEnrichment(user.uid, cards, r.patches, (w, total) => {
            setStatus(`Saving… ${w} / ${total} printings`);
          });
          done += r.patches.size;
          for (const id of r.patches.keys()) {
            patchedIds.add(id);
          }
        }
      } catch {
        incomplete = true;
      }

      // Strategy 2: if the API path was blocked (ad-blockers, burst
      // protection), one bulk download matched by name — the desktop's
      // reference approach.
      if (incomplete) {
        const remaining = cards.filter(
          (c) =>
            c.scryfall_id && !c.type_line && !patchedIds.has(c.scryfall_id),
        );
        const bulk = await fetchBulkEnrichment(remaining, setStatus);
        if (bulk.size > 0) {
          await applyEnrichment(user.uid, cards, bulk, (w, total) => {
            setStatus(`Saving… ${w} / ${total} printings`);
          });
          done += bulk.size;
        }
      }

      setStatus(
        done === 0
          ? "Everything is already enriched."
          : `Enriched ${done} printings — types, colors and mana filled in.`,
      );
    } catch (err) {
      setStatus(
        `Enrichment failed: ${err instanceof Error ? err.message : err}. ` +
          `If you use an ad-blocker, allow api.scryfall.com and data.scryfall.io.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDesc ? " ▾" : " ▴") : "";

  const onExport = () => {
    const csv = toManaBoxCsv(inScope);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const label = binderFilter || (rarityLock ? "rare_binder" : "collection");
    a.download = `${label}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`Exported ${inScope.length} printings (ManaBox format).`);
  };

  const onClear = async () => {
    if (!user || !cards) {
      return;
    }
    setShowClear(false);
    setBusy(true);
    try {
      const n = await clearLibrary(user.uid, cards, (done, total) => {
        setStatus(`Deleting… ${done} / ${total}`);
      });
      setStatus(`Library cleared — ${n} printings deleted.`);
    } finally {
      setBusy(false);
    }
  };

  const ctxActions = (row: AggRow): CtxAction[] => {
    if (!user || !cards) {
      return [];
    }
    const uid = user.uid;
    const all = cards;
    return [
      {
        label: `Set condition (${row.printings.length})`,
        children: CONDITIONS.map((c) => ({
          label: c,
          act: () => {
            void movePrintings(uid, all, row.printings, { condition: c });
          },
        })),
      },
      {
        label: "Set foil",
        children: [
          {
            label: "Foil ✦",
            act: () => {
              void movePrintings(uid, all, row.printings, { foil: true });
            },
          },
          {
            label: "Non-foil",
            act: () => {
              void movePrintings(uid, all, row.printings, { foil: false });
            },
          },
        ],
      },
      {
        label: "+1 quantity",
        act: () => {
          void adjustQuantity(uid, row.printings[0], +1);
        },
      },
      {
        label: "−1 quantity",
        act: () => {
          void adjustQuantity(uid, row.printings[0], -1);
        },
      },
      {
        label: "Move to binder…",
        act: () => {
          const b = window.prompt(
            `Move ${row.name} to binder (blank = none):\nExisting: ${binderNames.join(", ") || "—"}`,
            row.printings[0].binder,
          );
          if (b !== null) {
            void movePrintings(uid, all, row.printings, { binder: b.trim() });
          }
        },
      },
      {
        label: `Delete ${row.name}`,
        danger: true,
        act: () => {
          if (window.confirm(`Delete all printings of ${row.name}?`)) {
            void deletePrintings(uid, row.printings);
          }
        },
      },
    ];
  };

  return (
    <div className="collection-view">
      {(title || onBack) && (
        <div className="view-header">
          {onBack && (
            <button className="stone-btn" onClick={onBack}>
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
        <select
          className="combo"
          value={typeF}
          onChange={(e) => setTypeF(e.target.value)}
        >
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <ColorFilter value={colorSel} onChange={setColorSel} />
        {!rarityLock && (
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
        )}
        <div className="toolbar-spacer" />
        {!locked && (
          <>
            <button
              className="primary-btn"
              disabled={busy}
              onClick={() => setShowAdd(true)}
            >
              + Add Card
            </button>
            <button
              className="stone-btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Import CSV
            </button>
            <button
              className="stone-btn"
              disabled={busy}
              title="Optional: refresh per-printing data and current prices from Scryfall. Columns are already filled from the card reference automatically."
              onClick={() => {
                void onEnrich();
              }}
            >
              Scryfall Online
            </button>
            <button
              className="stone-btn danger"
              disabled={busy || !cards?.length}
              onClick={() => setShowClear(true)}
            >
              Clear Library
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

      <div className="filter-bar">
        <span className="filter-label">Mana value:</span>
        <input
          className="spin"
          type="number"
          min={0}
          max={20}
          value={mvMin}
          onChange={(e) => setMvMin(Number(e.target.value))}
        />
        <span className="filter-label">–</span>
        <input
          className="spin"
          type="number"
          min={0}
          max={20}
          value={mvMax}
          onChange={(e) => setMvMax(Number(e.target.value))}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={textSearch}
            onChange={(e) => setTextSearch(e.target.checked)}
          />
          Search card text
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={identity}
            onChange={(e) => setIdentity(e.target.checked)}
          />
          Match color identity
        </label>
        {binderFilter === undefined && (
          <>
            <span className="filter-label">Binder:</span>
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
        {!rarityLock && (
          <button className="stone-btn" onClick={() => setShowSearch(true)}>
            Card Search…
          </button>
        )}
        <button
          className="stone-btn"
          disabled={!inScope.length}
          onClick={onExport}
        >
          Export CSV
        </button>
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
          ) : aggregated.length === 0 ? (
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
                  <th onClick={() => onSort("type")}>Type{arrow("type")}</th>
                  <th onClick={() => onSort("colors")}>
                    Colors{arrow("colors")}
                  </th>
                  <th onClick={() => onSort("mana")}>Mana{arrow("mana")}</th>
                  <th onClick={() => onSort("set_code")}>
                    Set{arrow("set_code")}
                  </th>
                  <th onClick={() => onSort("rarity")}>
                    Rarity{arrow("rarity")}
                  </th>
                  <th className="num" onClick={() => onSort("quantity")}>
                    Owned{arrow("quantity")}
                  </th>
                  <th className="num" onClick={() => onSort("price")}>
                    Price{arrow("price")}
                  </th>
                  <th>Binder</th>
                  <th>Banned In</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const isSel = selected?.name === r.name;
                  const dc = displayColor(r.colors);
                  return (
                    <tr
                      key={r.name}
                      className={isSel ? "sel" : ""}
                      onClick={() => setSelected(r)}
                      onDoubleClick={() => setModalAt(i)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelected(r);
                        setCtx({ x: e.clientX, y: e.clientY, row: r });
                      }}
                    >
                      <td className="card-name">{r.name}</td>
                      <td className="dim">{mainType(r.type_line)}</td>
                      <td className={`col-${dc.toLowerCase()}`}>
                        {r.type_line ? dc : ""}
                      </td>
                      <td>
                        <ManaCost cost={r.mana_cost} />
                      </td>
                      <td className="dim">{r.set_code}</td>
                      <td className={`rar-${r.rarity.toLowerCase()}`}>
                        {r.rarity}
                      </td>
                      <td className="num">{r.quantity}</td>
                      <td className="num price">
                        {r.price > 0 ? `$${r.price.toFixed(2)}` : "—"}
                      </td>
                      <td className="dim">{r.binder}</td>
                      <td className="banned">{r.banned_in}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <Preview row={selected} />
      </div>

      {modalAt !== null && (
        <CardInfoModal
          rows={filtered}
          index={modalAt}
          onClose={() => setModalAt(null)}
          tagsMap={tagsMap}
          onSetTags={
            user
              ? (name, tags) => {
                  void setCardTags(user.uid, name, tags);
                }
              : undefined
          }
        />
      )}
      {showAdd && user && cards && (
        <AddCardModal
          binders={binderNames}
          onClose={() => setShowAdd(false)}
          onSubmit={(card) => {
            setShowAdd(false);
            void addCardManual(user.uid, cards, card).then(() =>
              setStatus(`Added ${card.quantity}× ${card.name}.`),
            );
          }}
        />
      )}
      {showSearch && (
        <CardSearchModal
          ownedNames={
            new Set((cards ?? []).map((c) => c.name.toLowerCase()))
          }
          onClose={() => setShowSearch(false)}
        />
      )}
      {showClear && (
        <ConfirmClearModal
          total={stats.total}
          onClose={() => setShowClear(false)}
          onConfirm={() => {
            void onClear();
          }}
        />
      )}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          actions={ctxActions(ctx.row)}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}

function Preview({ row }: { row: AggRow | null }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
  }, [row]);

  return (
    <aside className="preview">
      <div className="preview-img-slot">
        {row?.scryfall_id ? (
          <img
            key={row.scryfall_id}
            className={`preview-img${loaded ? " show" : ""}`}
            src={imageUrl(row.scryfall_id)}
            alt={row.name}
            onLoad={() => setLoaded(true)}
          />
        ) : (
          <span className="preview-hint">
            {row ? "No image for this card" : "Select a card"}
          </span>
        )}
      </div>
      {row && (
        <div className="preview-details">
          <div className="preview-name">{row.name}</div>
          {row.type_line && <div className="preview-line">{row.type_line}</div>}
          {row.mana_cost && (
            <div className="preview-line">
              <ManaCost cost={row.mana_cost} />
            </div>
          )}
          {row.oracle_text && (
            <div className="preview-oracle">
              {row.oracle_text.length > 260
                ? `${row.oracle_text.slice(0, 260)}…`
                : row.oracle_text}
            </div>
          )}
          {row.banned_in && (
            <div className="preview-line banned">Banned: {row.banned_in}</div>
          )}
          <div className="preview-printings">
            {row.printings.map((p, i) => (
              <div className="preview-line dim" key={i}>
                {p.set_code} #{p.collector_number}
                {p.foil ? " ✦" : ""} · {p.condition} · ×{p.quantity}
              </div>
            ))}
          </div>
          <div className="preview-badges">
            <span className="badge">
              Owned
              <b>{row.quantity}</b>
            </span>
            <span className="badge gold">
              Value
              <b>
                $
                {row.printings
                  .reduce((v, p) => v + p.quantity * cardPrice(p), 0)
                  .toFixed(2)}
              </b>
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
