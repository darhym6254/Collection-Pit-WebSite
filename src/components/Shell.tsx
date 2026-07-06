import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { subscribeCards, subscribeTags } from "../lib/collection";
import type { CardRow } from "../lib/manabox";
import { loadReference, type RefEntry } from "../lib/reference";
import { Library } from "./Library";
import { BindersPage } from "./BindersPage";
import { Dashboard } from "./Dashboard";

export type NavKey = "library" | "binder" | "binders" | "dashboard";

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
            className={`nav-btn${nav === "binders" || nav === "binder" ? " active" : ""}`}
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
        </nav>
        <div className="side-spacer" />
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
              onOpenRare={() => setNav("binder")}
              onOpenBinder={setOpenBinder}
            />
          ))}
        {nav === "dashboard" && <Dashboard cards={cards} />}
        <div className="status-bar">
          <span />
          <span className="ref-status">{refStatus}</span>
        </div>
      </main>
    </div>
  );
}
