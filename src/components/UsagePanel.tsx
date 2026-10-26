import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./UsagePanel.css";

interface Props {
  panelIndex: number;
  onReorderStart: (index: number, x: number, y: number) => void;
  onClosePanel: () => void;
}

type Result = { ok: true; data: any } | { ok: false; error: string };

interface Meter {
  label: string;
  percent: number;
  resetsAt?: number; // ms since epoch
}

interface Provider {
  key: string;
  name: string;
  logo?: string;
  plan?: string;
  meters: Meter[];
  balances?: string[];
  needsKey?: boolean;
  note?: string;
  error?: string;
}

const REFRESH_MS = 5 * 60 * 1000;

function windowLabel(minutes: number): string {
  if (minutes === 300) return "5-hour";
  if (minutes === 10080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-min`;
}

function claudeProvider(r?: Result): Provider {
  const base = { key: "claude", name: "Claude", logo: "/agent-logos/claude.svg" };
  if (!r) return { ...base, meters: [] };
  if (!r.ok) return { ...base, meters: [], error: r.error };
  const d = r.data;
  const windows: [string, string][] = [
    ["five_hour", "5-hour"],
    ["seven_day", "Weekly"],
    ["seven_day_opus", "Weekly · Opus"],
    ["seven_day_sonnet", "Weekly · Sonnet"],
  ];
  const meters: Meter[] = [];
  for (const [field, label] of windows) {
    const w = d?.[field];
    if (!w || typeof w.utilization !== "number") continue;
    meters.push({ label, percent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined });
  }
  const extra = d?.extra_usage;
  if (extra?.is_enabled && typeof extra.utilization === "number") {
    meters.push({ label: "Extra usage", percent: extra.utilization });
  }
  return { ...base, plan: d?.plan ?? undefined, meters };
}

function codexProvider(r?: Result): Provider {
  const base = { key: "codex", name: "Codex", logo: "/agent-logos/openai.svg" };
  if (!r) return { ...base, meters: [] };
  if (!r.ok) return { ...base, meters: [], error: r.error };
  const d = r.data;
  const meters: Meter[] = [];
  for (const w of [d?.primary, d?.secondary]) {
    if (!w || typeof w.used_percent !== "number") continue;
    meters.push({
      label: windowLabel(w.window_minutes ?? 0),
      percent: w.used_percent,
      resetsAt: typeof w.resets_at === "number" ? w.resets_at * 1000 : undefined,
    });
  }
  const observed = typeof d?.observed_at === "number" ? d.observed_at * 1000 : 0;
  return { ...base, meters, note: observed ? `as of your last Codex message, ${ago(observed)}` : undefined };
}

function cursorProvider(r?: Result): Provider {
  const base = { key: "cursor", name: "Cursor", logo: "/agent-logos/cursor.svg" };
  if (!r) return { ...base, meters: [] };
  if (!r.ok) return { ...base, meters: [], error: r.error };
  const d = r.data;
  const plan = d?.planUsage ?? {};
  const resetsAt = Number(d?.billingCycleEnd) || undefined;
  const meters: Meter[] = [];
  if (typeof plan.totalPercentUsed === "number") meters.push({ label: "Included usage", percent: plan.totalPercentUsed, resetsAt });
  if (typeof plan.autoPercentUsed === "number") meters.push({ label: "Auto / Composer", percent: plan.autoPercentUsed });
  if (typeof plan.apiPercentUsed === "number") meters.push({ label: "Named models (API)", percent: plan.apiPercentUsed });
  return { ...base, meters };
}

// Antigravity reports a remaining fraction per model; models in the same family
// share one pool, so show one meter per family. No fraction means it's used up.
function antigravityProvider(r?: Result): Provider {
  const base = { key: "antigravity", name: "Antigravity", logo: "/agent-logos/antigravity.svg" };
  if (!r) return { ...base, meters: [] };
  if (!r.ok) return { ...base, meters: [], error: r.error };
  const d = r.data;
  const families = new Map<string, Meter>();
  for (const m of d?.cascadeModelConfigData?.clientModelConfigs ?? []) {
    const q = m?.quotaInfo;
    if (!q || typeof m.label !== "string") continue;
    const family = m.label.replace(/\s*\(.*\)\s*$/, "");
    if (families.has(family)) continue;
    const remaining = typeof q.remainingFraction === "number" ? q.remainingFraction : 0;
    families.set(family, { label: family, percent: (1 - remaining) * 100, resetsAt: q.resetTime ? Date.parse(q.resetTime) : undefined });
  }
  return { ...base, plan: d?.planStatus?.planInfo?.planName, meters: [...families.values()] };
}

function deepseekProvider(r?: Result): Provider {
  const base = { key: "deepseek", name: "DeepSeek" };
  if (!r) return { ...base, meters: [] };
  if (!r.ok) return r.error === "needs-key" ? { ...base, meters: [], needsKey: true } : { ...base, meters: [], error: r.error, needsKey: true };
  const balances = (r.data?.balance_infos ?? []).map((b: any) =>
    `${b.total_balance} ${b.currency} balance` + (Number(b.granted_balance) > 0 ? ` (${b.granted_balance} granted)` : "")
  );
  return { ...base, meters: [], balances, note: r.data?.is_available === false ? "Balance too low for API calls." : undefined };
}

function ago(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function until(ms: number): string {
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.round(hours / 24)}d`;
}

function level(percent: number): string {
  if (percent >= 90) return "usage-hot";
  if (percent >= 70) return "usage-warm";
  return "usage-cool";
}

export default function UsagePanel({ panelIndex, onReorderStart, onClosePanel }: Props) {
  const [results, setResults] = useState<Record<string, Result | undefined>>({});
  const [keyDraft, setKeyDraft] = useState("");

  async function saveKey(provider: string) {
    if (!keyDraft.trim()) return;
    await invoke("set_provider_key", { provider, key: keyDraft });
    setKeyDraft("");
    void refresh();
  }
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    setLoading(true);
    try {
      setResults(await invoke("provider_usage"));
      setFetchedAt(Date.now());
    } catch (e) {
      const error = String(e);
      setResults({ claude: { ok: false, error }, codex: { ok: false, error }, cursor: { ok: false, error }, antigravity: { ok: false, error }, deepseek: { ok: false, error } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(refresh, REFRESH_MS);
    // Keep the "resets in" countdowns honest between fetches.
    const clock = setInterval(() => tick((n) => n + 1), 30000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [refresh]);

  const providers = [
    claudeProvider(results.claude),
    codexProvider(results.codex),
    cursorProvider(results.cursor),
    antigravityProvider(results.antigravity),
    deepseekProvider(results.deepseek),
  ];

  return (
    <div className="launcher-panel usage-panel">
      <div className="launcher-header">
        <button
          className="panel-drag-grip"
          title="Drag to reorder panel"
          onPointerDown={(e) => {
            e.preventDefault();
            onReorderStart(panelIndex, e.clientX, e.clientY);
          }}
        >
          <span className="grip-dots">⠿</span>
        </button>
        <span className="usage-title">AI usage</span>
        <span className="usage-fetched">{fetchedAt ? `updated ${ago(fetchedAt)}` : ""}</span>
        <button className="usage-refresh" onClick={() => void refresh()} disabled={loading} title="Refresh">
          {loading ? "…" : "↻"}
        </button>
        <button className="launcher-panel-close-btn" onClick={onClosePanel} title="Close panel">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="usage-body">
        {providers.map((p) => (
          <section key={p.key} className="usage-card">
            <header className="usage-card-head">
              {p.logo ? <img src={p.logo} alt="" className="usage-logo" /> : <span className="usage-logo usage-glyph">{p.name[0]}</span>}
              <span className="usage-name">{p.name}</span>
              {p.plan && <span className="usage-plan">{p.plan}</span>}
            </header>
            {p.needsKey ? (
              <div className="usage-key">
                {p.error && <p className="usage-error">{p.error}</p>}
                <p className="usage-note">Paste an API key from platform.deepseek.com. It's stored locally in ~/.mosaic/keys.json.</p>
                <div className="usage-key-row">
                  <input
                    type="password"
                    value={keyDraft}
                    placeholder="sk-…"
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveKey(p.key); }}
                  />
                  <button onClick={() => void saveKey(p.key)}>Save</button>
                </div>
              </div>
            ) : p.error ? (
              <p className="usage-error">{p.error}</p>
            ) : p.balances ? (
              p.balances.length ? p.balances.map((b) => <span key={b} className="usage-balance">{b}</span>) : <p className="usage-note">No balance reported.</p>
            ) : p.meters.length === 0 ? (
              <p className="usage-note">{loading || !fetchedAt ? "Loading…" : "No usage windows reported."}</p>
            ) : (
              p.meters.map((m) => (
                <div key={m.label} className={`usage-meter ${level(m.percent)}`}>
                  <div className="usage-meter-row">
                    <span className="usage-meter-label">{m.label}</span>
                    <span className="usage-meter-pct">{Math.round(m.percent)}%</span>
                  </div>
                  <div className="usage-bar">
                    <div className="usage-bar-fill" style={{ width: `${Math.min(100, Math.max(0, m.percent))}%` }} />
                  </div>
                  {m.resetsAt && <span className="usage-reset">resets in {until(m.resetsAt)}</span>}
                </div>
              ))
            )}
            {p.note && !p.error && <p className="usage-note">{p.note}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
