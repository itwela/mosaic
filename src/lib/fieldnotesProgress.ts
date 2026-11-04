import { useEffect, useState } from "react";

// The Field notes iframe posts this after every render. Counts come from the
// same client files and saved checklist state the page itself uses. When
// my-clients.js / workstreams-data.js are absent, the page has no clients and
// reports empty — the dashboard shows that, and does not invent a total.
export interface FieldnotesProgress {
  ready: boolean;
  empty: boolean;
  client: string;
  short: string;
  done: number;
  active: number;
  total: number;
  remaining: number;
}

const EMPTY: FieldnotesProgress = {
  ready: false,
  empty: true,
  client: "",
  short: "",
  done: 0,
  active: 0,
  total: 0,
  remaining: 0,
};

export function useFieldnotesProgress(): FieldnotesProgress {
  const [value, setValue] = useState<FieldnotesProgress>(EMPTY);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== "fieldnotes" || data.type !== "progress" || data.pane !== "main") return;
      const total = Number(data.total) || 0;
      const done = Number(data.done) || 0;
      const active = Number(data.active) || 0;
      setValue({
        ready: true,
        empty: Boolean(data.empty) || total === 0 && !data.client,
        client: String(data.client || ""),
        short: String(data.short || ""),
        done,
        active,
        total,
        remaining: Number.isFinite(Number(data.remaining)) ? Number(data.remaining) : Math.max(0, total - done),
      });
    };
    window.addEventListener("message", onMessage);
    // If the frame never answers (blocked script, closed early), stop waiting.
    const giveUp = window.setTimeout(() => {
      setValue((current) => current.ready ? current : { ...current, ready: true, empty: true });
    }, 4000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(giveUp);
    };
  }, []);

  return value;
}
