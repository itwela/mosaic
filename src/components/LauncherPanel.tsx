import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { LaunchItem, Panel } from "../types";
import "./LauncherPanel.css";

interface AppEntry {
  name: string;
  path: string;
}

interface Props {
  panel: Panel;
  onUpdate: (panel: Panel) => void;
}

const EXT_COLORS: Record<string, string> = {
  md: "#7aab9c", markdown: "#7aab9c",
  docx: "#2b579a", doc: "#2b579a",
  xlsx: "#217346", xls: "#217346", numbers: "#36b34a",
  pptx: "#d24726", ppt: "#d24726", key: "#34aae1", keynote: "#34aae1",
  pdf: "#e63333",
  pages: "#fc6f2a",
  txt: "#8a9cbb",
  zip: "#8a7a6a", gz: "#8a7a6a",
};

function faviconUrl(url: string) {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return null;
  }
}

function ExtBadge({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const label = ext.slice(0, 5).toUpperCase();
  const bg = EXT_COLORS[ext] ?? "#4a3523";
  return (
    <div className="ext-badge" style={{ background: bg }}>
      {label}
    </div>
  );
}

export default function LauncherPanel({ panel, onUpdate }: Props) {
  const items = panel.launchItems ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [appList, setAppList] = useState<AppEntry[]>([]);
  const [search, setSearch] = useState("");
  const [launching, setLaunching] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const fetchedPaths = useRef<Set<string>>(new Set());

  // URL form state
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlName, setUrlName] = useState("");

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");

  useEffect(() => {
    for (const item of items) {
      if (fetchedPaths.current.has(item.path)) continue;
      fetchedPaths.current.add(item.path);

      if (item.kind === "url") {
        const favicon = faviconUrl(item.path);
        setPreviews((prev) => ({ ...prev, [item.id]: favicon ?? null }));
        continue;
      }

      invoke<string | null>("get_file_preview", { path: item.path })
        .then((src) => setPreviews((prev) => ({ ...prev, [item.id]: src })))
        .catch(() => setPreviews((prev) => ({ ...prev, [item.id]: null })));
    }
  }, [items]);

  function save(updated: LaunchItem[]) {
    onUpdate({ ...panel, launchItems: updated });
  }

  async function handleAddFile() {
    const result = await pickFile({ multiple: true, directory: false });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    save([
      ...items,
      ...paths.map((p) => ({ id: uuidv4(), kind: "file" as const, name: p.split("/").pop() ?? p, path: p })),
    ]);
  }

  async function handleAddApp() {
    const apps: AppEntry[] = await invoke("list_applications");
    setAppList(apps);
    setSearch("");
    setPickerOpen(true);
  }

  function addApp(app: AppEntry) {
    save([...items, { id: uuidv4(), kind: "file" as const, name: app.name, path: app.path }]);
    setPickerOpen(false);
  }

  function commitUrl() {
    const raw = urlInput.trim();
    if (!raw) { setAddingUrl(false); return; }
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    const name = urlName.trim() || (() => {
      try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
    })();
    save([...items, { id: uuidv4(), kind: "url", name, path: url }]);
    setUrlInput("");
    setUrlName("");
    setAddingUrl(false);
  }

  function removeItem(id: string) {
    save(items.filter((i) => i.id !== id));
  }

  function startEdit(item: LaunchItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditUrl(item.path);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditUrl("");
  }

  function commitEdit(item: LaunchItem) {
    if (item.kind === "url") {
      const raw = editUrl.trim();
      if (!raw) { cancelEdit(); return; }
      const url = raw.startsWith("http") ? raw : `https://${raw}`;
      const name = editName.trim() || (() => {
        try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
      })();
      // Path changed — drop the cached preview fetch flag so the favicon refreshes.
      if (url !== item.path) {
        fetchedPaths.current.delete(item.path);
        fetchedPaths.current.delete(url);
      }
      save(items.map((i) => (i.id === item.id ? { ...i, name, path: url } : i)));
    } else {
      const name = editName.trim() || item.name;
      save(items.map((i) => (i.id === item.id ? { ...i, name } : i)));
    }
    cancelEdit();
  }

  async function launchOne(item: LaunchItem) {
    try {
      await invoke("open_path", { path: item.path });
    } catch (e) {
      const msg = `${item.name}: ${String(e)}`;
      setErrors((prev) => [...prev, msg]);
    }
  }

  async function launchAll() {
    if (items.length === 0) return;
    setErrors([]);
    setLaunching(true);
    for (const item of items) await launchOne(item);
    setLaunching(false);
  }

  const filtered = search
    ? appList.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : appList;

  return (
    <div className="launcher-panel">
      <div className="launcher-header">
        <span className="launcher-label">Launcher</span>
        <div className="launcher-header-actions">
          <button className="launcher-btn-ghost" onClick={handleAddFile}>+ file</button>
          <button className="launcher-btn-ghost" onClick={handleAddApp}>+ app</button>
          <button className="launcher-btn-ghost" onClick={() => setAddingUrl(true)}>+ url</button>
          {items.length > 0 && (
            <button
              className={`launcher-btn-primary ${launching ? "launcher-btn-launching" : ""}`}
              onClick={launchAll}
              disabled={launching}
            >
              {launching ? "Launching..." : "Launch All"}
            </button>
          )}
        </div>
      </div>

      {addingUrl && (
        <div className="url-form">
          <input
            className="url-form-input"
            autoFocus
            placeholder="https://..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitUrl();
              if (e.key === "Escape") { setAddingUrl(false); setUrlInput(""); setUrlName(""); }
            }}
          />
          <input
            className="url-form-input"
            placeholder="Label (optional)"
            value={urlName}
            onChange={(e) => setUrlName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitUrl();
              if (e.key === "Escape") { setAddingUrl(false); setUrlInput(""); setUrlName(""); }
            }}
          />
          <div className="url-form-actions">
            <button className="launcher-btn-ghost" onClick={() => { setAddingUrl(false); setUrlInput(""); setUrlName(""); }}>Cancel</button>
            <button className="launcher-btn-primary" onClick={commitUrl}>Add</button>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="launcher-errors">
          {errors.map((e, i) => (
            <div key={i} className="launcher-error-row">
              <span>Failed: {e}</span>
              <button onClick={() => setErrors((prev) => prev.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className="launcher-body">
        {items.length === 0 && !addingUrl ? (
          <div className="launcher-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
            <p>Nothing here yet.</p>
            <p>Add files, apps, or URLs to open together.</p>
          </div>
        ) : (
          <div className="launcher-grid">
            {items.map((item) => (
              editingId === item.id ? (
                <div key={item.id} className="launcher-card launcher-card-editing">
                  <div className="launcher-card-edit-fields">
                    {item.kind === "url" && (
                      <input
                        className="url-form-input"
                        autoFocus
                        placeholder="https://..."
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(item);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                    )}
                    <input
                      className="url-form-input"
                      autoFocus={item.kind !== "url"}
                      placeholder="Label"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(item);
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                    <div className="url-form-actions">
                      <button className="launcher-btn-ghost" onClick={cancelEdit}>Cancel</button>
                      <button className="launcher-btn-primary" onClick={() => commitEdit(item)}>Save</button>
                    </div>
                  </div>
                </div>
              ) : (
              <div key={item.id} className="launcher-card">
                <div className="launcher-card-icon">
                  {(() => {
                    const p = previews[item.id];
                    if (item.kind === "url") {
                      return p
                        ? <img src={p} className="launcher-card-preview-img" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        : <div className="ext-badge" style={{ background: "#3a6bc9" }}>URL</div>;
                    }
                    if (typeof p === "string" && p.startsWith("text:")) {
                      return <div className="launcher-card-text-preview">{p.slice(5)}</div>;
                    }
                    if (typeof p === "string") {
                      return <img src={p} className="launcher-card-preview-img" alt="" />;
                    }
                    return <ExtBadge path={item.path} />;
                  })()}
                </div>
                <div className="launcher-card-info">
                  <span className="launcher-card-name">{item.name}</span>
                  <span className="launcher-card-path">
                    {item.kind === "url" ? item.path : item.path.replace(/^\/Users\/[^/]+/, "~")}
                  </span>
                </div>
                <div className="launcher-card-actions">
                  <button className="launcher-card-launch" onClick={() => launchOne(item)} title="Open">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                  </button>
                  <button className="launcher-card-edit" onClick={() => startEdit(item)} title="Edit">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"/>
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                    </svg>
                  </button>
                  <button className="launcher-card-remove" onClick={() => removeItem(item.id)} title="Remove">×</button>
                </div>
              </div>
              )
            ))}
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="app-picker-overlay" onClick={() => setPickerOpen(false)}>
          <div className="app-picker" onClick={(e) => e.stopPropagation()}>
            <div className="app-picker-header">
              <span>Choose an app</span>
              <button className="app-picker-close" onClick={() => setPickerOpen(false)}>×</button>
            </div>
            <input
              className="app-picker-search"
              autoFocus
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="app-picker-list">
              {filtered.map((app) => (
                <button key={app.path} className="app-picker-item" onClick={() => addApp(app)}>
                  {app.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
