import { useSyncExternalStore } from "react";
import { v4 as uuidv4 } from "uuid";

// Deletions are reversible for a short window. The thing is removed from the UI
// right away, but anything destructive (killing a shell) is held back in
// `commit` until the window closes, so Undo can bring back a live terminal.

export interface UndoEntry {
  id: string;
  label: string;
  undo: () => void;
  commit?: () => void;
}

const UNDO_WINDOW_MS = 10000;

let entries: UndoEntry[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function drop(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  entries = entries.filter((e) => e.id !== id);
  emit();
}

export function pushUndo(label: string, undo: () => void, commit?: () => void) {
  const entry: UndoEntry = { id: uuidv4(), label, undo, commit };
  entries = [...entries, entry];
  timers.set(entry.id, setTimeout(() => {
    drop(entry.id);
    entry.commit?.();
  }, UNDO_WINDOW_MS));
  emit();
}

export function undoEntry(id: string) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  drop(id);
  entry.undo();
}

export function undoLatest(): boolean {
  const latest = entries[entries.length - 1];
  if (!latest) return false;
  undoEntry(latest.id);
  return true;
}

export function dismissEntry(id: string) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  drop(id);
  entry.commit?.();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUndoEntries(): UndoEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

export function insertAt<T>(list: T[], index: number, item: T): T[] {
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
}
