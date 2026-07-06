import { useEffect, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { subscribeCards } from "../lib/collection";
import type { CardRow } from "../lib/manabox";
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

  useEffect(() => {
    if (!user) {
      return;
    }
    return subscribeCards(user.uid, setCards);
  }, [user]);

  const go = (key: NavKey) => {
    setNav(key);
    setOpenBinder("");
  };

  return (
    <div className="pit-shell">
      <aside className="sidebar">
        <img className="side-logo" src="/art/app_logo.png" alt="Collection Pit" />
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
        {nav === "library" && <Library cards={cards} prefix="library" />}
        {nav === "binder" && (
          <Library
            cards={cards}
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
      </main>
    </div>
  );
}
