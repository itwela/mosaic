import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  allCategories,
  heatLevel,
  HEAT_COLORS,
  HEAT_LABELS,
  incrementCopy,
  removeCommand,
  setCategory,
  useCommandDb,
} from "../store/commands";
import "./CommandsView.css";

type SortMode = "hot" | "recent" | "az";

function categoryColor(cat: string): string {
  const known: Record<string, string> = {
    npm: "#c14b4b", fs: "#7aab9c", git: "#e0554a", other: "#A39377",
  };
  return known[cat] ?? "#A39377";
}

export default function CommandsView() {
  const db = useCommandDb();
  const [search, setSearch] = useState("");
  const [category, setCategoryFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("hot");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const categories = useMemo(() => allCategories(db), [db]);

  const visible = useMemo(() => {
    let list = db;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.text.toLowerCase().includes(q) ||
          (c.label ?? "").toLowerCase().includes(q),
      );
    }
    if (category !== "all") {
      list = list.filter((c) => c.category === category);
    }
    if (sort === "hot") {
      list = [...list].sort((a, b) => b.copyCount - a.copyCount || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    } else if (sort === "recent") {
      list = [...list].sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
    } else {
      list = [...list].sort((a, b) => a.text.localeCompare(b.text));
    }
    return list;
  }, [db, search, category, sort]);

  async function copy(text: string, id: string) {
    try {
      await writeText(text);
      incrementCopy(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="commands-view">
      <div className="commands-card">
        <div className="commands-header">
          <div>
            <div className="commands-eyebrow">Command Database</div>
            <h1 className="commands-title">Every command, in one place</h1>
            <p className="commands-sub">
              {db.length} command{db.length === 1 ? "" : "s"} saved across your terminals.
              Hotter commands get used more — the color tells you at a glance.
            </p>
          </div>
          <div className="commands-heat-legend">
            <span>cold</span>
            <i className="heat-swatch" style={{ background: HEAT_COLORS.cold }} />
            <i className="heat-swatch" style={{ background: HEAT_COLORS.cool }} />
            <i className="heat-swatch" style={{ background: HEAT_COLORS.warm }} />
            <i className="heat-swatch" style={{ background: HEAT_COLORS.hot }} />
            <i className="heat-swatch" style={{ background: HEAT_COLORS.hotter }} />
            <span>hot</span>
          </div>
        </div>

        <div className="commands-toolbar">
          <div className="commands-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="commands-search-icon">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="commands-search-input"
              placeholder="Search commands..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="commands-search-clear" onClick={() => setSearch("")} title="Clear">×</button>
            )}
          </div>

          <div className="commands-sort-group">
            {(["hot", "recent", "az"] as SortMode[]).map((m) => (
              <button
                key={m}
                className={`commands-sort-btn ${sort === m ? "commands-sort-active" : ""}`}
                onClick={() => setSort(m)}
              >
                {m === "hot" ? "Hot first" : m === "recent" ? "Recent" : "A–Z"}
              </button>
            ))}
          </div>
        </div>

        <div className="commands-categories">
          <button
            className={`commands-cat-pill ${category === "all" ? "commands-cat-active" : ""}`}
            onClick={() => setCategoryFilter("all")}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`commands-cat-pill ${category === cat ? "commands-cat-active" : ""}`}
              style={category === cat ? { borderColor: categoryColor(cat), color: categoryColor(cat) } : undefined}
              onClick={() => setCategoryFilter(cat === category ? "all" : cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="commands-body">
          {visible.length === 0 ? (
            <div className="commands-empty">
              {db.length === 0
                ? "No commands saved yet. Use the toolbox icon in any terminal to save one."
                : "No matches."}
            </div>
          ) : (
            <div className="commands-table">
              {visible.map((cmd) => {
                const heat = heatLevel(cmd.copyCount);
                const rank = ["cold", "cool", "warm", "hot", "hotter"].indexOf(heat);
                return (
                  <div key={cmd.id} className="commands-row">
                    <span className="commands-pips" title={`${HEAT_LABELS[heat]} — ${cmd.copyCount}×`}>
                      {[0, 1, 2, 3, 4].map((pip) => (
                        <i key={pip} style={pip <= rank ? { background: HEAT_COLORS[heat], boxShadow: `0 0 6px ${HEAT_COLORS[heat]}` } : undefined} />
                      ))}
                    </span>
                    <code className="commands-row-text" title={cmd.text}>{cmd.text}</code>
                    <span className="commands-row-label">{cmd.label || "—"}</span>
                    <select
                      className="commands-cat-select"
                      value={cmd.category}
                      onChange={(e) => setCategory(cmd.id, e.target.value)}
                      title="Change category"
                    >
                      {categories.includes(cmd.category) ? null : (
                        <option value={cmd.category}>{cmd.category}</option>
                      )}
                      {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      {!categories.includes("other") && <option value="other">other</option>}
                    </select>
                    <span className="commands-row-count">{cmd.copyCount}×</span>
                    <span className="commands-row-actions">
                      <button className="commands-copy-btn" onClick={() => copy(cmd.text, cmd.id)}>
                        {copiedId === cmd.id ? "Copied" : "Copy"}
                      </button>
                      <button className="commands-delete-btn" onClick={() => removeCommand(cmd.id)} title="Delete">×</button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
