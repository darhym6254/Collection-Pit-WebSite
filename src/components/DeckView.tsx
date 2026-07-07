import { useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { addCardManual } from "../lib/collection";
import { displayColor, mainType } from "../lib/colors";
import {
  allocatedMap,
  computeAnalytics,
  COMMANDER_FORMATS,
  FORMATS,
  ownedMap,
  rowStatus,
  saveDeck,
  deleteDeck,
  validateDeck,
  withCardAdded,
  type Deck,
  type DeckCard,
} from "../lib/decks";
import { parseDecklistFile, parseDecklistText } from "../lib/decklist";
import { cardPrice, toManaBoxCsv, type CardRow } from "../lib/manabox";
import type { RefEntry } from "../lib/reference";
import { aggregate, type AggRow } from "./Library";
import { CardInfoModal } from "./CardInfoModal";
import { ContextMenu, type CtxAction } from "./LibraryModals";
import { ManaCost } from "./ManaCost";

const CURVE_LABELS = ["0", "1", "2", "3", "4", "5", "6", "7+"];
const COLOR_ORDER = ["W", "U", "B", "R", "G", "C"];
const COLOR_HEX: Record<string, string> = {
  W: "#f0e8d0",
  U: "#3d7fd6",
  B: "#8a6aa0",
  R: "#d65a4a",
  G: "#4a9a4a",
  C: "#8a8a9a",
};

interface DeckViewProps {
  deck: Deck;
  decks: Deck[];
  cards: CardRow[] | null;
  refMap: Map<string, RefEntry> | null;
  tagsMap?: Map<string, string[]>;
  onDeleted: () => void;
}

interface DeckRow {
  entry: DeckCard;
  ref?: RefEntry;
  owned: number;
  status: "ok" | "tight" | "missing";
  missing: number;
  setCode: string;
  rarity: string;
}

export function DeckView({
  deck,
  decks,
  cards,
  refMap,
  tagsMap,
  onDeleted,
}: DeckViewProps) {
  const { user } = useAuth();
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [showBrowser, setShowBrowser] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [modalRows, setModalRows] = useState<AggRow[] | null>(null);
  const [modalAt, setModalAt] = useState(0);
  const [ctx, setCtx] = useState<{
    x: number;
    y: number;
    entry: DeckCard;
  } | null>(null);

  const lookup = useMemo(
    () => (name: string) => refMap?.get(name.toLowerCase()),
    [refMap],
  );

  const owned = useMemo(() => ownedMap(cards ?? []), [cards]);
  const allocated = useMemo(() => allocatedMap(decks), [decks]);
  const verdict = useMemo(() => validateDeck(deck, lookup), [deck, lookup]);
  const analytics = useMemo(
    () => computeAnalytics(deck, lookup),
    [deck, lookup],
  );
  const issuesByName = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [n, reason] of verdict.issues) {
      const k = n.toLowerCase();
      m.set(k, [...(m.get(k) ?? []), reason]);
    }
    return m;
  }, [verdict]);

  // Per-name need within THIS deck, then row status against global
  // availability (owned never decremented; other decks tie copies up).
  const rows = useMemo(() => {
    const need = new Map<string, number>();
    for (const e of deck.cards) {
      const k = e.card_name.toLowerCase();
      need.set(k, (need.get(k) ?? 0) + e.quantity);
    }
    const byNamePrinting = new Map<string, CardRow>();
    for (const c of cards ?? []) {
      const k = c.name.toLowerCase();
      if (!byNamePrinting.has(k)) {
        byNamePrinting.set(k, c);
      }
    }
    const make = (entry: DeckCard): DeckRow => {
      const k = entry.card_name.toLowerCase();
      const own = owned.get(k) ?? 0;
      const thisNeed = need.get(k) ?? entry.quantity;
      const otherAlloc = Math.max(0, (allocated.get(k) ?? 0) - thisNeed);
      const st = rowStatus(thisNeed, own, otherAlloc);
      const p = byNamePrinting.get(k);
      return {
        entry,
        ref: lookup(entry.card_name),
        owned: own,
        status: st.status,
        missing: st.missing,
        setCode: p?.set_code ?? "",
        rarity: p?.rarity ?? "",
      };
    };
    const sortByName = (a: DeckRow, b: DeckRow) =>
      a.entry.card_name.localeCompare(b.entry.card_name);
    return {
      commanders: deck.cards.filter((c) => c.is_commander).map(make),
      mainboard: deck.cards
        .filter((c) => !c.is_commander && !c.is_sideboard)
        .map(make)
        .sort(sortByName),
      sideboard: deck.cards
        .filter((c) => c.is_sideboard)
        .map(make)
        .sort(sortByName),
    };
  }, [deck, cards, owned, allocated, lookup]);

  const missingLines = useMemo(() => {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const r of [...rows.commanders, ...rows.mainboard, ...rows.sideboard]) {
      const k = r.entry.card_name.toLowerCase();
      if (r.missing > 0 && !seen.has(k)) {
        lines.push(`${r.missing} ${r.entry.card_name}`);
        seen.add(k);
      }
    }
    return lines;
  }, [rows]);

  const totalCards = deck.cards
    .filter((c) => !c.is_sideboard)
    .reduce((n, c) => n + c.quantity, 0);
  const sbCards = deck.cards
    .filter((c) => c.is_sideboard)
    .reduce((n, c) => n + c.quantity, 0);

  const save = (next: Deck) => {
    if (user) {
      void saveDeck(user.uid, next);
    }
  };

  const mutateEntry = (entry: DeckCard, fn: (e: DeckCard) => DeckCard | null) => {
    const cards2 = deck.cards
      .map((c) => (c === entry ? fn(c) : c))
      .filter((c): c is DeckCard => c !== null);
    save({ ...deck, cards: cards2 });
  };

  const openInfo = (entry: DeckCard) => {
    // Build Card-Info rows for the whole deck in display order.
    const names = [
      ...rows.commanders,
      ...rows.mainboard,
      ...rows.sideboard,
    ].map((r) => r.entry.card_name);
    const ownedByName = new Map<string, CardRow[]>();
    for (const c of cards ?? []) {
      const k = c.name.toLowerCase();
      ownedByName.set(k, [...(ownedByName.get(k) ?? []), c]);
    }
    const agg: AggRow[] = names.map((n) => {
      const prints = ownedByName.get(n.toLowerCase()) ?? [];
      if (prints.length > 0) {
        return aggregate(prints, refMap)[0];
      }
      const ref = lookup(n);
      return {
        name: n,
        quantity: 0,
        price: 0,
        rarity: "",
        set_code: "",
        binder: "",
        foil: false,
        type_line: ref?.type_line ?? "",
        colors: ref?.colors ?? "",
        color_identity: ref?.color_identity ?? "",
        mana_cost: ref?.mana_cost ?? "",
        cmc: ref?.cmc ?? 0,
        oracle_text: ref?.oracle_text ?? "",
        banned_in: ref?.banned_in ?? "",
        scryfall_id: "",
        printings: [],
      };
    });
    setModalRows(agg);
    setModalAt(names.findIndex((n) => n === entry.card_name));
  };

  const ctxActions = (entry: DeckCard): CtxAction[] => [
    {
      label: "+1 copy",
      act: () => mutateEntry(entry, (e) => ({ ...e, quantity: e.quantity + 1 })),
    },
    {
      label: "−1 copy",
      act: () =>
        mutateEntry(entry, (e) =>
          e.quantity > 1 ? { ...e, quantity: e.quantity - 1 } : null,
        ),
    },
    {
      label: entry.is_sideboard ? "Move to mainboard" : "Move to sideboard",
      act: () =>
        mutateEntry(entry, (e) => ({
          ...e,
          is_sideboard: !e.is_sideboard,
          is_commander: false,
        })),
    },
    ...(COMMANDER_FORMATS.has(deck.format)
      ? [
          {
            label: entry.is_commander
              ? "Remove as commander"
              : "Set as commander",
            act: () =>
              mutateEntry(entry, (e) => ({
                ...e,
                is_commander: !e.is_commander,
                is_sideboard: false,
              })),
          },
        ]
      : []),
    {
      label: "Set category…",
      act: () => {
        const cat = window.prompt(
          "Category (e.g. Ramp, Removal — blank clears):",
          entry.category,
        );
        if (cat !== null) {
          mutateEntry(entry, (e) => ({ ...e, category: cat.trim() }));
        }
      },
    },
    {
      label: `Remove ${entry.card_name}`,
      danger: true,
      act: () => mutateEntry(entry, () => null),
    },
  ];

  const onRename = () => {
    const name = window.prompt("Deck name:", deck.name);
    if (name?.trim()) {
      save({ ...deck, name: name.trim() });
    }
  };

  const onDelete = () => {
    if (user && window.confirm(`Delete deck "${deck.name}"?`)) {
      void deleteDeck(user.uid, deck.id).then(onDeleted);
    }
  };

  const onCopyMissing = () => {
    void navigator.clipboard.writeText(missingLines.join("\n"));
  };

  const onExportList = () => {
    const lines: string[] = [];
    for (const r of rows.commanders) {
      lines.push(`// Commander`, `${r.entry.quantity} ${r.entry.card_name}`);
    }
    for (const r of rows.mainboard) {
      lines.push(`${r.entry.quantity} ${r.entry.card_name}`);
    }
    if (rows.sideboard.length) {
      lines.push("", "Sideboard");
      for (const r of rows.sideboard) {
        lines.push(`${r.entry.quantity} ${r.entry.card_name}`);
      }
    }
    download(`${deck.name}.txt`, lines.join("\r\n"), "text/plain");
  };

  const onExportCsv = () => {
    const byName = new Map<string, CardRow>();
    for (const c of cards ?? []) {
      const k = c.name.toLowerCase();
      if (!byName.has(k)) {
        byName.set(k, c);
      }
    }
    const rowsCsv: CardRow[] = deck.cards.map((e) => {
      const p = byName.get(e.card_name.toLowerCase());
      return {
        name: e.card_name,
        quantity: e.quantity,
        foil: false,
        condition: p?.condition ?? "near_mint",
        language: "EN",
        binder: "",
        set_code: p?.set_code ?? "",
        set_name: p?.set_name ?? "",
        collector_number: p?.collector_number ?? "",
        rarity: p?.rarity ?? "",
        scryfall_id: p?.scryfall_id ?? "",
        price_usd: p ? cardPrice(p) : 0,
        price_foil: 0,
      };
    });
    download(`${deck.name}.csv`, toManaBoxCsv(rowsCsv), "text/csv");
  };

  const section = (label: string, list: DeckRow[]) => {
    if (list.length === 0) {
      return null;
    }
    // Category stacks inside the mainboard when categories are in use.
    const groups = new Map<string, DeckRow[]>();
    for (const r of list) {
      const g = r.entry.category || "";
      groups.set(g, [...(groups.get(g) ?? []), r]);
    }
    const grouped = [...groups.entries()].sort(
      (a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])),
    );
    return (
      <>
        <tr className="deck-section">
          <td colSpan={8}>{label}</td>
        </tr>
        {grouped.map(([cat, members]) => (
          <SectionRows
            key={cat || "_"}
            cat={groups.size > 1 || cat ? cat : ""}
            members={members}
            issuesByName={issuesByName}
            unknown={new Set(verdict.unknown.map((n) => n.toLowerCase()))}
            onInfo={openInfo}
            onCtx={(e, entry) => {
              e.preventDefault();
              setCtx({ x: e.clientX, y: e.clientY, entry });
            }}
          />
        ))}
      </>
    );
  };

  return (
    <div className="collection-view">
      <div className="view-header deck-header">
        <span className="view-title deck-title" onClick={onRename}>
          {deck.name}
        </span>
        <select
          className="combo"
          value={deck.format}
          onChange={(e) => save({ ...deck, format: e.target.value })}
        >
          {FORMATS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <span className="dim">
          {totalCards} cards{sbCards ? ` | ${sbCards} sideboard` : ""}
        </span>
        <span
          className={`legality-badge ${
            verdict.unknown.length && verdict.legal
              ? "unknown"
              : verdict.legal
                ? "ok"
                : "bad"
          }`}
          title={
            verdict.issues.map(([n, r]) => `${n}: ${r}`).join("\n") ||
            (verdict.unknown.length
              ? `${verdict.unknown.length} unknown card(s)`
              : "")
          }
        >
          {verdict.legal
            ? verdict.unknown.length
              ? "? Unknown cards"
              : `✓ Legal for ${deck.format}`
            : `✗ Not legal — ${verdict.issues.length} issue(s)`}
        </span>
        <div className="toolbar-spacer" />
        <button
          className="stone-btn"
          onClick={() => setShowAnalytics((v) => !v)}
        >
          Analytics
        </button>
        <button className="stone-btn" onClick={() => setShowBrowser((v) => !v)}>
          Browse Cards
        </button>
        <button className="stone-btn" onClick={() => setShowImport(true)}>
          Import Decklist
        </button>
        <button
          className="stone-btn"
          disabled={!missingLines.length}
          onClick={onCopyMissing}
        >
          Copy Missing
        </button>
        <button className="stone-btn" onClick={onExportList}>
          Export List
        </button>
        <button className="stone-btn" onClick={onExportCsv}>
          Export CSV
        </button>
        <button className="stone-btn danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      {showAnalytics && <AnalyticsStrip analytics={analytics} missing={missingLines.length} />}

      <div className="lib-body">
        <div className="lib-table-wrap">
          {deck.cards.length === 0 ? (
            <p className="placeholder pad">
              Empty deck — use Browse Cards to add from your collection (or
              all cards), or Import Decklist.
            </p>
          ) : (
            <table className="lib-table">
              <thead>
                <tr>
                  <th>Card</th>
                  <th className="num">Qty</th>
                  <th>Type</th>
                  <th>Colors</th>
                  <th>Mana</th>
                  <th>Set</th>
                  <th>Rarity</th>
                  <th className="num">Owned</th>
                </tr>
              </thead>
              <tbody>
                {section("Commanders", rows.commanders)}
                {section("Mainboard", rows.mainboard)}
                {section("Sideboard", rows.sideboard)}
              </tbody>
            </table>
          )}
        </div>

        {showBrowser && (
          <DeckBrowser
            deck={deck}
            cards={cards}
            refMap={refMap}
            onAdd={(name, qty, asCommander, toSideboard) =>
              save(withCardAdded(deck, name, qty, asCommander, toSideboard))
            }
          />
        )}
      </div>

      {modalRows && (
        <CardInfoModal
          rows={modalRows}
          index={Math.max(0, modalAt)}
          onClose={() => setModalRows(null)}
          tagsMap={tagsMap}
          onMarkOwned={
            user && cards
              ? (row) => {
                  const qty = parseInt(
                    window.prompt(
                      `How many copies of ${row.name} do you now own?`,
                      "1",
                    ) ?? "",
                    10,
                  );
                  if (Number.isFinite(qty) && qty > 0) {
                    void addCardManual(user.uid, cards, {
                      name: row.name,
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
                      type_line: row.type_line,
                      colors: row.colors,
                      color_identity: row.color_identity,
                      mana_cost: row.mana_cost,
                      cmc: row.cmc,
                      oracle_text: row.oracle_text,
                      banned_in: row.banned_in,
                    });
                  }
                }
              : undefined
          }
        />
      )}
      {showImport && (
        <ImportDecklistModal
          onClose={() => setShowImport(false)}
          onImport={(entries) => {
            let next = deck;
            for (const e of entries) {
              next = withCardAdded(
                next,
                e.card_name,
                e.quantity,
                false,
                e.is_sideboard,
              );
            }
            save(next);
            setShowImport(false);
          }}
        />
      )}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          actions={ctxActions(ctx.entry)}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}

function SectionRows({
  cat,
  members,
  issuesByName,
  unknown,
  onInfo,
  onCtx,
}: {
  cat: string;
  members: DeckRow[];
  issuesByName: Map<string, string[]>;
  unknown: Set<string>;
  onInfo: (entry: DeckCard) => void;
  onCtx: (e: React.MouseEvent, entry: DeckCard) => void;
}) {
  return (
    <>
      {cat && (
        <tr className="deck-category">
          <td colSpan={8}>
            {cat} ({members.reduce((n, r) => n + r.entry.quantity, 0)})
          </td>
        </tr>
      )}
      {members.map((r, i) => {
        const k = r.entry.card_name.toLowerCase();
        const issues = issuesByName.get(k);
        const cls = issues
          ? "deck-illegal"
          : r.status === "missing"
            ? "deck-missing"
            : r.status === "tight"
              ? "deck-tight"
              : "deck-ok";
        const tip = [
          ...(issues ?? []).map((x) => `⚠ ${x}`),
          r.status === "missing"
            ? `Need ${r.missing} more — you own ${r.owned}`
            : r.status === "tight"
              ? "Owned, but tied up in other decks"
              : "",
          unknown.has(k) ? "Legality unknown — card not in reference" : "",
        ]
          .filter(Boolean)
          .join("\n");
        return (
          <tr
            key={`${k}-${r.entry.is_sideboard}-${i}`}
            title={tip}
            onDoubleClick={() => onInfo(r.entry)}
            onContextMenu={(e) => onCtx(e, r.entry)}
          >
            <td className={cls}>{r.entry.card_name}</td>
            <td className="num">{r.entry.quantity}</td>
            <td className="dim">{mainType(r.ref?.type_line)}</td>
            <td
              className={`col-${displayColor(r.ref?.colors).toLowerCase()}`}
            >
              {r.ref ? displayColor(r.ref.colors) : ""}
            </td>
            <td>
              <ManaCost cost={r.ref?.mana_cost} />
            </td>
            <td className="dim">{r.setCode}</td>
            <td className={`rar-${r.rarity.toLowerCase()}`}>{r.rarity}</td>
            <td className="num">{r.owned}</td>
          </tr>
        );
      })}
    </>
  );
}

function AnalyticsStrip({
  analytics,
  missing,
}: {
  analytics: ReturnType<typeof computeAnalytics>;
  missing: number;
}) {
  const maxCurve = Math.max(1, ...analytics.curve);
  return (
    <div className="deck-analytics">
      <div className="da-block">
        <div className="da-title">Mana curve (non-land)</div>
        <div className="da-curve">
          {analytics.curve.map((n, i) => (
            <div className="da-col" key={i}>
              <span className="da-count">{n || ""}</span>
              <div
                className="da-bar"
                style={{ height: `${(n / maxCurve) * 46}px` }}
              />
              <span className="da-label">{CURVE_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="da-block">
        <div className="da-title">Colors (identity)</div>
        {COLOR_ORDER.map((c) => {
          const n = analytics.colors.get(c) ?? 0;
          return (
            <div className="da-color-row" key={c}>
              <span style={{ color: COLOR_HEX[c], width: 14 }}>{c}</span>
              <div className="dash-bar-track">
                <div
                  className="dash-bar"
                  style={{
                    width: `${(n / Math.max(1, ...analytics.colors.values())) * 100}%`,
                    background: COLOR_HEX[c],
                  }}
                />
              </div>
              <span className="da-count">{n || ""}</span>
            </div>
          );
        })}
      </div>
      <div className="da-block">
        <div className="da-title">Summary</div>
        <div className="modal-line">
          Avg mana value: <b>{analytics.avgMv.toFixed(2)}</b>
        </div>
        <div className="modal-line">
          Lands: <b>{analytics.lands}</b> · Cards: <b>{analytics.total}</b>
        </div>
        <div className="modal-line">
          {missing ? (
            <span className="deck-missing">Missing: {missing} name(s)</span>
          ) : (
            <span className="deck-ok">Fully owned ✓</span>
          )}
        </div>
        <div className="da-types">
          {[...analytics.types.entries()].map(([t, n]) => (
            <span key={t} className="dim">
              {t} {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Right-hand available-cards browser: your collection or ALL cards. */
function DeckBrowser({
  deck,
  cards,
  refMap,
  onAdd,
}: {
  deck: Deck;
  cards: CardRow[] | null;
  refMap: Map<string, RefEntry> | null;
  onAdd: (
    name: string,
    qty: number,
    asCommander: boolean,
    toSideboard: boolean,
  ) => void;
}) {
  const [search, setSearch] = useState("");
  const [allCards, setAllCards] = useState(false);
  const [toSideboard, setToSideboard] = useState(false);
  const [scryHits, setScryHits] = useState<
    { name: string; mana: string; type: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const isCmdr = COMMANDER_FORMATS.has(deck.format);

  const ownedRows = useMemo(() => {
    if (allCards) {
      return [];
    }
    const q = search.trim().toLowerCase();
    return aggregate(cards ?? [], refMap)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [cards, refMap, search, allCards]);

  const runScry = async () => {
    const q = search.trim();
    if (q.length < 2) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`,
      );
      if (!res.ok) {
        setScryHits([]);
        return;
      }
      const body = (await res.json()) as {
        data: {
          name: string;
          mana_cost?: string;
          type_line?: string;
          card_faces?: { mana_cost?: string }[];
        }[];
      };
      setScryHits(
        body.data.slice(0, 60).map((c) => ({
          name: c.name,
          mana: c.mana_cost || (c.card_faces?.[0]?.mana_cost ?? ""),
          type: c.type_line ?? "",
        })),
      );
    } finally {
      setBusy(false);
    }
  };

  const list = allCards
    ? scryHits
    : ownedRows.map((r) => ({
        name: r.name,
        mana: r.mana_cost,
        type: r.type_line,
      }));

  return (
    <aside className="deck-browser">
      <div className="lib-toolbar-row">
        <input
          className="search-field wide"
          placeholder={
            allCards ? "Search ALL cards (Enter)…" : "Search your collection…"
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && allCards) {
              void runScry();
            }
          }}
        />
      </div>
      <div className="deck-browser-opts">
        <label className="check">
          <input
            type="checkbox"
            checked={allCards}
            onChange={(e) => setAllCards(e.target.checked)}
          />
          All cards
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={toSideboard}
            onChange={(e) => setToSideboard(e.target.checked)}
          />
          to sideboard
        </label>
        {allCards && (
          <button
            className="stone-btn"
            disabled={busy}
            onClick={() => {
              void runScry();
            }}
          >
            {busy ? "…" : "Search"}
          </button>
        )}
      </div>
      <div className="deck-browser-list">
        {list.length === 0 ? (
          <p className="placeholder pad">
            {allCards
              ? "Search every Magic card and add unowned cards to plan the deck."
              : "Cards from your collection appear here."}
          </p>
        ) : (
          list.map((c) => (
            <div className="deck-browser-row" key={c.name}>
              <div className="dbr-main">
                <span className="card-name">{c.name}</span>
                <span className="dbr-sub dim">
                  <ManaCost cost={c.mana} /> {mainType(c.type)}
                </span>
              </div>
              <button
                className="ghost-btn small"
                title="Add 1 copy"
                onClick={() => onAdd(c.name, 1, false, toSideboard)}
              >
                +1
              </button>
              {isCmdr && (
                <button
                  className="ghost-btn small"
                  title="Add as commander"
                  onClick={() => onAdd(c.name, 1, true, false)}
                >
                  ★
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <p className="dim search-note">
        +1 adds a copy · ★ adds as commander · double-click deck rows for
        Card Info · right-click deck rows to edit
      </p>
    </aside>
  );
}

function ImportDecklistModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (entries: DeckCard[]) => void;
}) {
  const [text, setText] = useState("");
  const fileRef = { current: null as HTMLInputElement | null };
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
        <div className="modal-name">Import Decklist</div>
        <p className="modal-line dim">
          One card per line: “4 Lightning Bolt”. “Commander: X” and section
          headers (Deck / Sideboard / Commander) work; printing suffixes
          like “(C21) 263” are stripped. Or load a .txt/.csv file.
        </p>
        <textarea
          className="decklist-input"
          rows={12}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="modal-footer">
          <button
            className="stone-btn"
            onClick={() => fileRef.current?.click()}
          >
            Load from file…
          </button>
          <input
            ref={(el) => {
              fileRef.current = el;
            }}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) {
                void f.text().then((content) => {
                  const entries = parseDecklistFile(f.name, content);
                  if (entries.length) {
                    onImport(entries);
                  }
                });
              }
            }}
          />
          <div className="toolbar-spacer" />
          <button className="stone-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            disabled={!text.trim()}
            onClick={() => onImport(parseDecklistText(text))}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
