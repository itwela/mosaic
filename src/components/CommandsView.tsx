import { CSSProperties, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  allCategories,
  heatLevel,
  HEAT_COLORS,
  HEAT_LABELS,
  HeatLevel,
  incrementCopy,
  removeCommand,
  setCategory,
  useCommandDb,
} from "../store/commands";
import "./CommandsView.css";

// How much light comes through a card's glass: used commands glow, cold ones stay dim.
const GLASS_DIM: Record<HeatLevel, number> = { cold: 0.55, cool: 0.4, warm: 0.22, hot: 0.08, hotter: 0 };

// Each card shows its own stable patch of the mosaic in its glass band.
function glassOffset(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${-(h % 1000)}px ${-((h >> 10) % 700)}px`;
}

type SortMode = "hot" | "recent" | "az";

const CATEGORY_COLORS: Record<string, string> = {
  git: "#e0554a",
  npm: "#c14b4b",
  js: "#e0a03a",
  docker: "#3a8fd4",
  fs: "#7aab9c",
  python: "#4b7fc9",
  network: "#9a8cff",
  ssh: "#c98a5a",
  agent: "#a78bfa",
  brew: "#d4a24a",
  rust: "#c97d3a",
  db: "#5b8a6a",
  aws: "#e07a3a",
  cloud: "#3a9cd4",
  media: "#b05cff",
  sync: "#5b8def",
  archive: "#8a7a6a",
  system: "#8b949e",
  other: "#5c6b7a",
};

function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? "#5c6b7a";
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
            <div className="commands-grid">
              {visible.map((cmd) => {
                const heat = heatLevel(cmd.copyCount);
                return (
                  <div
                    key={cmd.id}
                    className="commands-item"
                    style={{
                      borderLeftColor: HEAT_COLORS[heat],
                      "--heat": HEAT_COLORS[heat],
                      "--cat": categoryColor(cmd.category),
                      "--glass-pos": glassOffset(cmd.id),
                      "--glass-dim": GLASS_DIM[heat],
                    } as CSSProperties}
                  >
                    <div className="commands-item-top">
                      <span
                        className="commands-heat-dot"
                        style={{ background: HEAT_COLORS[heat], boxShadow: `0 0 8px ${HEAT_COLORS[heat]}55` }}
                        title={`${HEAT_LABELS[heat]} — ${cmd.copyCount} cop${cmd.copyCount === 1 ? "y" : "ies"}`}
                      />
                      <span className="commands-heat-count" title={`${cmd.copyCount} cop${cmd.copyCount === 1 ? "y" : "ies"}`}>
                        {cmd.copyCount > 0 ? `${cmd.copyCount}×` : ""}
                      </span>
                      <span
                        className="commands-cat-chip"
                        style={{ color: categoryColor(cmd.category), borderColor: `${categoryColor(cmd.category)}55` }}
                      >
                        {cmd.category}
                      </span>
                    </div>
                    {cmd.label && <div className="commands-item-label">{cmd.label}</div>}
                    <code className="commands-item-text" onClick={() => copy(cmd.text, cmd.id)} title="Click to copy">
                      {cmd.text}
                    </code>
                    <div className="commands-item-actions">
                      <button className="commands-copy-btn" onClick={() => copy(cmd.text, cmd.id)}>
                        {copiedId === cmd.id ? "Copied" : "Copy"}
                      </button>
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
                      <button className="commands-delete-btn" onClick={() => removeCommand(cmd.id)} title="Delete">×</button>
                    </div>
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
