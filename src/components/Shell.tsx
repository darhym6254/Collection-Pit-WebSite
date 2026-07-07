import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { subscribeCards, subscribeTags } from "../lib/collection";
import { parseManaBoxCsv, type CardRow } from "../lib/manabox";
import { loadReference, type RefEntry } from "../lib/reference";
import {
  createDeck,
  saveDeck,
  subscribeDecks,
  withCardAdded,
  type Deck,
  type DeckCard,
} from "../lib/decks";
import {
  addToWishlist,
  subscribeWishlist,
  type WishEntry,
} from "../lib/wishlist";
import { importCards } from "../lib/collection";
import { DeckImportDialog } from "./DeckImportDialog";
import { Library } from "./Library";
import { BindersPage } from "./BindersPage";
import { Dashboard } from "./Dashboard";
import { DeckView } from "./DeckView";
import { ShoppingView } from "./ShoppingView";
import { HelpView } from "./HelpView";

export type NavKey =
  | "library"
  | "binder"
  | "commanders"
  | "binders"
  | "dashboard"
  | "shopping"
  | "help"
  | "deck";

const BINDER_RARITIES = ["Rare", "Mythic", "Special"];
const VALUE_FLOOR = 1.0;

/** Desktop-style shell: sidebar (logo + nav) on the left, the active view
 *  on the right, one shared live subscription to the user's cards. */
export function Shell() {
  const { user, signOutUser } = useAuth();
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [nav, setNav] = useState<NavKey>("library");
  // A named binder opened from the Binders page ("" = list view).
  const [openBinder, setOpenBinder] = useState("");
  // Name-keyed card reference (auto-loaded, cached in the browser) — the
  // web version of the desktop's AtomicCards table.
  const [refMap, setRefMap] = useState<Map<string, RefEntry> | null>(null);
  const [refStatus, setRefStatus] = useState("Loading card reference…");

  const [tagsMap, setTagsMap] = useState<Map<string, string[]>>(new Map());
  const [decks, setDecks] = useState<Deck[]>([]);
  const [openDeckId, setOpenDeckId] = useState("");
  const deckFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeCards(user.uid, setCards);
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeTags(user.uid, setTagsMap);
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeDecks(user.uid, setDecks);
  }, [user]);

  const [wishlist, setWishlist] = useState<WishEntry[]>([]);
  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeWishlist(user.uid, setWishlist);
  }, [user]);

  const onAddToWishlist = (name: string, qty: number) => {
    if (user) {
      void addToWishlist(user.uid, wishlist, name, qty);
    }
  };

  const onAddToDeck = (deckId: string, name: string, asCommander: boolean) => {
    const deck = decks.find((d) => d.id === deckId);
    if (deck && user) {
      void saveDeck(user.uid, withCardAdded(deck, name, 1, asCommander));
    }
  };

  const openDeck = (id: string) => {
    setOpenDeckId(id);
    setNav("deck");
    setOpenBinder("");
  };

  const onNewDeck = () => {
    const name = window.prompt("Deck name:");
    if (name?.trim() && user) {
      void createDeck(user.uid, name.trim(), "Commander").then(openDeck);
    }
  };

  // Import Deck: parse first, then confirm via the desktop-style dialog.
  const [deckImport, setDeckImport] = useState<{
    fileName: string;
    cards: CardRow[];
  } | null>(null);

  const onImportDeckFile = async (file: File) => {
    const { cards: parsed } = parseManaBoxCsv(await file.text());
    if (parsed.length) {
      setDeckImport({ fileName: file.name, cards: parsed });
    }
  };

  const onCreateImportedDeck = (
    name: string,
    format: string,
    alsoLibrary: boolean,
  ) => {
    if (!user || !deckImport) {
      return;
    }
    const parsed = deckImport.cards;
    setDeckImport(null);
    // Deck entries hold DESIRED counts only — the library is unchanged
    // unless the user opted in.
    const byName = new Map<string, number>();
    for (const c of parsed) {
      byName.set(c.name, (byName.get(c.name) ?? 0) + c.quantity);
    }
    const entries: DeckCard[] = [...byName.entries()].map(([n, q]) => ({
      card_name: n,
      quantity: q,
      is_commander: false,
      is_sideboard: false,
      category: "",
    }));
    void createDeck(user.uid, name, format, entries).then((id) => {
      openDeck(id);
      if (alsoLibrary) {
        void importCards(user.uid, parsed);
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    loadReference((msg) => {
      if (!cancelled) {
        setRefStatus(msg);
      }
    })
      .then((map) => {
        if (!cancelled) {
          setRefMap(map);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRefStatus(
            `Reference unavailable: ${err instanceof Error ? err.message : err}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const go = (key: NavKey) => {
    setNav(key);
    setOpenBinder("");
  };

  return (
    <div className="pit-shell">
      <aside className="sidebar">
        <img
          className="side-logo"
          src="/assets/app_logo.png"
          alt="Collection Pit"
        />
        <nav className="side-nav">
          <button
            className={`nav-btn${nav === "library" ? " active" : ""}`}
            onClick={() => go("library")}
          >
            Library
          </button>
          <button
            className={`nav-btn${
              nav === "binders" || nav === "binder" || nav === "commanders"
                ? " active"
                : ""
            }`}
            onClick={() => go("binders")}
          >
            Binders
          </button>
          <button
            className={`nav-btn${nav === "dashboard" ? " active" : ""}`}
            onClick={() => go("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={`nav-btn${nav === "shopping" ? " active" : ""}`}
            onClick={() => go("shopping")}
          >
            Shopping List
          </button>
        </nav>
        <div className="side-decks">
          <div className="side-section">DECKS</div>
          <div className="side-deck-list">
            {decks.map((d) => (
              <button
                key={d.id}
                className={`nav-btn deck-nav${
                  nav === "deck" && openDeckId === d.id ? " active" : ""
                }`}
                onClick={() => openDeck(d.id)}
              >
                {d.name}
              </button>
            ))}
            {decks.length === 0 && (
              <span className="side-hint">No decks yet</span>
            )}
          </div>
          <button className="stone-btn side-newdeck" onClick={onNewDeck}>
            + New Deck
          </button>
          <button
            className="ghost-btn side-importdeck"
            onClick={() => deckFileRef.current?.click()}
          >
            Import Deck
          </button>
          <input
            ref={deckFileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) {
                void onImportDeckFile(f);
              }
            }}
          />
        </div>
        <div className="side-spacer" />
        <button
          className={`nav-btn${nav === "help" ? " active" : ""}`}
          onClick={() => go("help")}
        >
          Help &amp; Guide
        </button>
        <div className="side-user">
          <span className="side-email">{user?.email}</span>
          <button
            className="ghost-btn"
            onClick={() => {
              void signOutUser();
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="view">
        {nav === "library" && (
          <Library
            cards={cards}
            refMap={refMap}
            tagsMap={tagsMap}
            prefix="library"
            onAddToWishlist={onAddToWishlist}
            decks={decks}
            onAddToDeck={onAddToDeck}
          />
        )}
        {nav === "shopping" && (
          <ShoppingView
            cards={cards}
            decks={decks}
            wishlist={wishlist}
            refMap={refMap}
          />
        )}
        {nav === "binder" && (
          <Library
            cards={cards}
            refMap={refMap}
            tagsMap={tagsMap}
            prefix="binder"
            title="Rare Binder"
            subtitle="rares, mythics, specials and any card worth $1.00 or more"
            rarityLock={BINDER_RARITIES}
            valueFloor={VALUE_FLOOR}
            onBack={() => go("binders")}
          />
        )}
        {nav === "commanders" && (
          <Library
            cards={cards}
            refMap={refMap}
            tagsMap={tagsMap}
            prefix="commanders"
            title="Possible Commanders"
            subtitle="legendary creatures, commander planeswalkers and Backgrounds you own"
            commanderLock
            onBack={() => go("binders")}
          />
        )}
        {nav === "binders" &&
          (openBinder ? (
            <Library
              cards={cards}
              refMap={refMap}
              tagsMap={tagsMap}
              prefix="binderspage"
              title={openBinder}
              binderFilter={openBinder}
              onBack={() => setOpenBinder("")}
            />
          ) : (
            <BindersPage
              cards={cards}
              refMap={refMap}
              onOpenRare={() => setNav("binder")}
              onOpenCommanders={() => setNav("commanders")}
              onOpenBinder={setOpenBinder}
            />
          ))}
        {nav === "deck" &&
          (() => {
            const deck = decks.find((d) => d.id === openDeckId);
            return deck ? (
              <DeckView
                deck={deck}
                decks={decks}
                cards={cards}
                refMap={refMap}
                tagsMap={tagsMap}
                onDeleted={() => go("library")}
              />
            ) : (
              <p className="placeholder pad">Deck not found.</p>
            );
          })()}
        {nav === "dashboard" && (
          <Dashboard cards={cards} decks={decks} refMap={refMap} />
        )}
        {nav === "help" && <HelpView />}
        <div className="status-bar">
          <span />
          <span className="ref-status">{refStatus}</span>
        </div>
        {deckImport && (
          <DeckImportDialog
            fileName={deckImport.fileName}
            cards={deckImport.cards}
            onCreate={onCreateImportedDeck}
            onClose={() => setDeckImport(null)}
          />
        )}
      </main>
    </div>
  );
}
