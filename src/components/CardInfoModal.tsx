import { useCallback, useEffect, useState } from "react";
import type { AggRow } from "./Library";
import { cardPrice } from "../lib/manabox";
import { imageUrl } from "../lib/scryfall";
import { ManaCost } from "./ManaCost";

interface Props {
  /** The caller's current filtered+sorted list — Prev/Next walks it. */
  rows: AggRow[];
  index: number;
  onClose: () => void;
}

/** Card Info modal — the web version of the desktop's read-first Card
 *  Info window: large image, full details, Prev/Next over the caller's
 *  visible list, Esc/backdrop/Close to dismiss. Action buttons arrive in
 *  a later phase (decks/binders first). */
export function CardInfoModal({ rows, index: initial, onClose }: Props) {
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initial, rows.length - 1)),
  );
  const [imgLoaded, setImgLoaded] = useState(false);
  const row = rows[index];

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const ni = i + delta;
        if (ni < 0 || ni >= rows.length) {
          return i;
        }
        setImgLoaded(false);
        return ni;
      });
    },
    [rows.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        go(-1);
      } else if (e.key === "ArrowRight") {
        go(+1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!row) {
    return null;
  }
  const value = row.printings.reduce(
    (v, p) => v + p.quantity * cardPrice(p),
    0,
  );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal card-info">
        <div className="modal-body">
          <div className="modal-left">
            <div className="modal-name">{row.name}</div>
            {row.type_line && (
              <div className="modal-line">
                <span className="dim">Type:</span> {row.type_line}
              </div>
            )}
            {row.mana_cost && (
              <div className="modal-line">
                <span className="dim">Mana:</span>{" "}
                <ManaCost cost={row.mana_cost} />
                <span className="dim"> · MV {row.cmc}</span>
              </div>
            )}
            <div className="modal-line">
              <span className="dim">Rarity:</span>{" "}
              <span className={`rar-${row.rarity.toLowerCase()}`}>
                {row.rarity}
              </span>
            </div>
            {row.binder && (
              <div className="modal-line">
                <span className="dim">Binder:</span> {row.binder}
              </div>
            )}
            {row.oracle_text && (
              <div className="preview-oracle modal-oracle">
                {row.oracle_text}
              </div>
            )}
            {row.banned_in && (
              <div className="modal-line banned">Banned: {row.banned_in}</div>
            )}
            <div className="modal-printings">
              <div className="dim modal-line">Printings you own:</div>
              {row.printings.map((p, i) => (
                <div className="modal-line dim" key={i}>
                  {p.set_name || p.set_code} ({p.set_code}) #
                  {p.collector_number}
                  {p.foil ? " ✦" : ""} · {p.condition} · {p.language} · ×
                  {p.quantity}
                  {cardPrice(p) > 0 && (
                    <span className="price"> ${cardPrice(p).toFixed(2)}</span>
                  )}
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
                <b>${value.toFixed(2)}</b>
              </span>
            </div>
          </div>

          <div className="modal-right">
            <div className="modal-img-slot">
              {row.scryfall_id ? (
                <img
                  key={row.scryfall_id}
                  className={`preview-img${imgLoaded ? " show" : ""}`}
                  src={imageUrl(row.scryfall_id)}
                  alt={row.name}
                  onLoad={() => setImgLoaded(true)}
                />
              ) : (
                <span className="preview-hint">No image</span>
              )}
            </div>
            <div className="modal-nav">
              <button
                className="stone-btn"
                disabled={index === 0}
                onClick={() => go(-1)}
              >
                ◀ Prev
              </button>
              <span className="modal-counter">
                {index + 1} / {rows.length}
              </span>
              <button
                className="stone-btn"
                disabled={index >= rows.length - 1}
                onClick={() => go(+1)}
              >
                Next ▶
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="stone-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
