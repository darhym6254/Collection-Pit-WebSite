/** Help & Guide — how the site works and how it pairs with the desktop
 *  app. Static content, mirroring the desktop's guide. */
export function HelpView() {
  return (
    <div className="collection-view dash-scroll">
      <div className="view-header">
        <span className="view-title">Help &amp; Guide</span>
      </div>
      <div className="help-body">
        <section className="dash-panel">
          <div className="dash-panel-title">Getting your cards in</div>
          <p>
            Your collection comes from <b>ManaBox-format CSV files</b> — the
            same files the desktop app imports and exports. In the Library
            click <b>Import CSV</b> and pick an export from ManaBox or from
            the desktop app (Library → Export CSV). Re-importing the same
            file is safe: matching printings are updated, never duplicated.
            You can also add single cards with <b>+ Add Card</b>.
          </p>
          <p>
            Card details (types, colors, mana costs, rules text, legality)
            come from a <b>card reference</b> the site downloads once and
            caches in your browser — watch the status bar at the bottom.
            The optional <b>Scryfall Online</b> button additionally refreshes
            per-printing prices.
          </p>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-title">Library</div>
          <p>
            Search by name or tag; filters cover type, a multi-select color
            filter (checking G+R shows mono-green, mono-red and Gruul only,
            with a color-identity mode for Commander), rarity, mana value,
            rules text, binder and foils. Click column headers to sort.
            <b> Click</b> a row to preview it, <b>double-click</b> for the
            full Card Info window (◀/▶ walks the list),{" "}
            <b>right-click</b> for bulk actions: condition, foil, quantity,
            move to binder, delete.
          </p>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-title">Binders</div>
          <p>
            Two automatic binders mirror the desktop: the <b>Rare Binder</b>{" "}
            (every Rare/Mythic/Special plus any card worth $1.00 or more)
            and <b>Possible Commanders</b> (legendary creatures, commander
            planeswalkers and Backgrounds). Create named binders for
            physical storage; move cards into them from the Library's
            right-click menu; export any binder as CSV.
          </p>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-title">Decks</div>
          <p>
            Decks hold <b>desired counts</b> — adding a card to a deck never
            changes how many you own. Rows are colored:{" "}
            <span className="deck-ok">green</span> = covered,{" "}
            <span className="deck-tight">amber</span> = owned but tied up in
            other decks, <span className="deck-missing">red</span> = you
            don't own enough. The legality badge checks the format banlist,
            singleton rules, and (for Commander) that every card fits the
            commander's <b>color identity</b>. Use <b>Browse Cards</b> to
            add from your collection or all of Magic, <b>Import Decklist</b>{" "}
            for “4 Lightning Bolt” lists, and <b>Copy Missing</b> to grab a
            buy list.
          </p>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-title">Shopping List</div>
          <p>
            A manual want-list (add cards from Card Search) plus an
            automatic roll-up of everything your decks still need. When
            cards arrive, <b>Mark as Owned</b> moves them into your library.
          </p>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-title">Desktop app</div>
          <p>
            The website and the desktop app share the same CSV format, so
            you can move your collection either direction any time:
            Export CSV on one side, Import CSV on the other. Your web data
            is private to your Google account.
          </p>
        </section>
      </div>
    </div>
  );
}
