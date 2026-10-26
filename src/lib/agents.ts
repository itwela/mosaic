import { AgentStatus } from "../types";

// Shape returned by the Rust `pty_statuses` command for each live terminal.
export interface SessionStatus {
  id: string;
  foreground: string;
  chain: string[];
  running: boolean;
  silent_ms: number;
  has_process: boolean;
  // State the agent reported itself via the Mosaic hooks (Claude Code), with
  // the time it was written in ms since the epoch.
  hook_state?: string | null;
  hook_at?: number | null;
}

// Signals the frontend collects per tab: desktop notifications the agent sent
// through the terminal (OSC 9 / OSC 777, used by Codex and others) and the last
// time the user typed into the tab.
export interface TabSignals {
  notify?: { state: "attention" | "ready"; at: number };
  inputAt?: number;
}

// A TUI that is working redraws its spinner every frame. Several seconds of
// total silence means it is sitting at its prompt.
const QUIET_MS = 4000;

interface AgentBadge {
  key: string;
  name: string;
  glyph: string;
  logo?: string;
  color: string;
}

// Known agent binaries, in priority order. `key` is matched (lowercased)
// against the process names in a terminal's process tree.
const AGENTS: AgentBadge[] = [
  { key: "claude", logo: "/agent-logos/claude.svg", name: "Claude Code", glyph: "✳", color: "#D97757" },
  { key: "opencode", logo: "/agent-logos/opencode.svg", name: "OpenCode", glyph: "◈", color: "#A78BFA" },
  { key: "codex", logo: "/agent-logos/openai.svg", name: "Codex", glyph: "⌘", color: "#10A37F" },
  { key: "antigravity", logo: "/agent-logos/antigravity.svg", name: "Antigravity", glyph: "▲", color: "#4285F4" },
  { key: "cursor-agent", logo: "/agent-logos/cursor.svg", name: "Cursor", glyph: "▮", color: "#E8E8E8" },
  { key: "cursor", logo: "/agent-logos/cursor.svg", name: "Cursor", glyph: "▮", color: "#E8E8E8" },
  { key: "gemini", logo: "/agent-logos/gemini.svg", name: "Gemini", glyph: "✦", color: "#9A8CFF" },
  { key: "aider", name: "Aider", glyph: "A", color: "#5B8DEF" },
  { key: "warp", name: "Warp", glyph: "▢", color: "#01A4FF" },
  { key: "cline", logo: "/agent-logos/cline.svg", name: "Cline", glyph: "C", color: "#B05CFF" },
  { key: "roo", name: "Roo", glyph: "R", color: "#D97757" },
  { key: "copilot", logo: "/agent-logos/copilot.svg", name: "Copilot", glyph: "⎇", color: "#8B949E" },
  { key: "openclaw", logo: "/agent-logos/openclaw.svg", name: "OpenClaw", glyph: "◈", color: "#7AAB9C" },
  { key: "kairo", name: "Kairo", glyph: "◈", color: "#7AAB9C" },
  { key: "gpt", logo: "/agent-logos/openai.svg", name: "GPT", glyph: "✦", color: "#10A37F" },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectAgent(chain: string[]): string | null {
  // `chain` now holds full command lines (argv), not truncated `comm`. Match the
  // agent binary name as a whole word anywhere in the command so pathed names
  // ("…/bin/codex") and truncated ones still resolve.
  const haystack = chain.map((c) => c.toLowerCase());
  if (haystack.some((c) => /\b(?:antigravity|agy|language_server_macos(?:_arm|_x64)?)\b/.test(c))) return "antigravity";
  for (const agent of AGENTS) {
    const re = new RegExp(`\\b${escapeRegExp(agent.key)}\\b`);
    if (haystack.some((h) => re.test(h))) return agent.key;
  }
  return null;
}

export function agentBadge(key: string | null): AgentBadge | null {
  if (!key) return null;
  return AGENTS.find((a) => a.key === key) ?? null;
}

// Inspect the rendered terminal screen, rather than raw ANSI chunks or CPU
// scheduling state. Quiet network requests and animated prompts are both common.
export type AgentScreenState = "attention" | "running" | "ready" | "unknown";

// Only the bottom of the viewport counts. A tool confirmation that was answered
// ten minutes ago still sits in scrollback, and matching it keeps a finished tab
// red forever. Live dialogs are always drawn at the bottom, above the composer.
const SCREEN_WINDOW = 24;

// Borders, bullets, selection carets and spinner frames sit *inside* the words
// when a panel is narrow: "│ 1. Yes, just│" / "  this once (y)". Strip them, then
// collapse the wrap so a phrase reads the same at any panel width.
const BOX_GLYPHS = /[\u2500-\u257f\u2580-\u259f\u25a0-\u25ff\u2022\u2026\u00b7\u203a\u2039\u276f\u276e]/g;

export function screenWindow(screen: string, lines = SCREEN_WINDOW): string {
  const rows = screen.split("\n");
  return rows
    .slice(Math.max(0, rows.length - lines))
    .join(" ")
    .replace(/\u00a0/g, " ")
    .replace(BOX_GLYPHS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A prompt is only a prompt if the answer rows are on screen too. Anchoring on
// the question alone matches an agent *describing* an approval, and matching any
// single option matches a collapsed tool summary in the transcript.
interface AttentionRule {
  anchor: RegExp;
  choice: RegExp;
}

const ATTENTION_RULES: AttentionRule[] = [
  // Codex 0.164. The options differ per prompt type (command, edits, network,
  // permissions, send-input), so the first version's "yes, proceed" requirement
  // silently missed every variant that offered "yes, just this once".
  {
    anchor: /would you like to (?:run the following command|make the following edits|grant these permissions|send input to)/,
    choice: /(?:^|\s)(?:\d\.\s*yes|yes, (?:proceed|just this once)|no, (?:and tell codex|continue without running it|and block))/,
  },
  // Gemini CLI tool confirmation. "Allow execution of" also survives in the
  // collapsed history row after answering, so the live dialog is identified by
  // its numbered rows: the summary keeps the words but not the "1. Allow once".
  {
    anchor: /allow execution of/,
    choice: /(?:^|\s)\d\.\s*(?:allow (?:once|for this session|tool for this session|all server tools)|no, (?:suggest changes|deny))/,
  },
  // Claude Code permission prompt.
  {
    anchor: /do you want to (?:proceed|make this edit|run this|create)/,
    choice: /(?:^|\s)\d\.\s*yes|yes, and don'?t ask again|no, and tell claude/,
  },
  {
    anchor: /would you like to proceed|review the plan and approve/,
    choice: /(?:^|\s)\d\.\s*(?:yes|no)/,
  },
];

const RUNNING_RULES: RegExp[] = [
  /\besc to (?:interrupt|cancel|dismiss|stop)\b/,
  /\b(?:ctrl|control)\+c to (?:interrupt|cancel|stop)\b/,
  /\b(?:thinking|working|generating|executing|researching|responding)\s*(?:\.\.\.|…|\()/,
];

const READY_RULES: RegExp[] = [
  /ask (?:codex|claude|gemini|opencode) to/,
  /type your message/,
  /@path\/to\/file/,
  /for shortcuts/,
  /what would you like to do/,
  /[›❯]\s*(?:ask|try|type|$)/,
];

export function detectScreenState(screen: string): AgentScreenState {
  const text = screenWindow(screen);
  for (const rule of ATTENTION_RULES) {
    if (rule.anchor.test(text) && rule.choice.test(text)) return "attention";
  }
  // Direct question that names the requirement, with no option list to anchor on.
  if (/(?:waiting for (?:your|user) (?:input|approval)|permission required)/.test(text)) return "attention";
  // Work indicators before the input footer: TUIs keep their composer visible
  // while a turn is still running.
  if (RUNNING_RULES.some((rule) => rule.test(text))) return "running";
  if (READY_RULES.some((rule) => rule.test(text))) return "ready";
  return "unknown";
}

export function classifyStatus(s: SessionStatus, screen: AgentScreenState = "unknown", signals: TabSignals = {}): AgentStatus {
  const agent = detectAgent(s.chain);
  if (!agent) return s.has_process ? "terminal" : "idle";

  // The newest event the agent itself reported wins over reading the screen.
  const hook = s.hook_state && s.hook_at && s.hook_state !== "ended"
    ? { state: s.hook_state, at: s.hook_at }
    : null;
  const notify = signals.notify ?? null;
  const reported = hook && notify ? (hook.at >= notify.at ? hook : notify) : hook ?? notify;
  const answered = reported && (signals.inputAt ?? 0) > reported.at;

  if (screen === "attention") return "attention";
  if (reported?.state === "attention" && !answered) return "attention";
  if (screen === "running") return "running";
  if (reported?.state === "running") return s.silent_ms > QUIET_MS * 15 ? "ready" : "running";
  if (reported?.state === "ready" && !answered) return "ready";
  if (screen === "ready") return "ready";
  // Silence alone used to count as "running", which painted every idle agent
  // orange. A working TUI is never quiet for long.
  return s.silent_ms > QUIET_MS ? "ready" : "running";
}

export interface TabMeta {
  status: AgentStatus;
  agent: string | null;
}

export function sessionToMeta(s: SessionStatus, screen: AgentScreenState = "unknown", signals: TabSignals = {}): TabMeta {
  return { status: classifyStatus(s, screen, signals), agent: detectAgent(s.chain) };
}

// Classify the text of a desktop notification an agent sent via OSC 9/777.
export function notificationState(text: string): "attention" | "ready" {
  return /approv|permission|confirm|allow|waiting for (?:your )?input|needs? your|requires? (?:your )?(?:input|attention)/i.test(text)
    ? "attention"
    : "ready";
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  // jewel-glass tones to sit on the mosaic: opal, cobalt, topaz, ruby
  idle: "#5d6878",
  ready: "#a8b4c6",
  terminal: "#2f6fd6",
  running: "#e08a1e",
  attention: "#d0304e",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "idle",
  ready: "agent ready for a new prompt",
  terminal: "terminal process running",
  running: "agent running",
  attention: "needs attention",
};
