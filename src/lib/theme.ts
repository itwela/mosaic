// App themes. "mosaic" (stained glass) is the default; each other theme is a
// stylesheet scoped under :root[data-theme="<id>"]. The Fieldnotes iframes
// mirror the attribute from their parent, so one switch restyles everything.
import { useEffect, useState } from "react";

export type ThemeId = "mosaic" | "aero";

export const THEMES: { id: ThemeId; name: string; desc: string }[] = [
  { id: "mosaic", name: "Mosaic", desc: "Stained glass in dark lead" },
  { id: "aero", name: "Frutiger Aero", desc: "Sky, glossy glass and fresh green" },
];

// Frutiger Aero wallpapers in /textures/aero/, generated with GPT Image 2
// (via Zen Studio) in the style of mid-2000s Asadal stock wallpapers.
export type AeroWallpaper = "skyline" | "tree" | "park" | "dandelion";

export const AERO_WALLPAPERS: { id: AeroWallpaper; name: string }[] = [
  { id: "skyline", name: "Skyline" },
  { id: "tree", name: "Lone tree" },
  { id: "park", name: "Park" },
  { id: "dandelion", name: "Dandelion" },
];

const KEY = "mosaic-theme";
const WALLPAPER_KEY = "mosaic-aero-wallpaper";
const listeners = new Set<(t: ThemeId) => void>();

export function getTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  } catch {}
  return "mosaic";
}

export function getWallpaper(): AeroWallpaper {
  try {
    const saved = localStorage.getItem(WALLPAPER_KEY);
    if (AERO_WALLPAPERS.some((w) => w.id === saved)) return saved as AeroWallpaper;
  } catch {}
  return "skyline";
}

export function applyTheme(theme: ThemeId = getTheme()) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.wallpaper = getWallpaper();
}

export function setWallpaper(wallpaper: AeroWallpaper) {
  try { localStorage.setItem(WALLPAPER_KEY, wallpaper); } catch {}
  document.documentElement.dataset.wallpaper = wallpaper;
  wallpaperListeners.forEach((fn) => fn(wallpaper));
}

const wallpaperListeners = new Set<(w: AeroWallpaper) => void>();

export function useWallpaper(): AeroWallpaper {
  const [wallpaper, set] = useState(getWallpaper);
  useEffect(() => {
    wallpaperListeners.add(set);
    return () => { wallpaperListeners.delete(set); };
  }, []);
  return wallpaper;
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
