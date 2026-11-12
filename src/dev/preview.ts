// Browser preview for design work: `npm run dev`, then open http://localhost:1420
// in a normal browser. There is no Tauri backend there, so this stands in for it
// with scripted shells and statuses. It is only loaded in dev and only when the
// page is not running inside Tauri; release builds never include it.

const E = "\x1b[";
const dim = (s: string) => `${E}90m${s}${E}0m`, green = (s: string) => `${E}32m${s}${E}0m`, red = (s: string) => `${E}31m${s}${E}0m`;
const amber = (s: string) => `${E}33m${s}${E}0m`, blue = (s: string) => `${E}34m${s}${E}0m`, agent = (s: string) => `${E}38;2;224;133;95m${s}${E}0m`;
const head = `Claude Code v2.1.317\r\n${dim("Opus 5.5 with low effort · Claude Pro")}\r\n${dim("~/Desktop/Code/PoC")}\r\n\r\n`;

const SCRIPTS: { chain: string[]; process: boolean; text: string }[] = [
  {
    chain: ["claude"], process: true,
    text: head + `${E}48;2;22;17;14m> Move /terms onto the shared site shell and          ${E}0m\r\n${E}48;2;22;17;14m  check it at 390 and 1440                             ${E}0m\r\n\r\n` +
      `${agent("*")} Reading app/terms/page.tsx\r\n${agent("*")} Editing app/terms/page.tsx      ${green("+31")} ${red("-6")}\r\n${agent("*")} Editing app/privacy/page.tsx    ${green("+28")} ${red("-6")}\r\n${agent("*")} npm run build\r\n  ${dim("└")} ${green("✓ Compiled in 137ms (901 modules)")}\r\n${agent("*")} Checking at 390 and 1440…\r\n\r\n  ${dim("Privacy and terms theme mismatch")}\r\n\r\n\r\n> \r\n${amber("▸▸ auto mode on")} ${dim("· 1 agent · esc to interrupt")}`,
  },
  {
    chain: ["claude"], process: true,
    text: head + `${E}48;2;22;17;14m> ${blue("/cro-release-sync")}                                    ${E}0m\r\n\r\n` +
      `${agent("*")} Committed 14 files to release/phase-1\r\n${agent("*")} Built production images     ${dim("2m 08s")}\r\n  ${dim("└")} ${green("✓")} web  ${green("✓")} api  ${green("✓")} worker\r\n\r\nDo you want to proceed? Deploy to production AWS?\r\n${red("> 1. Yes, deploy")}\r\n  2. Yes, and don't ask again\r\n  3. No, tell Claude what to do`,
  },
  {
    chain: ["node next dev"], process: true,
    text: Array.from({ length: 16 }, (_, i) => i % 3 === 2 ? ` ${green("✓ Compiled in " + (130 + i * 7) + "ms (901 modules)")}` : ` GET /${i % 4 === 1 ? "privacy" : "terms"} ${green("200")} in ${20 + i}ms`).join("\r\n") + "\r\n",
  },
];

// Six stand-in screenshots: paper, dark, and four tinted pages.
const THUMBS = [["#f1ede4", "#b9b2a4"], ["#16130f", "#3a342c"], ["#f6ecea", "#d9534f"], ["#101c33", "#3f7be0"], ["#17130d", "#e0a23a"], ["#0d1d1c", "#4bc2a8"]].map(([bg, ink]) =>
  "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 56"><rect width="88" height="56" fill="${bg}"/><rect x="10" y="10" width="30" height="5" fill="${ink}"/><rect x="10" y="22" width="56" height="3" fill="${ink}" opacity=".6"/><rect x="10" y="30" width="44" height="3" fill="${ink}" opacity=".6"/><rect x="10" y="38" width="50" height="3" fill="${ink}" opacity=".6"/></svg>`));

// The workspace from the design file, so a fresh browser profile opens on something to look at.
// The saved commands from the design file.
function seedCommands() {
  if (localStorage.getItem("mosaic-command-db")) return;
  const rows: [string, string, string, number][] = [["Start the project", "npm run dev", "npm", 9], ["Cursor agent", "cursor-agent", "other", 4], ["Paperclip", "paperclip", "npm", 4],
    ["DeepSeek harness command", "npx @deepseek-ai/dsh --profile web", "npm", 2], ["Antigravity", "agy", "other", 2], ["Antigravity model options", "agy models", "other", 1],
    ["Start the local Postgres DB", "npm run db:local", "npm", 6], ["DB UI", "open -a TablePlus postgresql://127.0.0.1:5432/veh", "fs", 3], ["cd into book blender file", "cd ~/Documents/Code/2026-09-24/i-need-you-to-make-a", "fs", 1],
    ["Claude Code", "claude", "other", 10], ["Codex", "codex", "other", 7], ["Gemini CLI", "gemini", "other", 1],
    ["OpenCode", "opencode", "other", 1], ["T3 Code", 'open -a "T3 Code (Beta)"', "other", 2], ["Paperclip run", "npx paperclipai run", "npm", 5]];
  localStorage.setItem("mosaic-command-db", JSON.stringify(rows.map(([label, text, category, copyCount], i) => ({ id: `demo-${i}`, label, text, category, copyCount, createdAt: Date.now() - i * 60000, lastUsedAt: Date.now() - i * 60000 }))));
}

function seedDemo() {
  if (localStorage.getItem("mosaic-workspaces")) return;
  const u = () => crypto.randomUUID();
  const term = (cwd?: string, extra?: string) => { const t = { id: u(), title: "shell", cwd }; const tabs = extra ? [t, { id: u(), title: extra, cwd }] : [t]; return { id: u(), type: "terminal", tabs, activeTabId: t.id }; };
  const board = (name: string, items: [string, string, string][]) => ({ id: u(), type: "launcher", tabs: [], activeTabId: "", name, launchItems: items.map(([n, path, kind]) => ({ id: u(), name: n, path, kind })) });
  const poc = "/Users/you/Desktop/Code/PoC";
  const first = [term(poc, "zsh"), term(poc), term(poc),
    board("Backend", [["api", poc + "/api", "file"], ["AWS console", "console.aws.amazon.com", "url"], ["launch-test-capacity.md", "fieldnotes/files/veh/launch-test-capacity.md", "file"]]),
    board("Frontend", [["PoC", poc, "file"], ["Terms page", "localhost:3000/terms", "url"], ["Cursor", "/Applications/Cursor.app", "file"]]),
    board("Hot Links", [["Jira board", "crescentglob-team.atlassian.net", "url"], ["figcraft-work", "/Users/you/Desktop/Code/figcraft-work", "file"], ["GitHub · PoC", "github.com", "url"]]),
    { id: u(), type: "usage", tabs: [], activeTabId: "" }, { id: u(), type: "fieldnotes", tabs: [], activeTabId: "", viewId: u() }];
  const names = ["Vous Êtes Héritage", "Nym", "Hala Card", "Bellhop / Kodawari", "School", "CMC", "Agents", "Career", "Life", "Design"];
  localStorage.setItem("mosaic-workspaces", JSON.stringify(names.map((name, i) => ({ id: u(), name, panels: i ? [term()] : first, layout: [] }))));
  localStorage.setItem("mosaic-screenshot-folder", "~/Desktop/Screenshots");
}

const callbacks = new Map<number, (v: unknown) => void>();
const listeners = new Map<string, number[]>();
const order: string[] = [];
let nextId = 1;

// Shells are scripted in the order they open; the second one is the spare "zsh" tab and stays a plain prompt.
const slot = (id: string) => [0, -1, 1, 2][order.indexOf(id)] ?? -1;

function emit(event: string, payload: unknown) {
  for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
}

const setupPreview = new URLSearchParams(location.search).get("setup");
const setupState = { disk: setupPreview === "done", hooks: setupPreview === "done", codex: setupPreview === "done", login: setupPreview === "done" || setupPreview === "progress" };
async function invoke(cmd: string, args: Record<string, any> = {}): Promise<unknown> {
  switch (cmd) {
    case "plugin:event|listen":
      listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]);
      return args.handler;
    case "plugin:event|unlisten": return null;
    case "pty_create": {
      if (!order.includes(args.id)) order.push(args.id);
      const script = SCRIPTS[slot(args.id)];
      setTimeout(() => emit(`pty-data-${args.id}`, script ? script.text : `${dim("~")} ${green("❯")} `), 300);
      return null;
    }
    case "pty_statuses":
      return order.map((id) => ({ id, i: slot(id) })).map(({ id, i }) => ({
        id, foreground: SCRIPTS[i]?.chain[0] ?? "zsh", chain: SCRIPTS[i]?.chain ?? ["zsh"], running: i < 3,
        silent_ms: i === 0 ? 200 : 60000, has_process: !!SCRIPTS[i]?.process, hook_state: null, hook_at: null,
      }));
    case "list_screenshots": return { folder: "~/Desktop/Screenshots", files: THUMBS.map((_, i) => ({ path: `/shots/shot-${i}.png`, name: `shot-${i}.png`, modified: i })) };
    case "screenshot_thumbnail": return THUMBS[Number(/shot-(\d+)/.exec(args.path)?.[1] ?? 0) % THUMBS.length];
    case "provider_usage": {
      const now = Date.now() / 1000;
      const iso = (sec: number) => new Date((now + sec) * 1000).toISOString();
      const bucket = (window: string, used: number, sec: number) => ({ window, remaining_fraction: 1 - used / 100, reset_time: iso(sec) });
      return {
        claude: { ok: true, data: { plan: "pro", source: "statusline", observed_at: now - 240,
          limits: [{ kind: "weekly_model", percent: 16, resets_at: iso(6 * 86400), scope: { model: { display_name: "Fable" } } }],
          five_hour: { utilization: 66, resets_at_epoch: now + 12060 }, seven_day: { utilization: 10, resets_at_epoch: now + 6 * 86400 } } },
        codex: { ok: true, data: { plan_type: "plus", live: true, reset_credits: { available_count: 2 }, primary: { used_percent: 0, window_minutes: 300, resets_at: now + 15300 }, secondary: { used_percent: 2, window_minutes: 10080, resets_at: now + 7 * 86400 } } },
        cursor: { ok: true, data: { planUsage: { totalPercentUsed: 7, autoPercentUsed: 7 }, billingCycleEnd: (now + 6 * 86400) * 1000 } },
        antigravity: { ok: true, data: { summary: { groups: [
          { displayName: "Gemini 4 Argon", buckets: [bucket("weekly", 63, 5 * 86400)] },
          { displayName: "Claude and GPT", buckets: [bucket("five_hour", 0, 17820), bucket("weekly", 52, 5 * 86400)] },
          { displayName: "Gemini", buckets: [bucket("five_hour", 0, 17820), bucket("weekly", 2, 5 * 86400)] },
        ] } } },
        deepseek: { ok: true, data: { is_available: true, balance_infos: [{ total_balance: "6.77", currency: "USD", granted_balance: "0" }] } },
      };
    }
    case "claude_resets": return { ok: true, data: { grants: [
      { label: "Limit reset", resets_left: 2, ends_at: new Date(Date.now() + 20 * 86400000).toISOString(), clears: ["five_hour", "seven_day"], usable_now: true },
    ] } };
    case "setup_identity": return "mosaic-preview-stable-identity";
    case "setup_folders": return null;
    case "setup_disk_access": return setupState.disk;
    case "setup_open_disk_settings": setupState.disk = true; return null;
    case "setup_codex_enabled": return setupState.codex;
    case "setup_enable_codex": setupState.codex = true; return null;
    case "install_agent_hooks": setupState.hooks = true; return null;
    case "plugin:autostart|is_enabled": return setupState.login;
    case "plugin:autostart|enable": setupState.login = true; return null;
    case "agent_hooks_installed": return setupState.hooks;
    case "list_applications": return [];
    case "plugin:window|outer_size":
    case "plugin:window|inner_size": return { width: innerWidth * devicePixelRatio, height: innerHeight * devicePixelRatio };
    case "plugin:window|outer_position":
    case "plugin:window|inner_position": return { x: 0, y: 0 };
    case "plugin:window|scale_factor": return devicePixelRatio;
    case "plugin:window|is_fullscreen":
    case "plugin:window|is_maximized": return false;
    default:
      if (cmd.startsWith("fieldnotes_")) throw new Error("preview: no backend");
      return null;
  }
}

export function installPreview() {
  const w = window as any;
  w.__MOSAIC_PREVIEW__ = true;
  seedDemo();
  seedCommands();
  w.isTauri = true;
  w.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(cb: (v: unknown) => void) { const id = nextId++; callbacks.set(id, cb); return id; },
    unregisterCallback(id: number) { callbacks.delete(id); },
    convertFileSrc: (p: string) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  w.__TAURI_OS_PLUGIN_INTERNALS__ = {};
}
