import { useMemo } from "react";
import { cardPrice, type CardRow } from "../lib/manabox";

const RARITY_ORDER = ["Mythic", "Rare", "Uncommon", "Common"];
const RARITY_COLORS: Record<string, string> = {
  Mythic: "#ff8c3c",
  Rare: "#d4af37",
  Uncommon: "#a8c0cc",
  Common: "#666676",
};

/** Collection overview: headline stats, rarity breakdown, top values —
 *  the web cousin of the desktop Dashboard. */
export function Dashboard({ cards }: { cards: CardRow[] | null }) {
  const rows = cards ?? [];

  const stats = useMemo(() => {
    const total = rows.reduce((n, c) => n + c.quantity, 0);
    const names = new Set(rows.map((c) => c.name.toLowerCase())).size;
    const value = rows.reduce((v, c) => v + c.quantity * cardPrice(c), 0);
    const foils = rows.filter((c) => c.foil).reduce((n, c) => n + c.quantity, 0);
    const byRarity = new Map<string, number>();
    for (const c of rows) {
      const r = RARITY_ORDER.includes(c.rarity) ? c.rarity : "Common";
      byRarity.set(r, (byRarity.get(r) ?? 0) + c.quantity);
    }
    const top = [...rows]
      .sort((a, b) => cardPrice(b) - cardPrice(a))
      .slice(0, 10);
    return { total, names, value, foils, byRarity, top };
  }, [rows]);

  const maxRarity = Math.max(1, ...stats.byRarity.values());

  return (
    <div className="collection-view">
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
      </div>

      <div className="dash-panels">
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
    </div>
  );
}
