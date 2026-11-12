import Icon from "./Icon";
import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  models?: string[];
  percent: number;
  resetsAt?: number; // ms since epoch
}

interface Grant {
  label: string;
  left: number;
  endsAt?: number;
  clears: string[];
  usable: boolean;
}

const CLEARS: Record<string, string> = { five_hour: "5-hour", seven_day: "weekly", seven_day_overage_included: "model weekly" };

function grantsFrom(r?: Result): { grants?: Grant[]; needsWebLogin?: boolean; resetsError?: string } {
  if (!r) return {};
  if (!r.ok) {
    if (r.error === "needs-login") return { needsWebLogin: true };
    if (r.error === "signing-in") return {};
    return { resetsError: `Couldn't load resets: ${r.error}` };
  }
  const grants = (r.data?.grants ?? [])
    .filter((g: any) => (g.resets_left ?? 0) > 0)
    .map((g: any) => ({
      label: String(g.label ?? "Limit reset"),
      left: g.resets_left,
      endsAt: g.ends_at ? Date.parse(g.ends_at) : undefined,
      clears: (g.clears ?? []).map((c: string) => CLEARS[c] ?? c.replace(/_/g, " ")),
      usable: !!g.usable_now,
    }))
    .sort((a: Grant, b: Grant) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));
  return { grants };
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Provider {
  key: string;
  name: string;
  logo?: string;
  plan?: string;
  meters: Meter[];
  balances?: string[];
  needsKey?: boolean;
  needsLogin?: boolean;
  idle?: string[];
  resetsNote?: string;
  grants?: Grant[];
  needsWebLogin?: boolean;
  resetsError?: string;
  pools?: string[]; // meter label = models sharing one quota, shown as pills // models with untouched quota, listed compactly
  resets?: number; // usage resets the account can spend right now
  note?: string;
  error?: string;
}

const REFRESH_MS = 5 * 60 * 1000;
const ORDER_KEY = "mosaic-usage-order";

function loadOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || "[]"); } catch { return []; }
}

// Providers in the order the user dragged them into; new ones go last.
function sortByOrder<T extends { key: string }>(items: T[], order: string[]): T[] {
  const rank = (k: string) => { const i = order.indexOf(k); return i === -1 ? order.length : i; };
  return [...items].sort((a, b) => rank(a.key) - rank(b.key));
}

function windowLabel(minutes: number): string {
  if (minutes === 300) return "5-hour";
  if (minutes === 10080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-min`;
}

function claudeProvider(r?: Result, resetsResult?: Result): Provider {
  const g = grantsFrom(resetsResult);
  const base = {
    key: "claude", name: "Claude", logo: "/agent-logos/claude.svg", ...g,
    resets: g.grants ? g.grants.reduce((n, x) => n + x.left, 0) : undefined,
  };
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
  const kindLabel = (l: any) =>
    l.kind === "session" ? "5-hour" : l.kind === "weekly_all" ? "Weekly" : `Weekly · ${l.scope?.model?.display_name ?? l.scope?.surface ?? "scoped"}`;
  // The status line only knows 5-hour/weekly; per-model weekly caps come from the endpoint.
  const extraLimits = (d?.limits ?? []).filter((l: any) => l.kind !== "session" && l.kind !== "weekly_all" && typeof l.percent === "number");
  for (const l of extraLimits) meters.push({ label: kindLabel(l), percent: l.percent, resetsAt: l.resets_at ? Date.parse(l.resets_at) : undefined });
  for (const [field, label] of windows) {
    const w = d?.[field];
    if (!w || typeof w.utilization !== "number") continue;
    const resetsAt = typeof w.resets_at_epoch === "number" ? w.resets_at_epoch * 1000 : w.resets_at ? Date.parse(w.resets_at) : undefined;
    meters.push({ label, percent: w.utilization, resetsAt });
  }
  const extra = d?.extra_usage;
  if (extra?.is_enabled && typeof extra.utilization === "number") {
    meters.push({ label: "Extra usage", percent: extra.utilization });
  }
  const observed = typeof d?.observed_at === "number" ? d.observed_at * 1000 : 0;
  const note = !observed ? undefined
    : d?.source === "statusline" ? `as of your last Claude message, ${ago(observed)}`
    : `checked ${ago(observed)} (Anthropic limits how often this can be asked)`;
  return { ...base, plan: d?.plan ?? undefined, meters, note };
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
  const resets = typeof d?.reset_credits?.available_count === "number" ? d.reset_credits.available_count : undefined;
  return {
    ...base,
    plan: d?.plan_type ?? undefined,
    meters,
    resets,
    note: !d?.live && observed ? `as of your last Codex message, ${ago(observed)}` : undefined,
  };
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
  if (!r.ok) return r.error === "needs-login" ? { ...base, meters: [], needsLogin: true } : { ...base, meters: [], error: r.error, needsLogin: /sign in/i.test(r.error) };
  const d = r.data;
  // Models that draw from one quota report the same fraction and reset time;
  // fold them into a single meter named after every model in the pool.
  const groups = d?.summary?.groups;
  if (Array.isArray(groups) && groups.length) {
    const windowName = (w?: string) => {
      const x = (w ?? "").toLowerCase();
      if (/5|five|hour/.test(x)) return "5-hour";
      if (/week|7|seven/.test(x)) return "weekly";
      return x.replace(/_/g, " ");
    };
    const meters: Meter[] = [];
    for (const g of groups) {
      const group = String(g.displayName ?? g.name ?? "Quota");
      for (const bk of g.buckets ?? []) {
        if (bk.disabled) continue;
        const rem = typeof bk.remaining_fraction === "number" ? bk.remaining_fraction
          : typeof bk.remainingFraction === "number" ? bk.remainingFraction
          : typeof bk.remaining?.remainingFraction === "number" ? bk.remaining.remainingFraction
          : bk.remaining?.case === "remainingFraction" ? bk.remaining.value : undefined;
        if (typeof rem !== "number") continue;
        const reset = bk.reset_time ?? bk.resetTime;
        const label = `${group.replace(/ models?$/i, "")} ${windowName(bk.window ?? bk.name ?? bk.displayName)}`;
        meters.push({ label, percent: (1 - rem) * 100, resetsAt: reset ? Date.parse(reset) : undefined });
      }
    }
    return { ...base, plan: d?.planStatus?.planInfo?.planName ?? undefined, meters };
  }
  const pools = new Map<string, { names: string[]; percent: number; resetsAt?: number }>();
  for (const m of d?.cascadeModelConfigData?.clientModelConfigs ?? []) {
    const q = m?.quotaInfo;
    if (!q || typeof m.label !== "string") continue;
    const name = m.label.replace(/\s*\(.*\)\s*$/, "");
    const remaining = typeof q.remainingFraction === "number" ? q.remainingFraction : 0;
    const percent = (1 - remaining) * 100;
    const resetsAt = q.resetTime ? Date.parse(q.resetTime) : undefined;
    const key = `${Math.round(percent)}|${resetsAt ? Math.round(resetsAt / 60000) : ""}`;
    const pool = pools.get(key) ?? { names: [], percent, resetsAt };
    if (!pool.names.includes(name)) pool.names.push(name);
    pools.set(key, pool);
  }
  const used = [...pools.values()].filter((p) => p.percent >= 0.5);
  const idle = [...pools.values()].filter((p) => p.percent < 0.5).flatMap((p) => p.names);
  const meters: Meter[] = used.map((p) => ({ label: p.names.join(" · "), models: p.names, percent: p.percent, resetsAt: p.resetsAt }));
  return {
    ...base,
    plan: d?.planStatus?.planInfo?.planName ?? undefined,
    meters,
    idle,
  };
}

function deepseekProvider(r?: Result): Provider {
  const base = { key: "deepseek", name: "DeepSeek", logo: "/agent-logos/deepseek.svg" };
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

type Row =
  | { kind: "single"; m: Meter }
  | { kind: "combo"; name: string; short?: Meter; week?: Meter; models?: string[] };

// Fold "X 5-hour" + "X weekly" into one bar: weekly fills the track, the 5-hour
// window rides on top as a thin bright strip.
function toRows(meters: Meter[]): Row[] {
  const combos = new Map<string, Extract<Row, { kind: "combo" }>>();
  const rows: Row[] = [];
  for (const m of meters) {
    const hit = m.label.match(/^(.*?)\s*(5-hour|weekly)$/i);
    if (!hit || m.models) { rows.push({ kind: "single", m }); continue; }
    const name = hit[1].trim();
    let c = combos.get(name);
    if (!c) { c = { kind: "combo", name }; combos.set(name, c); rows.push(c); }
    if (/5-hour/i.test(hit[2])) c.short = m; else c.week = m;
  }
  const peak = (r: Row) => r.kind === "single" ? r.m.percent : Math.max(r.short?.percent ?? 0, r.week?.percent ?? 0);
  return rows.sort((a, b) => peak(b) - peak(a));
}

function level(percent: number): string {
  if (percent >= 90) return "usage-hot";
  if (percent >= 70) return "usage-warm";
  return "usage-cool";
}

let sharedResults: Record<string, Result | undefined> = {};
let sharedFetchedAt: number | null = null;
let sharedInflight: Promise<void> | null = null;

export default function UsagePanel({ panelIndex, onReorderStart, onClosePanel }: Props) {
  const [results, setResults] = useState<Record<string, Result | undefined>>(sharedResults);
  const [keyDraft, setKeyDraft] = useState("");

  async function saveKey(provider: string) {
    if (!keyDraft.trim()) return;
    await invoke("set_provider_key", { provider, key: keyDraft });
    setKeyDraft("");
    void refresh(true);
  }
  const [openResets, setOpenResets] = useState<Record<string, boolean>>({});
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState("");

  async function signInClaudeWeb() {
    setSigningIn(true);
    setSignInError("");
    try {
      await invoke("claude_web_login");
      void refresh(true);
    } catch (e) {
      setSignInError(String(e));
    } finally {
      setSigningIn(false);
    }
  }

  async function signInAntigravity() {
    setSigningIn(true);
    setSignInError("");
    try {
      await invoke("antigravity_login");
      void refresh(true);
    } catch (e) {
      setSignInError(String(e));
    } finally {
      setSigningIn(false);
    }
  }
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(sharedFetchedAt);
  const [, tick] = useState(0);

  const [order, setOrder] = useState<string[]>(loadOrder);
  const [drag, setDrag] = useState<{ key: string; x: number; y: number; over: string | null } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const keysRef = useRef<string[]>([]);

  // Pointer-driven drag (the webview's native drag-drop is taken by file drops):
  // grab a card's header, drop it on another card to swap their places.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const card = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-usage-key]");
      const over = card?.dataset.usageKey ?? null;
      setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, over: over === d.key ? null : over });
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d?.over) return;
      const keys = [...keysRef.current];
      const from = keys.indexOf(d.key);
      const to = keys.indexOf(d.over);
      if (from === -1 || to === -1) return;
      [keys[from], keys[to]] = [keys[to], keys[from]];
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); } catch {}
      setOrder(keys);
    };
    const noSelect = (e: Event) => e.preventDefault();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("selectstart", noSelect);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("selectstart", noSelect);
    };
  }, [drag?.key]);

  const refresh = useCallback(async (force = false) => {
    if (!isTauri()) return;
    if (!force && sharedFetchedAt && Date.now() - sharedFetchedAt < 15000) {
      setResults(sharedResults);
      setFetchedAt(sharedFetchedAt);
      return;
    }
    setLoading(true);
    try {
      if (!sharedInflight) {
        sharedInflight = (async () => {
          try {
            const [usage, claudeResets] = await Promise.all([
              invoke<Record<string, Result>>("provider_usage"),
              invoke<Result>("claude_resets").catch((e) => ({ ok: false, error: String(e) }) as Result),
            ]);
            sharedResults = { ...usage, claudeResets };
            sharedFetchedAt = Date.now();
          } catch (e) {
            const error = String(e);
            sharedResults = { claude: { ok: false, error }, codex: { ok: false, error }, cursor: { ok: false, error }, antigravity: { ok: false, error }, deepseek: { ok: false, error } };
          } finally {
            sharedInflight = null;
          }
        })();
      }
      await sharedInflight;
      setResults(sharedResults);
      setFetchedAt(sharedFetchedAt);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const poll = setInterval(() => void refresh(false), REFRESH_MS);
    // Keep the "resets in" countdowns honest between fetches.
    const clock = setInterval(() => tick((n) => n + 1), 30000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [refresh]);

  const providers = sortByOrder([
    claudeProvider(results.claude, results.claudeResets),
    codexProvider(results.codex),
    cursorProvider(results.cursor),
    antigravityProvider(results.antigravity),
    deepseekProvider(results.deepseek),
  ], order);
  keysRef.current = providers.map((p) => p.key);

  return (
    <div className="launcher-panel usage-panel" data-usage-fetched-at={fetchedAt ?? ""}>
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
        <span className="usage-legend">
          <span className="usage-legend-item"><i className="usage-swatch usage-swatch-short" />5-hour</span>
          <span className="usage-legend-item"><i className="usage-swatch usage-swatch-week" />weekly</span>
        </span>
        <span className="usage-fetched">{fetchedAt ? `updated ${ago(fetchedAt)}` : ""}</span>
        <button className="usage-refresh" onClick={() => void refresh(true)} disabled={loading} title="Refresh">
          {loading ? "…" : <Icon name="refresh" />}
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
          <section
            key={p.key}
            data-usage-key={p.key}
            className={`usage-card ${drag?.key === p.key ? "usage-card-dragging" : ""} ${drag?.over === p.key ? "usage-card-target" : ""}`}
          >
            <header
              className="usage-card-head"
              title="Drag to reorder"
              onPointerDown={(e) => {
                if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
                e.preventDefault();
                setDrag({ key: p.key, x: e.clientX, y: e.clientY, over: null });
              }}
            >
              {p.logo ? <img src={p.logo} alt="" className="usage-logo" /> : <span className="usage-logo usage-glyph">{p.name[0]}</span>}
              <span className="usage-name">{p.name}</span>
              {p.plan && <span className="usage-plan">{p.plan}</span>}
              {p.resets !== undefined && (
                <button
                  type="button"
                  className={`usage-resets ${p.resets > 0 ? "usage-resets-on" : ""} ${openResets[p.key] ? "usage-resets-open" : ""}`}
                  disabled={!p.grants?.length}
                  onClick={() => setOpenResets((o) => ({ ...o, [p.key]: !o[p.key] }))}
                >
                  {p.resets} {p.resets === 1 ? "reset" : "resets"}{p.grants?.length ? (openResets[p.key] ? " ▴" : " ▾") : ""}
                </button>
              )}
            </header>
            {p.needsLogin ? (
              <div className="usage-key">
                {p.error && <p className="usage-error">{p.error}</p>}
                {signInError && <p className="usage-error">{signInError}</p>}
                <p className="usage-note">Antigravity isn't open. Sign in once with the Google account you use in Antigravity and Mosaic will read your quota without it.</p>
                <div className="usage-key-row">
                  <button onClick={() => void signInAntigravity()} disabled={signingIn}>
                    {signingIn ? "Waiting for browser…" : "Sign in with Google"}
                  </button>
                </div>
              </div>
            ) : p.needsKey ? (
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
              p.balances.length ? p.balances.map((b) => {
                const [amount, currency, ...rest] = b.split(" ");
                return <span key={b} className="usage-balance"><b>{amount}</b> <i>{currency}</i> <span>{rest.join(" ")}</span></span>;
              }) : <p className="usage-note">No balance reported.</p>
            ) : p.meters.length === 0 && !p.idle?.length ? (
              <p className="usage-note">{loading || !fetchedAt ? "Loading…" : "No usage windows reported."}</p>
            ) : (
              toRows(p.meters).map((row) => row.kind === "combo" ? (
                <div key={"c" + row.name} className={`usage-meter ${level(Math.max(row.short?.percent ?? 0, row.week?.percent ?? 0))}`}>
                  <div className="usage-meter-row">
                    <span className="usage-meter-label">{row.name || "Plan limits"}</span>
                    <span className="usage-meter-pct usage-combo-pct">
                      {row.short && <span className="usage-c-short">{Math.round(row.short.percent)}%</span>}
                      {row.week && <span className="usage-c-week">{Math.round(row.week.percent)}%</span>}
                    </span>
                  </div>
                  <div className="usage-bar usage-bar-combo">
                    {row.week && <div className="usage-bar-fill usage-bar-week" style={{ width: `${Math.min(100, Math.max(0, row.week.percent))}%`, "--pct": Math.min(100, Math.max(0, row.week.percent)) } as CSSProperties} />}
                    {row.short && <div className="usage-bar-fill usage-bar-short" style={{ width: `${Math.min(100, Math.max(0, row.short.percent))}%`, "--pct": Math.min(100, Math.max(0, row.short.percent)) } as CSSProperties} />}
                  </div>
                  <span className="usage-reset">
                    {row.short?.resetsAt && <span className="usage-c-short">5h resets in {until(row.short.resetsAt)}</span>}
                    {row.short?.resetsAt && row.week?.resetsAt && " · "}
                    {row.week?.resetsAt && <span className="usage-c-week">week in {until(row.week.resetsAt)}</span>}
                  </span>
                </div>
              ) : (() => { const m = row.m; return (
                <div key={m.label} className={`usage-meter ${level(m.percent)} ${/5-hour/i.test(m.label) ? "usage-win-short" : /week/i.test(m.label) ? "usage-win-week" : ""}`}>
                  <div className="usage-meter-row">
                    {m.models ? (
                      <span className="usage-pills">{m.models.map((n) => <span key={n} className="usage-pill">{n}</span>)}</span>
                    ) : (
                      <span className="usage-meter-label">{m.label}</span>
                    )}
                    <span className="usage-meter-pct">{Math.round(m.percent)}%</span>
                  </div>
                  <div className="usage-bar">
                    <div className="usage-bar-fill" style={{ width: `${Math.min(100, Math.max(0, m.percent))}%`, "--pct": Math.min(100, Math.max(0, m.percent)) } as CSSProperties} />
                  </div>
                  {m.resetsAt && <span className="usage-reset">resets in {until(m.resetsAt)}</span>}
                </div>
              ); })())
            )}
            {openResets[p.key] && p.grants && p.grants.length > 0 && !p.error && (
              <ul className="usage-grants">
                {p.grants.map((g) => (
                  <li key={g.label + g.endsAt} className={g.usable ? "" : "usage-grant-off"}>
                    <span className="usage-grant-name">{g.left > 1 ? `${g.left}× ` : ""}{g.label}</span>
                    <span className="usage-grant-meta">
                      clears {g.clears.join(", ")}{g.endsAt ? ` · expires ${shortDate(g.endsAt)}` : ""}{g.usable ? "" : " · not usable yet"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {p.resetsError && !p.error && <p className="usage-note">{p.resetsError}</p>}
            {p.needsWebLogin && !p.error && (
              <div className="usage-key">
                {signInError && <p className="usage-error">{signInError}</p>}
                <div className="usage-key-row">
                  <button onClick={() => void signInClaudeWeb()} disabled={signingIn}>
                    {signingIn ? "Finish signing in…" : "Sign in to claude.ai to see resets"}
                  </button>
                </div>
              </div>
            )}
            {p.idle && p.idle.length > 0 && !p.error && (
              <div className="usage-idle">
                <span className="usage-idle-head">Unused</span>
                <span className="usage-pills">{p.idle.map((n) => <span key={n} className="usage-pill usage-pill-idle">{n}</span>)}</span>
              </div>
            )}
            {p.note && !p.error && <p className="usage-note">{p.note}</p>}
          </section>
        ))}
      </div>
      {drag && createPortal(
        <div className="usage-drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {(() => {
            const p = providers.find((x) => x.key === drag.key);
            return p ? <>{p.logo && <img src={p.logo} alt="" />}{p.name}</> : null;
          })()}
        </div>,
        document.body,
      )}
    </div>
  );
}
