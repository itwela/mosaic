// App themes. "mosaic" (stained glass) is the default; each other theme is a
// stylesheet scoped under :root[data-theme="<id>"]. The Fieldnotes iframes
// mirror the attribute from their parent, so one switch restyles everything.
import { useEffect, useState } from "react";

export type ThemeId = "mosaic" | "aero";

export const THEMES: { id: ThemeId; name: string; desc: string }[] = [
  { id: "mosaic", name: "Mosaic", desc: "Stained glass in dark lead" },
  { id: "aero", name: "Frutiger Aero", desc: "Sky, glossy glass and fresh green" },
];

const KEY = "mosaic-theme";
const listeners = new Set<(t: ThemeId) => void>();

export function getTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  } catch {}
  return "mosaic";
}

export function applyTheme(theme: ThemeId = getTheme()) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: ThemeId) {
  try { localStorage.setItem(KEY, theme); } catch {}
  applyTheme(theme);
  listeners.forEach((fn) => fn(theme));
}

export function useTheme(): ThemeId {
  const [theme, set] = useState(getTheme);
  useEffect(() => {
    listeners.add(set);
    return () => { listeners.delete(set); };
  }, []);
  return theme;
}
