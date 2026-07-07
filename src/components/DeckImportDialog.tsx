import { useState } from "react";
import { FORMATS } from "../lib/decks";
import type { CardRow } from "../lib/manabox";

interface Props {
  fileName: string;
  cards: CardRow[];
  onCreate: (name: string, format: string, alsoLibrary: boolean) => void;
  onClose: () => void;
}

/** Import Deck dialog — mirrors the desktop: entry count, deck name
 *  (prefilled from the filename), format, and an opt-in "also add to my
 *  Library" (deck entries alone hold DESIRED counts and never change
 *  what you own). */
export function DeckImportDialog({
  fileName,
  cards,
  onCreate,
  onClose,
}: Props) {
  const stem = fileName.replace(/\.csv$/i, "");
  const [name, setName] = useState(stem);
  const [format, setFormat] = useState("Commander");
  const [alsoLibrary, setAlsoLibrary] = useState(false);
  const copies = cards.reduce((n, c) => n + c.quantity, 0);

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
        <div className="modal-name">Import Deck</div>
        <p className="modal-line">
          Found <b>{cards.length}</b> card entries ({copies} copies) in{" "}
          <b>{fileName}</b>.
        </p>
        <div className="form-grid">
          <label>Deck name</label>
          <input
            className="search-field wide"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <label>Format</label>
          <select
            className="combo"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {FORMATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={alsoLibrary}
            onChange={(e) => setAlsoLibrary(e.target.checked)}
          />
          Also add these cards to my Library
        </label>
        <p className="modal-line dim">
          Off (default): the deck just lists desired counts — your owned
          totals stay exactly as they are.
        </p>
        <div className="modal-footer">
          <button className="stone-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim(), format, alsoLibrary)}
          >
            Create Deck
          </button>
        </div>
      </div>
    </div>
  );
}
