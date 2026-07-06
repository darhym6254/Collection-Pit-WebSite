import { useMemo } from "react";
import { colorLetters, mainType } from "../lib/colors";
import { computeAnalytics, type Deck } from "../lib/decks";
import { cardPrice, type CardRow } from "../lib/manabox";
import type { RefEntry } from "../lib/reference";

const RARITY_ORDER = ["Mythic", "Rare", "Uncommon", "Common"];
const RARITY_COLORS: Record<string, string> = {
  Mythic: "#e87000",
  Rare: "#d4af37",
  Uncommon: "#a8c0cc",
  Common: "#666676",
};
const COLOR_ORDER = ["W", "U", "B", "R", "G", "C"];
const COLOR_HEX: Record<string, string> = {
  W: "#f0e8d0",
  U: "#3d7fd6",
  B: "#8a6aa0",
  R: "#d65a4a",
  G: "#4a9a4a",
  C: "#8a8a9a",
};
const TYPE_ORDER = [
  "Creature",
  "Instant",
  "Sorcery",
  "Enchantment",
  "Artifact",
  "Planeswalker",
  "Land",
  "Battle",
];

interface DashboardProps {
  cards: CardRow[] | null;
  decks?: Deck[];
  refMap?: Map<string, RefEntry> | null;
}

/** Collection overview + per-deck analytics — the desktop Dashboard. */
export function Dashboard({ cards, decks = [], refMap }: DashboardProps) {
  const rows = cards ?? [];
  const lookup = (name: string) => refMap?.get(name.toLowerCase());

  const stats = useMemo(() => {
    const total = rows.reduce((n, c) => n + c.quantity, 0);
    const names = new Set(rows.map((c) => c.name.toLowerCase())).size;
    const value = rows.reduce((v, c) => v + c.quantity * cardPrice(c), 0);
    const foils = rows.filter((c) => c.foil).reduce((n, c) => n + c.quantity, 0);
    const byRarity = new Map<string, number>();
    const byColor = new Map<string, number>();
    const byType = new Map<string, number>();
    for (const c of rows) {
      const r = RARITY_ORDER.includes(c.rarity) ? c.rarity : "Common";
      byRarity.set(r, (byRarity.get(r) ?? 0) + c.quantity);
      const ref = lookup(c.name);
      const colorsCsv = c.colors || ref?.colors;
      const letters = colorLetters(colorsCsv);
      if (letters.length === 0) {
        byColor.set("C", (byColor.get("C") ?? 0) + c.quantity);
      }
      for (const l of letters) {
        byColor.set(l, (byColor.get(l) ?? 0) + c.quantity);
      }
      const t = mainType(c.type_line || ref?.type_line);
      if (t) {
        byType.set(t, (byType.get(t) ?? 0) + c.quantity);
      }
    }
    const top = [...rows]
      .sort((a, b) => cardPrice(b) - cardPrice(a))
      .slice(0, 10);
    return { total, names, value, foils, byRarity, byColor, byType, top };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, refMap]);

  const maxRarity = Math.max(1, ...stats.byRarity.values());
  const maxColor = Math.max(1, ...stats.byColor.values());
  const maxType = Math.max(1, ...stats.byType.values());

  return (
    <div className="collection-view dash-scroll">
      <div className="view-header">
        <span className="view-title">Dashboard</span>
      </div>

      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-num">{stats.total}</div>
          <div className="dash-label">total cards</div>
        </div>
        <div className="dash-card">
          <div className="dash-num">{stats.names}</div>
          <div className="dash-label">unique cards</div>
        </div>
        <div className="dash-card">
          <div className="dash-num gold">${stats.value.toFixed(2)}</div>
          <div className="dash-label">collection value</div>
        </div>
        <div className="dash-card">
          <div className="dash-num foil">{stats.foils}</div>
          <div className="dash-label">foils</div>
        </div>
        <div className="dash-card">
          <div className="dash-num">{decks.length}</div>
          <div className="dash-label">decks</div>
        </div>
      </div>

      <div className="dash-panels">
        <div className="dash-panel">
          <div className="dash-panel-title">Colors</div>
          {COLOR_ORDER.map((c) => {
            const n = stats.byColor.get(c) ?? 0;
            return (
              <div className="dash-bar-row" key={c}>
                <span className="dash-bar-label" style={{ color: COLOR_HEX[c] }}>
                  {c}
                </span>
                <div className="dash-bar-track">
                  <div
                    className="dash-bar"
                    style={{
                      width: `${(n / maxColor) * 100}%`,
                      background: COLOR_HEX[c],
                    }}
                  />
                </div>
                <span className="dash-bar-count">{n}</span>
              </div>
            );
          })}
        </div>

        <div className="dash-panel">
          <div className="dash-panel-title">Types</div>
          {TYPE_ORDER.map((t) => {
            const n = stats.byType.get(t) ?? 0;
            return (
              <div className="dash-bar-row" key={t}>
                <span className="dash-bar-label dim">{t}</span>
                <div className="dash-bar-track">
                  <div
                    className="dash-bar"
                    style={{ width: `${(n / maxType) * 100}%`, background: "#0e7490" }}
                  />
                </div>
                <span className="dash-bar-count">{n}</span>
              </div>
            );
          })}
        </div>

        <div className="dash-panel">
          <div className="dash-panel-title">Rarity breakdown</div>
          {RARITY_ORDER.map((r) => {
            const n = stats.byRarity.get(r) ?? 0;
            return (
              <div className="dash-bar-row" key={r}>
                <span className="dash-bar-label" style={{ color: RARITY_COLORS[r] }}>
                  {r}
                </span>
                <div className="dash-bar-track">
                  <div
                    className="dash-bar"
                    style={{
                      width: `${(n / maxRarity) * 100}%`,
                      background: RARITY_COLORS[r],
                    }}
                  />
                </div>
                <span className="dash-bar-count">{n}</span>
              </div>
            );
          })}
        </div>

        <div className="dash-panel">
          <div className="dash-panel-title">Most valuable printings</div>
          {stats.top.map((c, i) => (
            <div className="dash-top-row" key={i}>
              <span className="card-name">{c.name}</span>
              <span className="dash-top-set">{c.set_code}</span>
              <span className="price">${cardPrice(c).toFixed(2)}</span>
            </div>
          ))}
          {stats.top.length === 0 && (
            <p className="placeholder">Import your collection first.</p>
          )}
        </div>
      </div>

      {decks.length > 0 && (
        <div className="dash-panels">
          <div className="dash-panel deck-dash">
            <div className="dash-panel-title">Decks</div>
            {decks.map((d) => {
              const a = computeAnalytics(d, lookup);
              const commanders = d.cards
                .filter((c) => c.is_commander)
                .map((c) => c.card_name);
              const maxCurve = Math.max(1, ...a.curve);
              return (
                <div className="deck-dash-row" key={d.id}>
                  <div className="deck-dash-main">
                    <span className="card-name">{d.name}</span>
                    <span className="dim">
                      {d.format} · {a.total} cards
                      {commanders.length
                        ? ` · ⭐ ${commanders.join(", ")}`
                        : ""}
                      {` · avg MV ${a.avgMv.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="deck-dash-curve">
                    {a.curve.map((n, i) => (
                      <div
                        key={i}
                        className="da-bar"
                        style={{
                          height: `${4 + (n / maxCurve) * 24}px`,
                          width: "10px",
                        }}
                        title={`MV ${i === 7 ? "7+" : i}: ${n}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
