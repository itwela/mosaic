import { useSyncExternalStore } from "react";
import { v4 as uuidv4 } from "uuid";
import { insertAt, pushUndo } from "./undo";

// Global, cross-terminal command database. Every command saved to a tab's
// toolbox (or copied) is recorded here so it can be searched, filtered, and
// ranked by how often it gets used ("hot" vs "cold").

export interface CommandRecord {
  id: string;
  text: string;
  label?: string;
  category: string;
  copyCount: number;
  lastUsedAt?: number;
  createdAt: number;
}

const STORAGE_KEY = "mosaic-command-db";

let db: CommandRecord[] = load();
const listeners = new Set<() => void>();

function load(): CommandRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* start fresh */
  }
  return [];
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* storage full or unavailable */
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function mutate(fn: (d: CommandRecord[]) => CommandRecord[]) {
  db = fn(db);
  persist();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCommandDb(): CommandRecord[] {
  return useSyncExternalStore(subscribe, () => db);
}

const CATEGORY_MAP: Record<string, string> = {
  git: "git",
  npm: "npm", yarn: "npm", pnpm: "npm", npx: "npm",
  node: "js", deno: "js", bun: "js", tsx: "js", vite: "js",
  docker: "docker", "docker-compose": "docker",
  cd: "fs", ls: "fs", mkdir: "fs", rm: "fs", mv: "fs", cp: "fs",
  touch: "fs", cat: "fs", open: "fs", find: "fs", chmod: "fs", chown: "fs",
  python: "python", python3: "python", pip: "python", pip3: "python", uv: "python",
  curl: "network", wget: "network", ping: "network",
  ssh: "ssh", scp: "ssh", sftp: "ssh",
  claude: "agent", opencode: "agent", codex: "agent", antigravity: "agent",
  cursor: "agent", gemini: "agent", aider: "agent", copilot: "agent",
  brew: "brew",
  cargo: "rust", rustc: "rust",
  psql: "db", mysql: "db", sqlite3: "db", redis: "db",
  aws: "aws", gcloud: "cloud", terraform: "cloud", az: "cloud",
  ffmpeg: "media", "yt-dlp": "media", "gallery-dl": "media", whisper: "media",
  rsync: "sync", tar: "archive", zip: "archive", unzip: "archive",
  sudo: "system", kill: "system", ps: "system", top: "system", htop: "system",
  df: "system", du: "system", env: "system",
};

export function categorize(text: string): string {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (CATEGORY_MAP[first]) return CATEGORY_MAP[first];
  if (first.startsWith("git")) return "git";
  if (first.startsWith("docker")) return "docker";
  return "other";
}

export function recordCommand(text: string, label?: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (db.some((c) => c.text === trimmed)) return;
  mutate((d) => [
    ...d,
    {
      id: uuidv4(),
      text: trimmed,
      label: label?.trim() || undefined,
      category: categorize(trimmed),
      copyCount: 0,
      createdAt: Date.now(),
    },
  ]);
}

export function incrementCopy(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const existing = db.find((c) => c.text === trimmed);
  if (existing) {
    mutate((d) =>
      d.map((c) =>
        c.text === trimmed
          ? { ...c, copyCount: c.copyCount + 1, lastUsedAt: Date.now() }
          : c,
      ),
    );
  } else {
    mutate((d) => [
      ...d,
      {
        id: uuidv4(),
        text: trimmed,
        category: categorize(trimmed),
        copyCount: 1,
        lastUsedAt: Date.now(),
        createdAt: Date.now(),
      },
    ]);
  }
}

export function setCategory(id: string, category: string) {
  mutate((d) => d.map((c) => (c.id === id ? { ...c, category } : c)));
}

export function removeCommand(id: string) {
  const index = db.findIndex((c) => c.id === id);
  const record = db[index];
  mutate((d) => d.filter((c) => c.id !== id));
  if (record) {
    pushUndo(`Deleted command "${record.label || record.text.slice(0, 32)}"`, () => {
      mutate((d) => (d.some((c) => c.id === record.id) ? d : insertAt(d, index, record)));
    });
  }
}

export function clearCommands() {
  mutate(() => []);
}

export type HeatLevel = "cold" | "cool" | "warm" | "hot" | "hotter";

export function heatLevel(count: number): HeatLevel {
  if (count <= 0) return "cold";
  if (count <= 1) return "cool";
  if (count <= 3) return "warm";
  if (count <= 6) return "hot";
  return "hotter";
}

export const HEAT_COLORS: Record<HeatLevel, string> = {
  cold: "#4a5568",
  cool: "#5b7bb4",
  warm: "#c99a4a",
  hot: "#e07a3a",
  hotter: "#e0453a",
};

export const HEAT_LABELS: Record<HeatLevel, string> = {
  cold: "cold",
  cool: "cool",
  warm: "warm",
  hot: "hot",
  hotter: "hot",
};

export function allCategories(records: CommandRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) set.add(r.category);
  return [...set].sort();
}
