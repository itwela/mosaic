import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./MeetingsView.css";

type Item = { id: string; title: string; app: string; startedAt: string; minutes: number; client?: string | null };
type Line = { speaker: string; text: string; start: number };
type Meeting = Item & { endedAt: string; summary: string; lines: Line[] };

// Wispr's imported notes carry tokens like <@person3:n=Nadia> and <@speaker:1>.
function clean(s: string) {
  return s.replace(/<@[^>]*?n=([^>]+)>/g, "$1").replace(/<@speaker:(\d+)>/g, "Speaker $1").replace(/<[^>]+>/g, "");
}

function when(iso: string) {
  const d = new Date(iso.replace(" +00:00", "Z").replace(" ", "T"));
  if (isNaN(+d)) return "";
  const today = new Date();
  const days = Math.floor((+new Date(today.toDateString()) - +new Date(d.toDateString())) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Summary({ md }: { md: string }) {
  const blocks: React.ReactElement[] = [];
  let list: { depth: number; text: string }[] = [];
  const flush = (k: number) => {
    if (!list.length) return;
    blocks.push(
      <ul key={`l${k}`} className="mt-list">
        {list.map((li, i) => <li key={i} className={li.depth ? "mt-sub" : ""}>{clean(li.text)}</li>)}
      </ul>
    );
    list = [];
  };
  md.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) { list.push({ depth: bullet[1].length >= 2 ? 1 : 0, text: bullet[2] }); return; }
    flush(i);
    if (line.startsWith("### ")) blocks.push(<h3 key={i}>{clean(line.slice(4))}</h3>);
    else if (line.trim()) blocks.push(<p key={i} className="mt-lede">{clean(line)}</p>);
  });
  flush(-1);
  return <div className="mt-summary">{blocks}</div>;
}

export default function MeetingsView({ visible, openId }: { visible: boolean; openId: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [m, setM] = useState<Meeting | null>(null);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [q, setQ] = useState("");
  const [rec, setRec] = useState(false);
  const [shut, setShut] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("mt-shut") || "[]")); } catch { return new Set(); }
  });
  const toggleGroup = (id: string) => setShut((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    try { localStorage.setItem("mt-shut", JSON.stringify([...n])); } catch {}
    return n;
  });
  const [clients, setClients] = useState<[string, string][]>([]);
  useEffect(() => { if (visible) invoke<[string, string][]>("voice_clients").then(setClients).catch(() => {}); }, [visible]);
  const setClient = (id: string, client: string) => {
    const c = client || null;
    setItems((l) => l.map((i) => (i.id === id ? { ...i, client: c } : i)));
    setM((x) => (x && x.id === id ? { ...x, client: c } : x));
    invoke("voice_set_meeting_client", { id, client: c }).catch(() => load());
  };

  useEffect(() => {
    const u = listen<{ type?: string }>("voice-event", (e) => {
      const t = e.payload?.type;
      if (t === "meeting-started") setRec(true);
      else if (t === "meeting-writing" || t === "meeting-empty") setRec(false);
    });
    return () => { u.then((f) => f()); };
  }, []);
  const toggleNotes = () => {
    const start = !rec;
    setRec(start);
    invoke("voice_notes", { start }).catch(() => setRec(!start));
  };

  const load = () => invoke<Item[]>("voice_meetings").then((l) => { setItems(l); setSel((s) => s ?? l[0]?.id ?? null); }).catch(() => {});
  useEffect(() => { if (visible) load(); }, [visible]);
  useEffect(() => { const u = listen("voice-meetings-changed", () => load()); return () => { u.then((f) => f()); }; }, []);
  useEffect(() => { if (openId) { setSel(openId); setTab("summary"); load(); } }, [openId]);
  useEffect(() => { if (sel) invoke<Meeting>("voice_meeting", { id: sel }).then(setM).catch(() => setM(null)); }, [sel]);

  const shown = items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase()));
  const names = new Map(clients);
  const groups = [
    ...clients.map(([id, name]) => ({ id, name, rows: shown.filter((i) => i.client === id) })),
    { id: "", name: "No client", rows: shown.filter((i) => !i.client || !names.has(i.client)) },
  ].filter((g) => g.rows.length);
  // Unsorted first so new meetings that need a client are easy to spot.
  groups.sort((a, b) => (a.id === "" ? -1 : b.id === "" ? 1 : 0));
  const copy = () => {
    if (!m) return;
    const text = tab === "summary" ? `${m.title}\n\n${clean(m.summary)}` : m.lines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="meetings-view" style={{ display: visible ? "flex" : "none" }}>
      <header className="page-bar" data-tauri-drag-region>
        <h1 className="page-bar-title">Meetings</h1>
        <span className="page-bar-sub">hold fn to talk · notes start when a call does</span>
        <button className={`mt-notes-btn ${rec ? "rec" : ""}`} onClick={toggleNotes}>
          <span className="mt-notes-dot" />{rec ? "Stop notes" : "Take notes"}
        </button>
      </header>
      <div className="page-sheet meetings-sheet">
        <aside className="mt-side">
          <input className="mt-search" placeholder="Search meetings" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-rows">
            {groups.map((g) => (
              <div key={g.id} className="mt-group">
                <button className={`mt-group-head ${shut.has(g.id) && !q ? "shut" : ""}`} onClick={() => toggleGroup(g.id)}>
                  <span className="mt-caret">▾</span>{g.name}<span className="mt-count">{g.rows.length}</span>
                </button>
                {!(shut.has(g.id) && !q) && g.rows.map((i) => (
                  <button key={i.id} className={`mt-row ${i.id === sel ? "mt-row-active" : ""}`} onClick={() => { setSel(i.id); setTab("summary"); }}>
                    <span className="mt-tile" />
                    <span className="mt-row-text">
                      <span className="mt-row-title">{i.title || "Untitled"}</span>
                      <span className="mt-row-sub">{when(i.startedAt)}{i.minutes ? ` · ${i.minutes} min` : ""}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!shown.length && <p className="mt-empty">No meetings yet. When Zoom, Meet, Teams, FaceTime, Slack or Discord takes your mic, Mosaic asks if you want notes.</p>}
          </div>
        </aside>
        <section className="mt-note">
          {m && (
            <>
              <div className="mt-head">
                <div>
                  <h2>{m.title}</h2>
                  <p className="mt-meta">{when(m.startedAt)}{m.minutes ? ` · ${m.minutes} min` : ""}{m.app ? ` · ${m.app}` : ""}</p>
                </div>
                <div className="mt-tabs">
                  <select className="mt-client" value={m.client ?? ""} onChange={(e) => setClient(m.id, e.target.value)}>
                    <option value="">No client</option>
                    {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                  <button className={tab === "summary" ? "on" : ""} onClick={() => setTab("summary")}>Summary</button>
                  <button className={tab === "transcript" ? "on" : ""} onClick={() => setTab("transcript")}>Transcript</button>
                  <button title="Copy" onClick={copy}>⧉</button>
                </div>
              </div>
              {tab === "summary" ? (
                m.summary ? <Summary md={m.summary} /> : <p className="mt-lede">No summary was written for this one. The transcript is all here.</p>
              ) : (
                <div className="mt-transcript">
                  {m.lines.map((l, i) => (
                    <p key={i}><span className={`mt-speaker ${l.speaker === "You" ? "you" : ""}`}>{l.speaker}</span>{l.text}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
